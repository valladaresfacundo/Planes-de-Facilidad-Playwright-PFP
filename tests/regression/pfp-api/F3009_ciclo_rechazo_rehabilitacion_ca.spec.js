// tests/regression/pfp-api/F3009_ciclo_rechazo_rehabilitacion_ca.spec.js
// Ciclo completo de estados de la Cancelación Anticipada (CA) más allá de
// CA_PENDIENTE→CA_ENVIADA_DEBITO→CA_PAGADA (ya cubierto por F3008_pago_ca.spec.js):
// CA_ENVIADA_DEBITO → CA_RECHAZADA → CA_REHABILITADA → CA_ENVIADA_DEBITO → CA_PAGADA.
//
// Hallazgo 2026-09-08 (ver memoria pfp-formularios-catalogo / pfp-roadmap-fases):
// la máquina de estados real y las reglas de negocio se leyeron directo de
// Mongo (Param.StateCharts "PFP_V1.0.0" + Param.RulePackage "F3010"/"F3005")
// en vez de adivinar:
//   - CA_ENVIADA_DEBITO → CA_RECHAZADA: mismo RegistrarFormulario?formulario=3010
//     de siempre, pero con Concepto:7529 (CA) — lib/pfpApiClient.js::
//     construirPayloadRechazoCA()/rechazarCancelacionAnticipada().
//   - CA_RECHAZADA → CA_REHABILITADA: F3005 (Solicitud de CA) llamado DE NUEVO
//     — la regla detecta el estado previo CA_RECHAZADA. El botón de la UI
//     queda deshabilitado fuera de VIGENTE, así que se usa el endpoint directo
//     api-cct SolicitarCancelacionAnticipada — lib/pfpApiClient.js::
//     solicitarCancelacionAnticipada().
//   - CA_REHABILITADA → CA_ENVIADA_DEBITO → CA_PAGADA: mismos F3009/F3008 de
//     siempre (generarDebitosCancelacionAnticipada/generarPagoCuotas).
//
// Usa los 3 planes que el usuario dejó a propósito en cada punto del ciclo
// (2026-09-08) — cada test avanza su plan UN paso más (son demos de un solo
// uso, no perfectamente repetibles indefinidamente, mismo criterio aceptado
// para F3010/F3011/F3012 en este repo).
//
// ⚠ MUTA datos reales de forma irreversible.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, withTracerInstance } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

async function estadoPlan(idSolicitud) {
  const doc = await withTracerInstance(col => col.findOne({ 'content.IDSolicitud': idSolicitud, quota: 0 }));
  return { doc, estado: doc?.states?.find(s => s.statechart === 'PFP')?.state };
}

test('TC_REG_CA_001 — rechazar el débito de una CA en curso (CA_ENVIADA_DEBITO → CA_RECHAZADA)', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraCAEnviadaDebito, 'Requiere PLANES_CONOCIDOS.paraCAEnviadaDebito en fixtures/test-data.js');

  const idSolicitud = PLANES_CONOCIDOS.paraCAEnviadaDebito;
  const cuit = CONTRIBUYENTES.conPlan.cuit;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(cuit, SIGN_CCT);

  const { estado: estadoInicial } = await estadoPlan(idSolicitud);
  test.skip(estadoInicial !== 'CA_ENVIADA_DEBITO', `El plan ${idSolicitud} ya no está en CA_ENVIADA_DEBITO (estado: ${estadoInicial}) — pedir un plan de reemplazo.`);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({ cuit, anio: new Date().getFullYear(), solicitud: idSolicitud });
  // La cuota con el débito de CA pendiente es la primera no paga (la CA cubre
  // todas las cuotas restantes, pero el débito puntual que envía F3009 recae
  // sobre esa cuota).
  const cuotaCA = (detalle?.cuotas ?? []).find(c => c.estadoDebito === 'DEBITO_ENVIADO');
  expect(cuotaCA, 'Debe existir una cuota con débito de CA enviado (DEBITO_ENVIADO)').toBeTruthy();

  const venc1ISO = cuotaCA.vencimientoCuota1.includes('/') ? cuotaCA.vencimientoCuota1.split('/').reverse().join('-') : cuotaCA.vencimientoCuota1;
  const idDebito = await obtenerIdDebito(cuotaCA.idTracerCuota);
  const payload = cliente.construirPayloadRechazoCA({
    cuit,
    cuota: { numeroCuota: cuotaCA.numeroCuota, importeNominal: cuotaCA.importeNominal, importeActualizado: cuotaCA.importeActualizado, vencimientoCuota1: venc1ISO, idTracerCuota: cuotaCA.idTracerCuota },
    resumenPlan: resumen,
    idDebito,
  });
  const resultado = await cliente.rechazarCancelacionAnticipada(payload);
  console.log(`TC_REG_CA_001 — rechazo CA: ${JSON.stringify(resultado)}`);

  await new Promise(r => setTimeout(r, 3000));
  const { estado: estadoFinal } = await estadoPlan(idSolicitud);
  console.log(`TC_REG_CA_001 — estado final: ${estadoFinal}`);
  expect(estadoFinal).toBe('CA_RECHAZADA');
});

