// tests/regression/pfp-api/F3013_reversa_nulidad_por_solicitud.spec.js
// F3013 — Reversa de Nulidad (NULO → VIGENTE) vía API (ReversarNulidades),
// alternativa al flujo UI de Portal Agente (tests/regression/pfp/
// F3013_reversa_nulidad.spec.js, que se detiene antes de "Confirmar" por
// la fragilidad del dropdown "Tipo Actuación" con scroll virtualizado) —
// mismo patrón que F3006_reversa_caducidad_por_solicitud.spec.js.
//
// Self-contained: si el plan no está NULO todavía, lo nulifica de verdad
// primero rechazando la cuota 1 (F3010 incorrecto, un solo rechazo alcanza
// — dispara F3011 automático, ver F3011_nulidad_automatica.spec.js) y
// recién ahí llama a ReversarNulidades.
//
// ⚠ Usa PLANES_CONOCIDOS.paraNulidad — el mismo fixture que
// F3011_nulidad_automatica.spec.js, NO PLANES_CONOCIDOS.nulo (el usuario
// pidió no tocar ese otro plan sin confirmarlo aparte).
//
// ⚠ NO perfectamente repetible para siempre: una vez que la cuota 1 queda
// RECHAZADA, no se la puede volver a rechazar para nulificar de nuevo desde
// cero — mismo criterio ya aceptado en el repo para F3010/F3011/F3012.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, buscarPlanPorSolicitud: buscarPlanEnMongo, estadoActual } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

test('TC_REG_F3013_001 — nulificar (si hace falta) y revertir la nulidad vía ReversarNulidades', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraNulidad, 'Requiere PLANES_CONOCIDOS.paraNulidad en fixtures/test-data.js');
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env — ver .env.example y lib/mongoAdmin.js');

  const idSolicitud = PLANES_CONOCIDOS.paraNulidad;
  const cuit = CONTRIBUYENTES.conPlan.cuit;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(cuit, SIGN_CCT);

  let docs = await buscarPlanEnMongo(idSolicitud);
  let plan = docs.find(d => d.quota === 0);
  expect(plan, `Debe existir el plan ${idSolicitud} en Mongo`).toBeTruthy();
  const estadoInicial = estadoActual(plan, 'PFP');
  console.log(`TC_REG_F3013_001 — estado inicial: ${estadoInicial}`);

  if (estadoInicial !== 'NULO') {
    const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
      cuit, anio: new Date().getFullYear(), solicitud: idSolicitud,
    });
    const cuota1 = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === 1);
    test.skip(
      !cuota1 || cuota1.estadoCuota !== 'NO_VENCIDA',
      `La cuota 1 de ${idSolicitud} ya no está NO_VENCIDA (estado: ${cuota1?.estadoCuota}) — pedir un plan VIGENTE nuevo con cuota 1 sin tocar para PLANES_CONOCIDOS.paraNulidad.`
    );

    const venc1ISO = cuota1.vencimientoCuota1.includes('/')
      ? cuota1.vencimientoCuota1.split('/').reverse().join('-')
      : cuota1.vencimientoCuota1;
    const emitir = cliente.buscarEmitirDRG(venc1ISO);
    await cliente.generarDebitoCuotaPorSolicitud({ idSolicitud, fecha: emitir, esPrimerIntento: true });
    await new Promise(r => setTimeout(r, 1500));

    let idDebito = await cliente.esperarIdDebito(cuota1.idTracerCuota);
    if (!idDebito) idDebito = await obtenerIdDebito(cuota1.idTracerCuota);

    const payload = cliente.construirPayloadF3010({
      cuit,
      cuota: { ...cuota1, vencimientoCuota1: venc1ISO },
      resumenPlan: resumen,
      correcto: false,
      idDebito: idDebito || 0,
    });
    const resultado = await cliente.registrarPagoCuota3010(payload);
    console.log(`TC_REG_F3013_001 — F3010 (rechazo cuota 1, dispara F3011): ${JSON.stringify(resultado)}`);

    await new Promise(r => setTimeout(r, 2000));
    docs = await buscarPlanEnMongo(idSolicitud);
    plan = docs.find(d => d.quota === 0);
    console.log(`TC_REG_F3013_001 — estado tras el rechazo: ${estadoActual(plan, 'PFP')}`);
    expect(estadoActual(plan, 'PFP')).toBe('NULO');
  }

  // F3013 vía API — reversa real
  const resultadoReversa = await cliente.reversarNulidades([idSolicitud]);
  console.log(`TC_REG_F3013_001 — ReversarNulidades: ${JSON.stringify(resultadoReversa)}`);

  await new Promise(r => setTimeout(r, 2000));
  docs = await buscarPlanEnMongo(idSolicitud);
  plan = docs.find(d => d.quota === 0);
  console.log(`TC_REG_F3013_001 — estado final: ${estadoActual(plan, 'PFP')}`);
  expect(estadoActual(plan, 'PFP')).toBe('VIGENTE');
});
