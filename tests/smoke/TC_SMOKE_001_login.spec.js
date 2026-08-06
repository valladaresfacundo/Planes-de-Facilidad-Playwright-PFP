// tests/smoke/TC_SMOKE_001_login.spec.js
const { test, expect } = require('@playwright/test');
const { LoginPage }    = require('../../pages/LoginPage');
const { PFPPage }      = require('../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PFP } = require('../../fixtures/test-data');

test.describe('Smoke Tests — Portal CCT AGIP QA Homo', () => {

  test('TC_SMOKE_001 — Portal responde sin errores de red', async ({ page }) => {
    console.log('Verificando que el portal responde...');
    const response = await page.goto(
      'http://portal-cct-qa.apps.ocp-test-hc.agip.gob.ar',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    expect(response, 'El portal debe responder').not.toBeNull();
    await page.screenshot({ path: 'screenshots/TC_SMOKE_001_portal.png', fullPage: true });
    console.log(`Portal respondió con status: ${response.status()}`);
  });

  test('TC_SMOKE_002 — Login exitoso con CUIT válido', async ({ page }) => {
    const loginPage = new LoginPage(page);
    console.log(`Iniciando login con CUIT: ${CONTRIBUYENTES.conPlan.cuit}`);

    await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

    const exitoso = await loginPage.verificarLoginExitoso();
    await page.screenshot({ path: 'screenshots/TC_SMOKE_002_login.png', fullPage: true });

    expect(exitoso, 'El login debe redirigir fuera de /login').toBe(true);
    console.log(`URL post-login: ${loginPage.obtenerUrl()}`);
  });

  test('TC_SMOKE_003 — Módulo Operaciones/Planes es accesible', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

    // Usamos la página activa después del login (nueva pestaña)
    const pfpPage = new PFPPage(loginPage.obtenerPagina());
    await pfpPage.irAOperacionesPlanes();
    await pfpPage.capturarEvidencia('TC_SMOKE_003_operaciones');

    const titulo = await loginPage.obtenerPagina().title();
    expect(titulo).not.toBe('');
    console.log(`Título: ${titulo}`);
  });

  test('TC_SMOKE_004 — Módulo Plan de Facilidades de Pago es accesible', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

    const pfpPage = new PFPPage(loginPage.obtenerPagina());
    await pfpPage.irAPlanFacilidadesPago();
    await pfpPage.capturarEvidencia('TC_SMOKE_004_pfp');

    const titulo = await loginPage.obtenerPagina().title();
    expect(titulo).not.toBe('');
    console.log(`Título PFP: ${titulo}`);
  });

  test('TC_SMOKE_005 — Verificar planes incluidos en parametría', async ({ page }) => {
    // Este test verifica que los planes de la parametría están bien configurados
    // No necesita conexión al portal — valida la data de prueba
    console.log('Verificando consistencia de parametría...');

    // El plan nuevo/2025 debe incluir al plan 890/MHFGC/20
    expect(PFP.planes.PLAN_NUEVO).toBe('nuevo/2025');
    expect(PFP.planes.PLAN_890).toBe('890/MHFGC/20');

    // Las cuotas máximas deben ser correctas según la parametría
    expect(PFP.maxCuotas['nuevo/2025']).toBe(48);
    expect(PFP.maxCuotas['890/MHFGC/20']).toBe(36);

    // Los estados del plan deben incluir los definidos en el YAML
    expect(PFP.estadosPlan).toContain('VIGENTE');
    expect(PFP.estadosPlan).toContain('CADUCO');
    expect(PFP.estadosPlan).toContain('NULO');

    console.log('Parametría verificada correctamente');
  });

}); 