test('TC_REG_CA_002 — rehabilitar una CA rechazada (CA_RECHAZADA → CA_REHABILITADA)', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraCARechazada, 'Requiere PLANES_CONOCIDOS.paraCARechazada en fixtures/test-data.js');

  const idSolicitud = PLANES_CONOCIDOS.paraCARechazada;
  const cuit = CONTRIBUYENTES.conPlan.cuit;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(cuit, SIGN_CCT);

  const { doc, estado: estadoInicial } = await estadoPlan(idSolicitud);
  test.skip(estadoInicial !== 'CA_RECHAZADA', `El plan ${idSolicitud} ya no está en CA_RECHAZADA (estado: ${estadoInicial}) — pedir un plan de reemplazo.`);

  const resultado = await cliente.solicitarCancelacionAnticipada({ idTracer: doc._id, idDuty: doc.idDuty, usuario: cuit });
  console.log(`TC_REG_CA_002 — SolicitarCancelacionAnticipada: ${JSON.stringify(resultado)}`);

  await new Promise(r => setTimeout(r, 1500));
  const { estado: estadoFinal } = await estadoPlan(idSolicitud);
  console.log(`TC_REG_CA_002 — estado final: ${estadoFinal}`);
  expect(estadoFinal).toBe('CA_REHABILITADA');
});

test('TC_REG_CA_003 — cerrar el ciclo desde una CA rehabilitada (CA_REHABILITADA → CA_ENVIADA_DEBITO → CA_PAGADA)', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraCARehabilitada, 'Requiere PLANES_CONOCIDOS.paraCARehabilitada en fixtures/test-data.js');

  const idSolicitud = PLANES_CONOCIDOS.paraCARehabilitada;
  const cuit = CONTRIBUYENTES.conPlan.cuit;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(cuit, SIGN_CCT);

  let { doc, estado } = await estadoPlan(idSolicitud);
  test.skip(estado !== 'CA_REHABILITADA', `El plan ${idSolicitud} ya no está en CA_REHABILITADA (estado: ${estado}) — pedir un plan de reemplazo.`);

  const fechaEmisionDGR = new Date(doc.content.CA_Fecha_Emision_DRG).toISOString().slice(0, 10);
  const resultadoDebito = await cliente.generarDebitosCancelacionAnticipada(fechaEmisionDGR);
  console.log(`TC_REG_CA_003 — F3009 (re-débito): ${JSON.stringify(resultadoDebito)}`);

  await new Promise(r => setTimeout(r, 1500));
  ({ doc, estado } = await estadoPlan(idSolicitud));
  console.log(`TC_REG_CA_003 — estado tras re-débito: ${estado}`);
  expect(estado).toBe('CA_ENVIADA_DEBITO');

  const resultadoPago = await cliente.generarPagoCuotas({ fechaEmisionDGR, idSolicitud, pagoRechazado: false, esCancelacionAnticipada: true });
  console.log(`TC_REG_CA_003 — F3008 (pago final): ${JSON.stringify(resultadoPago)}`);

  await new Promise(r => setTimeout(r, 1500));
  ({ estado } = await estadoPlan(idSolicitud));
  console.log(`TC_REG_CA_003 — estado final: ${estado}`);
  expect(estado).toBe('CA_PAGADA');
});
