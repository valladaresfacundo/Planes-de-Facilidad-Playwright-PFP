// tests/smoke/TC_AGENTE_001_smoke.spec.js
// Smoke tests del Portal Agente QA_AV — perfil AgentePFP
// (migrado de DEV20 el 2026-08-19 — DEV20 ya no se prueba más, ver memoria pfp-roadmap-fases)

const { test, expect } = require('@playwright/test');
const { LoginAgentePage } = require('../../pages/LoginAgentePage');
const { AMBIENTES_AGENTE, AGENTE, SIGN_AGENTE } = require('../../fixtures/test-data');

const URL_AGENTE_QA_AV = AMBIENTES_AGENTE.QA_AV;

test.describe('Smoke Tests — Portal Agente QA_AV (AgentePFP)', () => {

  async function loginAgente(page) {
    const loginPage = new LoginAgentePage(page);
    await loginPage.login(URL_AGENTE_QA_AV, AGENTE.usuario, AGENTE.perfiles.AgentePFP, SIGN_AGENTE);
    const portalPage = loginPage.obtenerPagina();
    await portalPage.waitForLoadState('networkidle');
    return { portalPage, loginPage };
  }

  test('TC_AGENTE_001 — Portal Agente QA_AV responde sin errores', async ({ page }) => {
    const response = await page.goto(
      URL_AGENTE_QA_AV,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    expect(response, 'Portal Agente debe responder').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await page.screenshot({ path: 'screenshots/TC_AGENTE_001_portal_responde.png', fullPage: true });
    console.log(`Portal Agente responde con status: ${response.status()}`);
  });

  test('TC_AGENTE_002 — Login exitoso con perfil AgentePFP', async ({ page }) => {
    const { portalPage, loginPage } = await loginAgente(page);

    const exitoso = await loginPage.verificarLoginExitoso();
    await portalPage.screenshot({ path: 'screenshots/TC_AGENTE_002_login_agente.png', fullPage: true });

    expect(exitoso, 'Login del agente debe ser exitoso').toBe(true);
    console.log(`URL post-login agente: ${loginPage.obtenerUrl()}`);
  });

  test('TC_AGENTE_003 — Menú principal visible tras login AgentePFP', async ({ page }) => {
    const { portalPage } = await loginAgente(page);

    // Verificamos los ítems del menú que vimos en el Codegen
    await expect(portalPage.getByRole('link', { name: 'Inicio' })).toBeVisible({ timeout: 15000 });
    await expect(portalPage.getByRole('button', { name: 'Consultas' })).toBeVisible();
    await expect(portalPage.getByRole('button', { name: 'Operaciones' })).toBeVisible();
    await expect(portalPage.getByRole('link', { name: 'Reportes' })).toBeVisible();
    await expect(portalPage.getByRole('link', { name: 'Cerrar Sesión' })).toBeVisible();

    await portalPage.screenshot({ path: 'screenshots/TC_AGENTE_003_menu_agente.png', fullPage: true });
    console.log('Menú principal del Portal Agente visible correctamente');
  });

  test('TC_AGENTE_004 — Consultas → Contribuyentes → Consultar PF accesible', async ({ page }) => {
    const { portalPage } = await loginAgente(page);

    await portalPage.getByRole('button', { name: 'Consultas' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.getByRole('link', { name: 'Contribuyentes' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.getByRole('link', { name: 'Consultar PF' }).click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_AGENTE_004_consultar_pf.png', fullPage: true });

    const titulo = await portalPage.title();
    expect(titulo).not.toBe('');
    console.log(`Título Consultar PF: ${titulo}`);
  });

  test('TC_AGENTE_005 — Operaciones → Riesgo Fiscal accesible', async ({ page }) => {
    const { portalPage } = await loginAgente(page);

    await portalPage.getByRole('button', { name: 'Operaciones' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.getByRole('link', { name: 'Riesgo Fiscal' }).click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_AGENTE_005_riesgo_fiscal.png', fullPage: true });

    const titulo = await portalPage.title();
    expect(titulo).not.toBe('');
    console.log(`Título Riesgo Fiscal: ${titulo}`);
  });

  test('TC_AGENTE_006 — Reportes accesible', async ({ page }) => {
    const { portalPage } = await loginAgente(page);

    await portalPage.getByRole('link', { name: 'Reportes' }).click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_AGENTE_006_reportes.png', fullPage: true });

    const titulo = await portalPage.title();
    expect(titulo).not.toBe('');
    console.log(`Título Reportes: ${titulo}`);
  });

  test('TC_AGENTE_007 — Cerrar Sesión redirige correctamente', async ({ page }) => {
    const { portalPage } = await loginAgente(page);

    await portalPage.getByRole('link', { name: 'Cerrar Sesión' }).click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_AGENTE_007_logout.png', fullPage: true });

    const url = portalPage.url();
    console.log(`URL post-logout: ${url}`);
    // Verificamos que ya no estamos en el portal
    expect(url).not.toContain('/inicio');
  });

});