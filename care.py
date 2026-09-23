import hashlib
import hmac
import json
import math
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import timedelta
from email.message import EmailMessage
from pathlib import Path
from uuid import uuid4

import click
from flask import Flask, abort, g, jsonify, request, send_from_directory, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parent
OFFSET = 19800
ONLINE_WINDOW = 45
ACTIVE = ('open', 'escalated', 'awaiting')
URGENT = ('fall', 'sos')
ROLE_RANK = {'viewer': 0, 'caregiver': 1, 'owner': 2}
EMAIL = re.compile(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+')
PHONE = re.compile(r'\+[1-9]\d{7,14}')
EXPO_TOKEN = re.compile(r'Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,120}\]')
SERIAL = re.compile(r'[A-Z0-9-]{4,32}')
EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
USER_COLUMNS = 'u.id,u.household_id,u.name,u.email,u.role,u.household_role,u.team_role'


def uid():
    return uuid4().hex


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def connect_db(app):
    db = sqlite3.connect(app.config['DATABASE'], timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=5000')
    return db


def text(data, key, maximum=120, minimum=1):
    value = data.get(key)
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        abort(400, f'{key}: expected {minimum}–{maximum} characters.')
    return value.strip()


def email_value(data):
    value = text(data, 'email', 254).lower()
    if not EMAIL.fullmatch(value):
        abort(400, 'Enter a valid email address.')
    return value


def phone_value(data):
    value = data.get('phone')
    if value in (None, ''):
        return None
    if not isinstance(value, str) or not PHONE.fullmatch(value.strip()):
        abort(400, 'Phone must be in international format, e.g. +919876543210.')
    return value.strip()


def payload():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, 'Expected a JSON object.')
    return data


def optional_payload():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def bounded_int(data, key, low, high, default, message):
    value = data.get(key, default)
    if type(value) is not int or not low <= value <= high:
        abort(400, message)
    return value


def audit(db, actor, action, target):
    db.execute('INSERT INTO audit(actor,action,target,at) VALUES (?,?,?,?)', (actor, action, target, time.time()))


def new_event(db, device, kind, status, now, source_ref=None, occurred_at=None, due_at=None, note=''):
    event_id = uid()
    db.execute('INSERT INTO events(id,household_id,device_id,kind,status,source_ref,occurred_at,received_at,due_at,note) VALUES (?,?,?,?,?,?,?,?,?,?)',
               (event_id, device['household_id'], device['id'], kind, status, source_ref, occurred_at, now, due_at, note))
    return db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()


def recipients(db, device_id):
    rows = db.execute('SELECT name,email,phone FROM contacts WHERE device_id=? ORDER BY priority,id', (device_id,)).fetchall()
    if rows:
        return rows
    return db.execute("SELECT u.name,u.email,NULL AS phone FROM users u JOIN devices d ON d.household_id=u.household_id WHERE d.id=? AND u.role='caregiver' AND u.household_role IN ('owner','caregiver') ORDER BY u.household_role DESC,u.created_at", (device_id,)).fetchall()


def queue_notification(db, event, recipient, channel, now):
    db.execute('INSERT OR IGNORE INTO notifications(id,household_id,event_id,recipient,channel,status,next_try,created_at) VALUES (?,?,?,?,?,?,?,?)',
               (uid(), event['household_id'], event['id'], recipient, channel, 'available' if channel == 'in_app' else 'pending', now, now))


def notify(db, app, event, now, level=0):
    contacts = recipients(db, event['device_id'])
    if contacts:
        contact = contacts[min(level, len(contacts) - 1)]
        queue_notification(db, event, contact['email'], 'in_app', now)
        if app.config['ENABLE_SMTP']:
            queue_notification(db, event, contact['email'], 'email', now)
        if app.config['WEBHOOK_URL'] and event['kind'] in URGENT and contact['phone']:
            queue_notification(db, event, contact['phone'], 'webhook', now)
    if level == 0 and app.config['ENABLE_PUSH']:
        for member in db.execute('SELECT DISTINCT u.id FROM users u JOIN push_tokens p ON p.user_id=u.id WHERE u.household_id=?', (event['household_id'],)).fetchall():
            queue_notification(db, event, member['id'], 'push', now)


def reminder_event(db, device, reminder, day, now):
    ref = f"{reminder['id']}:{day}"
    existing = db.execute('SELECT * FROM events WHERE device_id=? AND source_ref=?', (device['id'], ref)).fetchone()
    if existing:
        return existing
    due = day * 86400 - OFFSET + reminder['minute'] * 60
    return new_event(db, device, 'reminder', 'awaiting', now, source_ref=ref, occurred_at=due, due_at=due + 300, note=reminder['label'])


def tick(app, now=None):
    now = now if now is not None else time.time()
    db = connect_db(app)
    try:
        db.execute('BEGIN IMMEDIATE')
        before = db.total_changes
        day = int((now + OFFSET) // 86400)
        for reminder in db.execute('SELECT * FROM reminders WHERE enabled=1').fetchall():
            for occurrence_day in (day - 1, day):
                due = occurrence_day * 86400 - OFFSET + reminder['minute'] * 60
                if max(now - 86400, reminder['effective_at']) <= due <= now:
                    device = db.execute('SELECT * FROM devices WHERE id=?', (reminder['device_id'],)).fetchone()
                    reminder_event(db, device, reminder, occurrence_day, now)
        for event in db.execute("SELECT * FROM events WHERE due_at<=? AND status IN ('open','escalated','awaiting')", (now,)).fetchall():
            device = db.execute('SELECT * FROM devices WHERE id=?', (event['device_id'],)).fetchone()
            if event['status'] == 'awaiting':
                db.execute("UPDATE events SET status='missed',due_at=NULL WHERE id=?", (event['id'],))
                notify(db, app, event, now)
            else:
                level = event['escalation_level'] + 1
                count = len(recipients(db, event['device_id']))
                notify(db, app, event, now, level)
                db.execute("UPDATE events SET status='escalated',escalation_level=?,due_at=? WHERE id=?",
                           (level, now + device['escalation_seconds'] if level + 1 < count else None, event['id']))
        for device in db.execute('SELECT * FROM devices WHERE last_seen IS NOT NULL').fetchall():
            online = bool(device['connected']) and now - device['last_seen'] < ONLINE_WINDOW
            issue = db.execute("SELECT * FROM events WHERE device_id=? AND kind='disconnected' AND status IN ('open','acknowledged')", (device['id'],)).fetchone()
            if online and issue:
                db.execute("UPDATE events SET status='resolved' WHERE id=?", (issue['id'],))
            elif not online and not issue and now - device['last_seen'] >= device['offline_alert_seconds']:
                issue = new_event(db, device, 'disconnected', 'open', now, source_ref=f"offline:{device['last_seen']}", note='No gateway has heard the pendant recently; remote protection is reduced. Local alarms still work.')
                notify(db, app, issue, now)
        if db.total_changes > before:
            db.execute("UPDATE metadata SET value=value+1 WHERE key='revision'")
        db.commit()
        app.extensions['care']['worker_last_tick'] = time.time()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def send_email(app, row, tokens):
    message = EmailMessage()
    message['From'] = app.config['SMTP_SENDER']
    message['To'] = row['recipient']
    message['Subject'] = f"LOOMCARE: {row['kind'].replace('_', ' ')}"
    message['Message-ID'] = f"<{row['id']}@loomcare.local>"
    message.set_content(f"{row['parent_name']}: {row['kind'].replace('_', ' ')}. Please check on your family member.\nEvent: {row['event_id']}\nOpen your LOOMCARE app to acknowledge. LOOMCARE does not dispatch emergency services.")
    with smtplib.SMTP_SSL(app.config['SMTP_HOST'], app.config['SMTP_PORT'], timeout=10, context=ssl.create_default_context()) as smtp:
        smtp.login(app.config['SMTP_USERNAME'], app.config['SMTP_PASSWORD'])
        smtp.send_message(message)
    return []


def post_json(url, body, headers):
    data = json.dumps(body, separators=(',', ':')).encode()
    req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/json', 'Accept': 'application/json', **headers(data)})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read() or b'{}')


def send_push(app, row, tokens):
    if not tokens:
        raise LookupError('No registered phones for this caregiver.')
    title = {'fall': 'Possible fall', 'sos': 'SOS pressed', 'disconnected': 'Pendant out of reach', 'low_battery': 'Pendant battery low', 'reminder': 'Reminder not acknowledged', 'checkin': 'Check-in not answered', 'device_fault': 'Pendant needs attention'}.get(row['kind'], 'Care update')
    messages = [{'to': t, 'title': f"{title} · {row['parent_name']}", 'body': 'Open LOOMCARE to respond.', 'sound': 'default', 'priority': 'high', 'channelId': 'urgent' if row['kind'] in URGENT else 'default', 'data': {'event_id': row['event_id']}} for t in tokens]
    auth = {'Authorization': f"Bearer {app.config['EXPO_ACCESS_TOKEN']}"} if app.config['EXPO_ACCESS_TOKEN'] else {}
    tickets = post_json(EXPO_PUSH_URL, messages, lambda _: auth).get('data', [])
    stale = [t for t, ticket in zip(tokens, tickets) if (ticket.get('details') or {}).get('error') == 'DeviceNotRegistered']
    if not any(ticket.get('status') == 'ok' for ticket in tickets):
        raise ConnectionError('Push service rejected every message.', stale)
    return stale


def send_webhook(app, row, tokens):
    stamp = str(int(time.time()))
    body = {'notification_id': row['id'], 'event_id': row['event_id'], 'kind': row['kind'], 'parent': row['parent_name'], 'phone': row['recipient'], 'escalation_level': row['escalation_level'], 'created_at': row['created_at']}

    def sign(data):
        mac = hmac.new(app.config['WEBHOOK_SECRET'].encode(), stamp.encode() + b'.' + data, hashlib.sha256).hexdigest()
        return {'X-Loomcare-Timestamp': stamp, 'X-Loomcare-Signature': f'sha256={mac}'}
    post_json(app.config['WEBHOOK_URL'], body, sign)
    return []


SENDERS = {'email': send_email, 'push': send_push, 'webhook': send_webhook}


def external_channels(app):
    return [c for c, on in (('email', app.config['ENABLE_SMTP']), ('push', app.config['ENABLE_PUSH']), ('webhook', bool(app.config['WEBHOOK_URL']))) if on]


def deliver_one(app):
    channels = external_channels(app)
    if not channels:
        return False
    db = connect_db(app)
    try:
        now = time.time()
        db.execute('BEGIN IMMEDIATE')
        row = db.execute(f"SELECT n.*,e.kind,e.escalation_level,e.status AS event_status,d.name AS parent_name FROM notifications n JOIN events e ON e.id=n.event_id JOIN devices d ON d.id=e.device_id WHERE n.channel IN ({','.join('?' * len(channels))}) AND n.status IN ('pending','retry','sending') AND n.next_try<=? ORDER BY n.created_at LIMIT 1", (*channels, now)).fetchone()
        if not row:
            db.commit()
            return False
        if row['event_status'] in ('acknowledged', 'resolved', 'cancelled'):
            db.execute("UPDATE notifications SET status='cancelled' WHERE id=?", (row['id'],))
            db.execute("UPDATE metadata SET value=value+1 WHERE key='revision'")
            db.commit()
            return True
        tokens = [r['token'] for r in db.execute('SELECT token FROM push_tokens WHERE user_id=?', (row['recipient'],))] if row['channel'] == 'push' else []
        db.execute("UPDATE notifications SET status='sending',attempts=attempts+1,next_try=? WHERE id=?", (now + 60, row['id']))
        db.commit()
        stale, error = [], None
        try:
            stale = SENDERS[row['channel']](app, row, tokens)
            status = 'sent'
        except LookupError as problem:
            status, error = 'cancelled', str(problem)
        except (OSError, ValueError, smtplib.SMTPException, urllib.error.URLError) as problem:
            stale = problem.args[1] if isinstance(problem, ConnectionError) and len(problem.args) > 1 else []
            status = 'failed' if row['attempts'] + 1 >= 5 else 'retry'
            error = f"{row['channel'].upper()} delivery failed; check provider configuration."
        db.execute('BEGIN IMMEDIATE')
        db.execute('UPDATE notifications SET status=?,error=?,next_try=?,completed_at=? WHERE id=?',
                   (status, error, time.time() + min(300, 5 * 2 ** row['attempts']), time.time() if status in ('sent', 'failed', 'cancelled') else None, row['id']))
        for token in stale:
            db.execute('DELETE FROM push_tokens WHERE token=?', (token,))
        db.execute("UPDATE metadata SET value=value+1 WHERE key='revision'")
        db.commit()
        return True
    finally:
        db.close()


def migrate(db):
    columns = {table: {r['name'] for r in db.execute(f'PRAGMA table_info({table})')} for table in ('users', 'devices', 'contacts', 'reminders')}
    additions = [('reminders', 'effective_at', 'REAL NOT NULL DEFAULT 0'), ('users', 'household_role', "TEXT CHECK(household_role IN ('owner','caregiver','viewer'))"),
                 ('users', 'team_role', "TEXT CHECK(team_role IN ('admin','support'))"), ('devices', 'offline_alert_seconds', 'INTEGER NOT NULL DEFAULT 900'), ('contacts', 'phone', 'TEXT')]
    for table, column, ddl in additions:
        if column not in columns[table]:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}')
            if column == 'effective_at':
                db.execute('UPDATE reminders SET effective_at=created_at')
    db.execute("UPDATE users SET household_role='owner' WHERE role='caregiver' AND household_role IS NULL AND household_id IS NOT NULL")
    db.execute("UPDATE users SET team_role='admin' WHERE role='operator' AND team_role IS NULL")
    db.execute("INSERT OR IGNORE INTO gateways(id,device_id,name,kind,token_hash,created_at) SELECT lower(hex(randomblob(16))),id,'Browser gateway','web',token_hash,created_at FROM devices WHERE token_hash IS NOT NULL AND token_hash NOT IN (SELECT token_hash FROM gateways)")
    db.execute('UPDATE devices SET token_hash=NULL WHERE token_hash IS NOT NULL')


def create_app(config=None):
    app = Flask(__name__, static_folder=str(ROOT / 'static'))
    data_dir = Path(os.environ.get('LOOMCARE_DATA_DIR', ROOT / 'data'))
    env = os.environ.get
    app.config.update(DATABASE=str(data_dir / 'care.db'), SECRET_KEY=env('LOOMCARE_SECRET_KEY'), START_WORKER=True,
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict', SESSION_COOKIE_SECURE=env('LOOMCARE_SECURE_COOKIES') == '1',
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12), MAX_CONTENT_LENGTH=65536,
                      ENABLE_SMTP=env('LOOMCARE_ENABLE_SMTP') == '1', SMTP_HOST=env('SMTP_HOST'), SMTP_PORT=int(env('SMTP_PORT', '465')),
                      SMTP_USERNAME=env('SMTP_USERNAME'), SMTP_PASSWORD=env('SMTP_PASSWORD'), SMTP_SENDER=env('SMTP_SENDER'),
                      ENABLE_PUSH=env('LOOMCARE_ENABLE_PUSH') == '1', EXPO_ACCESS_TOKEN=env('EXPO_ACCESS_TOKEN'),
                      WEBHOOK_URL=env('LOOMCARE_ESCALATION_WEBHOOK_URL'), WEBHOOK_SECRET=env('LOOMCARE_ESCALATION_WEBHOOK_SECRET'),
                      MOBILE_TOKEN_DAYS=90)
    if config:
        app.config.update(config)
    Path(app.config['DATABASE']).parent.mkdir(parents=True, exist_ok=True)
    if not app.secret_key:
        if app.config['SESSION_COOKIE_SECURE']:
            raise RuntimeError('Set LOOMCARE_SECRET_KEY to at least 32 random characters for deployment.')
        key_path = Path(app.config['DATABASE']).parent / 'session.key'
        try:
            with key_path.open('x') as key_file:
                key_path.chmod(0o600)
                key_file.write(secrets.token_hex(32))
        except FileExistsError:
            pass
        app.secret_key = key_path.read_text().strip()
    if len(app.secret_key) < 32:
        raise RuntimeError('LOOMCARE_SECRET_KEY must contain at least 32 characters.')
    if app.config['ENABLE_SMTP'] and not all(app.config[k] for k in ('SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_SENDER')):
        raise RuntimeError('SMTP is enabled but its configuration is incomplete.')
    if app.config['WEBHOOK_URL'] and (not app.config['WEBHOOK_URL'].startswith('https://') or len(app.config['WEBHOOK_SECRET'] or '') < 32):
        raise RuntimeError('The escalation webhook needs an https:// URL and a secret of at least 32 characters.')
    db = connect_db(app)
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript((ROOT / 'schema.sql').read_text())
    migrate(db)
    db.close()
    runtime = {'latencies': deque(maxlen=1000), 'rate': defaultdict(deque), 'lock': threading.Lock(), 'worker_last_tick': None, 'started': time.time(), 'stop': threading.Event()}
    app.extensions['care'] = runtime

    def bearer():
        header = request.headers.get('Authorization', '')
        return header[7:] if header.startswith('Bearer ') and 20 <= len(header) <= 250 else None

    def user(operator=False, admin=False):
        if 'actor' not in g:
            token = bearer()
            if token:
                row = g.db.execute(f'SELECT {USER_COLUMNS},t.token_hash,t.last_used FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?', (digest(token), time.time())).fetchone()
                if row and (row['last_used'] or 0) < time.time() - 300:
                    g.db.execute('UPDATE api_tokens SET last_used=? WHERE token_hash=?', (time.time(), row['token_hash']))
            else:
                row = g.db.execute(f'SELECT {USER_COLUMNS} FROM users u WHERE u.id=?', (session.get('user_id'),)).fetchone()
            g.actor = row
        row = g.actor
        if not row:
            abort(401, 'Please sign in.')
        if (operator or admin) and row['role'] != 'operator':
            abort(403, 'Team access required.')
        if admin and row['team_role'] != 'admin':
            abort(403, 'Team administrator access required.')
        return row

    def member(min_role='viewer'):
        actor = user()
        if actor['role'] != 'caregiver' or not actor['household_id']:
            abort(403, 'Create a family or join one with an invite first.')
        if ROLE_RANK[actor['household_role'] or 'viewer'] < ROLE_RANK[min_role]:
            abort(403, 'Your Care Circle role does not allow this change.')
        return actor

    def device_for(device_id, min_role='viewer', allow_operator=False):
        actor = user()
        device = g.db.execute('SELECT * FROM devices WHERE id=?', (device_id,)).fetchone()
        if actor['role'] == 'operator':
            if not device or not allow_operator:
                abort(404, 'Device not found.')
            return device
        if not device or device['household_id'] != actor['household_id']:
            abort(404, 'Device not found.')
        member(min_role)
        return device

    def rate_limit(key, maximum, window=60):
        now = time.monotonic()
        with runtime['lock']:
            if len(runtime['rate']) > 10000:
                runtime['rate'] = defaultdict(deque, {k: q for k, q in runtime['rate'].items() if q and q[-1] > now - 300})
            queue = runtime['rate'][key]
            while queue and queue[0] < now - window:
                queue.popleft()
            if len(queue) >= maximum:
                abort(429, 'Too many requests. Please wait and retry.')
            queue.append(now)

    @app.before_request
    def before():
        g.started = time.perf_counter()
        g.db = connect_db(app)
        if request.path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.path.startswith('/api/gateway/'):
                rate_limit(('gateway', request.remote_addr), 600)
            elif not (request.path.startswith('/api/mobile/') or bearer()):
                expected = session.get('csrf', '')
                if not expected or not secrets.compare_digest(request.headers.get('X-CSRF-Token', ''), expected):
                    abort(403, 'Session expired or invalid CSRF token. Refresh this page.')
            g.db.execute('BEGIN IMMEDIATE')

    @app.after_request
    def after(response):
        if g.get('db') and g.db.in_transaction:
            if response.status_code < 400:
                g.db.execute("UPDATE metadata SET value=value+1 WHERE key='revision'")
                g.db.commit()
            else:
                g.db.rollback()
        elapsed = (time.perf_counter() - g.started) * 1000
        if request.path.startswith('/api/'):
            with runtime['lock']:
                runtime['latencies'].append(elapsed)
        response.headers.update({'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
                                 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
                                 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), bluetooth=(self)', 'Server-Timing': f'app;dur={elapsed:.2f}'})
        if not request.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'no-store'
        if app.config['SESSION_COOKIE_SECURE']:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.teardown_request
    def teardown(error):
        if g.get('db'):
            g.db.close()

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(sqlite3.IntegrityError)
    def conflict(error):
        return jsonify(error='That record already exists or conflicts with another change.'), 409

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.error('Request failed: %s', type(error).__name__)
        return jsonify(error='The operation could not be completed. Retry safely.'), 500

    @app.get('/')
    @app.get('/family')
    @app.get('/team')
    @app.get('/gateway')
    @app.get('/hardware')
    @app.get('/plan')
    def index():
        return send_from_directory(ROOT / 'static', 'index.html')

    @app.get('/healthz')
    def health():
        g.db.execute('SELECT 1').fetchone()
        tick_at = runtime['worker_last_tick']
        healthy = not app.config['START_WORKER'] or (tick_at is not None and time.time() - tick_at < 10)
        return jsonify(status='ok' if healthy else 'degraded', version='v1-prototype', worker_last_tick=tick_at), 200 if healthy else 503

    @app.get('/run-prediction')
    def retired():
        return jsonify(error='Legacy cloud inference is retired. Use the V1 gateway event API.'), 410

    def authenticate(data, register):
        email = email_value(data)
        rate_limit(('auth-ip', request.remote_addr), 15, 300)
        rate_limit(('auth-email', email), 8, 300)
        password = text(data, 'password', 128, 12)
        if not register:
            row = g.db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            if not check_password_hash(row['password_hash'] if row else app.config['DUMMY_PASSWORD_HASH'], password) or not row:
                abort(401, 'Email or password is incorrect.')
            return row['id']
        name, user_id, now = text(data, 'name', 80), uid(), time.time()
        code, invite = data.get('invite'), None
        if code:
            invite = g.db.execute('SELECT * FROM invites WHERE code_hash=? AND used_at IS NULL AND expires_at>?', (digest(str(code).strip().upper()), now)).fetchone()
            if not invite:
                abort(400, 'This invite code is invalid, used or expired. Ask the family owner for a new one.')
            household_id, role = invite['household_id'], invite['role']
        else:
            household_id, role = uid(), 'owner'
            g.db.execute('INSERT INTO households VALUES (?,?,?)', (household_id, f'{name} family', now))
        g.db.execute('INSERT INTO users(id,household_id,name,email,password_hash,role,created_at,household_role) VALUES (?,?,?,?,?,?,?,?)',
                     (user_id, household_id, name, email, generate_password_hash(password), 'caregiver', now, role))
        if invite:
            g.db.execute('UPDATE invites SET used_by=?,used_at=? WHERE code_hash=?', (user_id, now, invite['code_hash']))
        audit(g.db, user_id, 'joined_household' if invite else 'account_created', household_id)
        return user_id

    def public_user(user_id):
        row = g.db.execute(f'SELECT {USER_COLUMNS} FROM users u WHERE u.id=?', (user_id,)).fetchone()
        return dict(row) if row else None

    @app.get('/api/session')
    def get_session():
        session.setdefault('csrf', secrets.token_hex(32))
        return jsonify(user=public_user(session.get('user_id')), csrf=session['csrf'], smtp_enabled=app.config['ENABLE_SMTP'])

    @app.post('/api/register')
    @app.post('/api/login')
    def login():
        user_id = authenticate(payload(), request.path.endswith('register'))
        session.clear()
        session.update(user_id=user_id, csrf=secrets.token_hex(32))
        session.permanent = True
        return jsonify(ok=True, csrf=session['csrf'])

    @app.post('/api/logout')
    def logout():
        session.clear()
        return jsonify(ok=True)

    @app.post('/api/mobile/register')
    @app.post('/api/mobile/login')
    def mobile_login():
        data = payload()
        user_id = authenticate(data, request.path.endswith('register'))
        token, now = secrets.token_urlsafe(32), time.time()
        name = data.get('device_name') if isinstance(data.get('device_name'), str) else 'Phone'
        g.db.execute('INSERT INTO api_tokens VALUES (?,?,?,?,?,?)', (digest(token), user_id, name.strip()[:60] or 'Phone', now, now, now + app.config['MOBILE_TOKEN_DAYS'] * 86400))
        return jsonify(token=token, user=public_user(user_id))

    @app.get('/api/me')
    def me():
        return jsonify(user=public_user(user()['id']))

    @app.post('/api/mobile/logout')
    def mobile_logout():
        actor = user()
        token = bearer()
        if token:
            g.db.execute('DELETE FROM api_tokens WHERE token_hash=?', (digest(token),))
        data = optional_payload()
        if isinstance(data.get('push_token'), str):
            g.db.execute('DELETE FROM push_tokens WHERE token=? AND user_id=?', (data['push_token'], actor['id']))
        return jsonify(ok=True)

    @app.post('/api/push-tokens')
    def register_push():
        actor = user()
        data = payload()
        token = text(data, 'token', 200)
        platform = data.get('platform')
        if not EXPO_TOKEN.fullmatch(token) or platform not in ('ios', 'android'):
            abort(400, 'Expected an Expo push token and platform ios or android.')
        if g.db.execute('SELECT COUNT(*) FROM push_tokens WHERE user_id=?', (actor['id'],)).fetchone()[0] >= 5:
            g.db.execute('DELETE FROM push_tokens WHERE token=(SELECT token FROM push_tokens WHERE user_id=? ORDER BY created_at LIMIT 1)', (actor['id'],))
        g.db.execute('INSERT INTO push_tokens VALUES (?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,created_at=excluded.created_at', (token, actor['id'], platform, time.time()))
        return jsonify(ok=True)

    def device_rows(clause, args, now):
        rows = [dict(r) for r in g.db.execute('SELECT id,household_id,name,mode,last_seen,connected,battery,charging,sensor_ok,clock_ok,queue_overflow,firmware,escalation_seconds,offline_alert_seconds,created_at FROM devices' + clause + ' ORDER BY created_at', args)]
        for device in rows:
            device['online'] = bool(device['connected'] and device['last_seen'] and now - device['last_seen'] < ONLINE_WINDOW)
            device['silent_seconds'] = None if device['online'] or not device['last_seen'] else int(now - device['last_seen'])
        return rows

    def gateway_rows(device_ids, now):
        if not device_ids:
            return []
        rows = [dict(r) for r in g.db.execute(f"SELECT id,device_id,name,kind,created_at,last_seen,connected,app_version FROM gateways WHERE revoked_at IS NULL AND device_id IN ({','.join('?' * len(device_ids))}) ORDER BY created_at", device_ids)]
        for gateway in rows:
            gateway['online'] = bool(gateway['last_seen'] and now - gateway['last_seen'] < ONLINE_WINDOW)
        return rows

    @app.get('/api/state')
    def state():
        actor = user()
        is_team = actor['role'] == 'operator'
        now = time.time()
        if not is_team and not actor['household_id']:
            return jsonify(devices=[], gateways=[], events=[], notifications=[], reminders=[], contacts=[], customers=[], members=[], me=dict(actor), now=now, timezone='Asia/Kolkata', smtp_enabled=app.config['ENABLE_SMTP'], push_enabled=app.config['ENABLE_PUSH'])
        clause, args = ('', ()) if is_team else (' WHERE household_id=?', (actor['household_id'],))
        devices = device_rows(clause, args, now)
        events = [dict(r) for r in g.db.execute('SELECT * FROM events' + clause + ' ORDER BY received_at DESC LIMIT 150', args)]
        notifications = [dict(r) for r in g.db.execute('SELECT * FROM notifications' + clause + ' ORDER BY created_at DESC LIMIT 100', args)]
        suffix = '' if is_team else ' WHERE d.household_id=?'
        reminders = [dict(r) for r in g.db.execute('SELECT r.* FROM reminders r JOIN devices d ON d.id=r.device_id' + suffix + ' ORDER BY r.minute', args)]
        contacts = [dict(r) for r in g.db.execute('SELECT c.* FROM contacts c JOIN devices d ON d.id=c.device_id' + suffix + ' ORDER BY c.priority', args)]
        customers = [dict(r) for r in g.db.execute("SELECT u.name,u.email,u.created_at,h.id,h.name AS household FROM users u JOIN households h ON h.id=u.household_id WHERE u.role='caregiver' AND u.household_role='owner' ORDER BY u.created_at DESC LIMIT 200")] if is_team else []
        members = [] if is_team else [dict(r) for r in g.db.execute("SELECT id,name,email,household_role,created_at FROM users WHERE household_id=? ORDER BY household_role DESC,created_at", (actor['household_id'],))]
        return jsonify(devices=devices, gateways=gateway_rows([d['id'] for d in devices], now), events=events, notifications=notifications, reminders=reminders, contacts=contacts,
                       customers=customers, members=members, me=dict(actor), now=now, timezone='Asia/Kolkata', smtp_enabled=app.config['ENABLE_SMTP'], push_enabled=app.config['ENABLE_PUSH'])

    @app.post('/api/devices')
    def add_device():
        actor = member('owner')
        data = payload()
        mode = data.get('mode', 'simulator')
        if mode not in ('simulator', 'physical'):
            abort(400, 'Invalid device mode.')
        if g.db.execute('SELECT COUNT(*) FROM devices WHERE household_id=?', (actor['household_id'],)).fetchone()[0] >= 6:
            abort(400, 'Prototype limit: six parents/devices per household.')
        device_id = uid()
        g.db.execute('INSERT INTO devices(id,household_id,name,mode,created_at) VALUES (?,?,?,?,?)', (device_id, actor['household_id'], text(data, 'name', 80), mode, time.time()))
        audit(g.db, actor['id'], 'device_created', device_id)
        return jsonify(dict(g.db.execute('SELECT id,name,mode FROM devices WHERE id=?', (device_id,)).fetchone())), 201

    @app.patch('/api/devices/<device_id>')
    def settings(device_id):
        device = device_for(device_id, 'owner')
        data = payload()
        seconds = bounded_int(data, 'escalation_seconds', 15, 600, device['escalation_seconds'], 'Escalation must be between 15 and 600 seconds.')
        offline = bounded_int(data, 'offline_alert_seconds', 120, 86400, device['offline_alert_seconds'], 'Silence alert must be between 2 minutes and 24 hours.')
        name = text(data, 'name', 80) if 'name' in data else device['name']
        g.db.execute('UPDATE devices SET name=?,escalation_seconds=?,offline_alert_seconds=? WHERE id=?', (name, seconds, offline, device_id))
        audit(g.db, user()['id'], 'device_settings', device_id)
        return jsonify(ok=True)

    @app.post('/api/devices/<device_id>/pair')
    @app.post('/api/devices/<device_id>/gateways')
    def pair(device_id):
        device_for(device_id, 'owner')
        data = optional_payload()
        kind = data.get('kind', 'web')
        if kind not in ('web', 'phone', 'hub'):
            abort(400, 'Gateway kind must be web, phone or hub.')
        if g.db.execute('SELECT COUNT(*) FROM gateways WHERE device_id=? AND revoked_at IS NULL', (device_id,)).fetchone()[0] >= 4:
            abort(400, 'This pendant already has four gateways. Remove one before adding another.')
        name = text(data, 'name', 60) if data.get('name') else {'web': 'Browser gateway', 'phone': "Parent's phone", 'hub': 'Home Hub'}[kind]
        token, gateway_id = secrets.token_urlsafe(32), uid()
        g.db.execute('INSERT INTO gateways(id,device_id,name,kind,token_hash,created_at) VALUES (?,?,?,?,?,?)', (gateway_id, device_id, name, kind, digest(token), time.time()))
        audit(g.db, user()['id'], 'gateway_paired', gateway_id)
        return jsonify(token=token, device_id=device_id, gateway_id=gateway_id, kind=kind, name=name)

    @app.delete('/api/gateways/<gateway_id>')
    def revoke_gateway(gateway_id):
        gateway = g.db.execute('SELECT * FROM gateways WHERE id=? AND revoked_at IS NULL', (gateway_id,)).fetchone()
        if not gateway:
            abort(404, 'Gateway not found.')
        actor = user()
        if actor['role'] == 'operator':
            user(admin=True)
        else:
            device_for(gateway['device_id'], 'owner')
        g.db.execute('UPDATE gateways SET revoked_at=? WHERE id=?', (time.time(), gateway_id))
        audit(g.db, actor['id'], 'gateway_revoked', gateway_id)
        return jsonify(ok=True)

    @app.post('/api/devices/<device_id>/checkin')
    def checkin(device_id):
        device = device_for(device_id, 'caregiver')
        if g.db.execute("SELECT 1 FROM events WHERE device_id=? AND kind='checkin' AND status='awaiting'", (device_id,)).fetchone():
            abort(409, 'A check-in is already waiting for a response.')
        now = time.time()
        event = new_event(g.db, device, 'checkin', 'awaiting', now, occurred_at=now, due_at=now + 120, note='Please press the pendant button to respond.')
        g.db.execute('INSERT INTO commands(id,device_id,event_id,expires_at) VALUES (?,?,?,?)', (uid(), device_id, event['id'], now + 120))
        audit(g.db, user()['id'], 'checkin_requested', event['id'])
        return jsonify(dict(event)), 201

    @app.post('/api/devices/<device_id>/reminders')
    def add_reminder(device_id):
        device_for(device_id, 'caregiver')
        data = payload()
        clock = text(data, 'time', 5, 5)
        if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', clock):
            abort(400, 'Time must be HH:MM in Asia/Kolkata.')
        if g.db.execute('SELECT COUNT(*) FROM reminders WHERE device_id=?', (device_id,)).fetchone()[0] >= 8:
            abort(400, 'Prototype supports eight stored daily reminders per pendant.')
        reminder_id, now = uid(), time.time()
        minute = int(clock[:2]) * 60 + int(clock[3:])
        g.db.execute('INSERT INTO reminders VALUES (?,?,?,?,?,?,?)', (reminder_id, device_id, text(data, 'label', 80), minute, 1, now, int(now // 60) * 60))
        audit(g.db, user()['id'], 'reminder_created', reminder_id)
        return jsonify(id=reminder_id), 201

    @app.patch('/api/reminders/<reminder_id>')
    def update_reminder(reminder_id):
        row = g.db.execute('SELECT * FROM reminders WHERE id=?', (reminder_id,)).fetchone()
        if not row:
            abort(404)
        device_for(row['device_id'], 'caregiver')
        data = payload()
        if type(data.get('enabled')) is not bool:
            abort(400, 'enabled must be a boolean.')
        g.db.execute('UPDATE reminders SET enabled=?,effective_at=? WHERE id=?', (data['enabled'], int(time.time() // 60) * 60, reminder_id))
        if not data['enabled']:
            g.db.execute("UPDATE events SET status='cancelled',due_at=NULL WHERE device_id=? AND kind='reminder' AND status='awaiting' AND source_ref LIKE ?", (row['device_id'], reminder_id + ':%'))
        audit(g.db, user()['id'], 'reminder_updated', reminder_id)
        return jsonify(ok=True)

    @app.post('/api/devices/<device_id>/contacts')
    def add_contact(device_id):
        device_for(device_id, 'caregiver')
        data = payload()
        if g.db.execute('SELECT COUNT(*) FROM contacts WHERE device_id=?', (device_id,)).fetchone()[0] >= 5:
            abort(400, 'Prototype limit: five emergency contacts per device.')
        contact_id = uid()
        priority = g.db.execute('SELECT COALESCE(MAX(priority),-1)+1 FROM contacts WHERE device_id=?', (device_id,)).fetchone()[0]
        g.db.execute('INSERT INTO contacts(id,device_id,name,email,priority,phone) VALUES (?,?,?,?,?,?)', (contact_id, device_id, text(data, 'name', 80), email_value(data), priority, phone_value(data)))
        audit(g.db, user()['id'], 'contact_created', contact_id)
        return jsonify(id=contact_id), 201

    @app.delete('/api/contacts/<contact_id>')
    def remove_contact(contact_id):
        row = g.db.execute('SELECT * FROM contacts WHERE id=?', (contact_id,)).fetchone()
        if not row:
            abort(404)
        device_for(row['device_id'], 'caregiver')
        g.db.execute('DELETE FROM contacts WHERE id=?', (contact_id,))
        audit(g.db, user()['id'], 'contact_removed', contact_id)
        return jsonify(ok=True)

    @app.post('/api/events/<event_id>/ack')
    def acknowledge(event_id):
        event = g.db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
        if not event:
            abort(404)
        device_for(event['device_id'], 'viewer', allow_operator=True)
        if event['kind'] in ('checkin', 'reminder', 'fall_cancelled'):
            abort(409, 'Only the wearer can acknowledge a check-in or reminder.')
        if event['status'] not in ACTIVE + ('missed',):
            abort(409, 'This incident is already closed.')
        data = optional_payload()
        note = text(data, 'note', 300) if data.get('note') else 'Caregiver/team acknowledged; actual care is not verified.'
        g.db.execute("UPDATE events SET status='acknowledged',acknowledged_at=?,due_at=NULL,note=? WHERE id=?", (time.time(), note, event_id))
        audit(g.db, user()['id'], 'incident_acknowledged', event_id)
        return jsonify(ok=True)

    @app.get('/api/members')
    def members():
        actor = member()
        rows = [dict(r) for r in g.db.execute('SELECT id,name,email,household_role,created_at FROM users WHERE household_id=? ORDER BY household_role DESC,created_at', (actor['household_id'],))]
        invites = [dict(r) for r in g.db.execute('SELECT role,created_at,expires_at FROM invites WHERE household_id=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC', (actor['household_id'], time.time()))] if actor['household_role'] == 'owner' else []
        return jsonify(members=rows, invites=invites)

    @app.post('/api/invites')
    def create_invite():
        actor = member('owner')
        role = payload().get('role', 'caregiver')
        if role not in ('caregiver', 'viewer'):
            abort(400, 'Invite role must be caregiver or viewer.')
        now = time.time()
        if g.db.execute('SELECT COUNT(*) FROM invites WHERE household_id=? AND used_at IS NULL AND expires_at>?', (actor['household_id'], now)).fetchone()[0] >= 10:
            abort(400, 'Too many open invites. Wait for some to be used or expire.')
        code = '-'.join(''.join(secrets.choice('ABCDEFGHJKMNPQRSTUVWXYZ23456789') for _ in range(4)) for _ in range(3))
        g.db.execute('INSERT INTO invites VALUES (?,?,?,?,?,?,?,?)', (digest(code), actor['household_id'], role, actor['id'], now, now + 7 * 86400, None, None))
        audit(g.db, actor['id'], 'invite_created', role)
        return jsonify(code=code, role=role, expires_at=now + 7 * 86400), 201

    @app.patch('/api/members/<user_id>')
    @app.delete('/api/members/<user_id>')
    def manage_member(user_id):
        actor = member('owner')
        target = g.db.execute('SELECT * FROM users WHERE id=? AND household_id=?', (user_id, actor['household_id'])).fetchone()
        if not target:
            abort(404, 'Member not found.')
        if target['id'] == actor['id']:
            abort(409, 'You cannot change or remove your own membership.')
        if request.method == 'DELETE':
            g.db.execute('UPDATE users SET household_id=NULL,household_role=NULL WHERE id=?', (user_id,))
            g.db.execute('DELETE FROM api_tokens WHERE user_id=?', (user_id,))
            g.db.execute('DELETE FROM push_tokens WHERE user_id=?', (user_id,))
            audit(g.db, actor['id'], 'member_removed', user_id)
        else:
            role = payload().get('role')
            if role not in ROLE_RANK:
                abort(400, 'Role must be owner, caregiver or viewer.')
            g.db.execute('UPDATE users SET household_role=? WHERE id=?', (role, user_id))
            audit(g.db, actor['id'], f'member_role_{role}', user_id)
        return jsonify(ok=True)

    @app.get('/api/operator/metrics')
    def metrics():
        user(operator=True)
        with runtime['lock']:
            samples = sorted(runtime['latencies'])

        def percentile(p):
            return round(samples[min(len(samples) - 1, int((len(samples) - 1) * p))], 2) if samples else None
        return jsonify(p50_ms=percentile(.5), p95_ms=percentile(.95), sample_count=len(samples), uptime_seconds=int(time.time() - runtime['started']), worker_last_tick=runtime['worker_last_tick'],
                       delivery_counts=[dict(r) for r in g.db.execute('SELECT channel,status,COUNT(*) AS count FROM notifications GROUP BY channel,status')],
                       audit=[dict(r) for r in g.db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')], channels=['in_app'] + external_channels(app),
                       targets={'ui_poll_seconds': 2, 'worker_tick_seconds': 1, 'online_window_seconds': ONLINE_WINDOW, 'default_family_silence_alert_seconds': 900, 'local_cancel_seconds': 15})

    @app.get('/api/operator/households')
    def households():
        user(operator=True)
        now = time.time()
        rows = g.db.execute("""SELECT h.id,h.name,h.created_at,
            (SELECT name FROM users WHERE household_id=h.id AND household_role='owner' ORDER BY created_at LIMIT 1) AS owner,
            (SELECT email FROM users WHERE household_id=h.id AND household_role='owner' ORDER BY created_at LIMIT 1) AS owner_email,
            (SELECT COUNT(*) FROM users WHERE household_id=h.id) AS members,
            (SELECT COUNT(*) FROM devices WHERE household_id=h.id) AS devices,
            (SELECT COUNT(*) FROM devices WHERE household_id=h.id AND connected=1 AND last_seen>=?) AS online,
            (SELECT COUNT(*) FROM events WHERE household_id=h.id AND status IN ('open','escalated','missed')) AS open_incidents,
            (SELECT MAX(received_at) FROM events WHERE household_id=h.id) AS last_event
            FROM households h ORDER BY h.created_at DESC LIMIT 500""", (now - ONLINE_WINDOW,))
        return jsonify(households=[dict(r) for r in rows])

    @app.get('/api/operator/households/<household_id>')
    def household_detail(household_id):
        user(operator=True)
        household = g.db.execute('SELECT * FROM households WHERE id=?', (household_id,)).fetchone()
        if not household:
            abort(404, 'Household not found.')
        now = time.time()
        devices = device_rows(' WHERE household_id=?', (household_id,), now)
        return jsonify(household=dict(household), devices=devices, gateways=gateway_rows([d['id'] for d in devices], now),
                       members=[dict(r) for r in g.db.execute('SELECT id,name,email,household_role,created_at FROM users WHERE household_id=? ORDER BY household_role DESC,created_at', (household_id,))],
                       events=[dict(r) for r in g.db.execute('SELECT * FROM events WHERE household_id=? ORDER BY received_at DESC LIMIT 50', (household_id,))],
                       notes=[dict(r) for r in g.db.execute('SELECT n.id,n.body,n.created_at,u.name AS author FROM support_notes n JOIN users u ON u.id=n.author_id WHERE n.household_id=? ORDER BY n.created_at DESC LIMIT 100', (household_id,))],
                       inventory=[dict(r) for r in g.db.execute('SELECT i.* FROM inventory i JOIN devices d ON d.id=i.device_id WHERE d.household_id=?', (household_id,))])

    @app.post('/api/operator/households/<household_id>/notes')
    def add_note(household_id):
        actor = user(operator=True)
        if not g.db.execute('SELECT 1 FROM households WHERE id=?', (household_id,)).fetchone():
            abort(404, 'Household not found.')
        note_id = uid()
        g.db.execute('INSERT INTO support_notes VALUES (?,?,?,?,?)', (note_id, household_id, actor['id'], text(payload(), 'body', 1000), time.time()))
        audit(g.db, actor['id'], 'support_note_added', household_id)
        return jsonify(id=note_id), 201

    @app.get('/api/operator/inventory')
    def inventory():
        user(operator=True)
        rows = g.db.execute('SELECT i.*,d.name AS device_name,h.name AS household FROM inventory i LEFT JOIN devices d ON d.id=i.device_id LEFT JOIN households h ON h.id=d.household_id ORDER BY i.updated_at DESC LIMIT 1000')
        return jsonify(inventory=[dict(r) for r in rows])

    @app.post('/api/operator/inventory')
    def add_inventory():
        actor = user(admin=True)
        data = payload()
        serial = text(data, 'serial', 32, 4).upper()
        if not SERIAL.fullmatch(serial):
            abort(400, 'Serial may use A–Z, 0–9 and hyphens (4–32 characters).')
        now = time.time()
        g.db.execute('INSERT INTO inventory VALUES (?,?,?,?,?,?,?)', (serial, text(data, 'hardware_rev', 40), 'in_stock', None, '', now, now))
        audit(g.db, actor['id'], 'inventory_added', serial)
        return jsonify(serial=serial), 201

    @app.patch('/api/operator/inventory/<serial>')
    def update_inventory(serial):
        actor = user(admin=True)
        row = g.db.execute('SELECT * FROM inventory WHERE serial=?', (serial,)).fetchone()
        if not row:
            abort(404, 'Unit not found.')
        data = payload()
        device_id = data['device_id'] if 'device_id' in data else row['device_id']
        if device_id is not None and (not isinstance(device_id, str) or not g.db.execute('SELECT 1 FROM devices WHERE id=?', (device_id,)).fetchone()):
            abort(400, 'Unknown device.')
        status = data.get('status', 'assigned' if device_id else ('in_stock' if row['status'] == 'assigned' else row['status']))
        if status not in ('in_stock', 'assigned', 'returned', 'faulty', 'retired'):
            abort(400, 'Invalid status.')
        if (status == 'assigned') != bool(device_id):
            abort(400, 'Assigned units need a device; other statuses must not have one.')
        notes = text(data, 'notes', 500, 0) if 'notes' in data else row['notes']
        g.db.execute('UPDATE inventory SET status=?,device_id=?,notes=?,updated_at=? WHERE serial=?', (status, device_id, notes, time.time(), serial))
        audit(g.db, actor['id'], f'inventory_{status}', serial)
        return jsonify(ok=True)

    @app.get('/api/operator/team')
    def team():
        user(admin=True)
        return jsonify(team=[dict(r) for r in g.db.execute("SELECT id,name,email,team_role,created_at FROM users WHERE role='operator' ORDER BY created_at")])

    @app.route('/api/gateway/sync', methods=['GET', 'POST'])
    def gateway():
        token = bearer()
        if not token:
            abort(401, 'Pair this gateway from the family app.')
        gateway_row = g.db.execute('SELECT * FROM gateways WHERE token_hash=? AND revoked_at IS NULL', (digest(token),)).fetchone()
        if not gateway_row:
            abort(401, 'Gateway pairing expired or was revoked. Pair it again.')
        device = g.db.execute('SELECT * FROM devices WHERE id=?', (gateway_row['device_id'],)).fetchone()
        now = time.time()
        accepted = []
        if request.method == 'POST':
            data = payload()
            telemetry = {}
            for key in ('connected', 'charging', 'sensor_ok', 'clock_ok'):
                if key in data:
                    if data[key] is not None and type(data[key]) is not bool:
                        abort(400, f'{key} must be a boolean or null.')
                    if key == 'connected' and data[key] is None:
                        abort(400, 'connected cannot be null.')
                    telemetry[key] = data[key]
            link = telemetry.pop('connected', None)
            if 'battery' in data:
                value = data['battery']
                if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100):
                    abort(400, 'Battery must be null or 0–100.')
                telemetry['battery'] = value
            if 'queue_overflow' in data:
                if type(data['queue_overflow']) is not int or not 0 <= data['queue_overflow'] <= 2147483647:
                    abort(400, 'Invalid queue overflow count.')
                telemetry['queue_overflow'] = data['queue_overflow']
            if 'firmware' in data:
                telemetry['firmware'] = text(data, 'firmware', 60)
            gateway_updates = {'last_seen': now}
            if link is not None:
                gateway_updates['connected'] = link
            if 'app_version' in data:
                gateway_updates['app_version'] = text(data, 'app_version', 40)
            g.db.execute('UPDATE gateways SET ' + ','.join(f'{k}=?' for k in gateway_updates) + ' WHERE id=?', (*gateway_updates.values(), gateway_row['id']))
            updates = {} if link is False else dict(telemetry)
            if link:
                updates.update(connected=True, last_seen=now)
            elif link is False and not g.db.execute('SELECT 1 FROM gateways WHERE device_id=? AND id!=? AND revoked_at IS NULL AND connected=1 AND last_seen>=?', (device['id'], gateway_row['id'], now - ONLINE_WINDOW)).fetchone():
                updates['connected'] = False
            if updates:
                g.db.execute('UPDATE devices SET ' + ','.join(f'{k}=?' for k in updates) + ' WHERE id=?', (*updates.values(), device['id']))
            received = data.get('commands_received', [])
            if not isinstance(received, list) or len(received) > 16 or any(not isinstance(i, str) or len(i) > 80 for i in received):
                abort(400, 'Invalid command receipts.')
            for command_id in received:
                g.db.execute('UPDATE commands SET received_at=? WHERE id=? AND device_id=? AND received_at IS NULL', (now, command_id, device['id']))
            items = data.get('events', [])
            if not isinstance(items, list) or len(items) > 32:
                abort(400, 'Send up to 32 events per batch.')
            for item in items:
                if not isinstance(item, dict):
                    abort(400, 'Malformed event.')
                source_id = text(item, 'id', 80)
                kind = item.get('kind')
                if kind not in ('fall', 'sos', 'fall_cancelled', 'reminder_ack', 'checkin_ack', 'device_fault'):
                    abort(400, 'Unsupported event kind.')
                occurred = item.get('occurred_at')
                if occurred is not None and (type(occurred) not in (int, float) or not math.isfinite(occurred) or not now - 7 * 86400 <= occurred <= now + 60):
                    abort(400, 'Event time must be within the last seven days; use null if the device clock is unknown.')
                accepted.append(source_id)
                if g.db.execute('SELECT 1 FROM ingested WHERE device_id=? AND source_id=?', (device['id'], source_id)).fetchone():
                    continue
                if kind in ('checkin_ack', 'reminder_ack'):
                    ref = text(item, 'ref', 100)
                    if kind == 'reminder_ack':
                        parts = ref.split(':')
                        if len(parts) != 2 or not parts[1].isdigit():
                            abort(400, 'Invalid reminder occurrence.')
                        reminder = g.db.execute('SELECT * FROM reminders WHERE id=? AND device_id=?', (parts[0], device['id'])).fetchone()
                        day = int(parts[1])
                        today = int((now + OFFSET) // 86400)
                        if not reminder or not today - 7 <= day <= today or day * 86400 - OFFSET + reminder['minute'] * 60 > now + 60:
                            abort(400, 'Unknown or future reminder occurrence.')
                        event = reminder_event(g.db, device, reminder, day, now)
                    else:
                        event = g.db.execute("SELECT * FROM events WHERE id=? AND device_id=? AND kind='checkin'", (ref, device['id'])).fetchone()
                        if not event:
                            abort(400, 'Unknown check-in.')
                    g.db.execute("UPDATE events SET status='acknowledged',acknowledged_at=?,due_at=NULL WHERE id=?", (occurred or now, event['id']))
                else:
                    event = new_event(g.db, device, kind, 'cancelled' if kind == 'fall_cancelled' else 'open', now, source_ref=f'input:{source_id}', occurred_at=occurred,
                                      due_at=now + device['escalation_seconds'] if kind in URGENT else None,
                                      note='Local fall warning cancelled by wearer.' if kind == 'fall_cancelled' else '')
                    if kind != 'fall_cancelled':
                        notify(g.db, app, event, now)
                g.db.execute('INSERT INTO ingested VALUES (?,?,?)', (device['id'], source_id, now))
            battery = updates.get('battery')
            low = g.db.execute("SELECT * FROM events WHERE device_id=? AND kind='low_battery' AND status IN ('open','acknowledged') ORDER BY received_at DESC LIMIT 1", (device['id'],)).fetchone()
            if battery is not None and battery < 20 and not low:
                notify(g.db, app, new_event(g.db, device, 'low_battery', 'open', now, note='Battery estimate below 20%; please charge.'), now)
            elif battery is not None and battery >= 25 and low:
                g.db.execute("UPDATE events SET status='resolved' WHERE id=?", (low['id'],))
        reminders = [dict(r) for r in g.db.execute('SELECT id,label,minute,enabled FROM reminders WHERE device_id=? ORDER BY minute', (device['id'],))]
        commands = [dict(r) for r in g.db.execute('SELECT id,event_id,expires_at FROM commands WHERE device_id=? AND received_at IS NULL AND expires_at>?', (device['id'], now))]
        return jsonify(device={'id': device['id'], 'name': device['name'], 'mode': device['mode']}, gateway={'id': gateway_row['id'], 'name': gateway_row['name'], 'kind': gateway_row['kind']},
                       accepted=accepted, reminders=reminders, commands=commands, now=now, timezone_offset=OFFSET)

    @app.cli.command('create-operator')
    @click.option('--email', prompt=True)
    @click.option('--name', default='Care team')
    @click.option('--team-role', type=click.Choice(['admin', 'support']), default='admin', show_default=True)
    @click.password_option()
    def create_operator(email, name, team_role, password):
        if len(password) < 12 or not EMAIL.fullmatch(email):
            raise click.ClickException('Use a valid email and a password of at least 12 characters.')
        connection = connect_db(app)
        try:
            connection.execute('INSERT INTO users(id,household_id,name,email,password_hash,role,created_at,team_role) VALUES (?,?,?,?,?,?,?,?)',
                               (uid(), None, name, email.lower(), generate_password_hash(password), 'operator', time.time(), team_role))
            click.echo(f'Team account created ({team_role}). Sign in at /team.')
        except sqlite3.IntegrityError:
            raise click.ClickException('That account already exists; no role was changed.')
        finally:
            connection.close()

    app.config['DUMMY_PASSWORD_HASH'] = generate_password_hash(secrets.token_hex(24))
    if app.config['START_WORKER']:
        def worker():
            while not runtime['stop'].is_set():
                try:
                    tick(app)
                except Exception as error:
                    app.logger.error('Workflow worker failed: %s', type(error).__name__)
                runtime['stop'].wait(1)
        threading.Thread(target=worker, daemon=True, name='care-workflows').start()
        if external_channels(app):
            def delivery_worker():
                while not runtime['stop'].is_set():
                    try:
                        if deliver_one(app):
                            continue
                    except Exception as error:
                        app.logger.error('Delivery worker failed: %s', type(error).__name__)
                    runtime['stop'].wait(1)
            threading.Thread(target=delivery_worker, daemon=True, name='care-delivery').start()
    return app
