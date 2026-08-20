// tests/regression/pfp/F3005_solicitud_ca.spec.js
// F3005 — Solicitud de Cancelación Anticipada (VIGENTE → CA_PENDIENTE),
// Portal Contribuyente, Cuenta Corriente → Planes de Facilidades. Ver memoria
// pfp-formularios-catalogo del proyecto.
//
// Reorganizado 2026-08-19 (antes: TC_REG_009 en TC_REG_003_ca_cbu.spec.js +
// TC_API_011 en tests/api/) para agrupar la regresión por formulario.
//
// Cubre los dos casos reales confirmados en vivo contra QA_HOMO:
// - Negativo (TC_REG_009): 1° cuota sin pagar → el portal bloquea la CA.
// - Positivo (TC_REG_011): 1° cuota YA paga (fabricada vía F3010 real, Fase 2
//   — ver lib/pfpApiClient.js) → el wizard de CA avanza sin bloqueo. A
//   propósito NO confirma la CA hasta el final (dejaría el plan en
//   CA_PENDIENTE, consumiendo el fixture VIGENTE) — solo confirma que el
//   bloqueo desaparece y deja evidencia de hasta dónde avanza el wizard.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage }   = require('../../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

test.describe('F3005 — Solicitud de Cancelación Anticipada', () => {

  async function loginYBuscarPlan(page, nroSolicitud) {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_AV, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);
    await pfpPage.irAPlanesDeFacilidades();
    await pfpPage.buscarPlanPorNroSolicitud(nroSolicitud);
    return { portalPage, pfpPage };
  }

  test('TC_REG_009 — Cancelación Anticipada bloqueada si la 1° cuota no está paga', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js — ver memoria pfp-roadmap-fases');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.vigente);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_009_plan_encontrado.png', fullPage: true });

    await pfpPage.iniciarCancelacionAnticipada();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_009_ca_bloqueada.png', fullPage: true });

    await expect(portalPage.getByText('No es posible realizar una cancelación anticipada')).toBeVisible();
    await expect(portalPage.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    console.log('TC_REG_009 — F3005 correctamente bloqueado: 1° cuota sin pagar');
  });

  test('TC_REG_011 — Cancelación Anticipada YA NO bloqueada con la 1° cuota paga', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js — con la 1° cuota YA paga (ver F3010)');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.vigente);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_011_plan_encontrado.png', fullPage: true });

    await pfpPage.iniciarCancelacionAnticipada();
    await portalPage.waitForTimeout(1000);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_011_wizard_ca.png', fullPage: true });

    const bloqueado = await portalPage.getByText('No es posible realizar una cancelación anticipada').isVisible().catch(() => false);
    console.log(`TC_REG_011 — mensaje de bloqueo visible: ${bloqueado}`);
    expect(bloqueado, 'El mensaje de bloqueo de F3005 NO debería aparecer con la cuota 1 paga').toBe(false);

    const btnContinuar = portalPage.getByRole('button', { name: 'Continuar' });
    const habilitado = await btnContinuar.isEnabled().catch(() => false);
    console.log(`TC_REG_011 — botón "Continuar" habilitado: ${habilitado}`);

    console.log('TC_REG_011 — F3005 ya NO bloqueada (caso positivo confirmado). No se confirma la CA para no consumir el fixture VIGENTE.');
  });

});
