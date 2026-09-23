import tempfile
import time
import unittest
from pathlib import Path
from care import create_app, connect_db, tick


class CareTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "DATABASE": str(Path(self.temp.name) / "test.db"), "SECRET_KEY": "test-only-secret-key-with-32-characters", "START_WORKER": False})
        self.client = self.app.test_client()
        self.csrf = self.client.get('/api/session').json['csrf']
        self.post('/api/register', {"name": "Asha", "email": "asha@example.test", "password": "test-password-123"})
        self.csrf = self.client.get('/api/session').json['csrf']
        self.device = self.post('/api/devices', {"name": "Mother", "mode": "simulator"}).json
        self.token = self.post(f"/api/devices/{self.device['id']}/pair", {}).json['token']

    def tearDown(self):
        self.temp.cleanup()

    def post(self, path, data):
        return self.client.post(path, json=data, headers={"X-CSRF-Token": self.csrf})

    def sync(self, events=None, **status):
        return self.client.post('/api/gateway/sync', json={"events": events or [], **status}, headers={"Authorization": f"Bearer {self.token}"})

    def state(self):
        return self.client.get('/api/state').json

    def test_health_auth_and_csrf(self):
        self.assertEqual(self.client.get('/healthz').status_code, 200)
        self.assertEqual(self.client.post('/api/devices', json={"name": "Dad"}).status_code, 403)
        self.assertEqual(self.client.get('/run-prediction').status_code, 410)
        self.assertEqual(self.client.get('/api/operator/metrics').status_code, 403)

    def test_fall_persisted_and_deduplicated(self):
        event = {"id": "event-1", "kind": "fall", "occurred_at": time.time()}
        self.assertEqual(self.sync([event], connected=True, battery=80).status_code, 200)
        self.sync([event])
        state = self.state()
        self.assertEqual(len([e for e in state['events'] if e['kind'] == 'fall']), 1)
        self.assertEqual(len(state['notifications']), 1)
        self.assertEqual(state['notifications'][0]['status'], 'available')
        self.assertEqual(state['devices'][0]['battery'], 80)

    def test_household_isolation_and_pair_rotation(self):
        other = self.app.test_client()
        csrf = other.get('/api/session').json['csrf']
        other.post('/api/register', json={"name": "Other", "email": "other@example.test", "password": "other-password-123"}, headers={"X-CSRF-Token": csrf})
        csrf = other.get('/api/session').json['csrf']
        response = other.post(f"/api/devices/{self.device['id']}/pair", json={}, headers={"X-CSRF-Token": csrf})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(other.get('/api/state').json['devices'], [])
        second = self.post(f"/api/devices/{self.device['id']}/pair", {}).json
        self.assertEqual(self.sync().status_code, 200)
        self.assertEqual(self.client.delete(f"/api/gateways/{second['gateway_id']}", headers={'X-CSRF-Token': self.csrf}).status_code, 200)
        self.assertEqual(self.client.post('/api/gateway/sync', json={}, headers={'Authorization': f"Bearer {second['token']}"}).status_code, 401)
        self.assertEqual(self.sync().status_code, 200)

    def test_checkin_delivery_not_acknowledgement(self):
        event = self.post(f"/api/devices/{self.device['id']}/checkin", {}).json
        response = self.sync(connected=True).json
        command = response['commands'][0]
        self.sync(commands_received=[command['id']])
        self.assertEqual(self.state()['events'][0]['status'], 'awaiting')
        self.sync([{"id": "ack-1", "kind": "checkin_ack", "ref": event['id'], "occurred_at": time.time()}])
        self.assertEqual(self.state()['events'][0]['status'], 'acknowledged')

    def test_bad_payload_atomic_and_no_nan(self):
        response = self.sync([{"id": "good", "kind": "sos"}, {"id": "bad", "kind": "invalid"}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.state()['events'], [])
        self.assertEqual(self.sync(battery=float('nan')).status_code, 400)
        self.assertEqual(self.sync(connected='yes').status_code, 400)

    def test_ack_stops_escalation(self):
        self.sync([{"id": "sos-1", "kind": "sos"}])
        event = self.state()['events'][0]
        self.assertEqual(self.post(f"/api/events/{event['id']}/ack", {"note": "Called mum"}).status_code, 200)
        tick(self.app, time.time() + 200)
        updated = self.state()
        self.assertEqual(next(e for e in updated['events'] if e['id'] == event['id'])['status'], 'acknowledged')
        self.assertEqual(len([n for n in updated['notifications'] if n['event_id'] == event['id']]), 1)

    def test_escalation_and_late_checkin(self):
        for i in range(2):
            self.post(f"/api/devices/{self.device['id']}/contacts", {"name": f"Contact {i}", "email": f"contact{i}@example.test"})
        self.sync([{"id": "sos-1", "kind": "sos"}])
        tick(self.app, time.time() + 65)
        state = self.state()
        sos = next(e for e in state['events'] if e['kind'] == 'sos')
        self.assertEqual(len([n for n in state['notifications'] if n['event_id'] == sos['id']]), 2)
        event = self.post(f"/api/devices/{self.device['id']}/checkin", {}).json
        tick(self.app, time.time() + 125)
        self.sync([{"id": "late", "kind": "checkin_ack", "ref": event['id']}])
        found = next(e for e in self.state()['events'] if e['id'] == event['id'])
        self.assertEqual(found['status'], 'acknowledged')

    def test_reminders_and_offline_ack(self):
        local = time.gmtime(time.time() + 19800)
        reminder = self.post(f"/api/devices/{self.device['id']}/reminders", {"label": "Evening reminder", "time": time.strftime('%H:%M', local)}).json
        tick(self.app, time.time())
        events = self.state()['events']
        due = next(e for e in events if e['kind'] == 'reminder')
        self.sync([{"id": "rem-ack", "kind": "reminder_ack", "ref": due['source_ref'], "occurred_at": time.time()}])
        self.assertEqual(next(e for e in self.state()['events'] if e['id'] == due['id'])['status'], 'acknowledged')
        self.assertEqual(self.sync().json['reminders'][0]['id'], reminder['id'])

    def test_operator_and_persistence(self):
        db = connect_db(self.app)
        db.execute("UPDATE users SET role='operator' WHERE email='asha@example.test'")
        db.close()
        self.assertEqual(self.client.get('/api/operator/metrics').status_code, 200)
        second = create_app({"TESTING": True, "DATABASE": self.app.config['DATABASE'], "SECRET_KEY": self.app.secret_key, "START_WORKER": False})
        db = connect_db(second)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM devices').fetchone()[0], 1)
        db.close()

    def test_disconnect_ack_does_not_repeat_or_break_worker(self):
        self.sync(connected=True)
        self.sync(connected=False)
        tick(self.app, time.time() + 901)
        event = next(e for e in self.state()['events'] if e['kind'] == 'disconnected')
        self.post(f"/api/events/{event['id']}/ack", {})
        tick(self.app, time.time() + 902)
        self.assertEqual(len([e for e in self.state()['events'] if e['kind'] == 'disconnected']), 1)
        self.sync(connected=True)
        tick(self.app)
        self.assertEqual(next(e for e in self.state()['events'] if e['id'] == event['id'])['status'], 'resolved')

    def test_late_worker_records_missed_reminder(self):
        local = time.gmtime(time.time() + 19800)
        self.post(f"/api/devices/{self.device['id']}/reminders", {"label": "Daily", "time": time.strftime('%H:%M', local)})
        tick(self.app, time.time() + 600)
        reminders = [e for e in self.state()['events'] if e['kind'] == 'reminder']
        self.assertEqual(len(reminders), 1)
        self.assertEqual(reminders[0]['status'], 'missed')

    def test_pausing_reminder_does_not_backfill_paused_time(self):
        local = time.gmtime(time.time() + 19800)
        reminder = self.post(f"/api/devices/{self.device['id']}/reminders", {"label": "Daily", "time": time.strftime('%H:%M', local)}).json
        self.client.patch(f"/api/reminders/{reminder['id']}", json={"enabled": False}, headers={'X-CSRF-Token': self.csrf})
        tick(self.app, time.time() + 600)
        self.assertEqual(self.state()['events'], [])

    def test_append_contact_after_removal_keeps_chain_order(self):
        ids = []
        for i in range(3):
            ids.append(self.post(f"/api/devices/{self.device['id']}/contacts", {"name": str(i), "email": f"contact{i}@example.test"}).json['id'])
        self.client.delete(f'/api/contacts/{ids[1]}', json={}, headers={'X-CSRF-Token': self.csrf})
        added = self.post(f"/api/devices/{self.device['id']}/contacts", {"name": "New", "email": "new@example.test"}).json['id']
        contacts = self.state()['contacts']
        self.assertEqual(contacts[-1]['id'], added)
        self.assertEqual(len({c['priority'] for c in contacts}), 3)

    def test_email_retries_are_bounded_and_sanitised(self):
        from unittest.mock import patch
        from care import deliver_one
        self.app.config.update(ENABLE_SMTP=True, SMTP_HOST='smtp.example.test', SMTP_USERNAME='fixture', SMTP_PASSWORD='fixture', SMTP_SENDER='fixture@example.test')
        self.sync([{'id': 'smtp-fail', 'kind': 'sos'}])
        with patch('care.smtplib.SMTP_SSL', side_effect=OSError('Sensitive provider details')) as smtp:
            for _ in range(6):
                db = connect_db(self.app)
                db.execute("UPDATE notifications SET next_try=0 WHERE channel='email'")
                db.close()
                deliver_one(self.app)
            self.assertEqual(smtp.call_count, 5)
        email = next(n for n in self.state()['notifications'] if n['channel'] == 'email')
        self.assertEqual(email['status'], 'failed')
        self.assertNotIn('Sensitive', email['error'])

    def test_email_cancelled_after_human_ack(self):
        from unittest.mock import patch
        from care import deliver_one
        self.app.config['ENABLE_SMTP'] = True
        self.sync([{'id': 'smtp-cancel', 'kind': 'sos'}])
        event = self.state()['events'][0]
        self.post(f"/api/events/{event['id']}/ack", {})
        with patch('care.smtplib.SMTP_SSL') as smtp:
            deliver_one(self.app)
            smtp.assert_not_called()
        self.assertEqual(next(n for n in self.state()['notifications'] if n['channel'] == 'email')['status'], 'cancelled')

    def test_gateway_cannot_ack_another_device(self):
        other = self.post('/api/devices', {'name': 'Dad', 'mode': 'simulator'}).json
        checkin = self.post(f"/api/devices/{other['id']}/checkin", {}).json
        self.assertEqual(self.sync([{'id': 'cross-device', 'kind': 'checkin_ack', 'ref': checkin['id']}]).status_code, 400)
        self.assertEqual(self.post(f"/api/events/{checkin['id']}/ack", {}).status_code, 409)

    def test_pause_cancels_active_reminder(self):
        local = time.gmtime(time.time() + 19800)
        reminder = self.post(f"/api/devices/{self.device['id']}/reminders", {'label': 'Daily', 'time': time.strftime('%H:%M', local)}).json
        tick(self.app)
        self.client.patch(f"/api/reminders/{reminder['id']}", json={'enabled': False}, headers={'X-CSRF-Token': self.csrf})
        tick(self.app, time.time() + 600)
        self.assertEqual(self.state()['events'][0]['status'], 'cancelled')
        self.assertEqual(self.state()['notifications'], [])

    def test_event_clock_and_security_headers(self):
        self.assertEqual(self.sync([{'id': 'future', 'kind': 'sos', 'occurred_at': time.time() + 1000}]).status_code, 400)
        self.assertEqual(self.sync([{'id': 'old', 'kind': 'sos', 'occurred_at': time.time() - 8 * 86400}]).status_code, 400)
        response = self.client.get('/api/session')
        self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')

    def test_operator_cli_does_not_promote_existing_account(self):
        runner = self.app.test_cli_runner()
        result = runner.invoke(args=['create-operator', '--email', 'asha@example.test'], input='operator-test-password\noperator-test-password\n')
        self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(self.client.get('/api/session').json['user']['role'], 'caregiver')


if __name__ == '__main__':
    unittest.main()
