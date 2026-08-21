// tests/regression/pfp/F3007_cambio_cbu.spec.js
// F3007 — Cambio de CBU (sin cambio de estado del plan), Portal Contribuyente,
// Cuenta Corriente → Planes de Facilidades. Ver memoria pfp-formularios-catalogo
// del proyecto. Reorganizado 2026-08-19 (antes: TC_REG_010 en
// TC_REG_003_ca_cbu.spec.js) para agrupar la regresión por formulario.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage }   = require('../../../pages/PFPPage');
const { AMBIENTES, CUIT_AUTENTICADO, SIGN_CCT, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

test.describe('F3007 — Cambio de CBU', () => {

  async function loginYBuscarPlan(page, nroSolicitud) {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_AV, CUIT_AUTENTICADO, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);
    await pfpPage.irAPlanesDeFacilidades();
    await pfpPage.buscarPlanPorNroSolicitud(nroSolicitud);
    return { portalPage, pfpPage };
  }

  test('TC_REG_010 — Cambio de CBU sobre plan VIGENTE', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js — ver memoria pfp-roadmap-fases');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.vigente);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_010_plan_encontrado.png', fullPage: true });

    await pfpPage.abrirCambioCBU();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_010_form_cbu.png', fullPage: true });

    await expect(portalPage.getByRole('textbox', { name: 'CBU' })).toBeVisible();
    const btnConfirmar = portalPage.getByRole('button', { name: 'Confirmar' });
    await expect(btnConfirmar).toBeDisabled();

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test cambio cbu');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill(CUIT_AUTENTICADO);
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await expect(btnConfirmar).toBeEnabled();
    await btnConfirmar.click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_REG_010_cbu_actualizado.png', fullPage: true });
    console.log('TC_REG_010 — F3007 generado, CBU actualizado');
  });

});
