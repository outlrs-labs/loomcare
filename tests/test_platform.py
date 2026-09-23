import hashlib
import hmac
import io
import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from care import connect_db, create_app, deliver_one, tick

SECRET = 'test-only-secret-key-with-32-characters'
WEBHOOK_SECRET = 'webhook-test-secret-with-32-plus-chars'


class Reply(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class PlatformTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / 'test.db')
        self.app = self.make_app()
        self.owner = self.app.test_client()
        self.owner_csrf = self.register(self.owner, 'Asha', 'asha@example.test')
        self.device = self.call(self.owner, 'post', '/api/devices', {'name': 'Mother'}).json
        self.gateway = self.call(self.owner, 'post', f"/api/devices/{self.device['id']}/gateways", {'kind': 'phone'}).json

    def tearDown(self):
        self.temp.cleanup()

    def make_app(self, **config):
        return create_app({'TESTING': True, 'DATABASE': self.db_path, 'SECRET_KEY': SECRET, 'START_WORKER': False, **config})

    def register(self, client, name, email, invite=None):
        csrf = client.get('/api/session').json['csrf']
        body = {'name': name, 'email': email, 'password': 'test-password-123', **({'invite': invite} if invite else {})}
        response = client.post('/api/register', json=body, headers={'X-CSRF-Token': csrf})
        self.assertEqual(response.status_code, 200, response.json)
        client.csrf = client.get('/api/session').json['csrf']
        return client.csrf

    def call(self, client, method, path, body=None):
        return getattr(client, method)(path, json=body if body is not None else {}, headers={'X-CSRF-Token': client.csrf})

    def sync(self, token, events=None, **status):
        return self.owner.post('/api/gateway/sync', json={'events': events or [], **status}, headers={'Authorization': f'Bearer {token}'})

    def state(self, client=None):
        return (client or self.owner).get('/api/state').json

    def invite(self, role):
        return self.call(self.owner, 'post', '/api/invites', {'role': role}).json['code']

    def operator(self, team_role):
        client = self.app.test_client()
        email = f'{team_role}@team.test'
        result = self.app.test_cli_runner().invoke(args=['create-operator', '--email', email, '--team-role', team_role], input='team-test-password\nteam-test-password\n')
        self.assertEqual(result.exit_code, 0, result.output)
        csrf = client.get('/api/session').json['csrf']
        client.post('/api/login', json={'email': email, 'password': 'team-test-password'}, headers={'X-CSRF-Token': csrf})
        client.csrf = client.get('/api/session').json['csrf']
        return client

    def test_two_gateways_keep_pendant_online_and_dedupe(self):
        hub = self.call(self.owner, 'post', f"/api/devices/{self.device['id']}/gateways", {'kind': 'hub'}).json
        self.sync(self.gateway['token'], connected=True, battery=70)
        self.sync(hub['token'], connected=True)
        self.sync(self.gateway['token'], connected=False, battery=5)
        state = self.state()
        self.assertTrue(state['devices'][0]['online'])
        self.assertEqual(state['devices'][0]['battery'], 70)
        self.assertEqual({g['kind'] for g in state['gateways']}, {'phone', 'hub'})
        event = {'id': 'shared-1', 'kind': 'sos', 'occurred_at': time.time()}
        self.sync(self.gateway['token'], [event])
        self.sync(hub['token'], [event])
        self.assertEqual(len([e for e in self.state()['events'] if e['kind'] == 'sos']), 1)
        for _ in range(3):
            self.call(self.owner, 'post', f"/api/devices/{self.device['id']}/gateways", {'kind': 'web'})
        self.assertEqual(self.call(self.owner, 'post', f"/api/devices/{self.device['id']}/gateways", {}).status_code, 400)

    def test_silence_alert_waits_for_configured_window(self):
        self.assertEqual(self.call(self.owner, 'patch', f"/api/devices/{self.device['id']}", {'offline_alert_seconds': 60}).status_code, 400)
        self.assertEqual(self.call(self.owner, 'patch', f"/api/devices/{self.device['id']}", {'offline_alert_seconds': 300}).status_code, 200)
        self.sync(self.gateway['token'], connected=True)
        db = connect_db(self.app)
        db.execute('UPDATE devices SET last_seen=?', (time.time() - 120,))
        tick(self.app)
        state = self.state()
        self.assertFalse(state['devices'][0]['online'])
        self.assertGreaterEqual(state['devices'][0]['silent_seconds'], 120)
        self.assertEqual([e for e in state['events'] if e['kind'] == 'disconnected'], [])
        db.execute('UPDATE devices SET last_seen=?', (time.time() - 301,))
        db.close()
        tick(self.app)
        self.assertEqual(len([e for e in self.state()['events'] if e['kind'] == 'disconnected']), 1)
        self.sync(self.gateway['token'], connected=True)
        tick(self.app)
        self.assertEqual(next(e for e in self.state()['events'] if e['kind'] == 'disconnected')['status'], 'resolved')

    def test_care_circle_roles_and_invites(self):
        viewer, caregiver = self.app.test_client(), self.app.test_client()
        viewer_code = self.invite('viewer')
        self.register(viewer, 'Ravi', 'ravi@example.test', viewer_code)
        self.register(caregiver, 'Meena', 'meena@example.test', self.invite('caregiver'))
        second = self.app.test_client()
        csrf = second.get('/api/session').json['csrf']
        reused = second.post('/api/register', json={'name': 'X', 'email': 'x@example.test', 'password': 'test-password-123', 'invite': viewer_code}, headers={'X-CSRF-Token': csrf})
        self.assertEqual(reused.status_code, 400)
        self.assertEqual(len(self.state(viewer)['devices']), 1)
        self.assertEqual(self.call(viewer, 'post', f"/api/devices/{self.device['id']}/reminders", {'label': 'Walk', 'time': '09:00'}).status_code, 403)
        self.assertEqual(self.call(caregiver, 'post', f"/api/devices/{self.device['id']}/reminders", {'label': 'Walk', 'time': '09:00'}).status_code, 201)
        self.assertEqual(self.call(caregiver, 'post', f"/api/devices/{self.device['id']}/gateways", {}).status_code, 403)
        self.assertEqual(self.call(caregiver, 'post', '/api/invites', {'role': 'viewer'}).status_code, 403)
        self.sync(self.gateway['token'], [{'id': 'sos-v', 'kind': 'sos'}])
        sos = self.state()['events'][0]
        self.assertEqual(self.call(viewer, 'post', f"/api/events/{sos['id']}/ack", {'note': 'Neighbour going'}).status_code, 200)
        members = self.call(self.owner, 'get', '/api/members').json
        self.assertEqual({m['household_role'] for m in members['members']}, {'owner', 'viewer', 'caregiver'})
        viewer_id = next(m['id'] for m in members['members'] if m['household_role'] == 'viewer')
        self.assertEqual(self.call(self.owner, 'patch', f'/api/members/{viewer_id}', {'role': 'caregiver'}).status_code, 200)
        self.assertEqual(self.call(self.owner, 'delete', f'/api/members/{viewer_id}').status_code, 200)
        self.assertEqual(self.state(viewer)['devices'], [])
        own_id = self.state()['me']['id']
        self.assertEqual(self.call(self.owner, 'delete', f'/api/members/{own_id}').status_code, 409)

    def test_mobile_bearer_auth_without_csrf(self):
        anonymous = self.app.test_client()
        login = anonymous.post('/api/mobile/login', json={'email': 'asha@example.test', 'password': 'test-password-123', 'device_name': 'Pixel'})
        self.assertEqual(login.status_code, 200)
        headers = {'Authorization': f"Bearer {login.json['token']}"}
        self.assertEqual(anonymous.get('/api/state', headers=headers).json['devices'][0]['id'], self.device['id'])
        self.assertEqual(anonymous.post(f"/api/devices/{self.device['id']}/checkin", json={}, headers=headers).status_code, 201)
        self.assertEqual(anonymous.post('/api/devices', json={'name': 'Dad'}).status_code, 403)
        self.assertEqual(anonymous.get('/api/state', headers={'Authorization': 'Bearer ' + 'x' * 43}).status_code, 401)
        self.assertEqual(anonymous.post('/api/mobile/logout', json={}, headers=headers).status_code, 200)
        self.assertEqual(anonymous.get('/api/state', headers=headers).status_code, 401)
        joined = anonymous.post('/api/mobile/register', json={'name': 'Kiran', 'email': 'kiran@example.test', 'password': 'test-password-123', 'invite': self.invite('viewer')})
        self.assertEqual(joined.json['user']['household_role'], 'viewer')

    def test_push_delivery_and_stale_token_cleanup(self):
        app = self.make_app(ENABLE_PUSH=True)
        client = app.test_client()
        token = client.post('/api/mobile/login', json={'email': 'asha@example.test', 'password': 'test-password-123'}).json['token']
        headers = {'Authorization': f'Bearer {token}'}
        self.assertEqual(client.post('/api/push-tokens', json={'token': 'bad', 'platform': 'android'}, headers=headers).status_code, 400)
        for push in ('ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]', 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbb]'):
            self.assertEqual(client.post('/api/push-tokens', json={'token': push, 'platform': 'android'}, headers=headers).status_code, 200)
        client.post('/api/gateway/sync', json={'events': [{'id': 'fall-p', 'kind': 'fall'}]}, headers={'Authorization': f"Bearer {self.gateway['token']}"})
        tickets = {'data': [{'status': 'ok', 'id': '1'}, {'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}]}
        with patch('care.urllib.request.urlopen', return_value=Reply(json.dumps(tickets).encode())) as opened:
            self.assertTrue(deliver_one(app))
            sent = json.loads(opened.call_args[0][0].data)
        self.assertEqual(len(sent), 2)
        self.assertIn('Possible fall', sent[0]['title'])
        state = client.get('/api/state', headers=headers).json
        self.assertEqual(next(n for n in state['notifications'] if n['channel'] == 'push')['status'], 'sent')
        db = connect_db(app)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM push_tokens').fetchone()[0], 1)
        db.close()

    def test_webhook_escalation_is_signed(self):
        app = self.make_app(WEBHOOK_URL='https://hooks.example.test/escalate', WEBHOOK_SECRET=WEBHOOK_SECRET)
        client = app.test_client()
        csrf = client.get('/api/session').json['csrf']
        client.post('/api/login', json={'email': 'asha@example.test', 'password': 'test-password-123'}, headers={'X-CSRF-Token': csrf})
        csrf = client.get('/api/session').json['csrf']
        self.assertEqual(client.post(f"/api/devices/{self.device['id']}/contacts", json={'name': 'Son', 'email': 'son@example.test', 'phone': '98765'}, headers={'X-CSRF-Token': csrf}).status_code, 400)
        self.assertEqual(client.post(f"/api/devices/{self.device['id']}/contacts", json={'name': 'Son', 'email': 'son@example.test', 'phone': '+919876543210'}, headers={'X-CSRF-Token': csrf}).status_code, 201)
        client.post('/api/gateway/sync', json={'events': [{'id': 'sos-w', 'kind': 'sos'}]}, headers={'Authorization': f"Bearer {self.gateway['token']}"})
        with patch('care.urllib.request.urlopen', return_value=Reply(b'{}')) as opened:
            self.assertTrue(deliver_one(app))
            request = opened.call_args[0][0]
        body = json.loads(request.data)
        self.assertEqual((body['kind'], body['phone']), ('sos', '+919876543210'))
        stamp = request.get_header('X-loomcare-timestamp')
        expected = hmac.new(WEBHOOK_SECRET.encode(), stamp.encode() + b'.' + request.data, hashlib.sha256).hexdigest()
        self.assertEqual(request.get_header('X-loomcare-signature'), f'sha256={expected}')
        with self.assertRaises(RuntimeError):
            self.make_app(WEBHOOK_URL='http://insecure.example.test', WEBHOOK_SECRET=WEBHOOK_SECRET)

    def test_team_roles_inventory_and_notes(self):
        support, admin = self.operator('support'), self.operator('admin')
        household_id = self.state()['me']['household_id']
        self.assertEqual(self.call(support, 'post', '/api/operator/inventory', {'serial': 'LC-0001', 'hardware_rev': 'XIAO-EVT0'}).status_code, 403)
        self.assertEqual(self.call(admin, 'post', '/api/operator/inventory', {'serial': 'lc-0001', 'hardware_rev': 'XIAO-EVT0'}).status_code, 201)
        self.assertEqual(self.call(admin, 'patch', '/api/operator/inventory/LC-0001', {'status': 'assigned'}).status_code, 400)
        self.assertEqual(self.call(admin, 'patch', '/api/operator/inventory/LC-0001', {'device_id': self.device['id']}).status_code, 200)
        self.assertEqual(support.get('/api/operator/inventory').json['inventory'][0]['status'], 'assigned')
        self.assertEqual(self.call(admin, 'patch', '/api/operator/inventory/LC-0001', {'device_id': None}).status_code, 200)
        self.assertEqual(support.get('/api/operator/inventory').json['inventory'][0]['status'], 'in_stock')
        self.assertEqual(self.call(support, 'post', f'/api/operator/households/{household_id}/notes', {'body': 'Called family; pendant charging.'}).status_code, 201)
        detail = support.get(f'/api/operator/households/{household_id}').json
        self.assertEqual(detail['notes'][0]['body'], 'Called family; pendant charging.')
        self.assertEqual(detail['gateways'][0]['kind'], 'phone')
        self.assertEqual(support.get('/api/operator/households').json['households'][0]['owner'], 'Asha')
        self.assertEqual(support.get('/api/operator/team').status_code, 403)
        self.assertEqual(len(admin.get('/api/operator/team').json['team']), 2)
        self.assertEqual(self.call(support, 'delete', f"/api/gateways/{self.gateway['gateway_id']}").status_code, 403)
        self.assertEqual(self.call(admin, 'delete', f"/api/gateways/{self.gateway['gateway_id']}").status_code, 200)
        self.assertEqual(self.call(self.owner, 'get', '/api/operator/households').status_code, 403)

    def test_migrates_pre_platform_database(self):
        old_path = str(Path(self.temp.name) / 'old.db')
        db = sqlite3.connect(old_path)
        db.executescript("""
            CREATE TABLE households (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at REAL NOT NULL);
            CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT REFERENCES households(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('caregiver','operator')), created_at REAL NOT NULL);
            CREATE TABLE devices (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), name TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('simulator','physical')), token_hash TEXT UNIQUE, last_seen REAL, connected INTEGER NOT NULL DEFAULT 0, battery REAL, charging INTEGER, sensor_ok INTEGER, clock_ok INTEGER, queue_overflow INTEGER NOT NULL DEFAULT 0, firmware TEXT NOT NULL DEFAULT 'not connected', escalation_seconds INTEGER NOT NULL DEFAULT 60, created_at REAL NOT NULL);
            CREATE TABLE reminders (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), label TEXT NOT NULL, minute INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL);
            CREATE TABLE contacts (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), name TEXT NOT NULL, email TEXT NOT NULL, priority INTEGER NOT NULL, UNIQUE(device_id,email));
        """)
        db.execute("INSERT INTO households VALUES ('h1','Old family',1)")
        db.execute("INSERT INTO users VALUES ('u1','h1','Old','old@example.test','x','caregiver',1)")
        db.execute("INSERT INTO devices(id,household_id,name,mode,token_hash,created_at) VALUES ('d1','h1','Dad','simulator',?,1)", (hashlib.sha256(b'legacy-gateway-token-value-000000000').hexdigest(),))
        db.commit()
        db.close()
        migrated = create_app({'TESTING': True, 'DATABASE': old_path, 'SECRET_KEY': SECRET, 'START_WORKER': False})
        response = migrated.test_client().post('/api/gateway/sync', json={'connected': True}, headers={'Authorization': 'Bearer legacy-gateway-token-value-000000000'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['gateway']['kind'], 'web')
        db = connect_db(migrated)
        self.assertEqual(db.execute("SELECT household_role FROM users WHERE id='u1'").fetchone()[0], 'owner')
        self.assertEqual(db.execute("SELECT offline_alert_seconds FROM devices WHERE id='d1'").fetchone()[0], 900)
        self.assertIsNone(db.execute("SELECT token_hash FROM devices WHERE id='d1'").fetchone()[0])
        db.close()


if __name__ == '__main__':
    unittest.main()
