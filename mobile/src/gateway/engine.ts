import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { PermissionsAndroid, Platform, type EventSubscription } from 'react-native';
import BleManager, { BleState } from 'react-native-ble-manager';

import { ApiError, request, type SyncResult } from '@/lib/api';
import { configVersion, fromBytes, RX_UUID, SERVICE_UUID, toBytes, TX_UUID } from '@/lib/protocol';

export interface GatewayStatus {
  paired: boolean;
  running: boolean;
  pendant: 'idle' | 'permission-needed' | 'bluetooth-off' | 'searching' | 'connecting' | 'connected';
  cloud: 'unpaired' | 'connecting' | 'ok' | 'offline' | 'revoked';
  queued: number;
  lastSync: number | null;
  parentName: string | null;
  battery: number | null;
  firmware: string | null;
}

interface QueuedEvent {
  id: string;
  kind: string;
  ref?: string;
  occurred_at: number | null;
}

interface Telemetry {
  battery: number | null;
  charging: boolean | null;
  sensor_ok: boolean | null;
  clock_ok: boolean | null;
  queue_overflow: number;
  firmware: string;
}

const KEYS = { server: 'gateway.server', token: 'gateway.token', peripheral: 'gateway.peripheral', queue: 'gateway.queue' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function savePairing(server: string, token: string) {
  await Promise.all([SecureStore.setItemAsync(KEYS.server, server), SecureStore.setItemAsync(KEYS.token, token), AsyncStorage.removeItem(KEYS.peripheral)]);
}

export async function clearPairing() {
  await Promise.all([SecureStore.deleteItemAsync(KEYS.server), SecureStore.deleteItemAsync(KEYS.token), AsyncStorage.multiRemove([KEYS.peripheral, KEYS.queue])]);
}

async function permissionsGranted() {
  if (Platform.OS !== 'android') return true;
  const needed = Platform.Version >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, ...(Platform.Version >= 33 ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] : [])]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(needed);
  return needed.filter((p) => p !== PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

class GatewayEngine {
  private status: GatewayStatus = { paired: false, running: false, pendant: 'idle', cloud: 'unpaired', queued: 0, lastSync: null, parentName: null, battery: null, firmware: null };
  private listeners = new Set<(status: GatewayStatus) => void>();
  private credentials: { server: string; token: string } | null = null;
  private peripheral: string | null = null;
  private buffer = '';
  private queue: QueuedEvent[] = [];
  private receipts: string[] = [];
  private telemetry: Telemetry = { battery: null, charging: null, sensor_ok: null, clock_ok: null, queue_overflow: 0, firmware: 'unknown' };
  private desiredConfig = '';
  private configAck = '';
  private lastConfigSend = 0;
  private lastClockSend = 0;
  private syncing = false;
  private started = false;
  private stopRequested = false;
  private wake: (() => void) | null = null;
  private subscriptions: EventSubscription[] = [];

  subscribe(listener: (status: GatewayStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<GatewayStatus>) {
    this.status = { ...this.status, ...patch, queued: this.queue.length };
    this.listeners.forEach((listener) => listener(this.status));
  }

  async load() {
    const [server, token, peripheral, stored] = await Promise.all([SecureStore.getItemAsync(KEYS.server), SecureStore.getItemAsync(KEYS.token), AsyncStorage.getItem(KEYS.peripheral), AsyncStorage.getItem(KEYS.queue)]);
    this.credentials = server && token ? { server, token } : null;
    this.peripheral = peripheral;
    const saved = stored ? (JSON.parse(stored) as { queue: QueuedEvent[]; receipts: string[] }) : { queue: [], receipts: [] };
    this.queue = saved.queue;
    this.receipts = saved.receipts;
    this.update({ paired: !!this.credentials, cloud: this.credentials ? 'connecting' : 'unpaired' });
    return !!this.credentials;
  }

  private persist() {
    return AsyncStorage.setItem(KEYS.queue, JSON.stringify({ queue: this.queue, receipts: this.receipts }));
  }

  private async setup() {
    if (this.started) return;
    await BleManager.start({ showAlert: false, restoreIdentifierKey: 'loomcare-gateway' });
    this.subscriptions = [
      BleManager.onDidUpdateValueForCharacteristic((event) => {
        if (event.peripheral === this.peripheral && event.characteristic.toLowerCase() === TX_UUID) this.receive(fromBytes(event.value));
      }),
      BleManager.onDisconnectPeripheral((event) => {
        if (event.peripheral === this.peripheral) {
          this.configAck = '';
          this.update({ pendant: 'searching' });
          this.poke();
        }
      }),
      BleManager.onDidUpdateState(() => this.poke()),
    ];
    this.started = true;
  }

  async pairPendant(pin: string) {
    await this.setup();
    if (!(await permissionsGranted())) throw new Error('Allow Bluetooth access for LOOMCARE in Settings.');
    const found = this.peripheral ?? (await this.scan());
    if (!found) throw new Error('No pendant found nearby. Keep it close and make sure it is switched on.');
    if (Platform.OS === 'android' && /^\d{6}$/.test(pin)) await BleManager.createBond(found, pin);
    this.peripheral = found;
    await AsyncStorage.setItem(KEYS.peripheral, found);
    this.poke();
  }

  async forgetPendant() {
    if (this.peripheral) await BleManager.disconnect(this.peripheral).catch(() => undefined);
    this.peripheral = null;
    await AsyncStorage.removeItem(KEYS.peripheral);
    this.update({ pendant: 'searching' });
  }

  private scan() {
    return new Promise<string | null>((resolve) => {
      let found: string | null = null;
      const discovered = BleManager.onDiscoverPeripheral((peripheral) => {
        if (!found) {
          found = peripheral.id;
          BleManager.stopScan().catch(() => undefined);
        }
      });
      const stopped = BleManager.onStopScan(() => {
        discovered.remove();
        stopped.remove();
        resolve(found);
      });
      BleManager.scan({ serviceUUIDs: [SERVICE_UUID], seconds: 8 }).catch(() => {
        discovered.remove();
        stopped.remove();
        resolve(null);
      });
    });
  }

  private receive(text: string) {
    this.buffer += text;
    if (this.buffer.length > 4096) this.buffer = '';
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.handle(line).catch(() => undefined);
    }
  }

  private async handle(line: string) {
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message.kind === 'status') {
      this.telemetry = {
        battery: typeof message.battery === 'number' ? message.battery : null,
        charging: typeof message.charging === 'boolean' ? message.charging : null,
        sensor_ok: typeof message.sensor_ok === 'boolean' ? message.sensor_ok : null,
        clock_ok: typeof message.clock_ok === 'boolean' ? message.clock_ok : null,
        queue_overflow: typeof message.queue_overflow === 'number' ? message.queue_overflow : 0,
        firmware: typeof message.firmware === 'string' ? message.firmware : 'unknown',
      };
      this.update({ battery: this.telemetry.battery, firmware: this.telemetry.firmware });
    } else if (message.kind === 'receipt' && typeof message.ref === 'string') {
      if (!this.receipts.includes(message.ref)) this.receipts.push(message.ref);
      await this.persist();
      this.poke();
    } else if (message.kind === 'config_received') {
      if (message.ref === configVersion(this.desiredConfig)) this.configAck = this.desiredConfig;
    } else if (typeof message.id === 'string' && typeof message.kind === 'string' && message.kind !== 'local_warning') {
      if (!this.queue.some((event) => event.id === message.id) && this.queue.length < 256) {
        this.queue.push({ id: message.id, kind: message.kind, ref: typeof message.ref === 'string' ? message.ref : undefined, occurred_at: typeof message.at === 'number' && message.at > 0 ? message.at : null });
        await this.persist();
        this.update({});
      }
      this.poke();
    }
  }

  private async write(command: Record<string, unknown>) {
    if (this.peripheral) await BleManager.write(this.peripheral, SERVICE_UUID, RX_UUID, toBytes(JSON.stringify(command) + '\n'), 20);
  }

  private async ensureConnected() {
    if (!(await permissionsGranted())) return this.update({ pendant: 'permission-needed' });
    if ((await BleManager.checkState()) !== BleState.On) return this.update({ pendant: 'bluetooth-off' });
    if (this.peripheral && (await BleManager.isPeripheralConnected(this.peripheral, [SERVICE_UUID]))) {
      if (this.status.pendant !== 'connected') this.update({ pendant: 'connected' });
      return;
    }
    if (!this.peripheral) {
      this.update({ pendant: 'searching' });
      this.peripheral = await this.scan();
      if (!this.peripheral) return;
      await AsyncStorage.setItem(KEYS.peripheral, this.peripheral);
    }
    this.update({ pendant: 'connecting' });
    try {
      await BleManager.connect(this.peripheral, { autoconnect: Platform.OS === 'android' });
      await BleManager.retrieveServices(this.peripheral, [SERVICE_UUID]);
      await BleManager.startNotification(this.peripheral, SERVICE_UUID, TX_UUID);
      this.configAck = '';
      this.lastClockSend = 0;
      this.lastConfigSend = 0;
      this.update({ pendant: 'connected' });
    } catch {
      this.update({ pendant: 'searching' });
    }
  }

  private async sync() {
    if (!this.credentials || this.syncing) return;
    this.syncing = true;
    const events = this.queue.slice(0, 32);
    const receipts = [...this.receipts];
    const connected = this.status.pendant === 'connected';
    try {
      const result = await request<SyncResult>(this.credentials.server, '/api/gateway/sync', {
        token: this.credentials.token,
        body: { events, commands_received: receipts, connected, app_version: `loomcare-mobile/${Constants.expoConfig?.version ?? '1'}`, ...(connected ? this.telemetry : {}) },
      });
      const accepted = new Set(result.accepted);
      this.queue = this.queue.filter((event) => !accepted.has(event.id));
      this.receipts = this.receipts.filter((id) => !receipts.includes(id));
      await this.persist();
      this.update({ cloud: 'ok', lastSync: Date.now(), parentName: result.device.name });
      if (connected) {
        for (const id of accepted) await this.write({ op: 'ack', id });
        if (Date.now() - this.lastClockSend > 60000) {
          await this.write({ op: 'time', epoch: Math.floor(result.now) });
          this.lastClockSend = Date.now();
        }
        this.desiredConfig = JSON.stringify(result.reminders.map((r) => [r.id, r.minute, r.enabled]));
        if (this.configAck !== this.desiredConfig && Date.now() - this.lastConfigSend > 10000) {
          this.lastConfigSend = Date.now();
          await this.write({ op: 'begin', version: configVersion(this.desiredConfig), count: result.reminders.length });
          for (const r of result.reminders) await this.write({ op: 'reminder', id: r.id, minute: r.minute, enabled: !!r.enabled });
          await this.write({ op: 'commit' });
        }
        for (const command of result.commands) await this.write({ op: 'checkin', id: command.id, ref: command.event_id, expires: Math.floor(command.expires_at) });
      }
    } catch (error) {
      this.update({ cloud: error instanceof ApiError && error.status === 401 ? 'revoked' : 'offline' });
    } finally {
      this.syncing = false;
    }
  }

  private poke() {
    this.wake?.();
  }

  async run() {
    if (!(await this.load())) return;
    await this.setup();
    this.stopRequested = false;
    this.update({ running: true });
    while (!this.stopRequested) {
      await this.ensureConnected().catch(() => this.update({ pendant: 'searching' }));
      await this.sync();
      await Promise.race([sleep(this.queue.length || this.receipts.length ? 1000 : 5000), new Promise<void>((resolve) => (this.wake = resolve))]);
      this.wake = null;
    }
    this.update({ running: false });
  }

  stop() {
    this.stopRequested = true;
    this.poke();
  }
}

export const gateway = new GatewayEngine();
