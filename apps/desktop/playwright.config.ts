import { defineConfig, devices } from '@playwright/test';

const localNoProxy = ['127.0.0.1', 'localhost', '::1'];
process.env.NO_PROXY = [process.env.NO_PROXY, ...localNoProxy].filter(Boolean).join(',');
process.env.no_proxy = [process.env.no_proxy, ...localNoProxy].filter(Boolean).join(',');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    env: {
      ...process.env,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
    },
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
