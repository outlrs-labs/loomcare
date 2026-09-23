import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from care import create_app

with tempfile.TemporaryDirectory(prefix='loomcare-bench-') as directory:
    app = create_app({'DATABASE': str(Path(directory) / 'bench.db'), 'SECRET_KEY': 'benchmark-only-32-character-secret-key', 'START_WORKER': False, 'ENABLE_SMTP': False})
    client = app.test_client()
    csrf = client.get('/api/session').json['csrf']
    result = client.post('/api/register', json={'name': 'Benchmark', 'email': 'bench@example.test', 'password': 'benchmark-only-password'}, headers={'X-CSRF-Token': csrf})
    headers = {'X-CSRF-Token': result.json['csrf']}
    device = client.post('/api/devices', json={'name': 'Test pendant'}, headers=headers).json
    token = client.post(f"/api/devices/{device['id']}/pair", json={}, headers=headers).json['token']
    measurements = {'event_ingestion': [], 'family_snapshot': []}
    for i in range(150):
        started = time.perf_counter()
        response = client.post('/api/gateway/sync', json={'events': [{'id': f'bench-{i}', 'kind': 'sos', 'occurred_at': time.time()}], 'connected': True}, headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 200
        if i >= 10:
            measurements['event_ingestion'].append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        assert client.get('/api/state').status_code == 200
        if i >= 10:
            measurements['family_snapshot'].append((time.perf_counter() - started) * 1000)
    output = {'scope': 'Local Flask test client + real temporary SQLite WAL; no network, SMTP, or hardware; sequential warm requests', 'samples_per_route': 140}
    for route, values in measurements.items():
        output[route] = {'p50_ms': round(statistics.median(values), 3), 'p95_ms': round(sorted(values)[int(len(values) * .95)], 3)}
    print(json.dumps(output, indent=2))
