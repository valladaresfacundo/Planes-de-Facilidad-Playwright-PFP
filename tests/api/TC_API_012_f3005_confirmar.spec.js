// tests/api/TC_API_012_f3005_confirmar.spec.js
// Fase 2 — genera la CA (F3005) real sobre el plan VIGENTE conocido, con
// decisión explícita del usuario (2026-08-13, ver memoria pfp-roadmap-fases).
// Avanza el wizard "Operaciones / Pagar" paso a paso, dejando evidencia en
// cada paso — no se conocen los selectores de los pasos 2-4 todavía, así que
// este test es exploratorio/reconocimiento, no una regresión definitiva.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../pages/LoginPage');
const { PFPPage } = require('../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test('TC_API_012 — F3005: confirmar la Cancelación Anticipada real, paso a paso', async ({ page }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

  const loginPage = new LoginPage(page);
  await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
  const portalPage = loginPage.obtenerPagina();
  const pfpPage = new PFPPage(portalPage);

  await pfpPage.irAPlanesDeFacilidades();
  await pfpPage.buscarPlanPorNroSolicitud(PLANES_CONOCIDOS.vigente);
  await pfpPage.iniciarCancelacionAnticipada();
  await portalPage.waitForTimeout(1000);

  // Paso 1 — Confirmar Cuotas (ya validado en TC_API_011)
  await portalPage.screenshot({ path: 'screenshots/TC_API_012_paso1_confirmar_cuotas.png', fullPage: true });
  await portalPage.getByRole('button', { name: 'Continuar' }).click();
  await portalPage.waitForLoadState('networkidle');
  await portalPage.waitForTimeout(1000);

  // Paso 2 — Confirmación de CBU (viene precargado con el CBU dejado en F3007/TC_REG_010)
  await portalPage.screenshot({ path: 'screenshots/TC_API_012_paso2_confirmacion_cbu.png', fullPage: true });
  await portalPage.getByRole('button', { name: 'Continuar' }).click();
  await portalPage.waitForLoadState('networkidle');
  await portalPage.waitForTimeout(1000);

  // Paso 3 — Confirmación (última pantalla antes de generar la CA de verdad)
  await portalPage.screenshot({ path: 'screenshots/TC_API_012_paso3_confirmacion.png', fullPage: true });
  await portalPage.getByRole('button', { name: 'Confirmar' }).click();
  await portalPage.waitForLoadState('networkidle');
  await portalPage.waitForTimeout(1500);

  // Paso 4 — Resultado (acá debería aparecer el Nro. de solicitud CA generado)
  await portalPage.screenshot({ path: 'screenshots/TC_API_012_paso4_resultado.png', fullPage: true });
  const textoResultado = await portalPage.locator('body').innerText();
  console.log(`TC_API_012 — Paso 4 (Resultado) texto completo:\n${textoResultado}`);
});
