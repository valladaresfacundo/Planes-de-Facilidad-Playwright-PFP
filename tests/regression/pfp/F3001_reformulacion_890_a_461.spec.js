// tests/regression/pfp/F3001_reformulacion_890_a_461.spec.js
// "Reformular plan de facilidades" — consolida un plan VIGENTE bajo una
// norma vieja (890/MHFGC/20, en este test) hacia un plan nuevo bajo
// 461/AGIP/25. Investigado y confirmado real 2026-09-16 (pedido del
// usuario) — ver memoria pfp-roadmap-fases para el detalle completo.
//
// MECANISMO REAL (confirmado leyendo Param.RulePackage — NO es un
// formulario nuevo): es el mismo F3001 (Acogimiento) con 2 campos extra en
// el payload — `Datos.Reformula_Plan_Solicitud` (no vacío) y
// `Datos.Reformula_Plan_SistemaControl === "NCCT"`. Cuando vienen
// poblados, la regla además marca el plan de origen (`Reformula_Plan_Tracer`)
// como PFP: REFORMULADO, y cada cuota de `CuotasReformuladas[]` como
// PFP_Cuota: REFORMULADA / PFP_Cuota_Debito: REFORMULADO.
//
// PRECONDICIÓN REAL (dato clave del usuario, no documentada en ningún
// lado): el plan de origen necesita AL MENOS la cuota 1 pagada para
// aparecer como elegible en "Seleccioná un plan vigente a reformular".
// Sin eso, la pantalla de selección viene vacía — el endpoint
// ObtenerPlanesParaReformularNuevo2025 además da 404 real (servicio
// externo CTPFO0015-PLANES) independientemente de esto, pero no bloquea
// el flujo: el frontend usa el endpoint viejo ObtenerPlanesParaReformular
// como fuente principal de esa tabla.
//
// Requiere PLANES_CONOCIDOS.plan890Alternativo — un plan 890 VIGENTE con
// la cuota 1 ya paga (mismo criterio que el resto de la suite: si no está
// disponible, se saltea con un mensaje claro en vez de fabricar uno nuevo
// por UI en el momento — generar un plan 890 por UI + pagar su cuota 1
// consume períodos de deuda reales del CUIT, que son finitos; mejor
// pedirle al usuario uno nuevo cuando se agote que auto-fabricar en cada
// corrida. Ver fixtures/test-data.js para reponerlo).
//
// ⚠ MUTA datos reales de forma irreversible: el plan de origen queda
// REFORMULADO para siempre (no hay reversa documentada).
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage } = require('../../../pages/PFPPage');
const { buscarPlanPorSolicitud: buscarPlanEnMongo, estadoActual } = require('../../../lib/mongoAdmin');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

async function confirmarPrevisualizacionSiAparece(portalPage) {
  for (let i = 0; i < 10; i++) {
    const yaEnResultado = await portalPage.getByText('¡Perfecto!').isVisible().catch(() => false);
    if (yaEnResultado) return;
    const btn = portalPage.getByRole('button', { name: 'Confirmar' });
    if (!(await btn.isVisible().catch(() => false))) return;
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await portalPage.waitForLoadState('networkidle').catch(() => {});
      await portalPage.waitForTimeout(1000);
    } else {
      await portalPage.waitForTimeout(500);
    }
  }
}

