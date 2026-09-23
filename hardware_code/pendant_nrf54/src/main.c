#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/adc.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/pwm.h>
#include <zephyr/drivers/regulator.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/console/console.h>
#include <zephyr/data/json.h>
#include <zephyr/settings/settings.h>
#include <zephyr/sys/printk.h>

#include "detector.h"

#define FIRMWARE "xiao-nrf54l15/1.0"
#define OFFSET 19800
#define STATE_MAGIC 0x4c433534u
#define MAX_EVENTS 32
#define MAX_REMINDERS 8
#define MAX_PROMPTS 9
#define FRAME 192
#define TICK_MS 20

#define USER DT_PATH(zephyr_user)
static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET(USER, button_gpios);
static const struct gpio_dt_spec motor = GPIO_DT_SPEC_GET(USER, motor_gpios);
static const struct gpio_dt_spec leds[3] = {
	GPIO_DT_SPEC_GET_BY_IDX(USER, led_gpios, 0),
	GPIO_DT_SPEC_GET_BY_IDX(USER, led_gpios, 1),
	GPIO_DT_SPEC_GET_BY_IDX(USER, led_gpios, 2),
};
static const struct pwm_dt_spec buzzer = PWM_DT_SPEC_GET(USER);
static const struct adc_dt_spec vbat_adc = ADC_DT_SPEC_GET(USER);
static const struct device *const vbat_switch = DEVICE_DT_GET(DT_NODELABEL(vbat_pwr));
static const struct device *const imu = DEVICE_DT_GET(DT_ALIAS(imu0));

enum { RED, GREEN, BLUE };

struct stored_event {
	char id[12];
	char kind[16];
	char ref[40];
	uint32_t at;
};

struct reminder {
	char id[33];
	uint16_t minute;
	uint8_t enabled;
	uint32_t fired_day;
};

struct prompt {
	char ref[40];
	uint32_t expires;
	uint8_t checkin;
};

static struct {
	uint32_t magic, next_id, overflow;
	uint8_t count;
	struct stored_event items[MAX_EVENTS];
} queue;

static struct {
	uint32_t magic;
	uint8_t reminder_count, prompt_count, fall_pending;
	struct reminder reminders[MAX_REMINDERS];
	struct prompt prompts[MAX_PROMPTS];
	char last_command[33];
	uint32_t fall_deadline;
} plan;

static uint32_t passkey;
static int64_t epoch_base, uptime_base;
static bool sensor_ok, subscribed, warning_active, gyro_on, overflow_noted;
static int64_t warning_started, last_event_frame, last_status, last_battery, fast_adv_until, gyro_until;
static int battery_percent = -1;
static atomic_t connections;

struct line {
	char text[FRAME];
	uint16_t len;
};
K_MSGQ_DEFINE(rx_queue, sizeof(struct line), 16, 4);
K_MSGQ_DEFINE(tx_queue, sizeof(struct line), 8, 4);
static struct line rx_partial[CONFIG_BT_MAX_CONN];
static bool rx_discard[CONFIG_BT_MAX_CONN];

static struct reminder staging[MAX_REMINDERS];
static uint8_t staging_count, expected_count;
static bool staging_valid;
static char staging_version[20];

static void save_queue(void) { settings_save_one("loom/q", &queue, sizeof(queue)); }
static void save_plan(void) { settings_save_one("loom/p", &plan, sizeof(plan)); }

static uint32_t epoch_now(void)
{
	return epoch_base ? (uint32_t)(epoch_base + (k_uptime_get() - uptime_base) / 1000) : 0;
}

static int loom_set(const char *key, size_t len, settings_read_cb read_cb, void *cb_arg)
{
	if (!strcmp(key, "q") && len == sizeof(queue)) {
		read_cb(cb_arg, &queue, sizeof(queue));
	} else if (!strcmp(key, "p") && len == sizeof(plan)) {
		read_cb(cb_arg, &plan, sizeof(plan));
	} else if (!strcmp(key, "pin") && len == sizeof(passkey)) {
		read_cb(cb_arg, &passkey, sizeof(passkey));
	}
	return 0;
}

