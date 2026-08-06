require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  retries: 2,
  workers: 1,
  use: {
    baseURL: process.env.AGIP_BASE_URL || "http://portal-cct-qa.apps.ocp-test-hc.agip.gob.ar",
    actionTimeout: 30000,
    navigationTimeout: 60000,
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: false,
  },
  timeout: 120000,
  reporter: [
    ['html', { outputFolder: 'reports', open: 'never' }],
    ['list'],
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});