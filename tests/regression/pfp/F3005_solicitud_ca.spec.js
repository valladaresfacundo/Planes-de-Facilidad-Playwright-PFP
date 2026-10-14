// tests/regression/pfp/F3005_solicitud_ca.spec.js
// F3005 — Solicitud de Cancelación Anticipada (VIGENTE → CA_PENDIENTE),
// Portal Contribuyente, Cuenta Corriente → Planes de Facilidades. Ver memoria
// pfp-formularios-catalogo del proyecto.
//
// Reorganizado 2026-08-19 (antes: TC_REG_009 en TC_REG_003_ca_cbu.spec.js +
// TC_API_011 en tests/api/) para agrupar la regresión por formulario.
//
// Cubre los dos casos reales confirmados en vivo:
// - Negativo (TC_REG_009): 1° cuota sin pagar → el portal bloquea la CA.
// - Positivo (TC_REG_011): 1° cuota YA paga → el wizard de CA avanza sin
//   bloqueo. A propósito NO confirma la CA (dejaría el plan en CA_PENDIENTE)
//   — solo confirma que el bloqueo desaparece.
//
// 2026-10-14: cada caso pide su plan a lib/fabricaPlanes.js (antes compartían
// PLANES_CONOCIDOS.vigente con F3003/F3006/F3010, que lo dejaban con todas las
// cuotas pagas y el botón "Cancelación Anticipada" deshabilitado). Los dos
// son de solo lectura, así que el plan se reusa entre corridas.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage }   = require('../../../pages/PFPPage');
const { planSinTocar, planCuota1Paga } = require('../../../lib/fabricaPlanes');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT } = require('../../../fixtures/test-data');

test.describe('F3005 — Solicitud de Cancelación Anticipada', () => {

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

  test('TC_REG_009 — Cancelación Anticipada bloqueada si la 1° cuota no está paga', async ({ page }) => {
    test.setTimeout(240000);
    const solicitud = await planSinTocar(page);
    test.skip(!solicitud, 'Sin plan VIGENTE con cuotas sin tocar y NO_FABRICAR=1');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, solicitud);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_009_plan_encontrado.png', fullPage: true });

    await pfpPage.iniciarCancelacionAnticipada();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_009_ca_bloqueada.png', fullPage: true });

    await expect(portalPage.getByText('No es posible realizar una cancelación anticipada')).toBeVisible();
    await expect(portalPage.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    console.log(`TC_REG_009 — F3005 correctamente bloqueado: 1° cuota sin pagar (plan ${solicitud})`);
  });

  test('TC_REG_011 — Cancelación Anticipada YA NO bloqueada con la 1° cuota paga', async ({ page, request }) => {
    test.setTimeout(240000);
    const solicitud = await planCuota1Paga(page, request);
    test.skip(!solicitud, 'Sin plan VIGENTE con solo la cuota 1 paga y NO_FABRICAR=1');

    const { portalPage, pfpPage } = await loginYBuscarPlan(page, solicitud);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_011_plan_encontrado.png', fullPage: true });

    await pfpPage.iniciarCancelacionAnticipada();
    await portalPage.waitForTimeout(1000);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_011_wizard_ca.png', fullPage: true });

    const bloqueado = await portalPage.getByText('No es posible realizar una cancelación anticipada').isVisible().catch(() => false);
    console.log(`TC_REG_011 — mensaje de bloqueo visible: ${bloqueado}`);
    expect(bloqueado, 'El mensaje de bloqueo de F3005 NO debería aparecer con la cuota 1 paga').toBe(false);
    await expect(portalPage.getByRole('button', { name: 'Continuar' })).toBeEnabled();

    console.log(`TC_REG_011 — F3005 ya NO bloqueada (plan ${solicitud}). No se confirma la CA para no consumir el plan.`);
  });

});
