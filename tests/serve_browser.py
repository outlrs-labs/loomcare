import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from care import create_app, connect_db, uid
from werkzeug.security import generate_password_hash
import time

with tempfile.TemporaryDirectory(prefix='loomcare-browser-') as folder:
    app = create_app({'DATABASE': str(Path(folder) / 'test.db'), 'SECRET_KEY': 'browser-fixture-only-not-a-deployment-key', 'ENABLE_SMTP': False})
    db = connect_db(app)
    db.execute('INSERT INTO users(id,household_id,name,email,password_hash,role,created_at,team_role) VALUES (?,?,?,?,?,?,?,?)', (uid(), None, 'Test operator', 'team@example.test', generate_password_hash('team-test-password-123'), 'operator', time.time(), 'admin'))
    db.close()
    app.run(host='127.0.0.1', port=8011, debug=False, use_reloader=False)