test('TC_REG_REFORMULAR_001 — reformular un plan 890 (con cuota 1 paga) hacia 461/AGIP/25', async ({ page }) => {
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env — ver .env.example y lib/mongoAdmin.js');
  test.skip(!PLANES_CONOCIDOS.plan890Alternativo, 'Requiere PLANES_CONOCIDOS.plan890Alternativo en fixtures/test-data.js');

  const idSolicitudOrigen = PLANES_CONOCIDOS.plan890Alternativo;
  const docsOrigen = await buscarPlanEnMongo(idSolicitudOrigen);
  const planOrigen = docsOrigen.find(d => d.quota === 0);
  const cuota1Origen = docsOrigen.find(d => d.quota === 1);
  test.skip(
    !planOrigen || estadoActual(planOrigen, 'PFP') !== 'VIGENTE' || !cuota1Origen || estadoActual(cuota1Origen, 'PFP_Cuota') !== 'PAGADA',
    `El plan ${idSolicitudOrigen} ya no está VIGENTE con cuota 1 paga — pedir un plan 890 nuevo (cuota 1 ya paga) para PLANES_CONOCIDOS.plan890Alternativo.`
  );

  const loginPage = new LoginPage(page);
  await loginPage.login(AMBIENTES.QA_AV, CONTRIBUYENTES.con890.cuit, SIGN_CCT);
  const portalPage = loginPage.obtenerPagina();
  const pfpPage = new PFPPage(portalPage);

  // Ir al flujo de Reformular (bajo 461, NO bajo 890)
  await pfpPage.irAPlanesYMoratoria();
  await portalPage.getByRole('button', { name: 'Tipo de plan' }).click();
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('option', { name: '461/AGIP/25' }).click();
  await portalPage.waitForTimeout(500);
  await portalPage.getByRole('button', { name: 'Operación' }).click();
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('option', { name: 'Reformular plan de facilidades' }).click();
  await portalPage.waitForTimeout(500);
  await portalPage.getByRole('button', { name: 'Impuesto' }).click();
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('option', { name: CONTRIBUYENTES.con890.impuesto, exact: true }).click();
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('button', { name: 'Consultar' }).click();
  await portalPage.waitForTimeout(1500);
  await portalPage.getByText('Procesando').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await portalPage.waitForTimeout(800);

  await expect(portalPage.getByText('Seleccioná un plan vigente a reformular')).toBeVisible({ timeout: 10000 });
  const filaPlan = portalPage.locator('tr', { hasText: idSolicitudOrigen });
  await expect(filaPlan, `El plan ${idSolicitudOrigen} debe aparecer como elegible para reformular`).toBeVisible();
  await filaPlan.locator('.v-simple-checkbox').click({ force: true });
  await portalPage.waitForTimeout(500);
  await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
  await portalPage.waitForLoadState('networkidle');

  await expect(portalPage.getByText('Resumen del plan a reformular')).toBeVisible({ timeout: 10000 });
  await portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('option', { name: '3 cuotas', exact: true }).click();
  await portalPage.waitForTimeout(500);
  await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
  await portalPage.waitForLoadState('networkidle');

  await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test reformulacion regresion');
  await portalPage.getByRole('textbox', { name: 'CUIT' }).fill(CONTRIBUYENTES.con890.cuit);
  await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('button', { name: 'Continuar' }).click();
  await portalPage.waitForLoadState('networkidle');

  const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
  await checkboxConfirmacion.click();
  await portalPage.waitForTimeout(300);
  await portalPage.getByRole('button', { name: 'Confirmar' }).click();
  await portalPage.waitForLoadState('networkidle');
  await portalPage.waitForTimeout(1500);
  await confirmarPrevisualizacionSiAparece(portalPage);

  const textoFinal = await portalPage.locator('body').innerText();
  await expect(portalPage.getByText('¡Perfecto!')).toBeVisible({ timeout: 10000 });
  const matchNuevo = textoFinal.match(/Solicitud Nº\s*\n?\s*(\d+)/);
  const matchResolucion = textoFinal.match(/Resolución Nº\s*\n?\s*([^\n]+)/);
  expect(matchNuevo, 'Debe poder leerse el Nro. de Solicitud del plan reformulado').toBeTruthy();
  const idSolicitudNuevo = matchNuevo[1];
  console.log(`TC_REG_REFORMULAR_001 — plan reformulado generado: ${idSolicitudNuevo} (${matchResolucion?.[1]?.trim()})`);

  // Verificación real en Mongo
  await new Promise(r => setTimeout(r, 2000));
  const docsViejo = await buscarPlanEnMongo(idSolicitudOrigen);
  const planViejo = docsViejo.find(d => d.quota === 0);
  console.log(`TC_REG_REFORMULAR_001 — estado plan origen (${idSolicitudOrigen}): ${estadoActual(planViejo, 'PFP')}`);
  expect(estadoActual(planViejo, 'PFP')).toBe('REFORMULADO');

  const docsNuevo = await buscarPlanEnMongo(idSolicitudNuevo);
  const planNuevo = docsNuevo.find(d => d.quota === 0);
  console.log(`TC_REG_REFORMULAR_001 — estado plan nuevo (${idSolicitudNuevo}): ${estadoActual(planNuevo, 'PFP')} | Instrumento_Legal: ${planNuevo.content.Instrumento_Legal}`);
  expect(estadoActual(planNuevo, 'PFP')).toBe('VIGENTE');
  expect(planNuevo.content.Instrumento_Legal).toBe('461/AGIP/25');
});
