// tests/regression/pfp-api/F3011_nulidad_automatica.spec.js
// F3011 — Nulidad automática (VIGENTE → NULO), disparada como efecto
// colateral de rechazar la cuota 1 de un plan (F3010 incorrecto) — nunca
// tuvo un test formal antes, solo se había observado como side-effect
// indeseado en otras pruebas (ver memoria pfp-formularios-catalogo).
//
// También ejercita F3013 vía API (ReversarNulidades, hallazgo 2026-09-03,
// mismo mecanismo que reversarCaducidades() — ver F3006_reversa_caducidad_
// por_solicitud.spec.js), para cerrar el ciclo NULO → VIGENTE sin depender
// del flujo UI de Portal Agente.
//
// ⚠ Usa PLANES_CONOCIDOS.paraNulidad, un plan DEDICADO y separado de
// PLANES_CONOCIDOS.nulo — el usuario pidió explícitamente no tocar ese otro
// plan sin confirmarlo aparte (ver memoria pfp-roadmap-fases 2026-09-03).
//
// ⚠ NO perfectamente repetible para siempre: una vez que la cuota 1 del plan
// queda RECHAZADA (por el propio test), no se la puede volver a rechazar
// para disparar F3011 de nuevo — mismo criterio ya aceptado en el repo para
// F3010/F3012 (ver esos specs). Si el plan ya no tiene la cuota 1 en
// NO_VENCIDA, el test se saltea con un mensaje claro pidiendo un reemplazo.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, buscarPlanPorSolicitud: buscarPlanEnMongo, estadoActual } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

test('TC_REG_F3011_001 — rechazar cuota 1 dispara Nulidad automática, y ReversarNulidades revierte a VIGENTE', async ({ request }) => {
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
  console.log(`TC_REG_F3011_001 — estado inicial del plan: ${estadoInicial}`);

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

    // Rechazo real de la cuota 1 (F3010, correcto:false) — CONFIRMADO que un
    // solo rechazo alcanza para disparar F3011 (no hace falta el doble
    // rechazo de F3012, esa regla es solo para A_REHABILITAR).
    const payload = cliente.construirPayloadF3010({
      cuit,
      cuota: { ...cuota1, vencimientoCuota1: venc1ISO },
      resumenPlan: resumen,
      correcto: false,
      idDebito: idDebito || 0,
    });
    const resultado = await cliente.registrarPagoCuota3010(payload);
    console.log(`TC_REG_F3011_001 — F3010 (rechazo cuota 1): ${JSON.stringify(resultado)}`);

    await new Promise(r => setTimeout(r, 2000));
    docs = await buscarPlanEnMongo(idSolicitud);
    plan = docs.find(d => d.quota === 0);
    console.log(`TC_REG_F3011_001 — estado tras el rechazo: ${estadoActual(plan, 'PFP')}`);
    expect(estadoActual(plan, 'PFP')).toBe('NULO');
  }

  // F3013 vía API — reversa real
  const resultadoReversa = await cliente.reversarNulidades([idSolicitud]);
  console.log(`TC_REG_F3011_001 — ReversarNulidades: ${JSON.stringify(resultadoReversa)}`);

  await new Promise(r => setTimeout(r, 1500));
  docs = await buscarPlanEnMongo(idSolicitud);
  plan = docs.find(d => d.quota === 0);
  console.log(`TC_REG_F3011_001 — estado final: ${estadoActual(plan, 'PFP')}`);
  expect(estadoActual(plan, 'PFP')).toBe('VIGENTE');
});