SETTINGS_STATIC_HANDLER_DEFINE(loom, "loom", NULL, loom_set, NULL, NULL);

static void send_frame(const char *text)
{
	struct line frame = {0};
	int len = snprintf(frame.text, sizeof(frame.text) - 1, "%s\n", text);

	if (!subscribed || len <= 1 || len >= (int)sizeof(frame.text) - 1) {
		return;
	}
	frame.len = len;
	k_msgq_put(&tx_queue, &frame, K_NO_WAIT);
}

static void receipt(const char *kind, const char *ref)
{
	char text[96];

	snprintf(text, sizeof(text), "{\"kind\":\"%s\",\"ref\":\"%s\"}", kind, ref);
	send_frame(text);
}

static bool emit(const char *kind, const char *ref)
{
	if (queue.count >= MAX_EVENTS) {
		if (!overflow_noted) {
			queue.overflow++;
			save_queue();
			overflow_noted = true;
		}
		return false;
	}
	overflow_noted = false;
	struct stored_event *event = &queue.items[queue.count++];

	snprintf(event->id, sizeof(event->id), "%u", queue.next_id++);
	strncpy(event->kind, kind, sizeof(event->kind) - 1);
	strncpy(event->ref, ref ? ref : "", sizeof(event->ref) - 1);
	event->at = epoch_now();
	save_queue();
	last_event_frame = 0;
	return true;
}

static void drop_prompt(int index)
{
	memmove(&plan.prompts[index], &plan.prompts[index + 1], (plan.prompt_count - index - 1) * sizeof(struct prompt));
	plan.prompt_count--;
}

struct command {
	const char *op, *id, *ref, *version;
	int64_t epoch, expires;
	int32_t minute, count;
	bool enabled;
};

static const struct json_obj_descr command_descr[] = {
	JSON_OBJ_DESCR_PRIM(struct command, op, JSON_TOK_STRING),
	JSON_OBJ_DESCR_PRIM(struct command, id, JSON_TOK_STRING),
	JSON_OBJ_DESCR_PRIM(struct command, ref, JSON_TOK_STRING),
	JSON_OBJ_DESCR_PRIM(struct command, version, JSON_TOK_STRING),
	JSON_OBJ_DESCR_PRIM(struct command, epoch, JSON_TOK_INT64),
	JSON_OBJ_DESCR_PRIM(struct command, expires, JSON_TOK_INT64),
	JSON_OBJ_DESCR_PRIM(struct command, minute, JSON_TOK_NUMBER),
	JSON_OBJ_DESCR_PRIM(struct command, count, JSON_TOK_NUMBER),
	JSON_OBJ_DESCR_PRIM(struct command, enabled, JSON_TOK_TRUE),
};
enum { F_OP, F_ID, F_REF, F_VERSION, F_EPOCH, F_EXPIRES, F_MINUTE, F_COUNT, F_ENABLED };
#define HAS(mask, field) ((mask) & BIT(field))

