// tests/regression/pfp-api/F3008_pago_ca.spec.js
// F3005 (real) → F3009 (débito CA) → F3008 (pago CA) — flujo completo de
// Cancelación Anticipada. Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// Aclaración del usuario 2026-08-24 (corrige el catálogo original, que decía
// "F3008 = cierre final tras CA_PAGADA"): F3008 ES el paso de pago/rechazo de
// la CA en sí — GenerarPagoCuotas con esCancelacionAnticipada=true. Este
// mismo mecanismo ya se había validado una vez en vivo el 2026-08-13 (sin
// llamarlo F3008 en su momento) — acá queda formalizado como test repetible.
//
// Mezcla UI (page — confirmar la CA de verdad, único jeito de generarla) y
// API (request — F3010 previo, F3009, F3008).
//
// ⚠ MUTA datos reales de forma IRREVERSIBLE: confirma una CA real (el plan
// pasa a CA_PENDIENTE) y la paga (CA_PAGADA). No hay reversa documentada de
// una CA ya pagada.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage } = require('../../../pages/PFPPage');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, withTracerInstance } = require('../../../lib/mongoAdmin');
const { AMBIENTES, SIGN_CCT, CONTRIBUYENTES, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

test('TC_REG_F3008_001 — generar CA real, débito (F3009) y pago de la CA (F3008)', async ({ page, request }) => {
  test.skip(!PLANES_CONOCIDOS.paraCancelacionAnticipada, 'Requiere PLANES_CONOCIDOS.paraCancelacionAnticipada en fixtures/test-data.js');

  const idSolicitud = PLANES_CONOCIDOS.paraCancelacionAnticipada;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

  // Paso 1 — pagar cuota 1 si todavía no está paga (precondición real de F3005)
  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CONTRIBUYENTES.conPlan.cuit, anio: new Date().getFullYear(), solicitud: idSolicitud,
  });
  const cuota1 = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === 1);
  expect(cuota1, 'Debe existir la cuota 1 en el detalle del plan').toBeTruthy();

  if (cuota1.estadoCuota !== 'PAGADA') {
    const venc1ISO = cuota1.vencimientoCuota1.includes('/')
      ? cuota1.vencimientoCuota1.split('/').reverse().join('-')
      : cuota1.vencimientoCuota1;
    const emitir = cliente.buscarEmitirDRG(venc1ISO);
    await cliente.generarDebitoCuotaPorSolicitud({ idSolicitud, fecha: emitir, esPrimerIntento: true });
    await new Promise(r => setTimeout(r, 1500));
    let idDebito = await cliente.esperarIdDebito(cuota1.idTracerCuota);
    if (!idDebito) idDebito = await obtenerIdDebito(cuota1.idTracerCuota);
    const payload = cliente.construirPayloadF3010({
      cuit: CONTRIBUYENTES.conPlan.cuit,
      cuota: { numeroCuota: 1, importeNominal: cuota1.importeNominal, importeActualizado: cuota1.importeActualizado, vencimientoCuota1: venc1ISO, idTracerCuota: cuota1.idTracerCuota },
      resumenPlan: resumen, correcto: true, idDebito: idDebito || 0,
    });
    const resultadoPago = await cliente.registrarPagoCuota3010(payload);
    console.log(`TC_REG_F3008_001 — pago cuota 1: ${JSON.stringify(resultadoPago)}`);
    await new Promise(r => setTimeout(r, 1500));
  }

  // Paso 2 — F3005 real: generar la CA de verdad por UI (único camino conocido)
  const loginPage = new LoginPage(page);
  await loginPage.login(AMBIENTES.QA_AV, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
  const portalPage = loginPage.obtenerPagina();
  const pfpPage = new PFPPage(portalPage);

  await pfpPage.irAPlanesDeFacilidades();
  await pfpPage.buscarPlanPorNroSolicitud(idSolicitud);
  await pfpPage.iniciarCancelacionAnticipada();
  await portalPage.waitForTimeout(1000);

  const bloqueado = await portalPage.getByText('No es posible realizar una cancelación anticipada').isVisible().catch(() => false);
  expect(bloqueado, 'F3005 no debería estar bloqueada — la cuota 1 ya está paga').toBe(false);

  await pfpPage.confirmarCancelacionAnticipada();
  console.log('TC_REG_F3008_001 — F3005 confirmada por UI');

  // Paso 3 — leer CA_Fecha_Emision_DRG del plan real (no calcularla — ver
  // memoria pfp-roadmap-fases, es un dato que solo existe tras confirmar la CA)
  await new Promise(r => setTimeout(r, 1500));
  let docPlan = await withTracerInstance(col => col.findOne({ 'content.IDSolicitud': idSolicitud, quota: 0 }));
  let estadoPlan = docPlan.states?.find(s => s.statechart === 'PFP')?.state;
  console.log(`TC_REG_F3008_001 — estado tras confirmar CA: ${estadoPlan}`);
  expect(estadoPlan).toBe('CA_PENDIENTE');

  const fechaEmisionDGR = new Date(docPlan.content.CA_Fecha_Emision_DRG).toISOString().slice(0, 10);
  console.log(`TC_REG_F3008_001 — CA_Fecha_Emision_DRG: ${fechaEmisionDGR}`);

  // Paso 4 — F3009: débito de la CA (global, sin variante puntual confirmada)
  const resultadoDebito = await cliente.generarDebitosCancelacionAnticipada(fechaEmisionDGR);
  console.log(`TC_REG_F3008_001 — F3009 GenerarDebitosCancelacionAnticipada: ${JSON.stringify(resultadoDebito)}`);

  await new Promise(r => setTimeout(r, 1500));
  docPlan = await withTracerInstance(col => col.findOne({ 'content.IDSolicitud': idSolicitud, quota: 0 }));
  estadoPlan = docPlan.states?.find(s => s.statechart === 'PFP')?.state;
  console.log(`TC_REG_F3008_001 — estado tras F3009: ${estadoPlan}`);
  expect(estadoPlan).toBe('CA_ENVIADA_DEBITO');

  // Paso 5 — F3008: pago de la CA (esCancelacionAnticipada=true, idSolicitud = idPlan)
  const resultadoPagoCA = await cliente.generarPagoCuotas({
    fechaEmisionDGR, idSolicitud, pagoRechazado: false, esCancelacionAnticipada: true,
  });
  console.log(`TC_REG_F3008_001 — F3008 GenerarPagoCuotas: ${JSON.stringify(resultadoPagoCA)}`);

  await new Promise(r => setTimeout(r, 1500));
  docPlan = await withTracerInstance(col => col.findOne({ 'content.IDSolicitud': idSolicitud, quota: 0 }));
  estadoPlan = docPlan.states?.find(s => s.statechart === 'PFP')?.state;
  console.log(`TC_REG_F3008_001 — estado final: ${estadoPlan}`);
  expect(estadoPlan).toBe('CA_PAGADA');
});
