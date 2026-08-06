// playwright.config.dev20.js
// Configuración para correr la regresión completa contra DEV20 (NodeJS 20.3+)
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  retries: 2,
  workers: 1,
  use: {
    baseURL: 'http://portal-cct20-dev.apps.ocp-test-hc.agip.gob.ar',
    actionTimeout: 30000,
    navigationTimeout: 60000,
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: false,
  },
  timeout: 120000,
  reporter: [
    ['html', { outputFolder: 'reports/dev20', open: 'never' }],
    ['list'],
  ],
  projects: [
    {
      name: 'chromium-DEV20',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});