static void process_command(struct line *line)
{
	struct command cmd = {0};
	int64_t found = json_obj_parse(line->text, line->len, command_descr, ARRAY_SIZE(command_descr), &cmd);

	if (found < 0 || !HAS(found, F_OP)) {
		return;
	}
	if (!strcmp(cmd.op, "ack") && HAS(found, F_ID)) {
		if (queue.count && !strcmp(queue.items[0].id, cmd.id)) {
			memmove(&queue.items[0], &queue.items[1], (--queue.count) * sizeof(struct stored_event));
			save_queue();
			last_event_frame = 0;
		}
	} else if (!strcmp(cmd.op, "time") && HAS(found, F_EPOCH) && cmd.epoch > 1704067200LL && cmd.epoch < 4102444799LL) {
		epoch_base = cmd.epoch;
		uptime_base = k_uptime_get();
	} else if (!strcmp(cmd.op, "begin")) {
		staging_valid = HAS(found, F_COUNT) && HAS(found, F_VERSION) && cmd.count >= 0 && cmd.count <= MAX_REMINDERS && strlen(cmd.version) < sizeof(staging_version);
		expected_count = staging_valid ? cmd.count : 0;
		staging_count = 0;
		if (staging_valid) {
			strcpy(staging_version, cmd.version);
		}
	} else if (!strcmp(cmd.op, "reminder")) {
		if (!staging_valid || staging_count >= expected_count || !HAS(found, F_ID) || strlen(cmd.id) != 32 || !HAS(found, F_MINUTE) || cmd.minute < 0 || cmd.minute > 1439 || !HAS(found, F_ENABLED)) {
			staging_valid = false;
			return;
		}
		for (int i = 0; i < staging_count; i++) {
			if (!strcmp(staging[i].id, cmd.id)) {
				staging_valid = false;
				return;
			}
		}
		struct reminder *r = &staging[staging_count++];

		memset(r, 0, sizeof(*r));
		strcpy(r->id, cmd.id);
		r->minute = cmd.minute;
		r->enabled = cmd.enabled;
		for (int i = 0; i < plan.reminder_count; i++) {
			if (!strcmp(plan.reminders[i].id, cmd.id)) {
				r->fired_day = plan.reminders[i].fired_day;
			}
		}
	} else if (!strcmp(cmd.op, "commit")) {
		if (!staging_valid || staging_count != expected_count) {
			return;
		}
		memcpy(plan.reminders, staging, staging_count * sizeof(struct reminder));
		plan.reminder_count = staging_count;
		for (int i = 0; i < plan.prompt_count;) {
			bool keep = plan.prompts[i].checkin;

			for (int j = 0; j < plan.reminder_count && !keep; j++) {
				keep = plan.reminders[j].enabled && !strncmp(plan.prompts[i].ref, plan.reminders[j].id, 32);
			}
			if (keep) {
				i++;
			} else {
				drop_prompt(i);
			}
		}
		save_plan();
		staging_valid = false;
		receipt("config_received", staging_version);
	} else if (!strcmp(cmd.op, "checkin") && HAS(found, F_ID) && HAS(found, F_REF) && HAS(found, F_EXPIRES)) {
		uint32_t now = epoch_now();

		if (strlen(cmd.id) != 32 || strlen(cmd.ref) != 32 || !now || cmd.expires <= now || cmd.expires > now + 180) {
			return;
		}
		if (!strcmp(cmd.id, plan.last_command)) {
			receipt("receipt", cmd.id);
			return;
		}
		if (plan.prompt_count >= MAX_PROMPTS) {
			return;
		}
		struct prompt *p = &plan.prompts[plan.prompt_count++];

		strcpy(p->ref, cmd.ref);
		p->expires = cmd.expires;
		p->checkin = 1;
		strcpy(plan.last_command, cmd.id);
		save_plan();
		receipt("receipt", cmd.id);
	}
}

static ssize_t read_tx(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf, uint16_t len, uint16_t offset)
{
	return bt_gatt_attr_read(conn, attr, buf, len, offset, "", 0);
}

static ssize_t write_rx(struct bt_conn *conn, const struct bt_gatt_attr *attr, const void *buf, uint16_t len, uint16_t offset, uint8_t flags)
{
	uint8_t index = bt_conn_index(conn);
	struct line *partial = &rx_partial[index];
	const char *bytes = buf;

	for (uint16_t i = 0; i < len; i++) {
		if (bytes[i] == '\n') {
			if (!rx_discard[index] && partial->len) {
				partial->text[partial->len] = '\0';
				k_msgq_put(&rx_queue, partial, K_NO_WAIT);
			}
			partial->len = 0;
			rx_discard[index] = false;
		} else if (partial->len < FRAME - 2 && !rx_discard[index]) {
			partial->text[partial->len++] = bytes[i];
		} else {
			rx_discard[index] = true;
			partial->len = 0;
		}
	}
	return len;
}

static void tx_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
	subscribed = value == BT_GATT_CCC_NOTIFY;
	if (!subscribed) {
		k_msgq_purge(&tx_queue);
	}
}

