// playwright.config.qa-av.js
// Configuración para correr la regresión completa contra QA_AV (NodeJS 20.3+)
// (renombrado de playwright.config.dev20.js el 2026-08-19 — DEV20 ya no se
// prueba más, ver memoria pfp-roadmap-fases del proyecto)
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Carga deuda a los CUITS_EJECUCION si les quedan pocos períodos (SIN_CARGA_DEUDA=1 lo saltea)
  globalSetup: require.resolve('./lib/globalSetupDeuda.js'),
  retries: 2,
  workers: 1,
  use: {
    baseURL: 'http://portal-cct-qa-av.apps.ocp-test-hc.agip.gob.ar',
    actionTimeout: 30000,
    navigationTimeout: 60000,
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: false,
  },
  timeout: 120000,
  reporter: [
    ['html', { outputFolder: 'reports/qa-av', open: 'never' }],
    ['list'],
  ],
  projects: [
    {
      name: 'chromium-QA_AV',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
