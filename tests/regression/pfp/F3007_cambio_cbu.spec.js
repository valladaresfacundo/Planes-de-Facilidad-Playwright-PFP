// tests/regression/pfp/F3007_cambio_cbu.spec.js
// F3007 — Cambio de CBU (sin cambio de estado del plan), Portal Contribuyente,
// Cuenta Corriente → Planes de Facilidades. Ver memoria pfp-formularios-catalogo
// del proyecto. Reorganizado 2026-08-19 (antes: TC_REG_010 en
// TC_REG_003_ca_cbu.spec.js) para agrupar la regresión por formulario.
//
// 2026-10-14: usa el plan "sinTocar" de lib/fabricaPlanes.js (el mismo que
// F3005 negativo) — el botón "Cambiar CBU" se deshabilita si el plan no tiene
// cuotas adeudadas, que es lo que pasaba con PLANES_CONOCIDOS.vigente.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage }   = require('../../../pages/PFPPage');
const { planSinTocar } = require('../../../lib/fabricaPlanes');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT } = require('../../../fixtures/test-data');

test.describe('F3007 — Cambio de CBU', () => {

  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env (la fábrica de planes valida el estado en Mongo)');

  async function loginYBuscarPlan(page, nroSolicitud) {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_AV, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);
    await pfpPage.irAPlanesDeFacilidades();
    await pfpPage.buscarPlanPorNroSolicitud(nroSolicitud);
    return { portalPage, pfpPage };
  }

  test('TC_REG_010 — Cambio de CBU sobre plan VIGENTE', async ({ page }) => {
    test.setTimeout(240000);
    const solicitud = await planSinTocar(page);
    test.skip(!solicitud, 'Sin plan VIGENTE con cuotas sin tocar y NO_FABRICAR=1');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, solicitud);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_010_plan_encontrado.png', fullPage: true });

    await pfpPage.abrirCambioCBU();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_010_form_cbu.png', fullPage: true });

    await expect(portalPage.getByRole('textbox', { name: 'CBU' })).toBeVisible();
    const btnConfirmar = portalPage.getByRole('button', { name: 'Confirmar' });
    await expect(btnConfirmar).toBeDisabled();

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test cambio cbu');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill(CONTRIBUYENTES.conPlan.cuit);
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await expect(btnConfirmar).toBeEnabled();
    await btnConfirmar.click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_REG_010_cbu_actualizado.png', fullPage: true });
    console.log(`TC_REG_010 — F3007 generado, CBU actualizado (plan ${solicitud})`);
  });

});