#define SERVICE_UUID BT_UUID_128_ENCODE(0x8be12000, 0x7e34, 0x4b80, 0x8fd8, 0x7277a721e9bc)
static const struct bt_uuid_128 service_uuid = BT_UUID_INIT_128(SERVICE_UUID);
static const struct bt_uuid_128 tx_uuid = BT_UUID_INIT_128(BT_UUID_128_ENCODE(0x8be12001, 0x7e34, 0x4b80, 0x8fd8, 0x7277a721e9bc));
static const struct bt_uuid_128 rx_uuid = BT_UUID_INIT_128(BT_UUID_128_ENCODE(0x8be12002, 0x7e34, 0x4b80, 0x8fd8, 0x7277a721e9bc));

BT_GATT_SERVICE_DEFINE(loom_service,
	BT_GATT_PRIMARY_SERVICE(&service_uuid),
	BT_GATT_CHARACTERISTIC(&tx_uuid.uuid, BT_GATT_CHRC_NOTIFY | BT_GATT_CHRC_READ, BT_GATT_PERM_READ_AUTHEN, read_tx, NULL, NULL),
	BT_GATT_CCC(tx_ccc_changed, BT_GATT_PERM_READ_AUTHEN | BT_GATT_PERM_WRITE_AUTHEN),
	BT_GATT_CHARACTERISTIC(&rx_uuid.uuid, BT_GATT_CHRC_WRITE, BT_GATT_PERM_WRITE_AUTHEN, NULL, write_rx, NULL),
);

