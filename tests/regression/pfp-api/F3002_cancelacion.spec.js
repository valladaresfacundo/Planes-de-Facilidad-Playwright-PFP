// tests/regression/pfp-api/F3002_cancelacion.spec.js
// F3002 — Cancelación normal (VIGENTE → CANCELADO): todas las cuotas del plan
// quedan PAGADA. Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// Endpoint confirmado real por el usuario 2026-08-24 (curl 200 OK contra un
// plan real): GET api-publicador-{a}/publicador/PFPIndividuales/
// GenerarCancelacionPorSolicitud?idSolicitud=... — es el endpoint PUNTUAL y
// SEGURO, distinto de generarCancelaciones() (que impacta TODOS los planes
// del ambiente con cuotas pagas, nunca usar ese en un test). Estado final
// verificado real: CANCELADO.
//
// Self-contained: usa PLANES_CONOCIDOS.paraCancelar, un plan de 1 sola cuota
// (así "pagar todas las cuotas" es un solo F3010) — paga esa cuota si todavía
// no está PAGADA, y recién ahí llama GenerarCancelacionPorSolicitud.
//
// ⚠ MUTA datos reales de forma IRREVERSIBLE: el plan queda CANCELADO al
// final, no hay reversa de F3002 documentada. No correr sin un plan de sobra.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, withTracerInstance } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

test('TC_REG_F3002_001 — cancelar el plan cuando todas las cuotas están pagas', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraCancelar, 'Requiere PLANES_CONOCIDOS.paraCancelar en fixtures/test-data.js');

  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CONTRIBUYENTES.conPlan.cuit,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.paraCancelar,
  });

  const cuotas = detalle?.cuotas ?? [];
  console.log(`TC_REG_F3002_001 — cuotas del plan: ${cuotas.length}`);

  // Pagar cualquier cuota que todavía no esté PAGADA
  for (const cuota of cuotas) {
    if (cuota.estadoCuota === 'PAGADA') continue;

    const venc1ISO = cuota.vencimientoCuota1.includes('/')
      ? cuota.vencimientoCuota1.split('/').reverse().join('-')
      : cuota.vencimientoCuota1;
    const emitir = cliente.buscarEmitirDRG(venc1ISO);
    expect(emitir, `Debe existir EmitirDRG para vencimiento ${venc1ISO}`).toBeTruthy();

    await cliente.generarDebitoCuotaPorSolicitud({
      idSolicitud: PLANES_CONOCIDOS.paraCancelar, fecha: emitir, esPrimerIntento: true,
    });
    await new Promise(r => setTimeout(r, 1500));

    let idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
    if (!idDebito) idDebito = await obtenerIdDebito(cuota.idTracerCuota);

    const payload = cliente.construirPayloadF3010({
      cuit: CONTRIBUYENTES.conPlan.cuit,
      cuota: {
        numeroCuota: cuota.numeroCuota,
        importeNominal: cuota.importeNominal,
        importeActualizado: cuota.importeActualizado,
        vencimientoCuota1: venc1ISO,
        idTracerCuota: cuota.idTracerCuota,
      },
      resumenPlan: resumen,
      correcto: true,
      idDebito: idDebito || 0,
    });
    const resultadoPago = await cliente.registrarPagoCuota3010(payload);
    console.log(`TC_REG_F3002_001 — pago cuota ${cuota.numeroCuota}: ${JSON.stringify(resultadoPago)}`);
    await new Promise(r => setTimeout(r, 1500));
  }

  // Verificar que todas quedaron PAGADA — directo en Mongo (más confiable
  // que la API de detalle en este punto)
  const docsCuotas = await withTracerInstance(col =>
    col.find({ 'content.IDSolicitud': PLANES_CONOCIDOS.paraCancelar, quota: { $gt: 0 } }).toArray()
  );
  const estados = docsCuotas.map(d => d.states?.find(s => s.statechart === 'PFP_Cuota')?.state);
  console.log(`TC_REG_F3002_001 — estados de cuotas antes de cancelar: ${JSON.stringify(estados)}`);
  expect(estados.every(e => e === 'PAGADA'), `Todas las cuotas deben estar PAGADA: ${estados}`).toBe(true);

  // Cancelar
  const resultado = await cliente.generarCancelacionPorSolicitud({ idSolicitud: PLANES_CONOCIDOS.paraCancelar });
  console.log(`TC_REG_F3002_001 — GenerarCancelacionPorSolicitud: ${JSON.stringify(resultado)}`);

  await new Promise(r => setTimeout(r, 1500));
  const docPlan = await withTracerInstance(col =>
    col.findOne({ 'content.IDSolicitud': PLANES_CONOCIDOS.paraCancelar, quota: 0 })
  );
  const estadoFinal = docPlan.states?.find(s => s.statechart === 'PFP')?.state;
  console.log(`TC_REG_F3002_001 — estado final del plan: ${estadoFinal}`);
  expect(estadoFinal).toBe('CANCELADO');
});
