const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  workers: 1,
  use: {baseURL: 'http://127.0.0.1:8011', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, trace: 'retain-on-failure'},
  webServer: {command: `${process.env.LOOMCARE_TEST_PYTHON || '.venv/bin/python'} tests/serve_browser.py`, url: 'http://127.0.0.1:8011/healthz', reuseExistingServer: false, timeout: 30000},
  reporter: 'list'
});