static const struct bt_data advertising[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR),
	BT_DATA_BYTES(BT_DATA_UUID128_ALL, SERVICE_UUID),
};
static const struct bt_data scan_response[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME, sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

static void advertise(struct k_work *work)
{
	bool fast = k_uptime_get() < fast_adv_until;
	struct bt_le_adv_param param = BT_LE_ADV_PARAM_INIT(BT_LE_ADV_OPT_CONN, fast ? BT_GAP_ADV_FAST_INT_MIN_2 : 1600, fast ? BT_GAP_ADV_FAST_INT_MAX_2 : 1760, NULL);

	bt_le_adv_stop();
	if (atomic_get(&connections) < CONFIG_BT_MAX_CONN) {
		bt_le_adv_start(&param, advertising, ARRAY_SIZE(advertising), scan_response, ARRAY_SIZE(scan_response));
	}
}
K_WORK_DEFINE(advertise_work, advertise);
K_WORK_DELAYABLE_DEFINE(slow_adv_work, advertise);

static void advertise_fast(void)
{
	fast_adv_until = k_uptime_get() + 30000;
	k_work_submit(&advertise_work);
	k_work_reschedule(&slow_adv_work, K_SECONDS(31));
}

static void connected(struct bt_conn *conn, uint8_t err)
{
	if (err) {
		return;
	}
	atomic_inc(&connections);
	bt_conn_set_security(conn, BT_SECURITY_L4);
	k_work_submit(&advertise_work);
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
	atomic_dec(&connections);
	rx_partial[bt_conn_index(conn)].len = 0;
}

static void recycled(void)
{
	k_work_submit(&advertise_work);
}

static void security_changed(struct bt_conn *conn, bt_security_t level, enum bt_security_err err)
{
	if (!err && level >= BT_SECURITY_L4) {
		struct bt_le_conn_param param = BT_LE_CONN_PARAM_INIT(720, 800, 0, 600);

		bt_conn_le_param_update(conn, &param);
		last_status = 0;
	} else if (err) {
		bt_conn_disconnect(conn, BT_HCI_ERR_AUTH_FAIL);
	}
}

BT_CONN_CB_DEFINE(connection_callbacks) = {
	.connected = connected,
	.disconnected = disconnected,
	.recycled = recycled,
	.security_changed = security_changed,
};

static void passkey_display(struct bt_conn *conn, unsigned int key) {}
static void auth_cancel(struct bt_conn *conn) {}
static uint32_t app_passkey(struct bt_conn *conn) { return passkey; }

static struct bt_conn_auth_cb auth_callbacks = {
	.passkey_display = passkey_display,
	.cancel = auth_cancel,
	.app_passkey = app_passkey,
};

static void tx_thread(void)
{
	struct line frame;

	for (;;) {
		k_msgq_get(&tx_queue, &frame, K_FOREVER);
		for (uint16_t offset = 0; offset < frame.len && subscribed;) {
			uint16_t chunk = MIN(20, frame.len - offset);

			if (bt_gatt_notify(NULL, &loom_service.attrs[1], frame.text + offset, chunk) == 0) {
				offset += chunk;
			}
			k_sleep(K_MSEC(12));
		}
	}
}
K_THREAD_DEFINE(tx_tid, 1536, tx_thread, NULL, NULL, NULL, 7, 0, 0);

static void provision_pin(void)
{
	char digits[7];
	uint8_t length = 0;
	bool invalid = false;

	console_init();
	printk("Setup required: enter a private 6-digit BLE PIN (100000-999999), then Enter. Input is not echoed. Monitoring starts after setup.\n");
	while (!passkey) {
		int c = console_getchar();

		if (c == '\r' || c == '\n') {
			if (!invalid && length == 6) {
				digits[6] = '\0';
				uint32_t candidate = strtoul(digits, NULL, 10);

				if (candidate >= 100000 && candidate <= 999999 && settings_save_one("loom/pin", &candidate, sizeof(candidate)) == 0) {
					passkey = candidate;
				}
			}
			if (!passkey && length) {
				printk("PIN not saved; retry six digits. Do not share this PIN.\n");
			}
			length = 0;
			invalid = false;
			memset(digits, 0, sizeof(digits));
		} else if (c >= '0' && c <= '9' && length < 6) {
			digits[length++] = (char)c;
		} else {
			invalid = true;
		}
	}
	printk("BLE provisioning complete. The PIN will not be displayed or logged.\n");
}

static void configure_imu(void)
{
	struct sensor_value accel_range = {16, 0}, gyro_range = {500, 0}, odr = {50, 0}, off = {0, 0};

	sensor_ok = device_is_ready(imu) &&
		    !sensor_attr_set(imu, SENSOR_CHAN_ACCEL_XYZ, SENSOR_ATTR_FULL_SCALE, &accel_range) &&
		    !sensor_attr_set(imu, SENSOR_CHAN_ACCEL_XYZ, SENSOR_ATTR_SAMPLING_FREQUENCY, &odr) &&
		    !sensor_attr_set(imu, SENSOR_CHAN_GYRO_XYZ, SENSOR_ATTR_FULL_SCALE, &gyro_range) &&
		    !sensor_attr_set(imu, SENSOR_CHAN_GYRO_XYZ, SENSOR_ATTR_SAMPLING_FREQUENCY, &off);
	gyro_on = false;
}

static void set_gyro(bool on)
{
	struct sensor_value odr = {on ? 50 : 0, 0};

	if (on != gyro_on && !sensor_attr_set(imu, SENSOR_CHAN_GYRO_XYZ, SENSOR_ATTR_SAMPLING_FREQUENCY, &odr)) {
		gyro_on = on;
	}
}

static void start_warning(int64_t now)
{
	warning_active = true;
	warning_started = now;
	plan.fall_pending = 1;
	plan.fall_deadline = epoch_now() ? epoch_now() + 15 : 0;
	save_plan();
	receipt("local_warning", "15");
	advertise_fast();
}

static void sample_motion(int64_t now)
{
	struct sensor_value accel[3], gyro[3] = {0};

	if (!device_is_ready(imu) || sensor_sample_fetch(imu) || sensor_channel_get(imu, SENSOR_CHAN_ACCEL_XYZ, accel) ||
	    (gyro_on && sensor_channel_get(imu, SENSOR_CHAN_GYRO_XYZ, gyro))) {
		if (sensor_ok) {
			emit("device_fault", NULL);
		}
		sensor_ok = false;
		return;
	}
	if (!sensor_ok) {
		configure_imu();
		return;
	}
	float ax = sensor_value_to_float(&accel[0]) / 9.80665f, ay = sensor_value_to_float(&accel[1]) / 9.80665f, az = sensor_value_to_float(&accel[2]) / 9.80665f;
	float magnitude = ax * ax + ay * ay + az * az;

	if (magnitude < 0.6f * 0.6f || magnitude > 1.8f * 1.8f) {
		gyro_until = now + 6000;
	}
	set_gyro(now < gyro_until);
	if (!warning_active && loom_detector_update(ax, ay, az, sensor_value_to_float(&gyro[0]) * 57.29578f, sensor_value_to_float(&gyro[1]) * 57.29578f,
						     sensor_value_to_float(&gyro[2]) * 57.29578f, (uint32_t)now)) {
		start_warning(now);
	}
}

static void button_tick(int64_t now)
{
	static bool raw_last, down, held;
	static int64_t changed_at, down_at;
	bool raw = gpio_pin_get_dt(&button) == 1;

	if (raw != raw_last) {
		raw_last = raw;
		changed_at = now;
	}
	if (now - changed_at >= 35 && down != raw) {
		down = raw;
		if (down) {
			down_at = now;
			held = false;
		} else if (!held) {
			if (warning_active) {
				if (emit("fall_cancelled", NULL)) {
					warning_active = false;
					plan.fall_pending = 0;
					save_plan();
				}
			} else if (plan.prompt_count) {
				int index = 0;

				for (int i = 0; i < plan.prompt_count; i++) {
					if (plan.prompts[i].checkin) {
						index = i;
						break;
					}
				}
				if (emit(plan.prompts[index].checkin ? "checkin_ack" : "reminder_ack", plan.prompts[index].ref)) {
					drop_prompt(index);
					save_plan();
				}
			}
		}
	}
	if (down && !held && now - down_at >= 2000) {
		held = true;
		if (emit("sos", NULL)) {
			warning_active = false;
			plan.fall_pending = 0;
			save_plan();
			advertise_fast();
		}
	}
}

static void reminder_tick(void)
{
	uint32_t now = epoch_now();
	bool changed = false;

	if (!now) {
		return;
	}
	uint32_t day = (now + OFFSET) / 86400;

	for (int i = 0; i < plan.prompt_count;) {
		if (plan.prompts[i].expires <= now) {
			drop_prompt(i);
			changed = true;
		} else {
			i++;
		}
	}
	for (int i = 0; i < plan.reminder_count; i++) {
		struct reminder *r = &plan.reminders[i];
		uint32_t due = day * 86400 - OFFSET + r->minute * 60;

		if (r->enabled && r->fired_day != day && now >= due && now < due + 300 && plan.prompt_count < MAX_PROMPTS) {
			struct prompt *p = &plan.prompts[plan.prompt_count++];

			snprintf(p->ref, sizeof(p->ref), "%s:%u", r->id, day);
			p->checkin = 0;
			p->expires = due + 300;
			r->fired_day = day;
			changed = true;
		}
	}
	if (changed) {
		save_plan();
	}
}

static void read_battery(void)
{
	int16_t raw = 0;
	int32_t millivolts;
	struct adc_sequence sequence = {.buffer = &raw, .buffer_size = sizeof(raw)};

	battery_percent = -1;
	if (!adc_is_ready_dt(&vbat_adc) || adc_channel_setup_dt(&vbat_adc) || adc_sequence_init_dt(&vbat_adc, &sequence)) {
		return;
	}
	if (device_is_ready(vbat_switch)) {
		regulator_enable(vbat_switch);
		k_msleep(5);
	}
	int err = adc_read_dt(&vbat_adc, &sequence);

	if (device_is_ready(vbat_switch)) {
		regulator_disable(vbat_switch);
	}
	millivolts = raw;
	if (err || adc_raw_to_millivolts_dt(&vbat_adc, &millivolts)) {
		return;
	}
	millivolts *= 2;
	if (millivolts > 2800 && millivolts < 4400) {
		battery_percent = CLAMP((millivolts - 3300) * 100 / 900, 0, 100);
	}
}

static void send_status(void)
{
	char text[FRAME - 8], battery[8];

	snprintf(battery, sizeof(battery), battery_percent < 0 ? "null" : "%d", battery_percent);
	snprintf(text, sizeof(text), "{\"kind\":\"status\",\"firmware\":\"" FIRMWARE "\",\"sensor_ok\":%s,\"clock_ok\":%s,\"queue_overflow\":%u,\"battery\":%s,\"charging\":null}",
		 sensor_ok ? "true" : "false", epoch_now() ? "true" : "false", queue.overflow, battery);
	send_frame(text);
}

static void send_oldest_event(void)
{
	const struct stored_event *e = &queue.items[0];
	char text[FRAME - 8];

	if (e->ref[0]) {
		snprintf(text, sizeof(text), "{\"id\":\"%s\",\"kind\":\"%s\",\"at\":%u,\"ref\":\"%s\"}", e->id, e->kind, e->at, e->ref);
	} else {
		snprintf(text, sizeof(text), "{\"id\":\"%s\",\"kind\":\"%s\",\"at\":%u}", e->id, e->kind, e->at);
	}
	send_frame(text);
}

static void outputs(int64_t now)
{
	static int last_tone = -1;
	bool prompt = warning_active || plan.prompt_count > 0;
	bool pulse = prompt && (now % (warning_active ? 800 : 2000)) < 250;
	bool fault = !sensor_ok || !epoch_now() || queue.overflow;
	bool linked = atomic_get(&connections) > 0 && subscribed;

	gpio_pin_set_dt(&motor, pulse);
	if (pulse != last_tone && device_is_ready(buzzer.dev)) {
		pwm_set_pulse_dt(&buzzer, pulse ? buzzer.period / 2 : 0);
		last_tone = pulse;
	}
	gpio_pin_set_dt(&leds[RED], fault && now % 3000 < 30);
	gpio_pin_set_dt(&leds[GREEN], !fault && linked && now % 5000 < 20);
	gpio_pin_set_dt(&leds[BLUE], !fault && !linked && now % 3000 < 20);
}

static void configure_outputs(void)
{
	gpio_pin_configure_dt(&button, GPIO_INPUT);
	gpio_pin_configure_dt(&motor, GPIO_OUTPUT_INACTIVE);
	for (int i = 0; i < 3; i++) {
		gpio_pin_configure_dt(&leds[i], GPIO_OUTPUT_INACTIVE);
	}
}

int main(void)
{
	configure_outputs();
	settings_subsys_init();
	bt_conn_auth_cb_register(&auth_callbacks);
	if (bt_enable(NULL)) {
		printk("Bluetooth failed to start\n");
	}
	settings_load();
	if (queue.magic != STATE_MAGIC || queue.count > MAX_EVENTS) {
		memset(&queue, 0, sizeof(queue));
		queue.magic = STATE_MAGIC;
		queue.next_id = 1;
		save_queue();
	}
	if (plan.magic != STATE_MAGIC || plan.reminder_count > MAX_REMINDERS || plan.prompt_count > MAX_PROMPTS) {
		memset(&plan, 0, sizeof(plan));
		plan.magic = STATE_MAGIC;
		save_plan();
	}
	if (passkey < 100000 || passkey > 999999) {
		passkey = 0;
		provision_pin();
	}
	configure_imu();
	if (!sensor_ok) {
		emit("device_fault", NULL);
	}
	if (plan.fall_pending) {
		warning_active = true;
		warning_started = k_uptime_get();
	}
	printk("LOOMCARE %s ready. Motion sensor: %s\n", FIRMWARE, sensor_ok ? "ready" : "FAULT");
	advertise_fast();

	int64_t next = k_uptime_get();

	for (;;) {
		int64_t now = k_uptime_get();
		struct line command;

		while (k_msgq_get(&rx_queue, &command, K_NO_WAIT) == 0) {
			process_command(&command);
		}
		sample_motion(now);
		button_tick(now);
		if (warning_active && now - warning_started >= 15000 && emit("fall", NULL)) {
			warning_active = false;
			plan.fall_pending = 0;
			save_plan();
		}
		if (now % 1000 < TICK_MS) {
			reminder_tick();
		}
		if (now - last_battery >= 60000 || !last_battery) {
			last_battery = now;
			read_battery();
		}
		if (subscribed && now - last_status >= 10000) {
			last_status = now;
			send_status();
		}
		if (subscribed && queue.count && now - last_event_frame >= 3000) {
			last_event_frame = now;
			send_oldest_event();
		}
		outputs(now);
		next += TICK_MS;
		if (next < k_uptime_get()) {
			next = k_uptime_get();
		}
		k_sleep(K_TIMEOUT_ABS_MS(next));
	}
	return 0;
}
