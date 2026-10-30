import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3199', channel: process.env.PW_CHANNEL || undefined, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node server/index.js', url: 'http://127.0.0.1:3199/api/health', reuseExistingServer: false,
    env: { PORT: '3199', HOST: '127.0.0.1', HOST_KEY: 'browser-test-key', DB_PATH: ':memory:' } }
});
