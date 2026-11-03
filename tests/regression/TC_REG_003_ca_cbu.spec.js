// tests/regression/TC_REG_003_ca_cbu.spec.js
// Regresión — Operaciones sobre un plan existente: Solicitud de Cancelación
// Anticipada (F3005) y Cambio de CBU (F3007). Fase 1 de la matriz de cobertura
// de formularios PFP (F3001-F3018).
//
// Navegación y selectores confirmados en vivo contra QA_HOMO (2026-08-12) con
// el plan real PLANES_CONOCIDOS.vigente (Nro. 1783000149, CUIT 30686855860,
// impuesto "Sellos - AR RELIT"). Ese plan tiene la 1° cuota sin pagar, así que
// TC_REG_009 cubre el caso negativo real (el portal bloquea la CA). El caso
// positivo (CA aceptada) requiere un plan con la 1° cuota ya PAGADA — hoy solo
// se puede fabricar vía la capa API de Fase 2 (F3010). Ver memoria pfp-roadmap-fases.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../pages/LoginPage');
const { PFPPage }   = require('../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test.describe('Regresión — Plan existente: Cancelación Anticipada y Cambio de CBU', () => {

  async function loginYBuscarPlan(page, nroSolicitud) {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);
    await pfpPage.irAPlanesDeFacilidades();
    await pfpPage.buscarPlanPorNroSolicitud(nroSolicitud);
    return { portalPage, pfpPage };
  }

  test('TC_REG_009 — Cancelación Anticipada (F3005) bloqueada si la 1° cuota no está paga', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js — ver memoria pfp-roadmap-fases');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.vigente);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_009_plan_encontrado.png', fullPage: true });

    await pfpPage.iniciarCancelacionAnticipada();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_009_ca_bloqueada.png', fullPage: true });

    await expect(portalPage.getByText('No es posible realizar una cancelación anticipada')).toBeVisible();
    await expect(portalPage.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    console.log('TC_REG_009 — F3005 correctamente bloqueado: 1° cuota sin pagar');
  });

  test('TC_REG_010 — Cambio de CBU (F3007) sobre plan VIGENTE', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js — ver memoria pfp-roadmap-fases');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.vigente);
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
    console.log('TC_REG_010 — F3007 generado, CBU actualizado');
  });

});
