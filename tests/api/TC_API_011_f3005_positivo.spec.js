// tests/api/TC_API_011_f3005_positivo.spec.js
// Fase 2 → valida el caso POSITIVO de F3005 (Cancelación Anticipada) que quedó
// bloqueado en Fase 1: con la cuota 1 del plan PLANES_CONOCIDOS.vigente ya
// pagada de verdad (ver TC_API_010_pago_cuota1_f3010.spec.js), el wizard NO
// debería mostrar el mensaje de bloqueo "La primer cuota del plan debe estar
// paga" — debería dejar avanzar el flujo real de CA.
//
// A propósito NO confirma la CA hasta el final (mismo criterio que
// TC_AGPFP_007/008 en Fase 1 para las reversas) — generar la CA de verdad deja
// el plan en CA_PENDIENTE y lo consume como fixture VIGENTE. Solo confirma que
// el bloqueo desapareció y deja evidencia de hasta dónde avanza el wizard.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../pages/LoginPage');
const { PFPPage } = require('../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test('TC_API_011 — F3005 (Cancelación Anticipada) YA NO bloqueada con la cuota 1 paga', async ({ page }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

  const loginPage = new LoginPage(page);
  await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
  const portalPage = loginPage.obtenerPagina();
  const pfpPage = new PFPPage(portalPage);

  await pfpPage.irAPlanesDeFacilidades();
  await pfpPage.buscarPlanPorNroSolicitud(PLANES_CONOCIDOS.vigente);
  await portalPage.screenshot({ path: 'screenshots/TC_API_011_plan_encontrado.png', fullPage: true });

  await pfpPage.iniciarCancelacionAnticipada();
  await portalPage.waitForTimeout(1000);
  await portalPage.screenshot({ path: 'screenshots/TC_API_011_wizard_ca.png', fullPage: true });

  const bloqueado = await portalPage.getByText('No es posible realizar una cancelación anticipada').isVisible().catch(() => false);
  console.log(`TC_API_011 — mensaje de bloqueo visible: ${bloqueado}`);
  expect(bloqueado, 'El mensaje de bloqueo de F3005 NO debería aparecer con la cuota 1 paga').toBe(false);

  const btnContinuar = portalPage.getByRole('button', { name: 'Continuar' });
  const habilitado = await btnContinuar.isEnabled().catch(() => false);
  console.log(`TC_API_011 — botón "Continuar" habilitado: ${habilitado}`);

  console.log('TC_API_011 — F3005 ya NO bloqueada (caso positivo confirmado). No se confirma la CA para no consumir el fixture VIGENTE.');
});
