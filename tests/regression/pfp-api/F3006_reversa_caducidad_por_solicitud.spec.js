// tests/regression/pfp-api/F3006_reversa_caducidad_por_solicitud.spec.js
// F3006 — Reversa de Caducidad (CADUCO → VIGENTE) vía API (ReversarCaducidades),
// alternativa descubierta 2026-09-03 al flujo UI de Portal Agente
// (tests/regression/pfp/F3006_reversa_caducidad.spec.js, que se detiene antes
// de "Confirmar" por la fragilidad del dropdown "Tipo Actuación" con scroll
// virtualizado). Ver memoria pfp-formularios-catalogo / pfp-roadmap-fases.
//
// Self-contained como F3003: si el plan no está CADUCO todavía, primero lo
// caduca de verdad (mismo proceso que F3003_caducidad_por_solicitud.spec.js
// — pagar cuota 1, rechazar cuota 2/3, backdatear fechas en Mongo,
// GenerarCaducidadPorSolicitud) y recién ahí llama a ReversarCaducidades.
//
// ⚠ CONFIRMADO real 2026-09-03: ReversarCaducidades NO redistribuye/resetea
// las cuotas RECHAZADA (F3015/F3016 no son un efecto colateral automático
// de este llamado) — el plan queda VIGENTE pero con cuotas rechazadas y
// vencimientos ya pasados, sin resolver. El test solo verifica el estado del
// PLAN (VIGENTE), no pretende que las cuotas queden "sanas".
//
// ⚠ MUTA datos reales. Requiere MONGO_URI en .env (mismo que F3003).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { actualizarFechasCuota, buscarPlanPorSolicitud: buscarPlanEnMongo, estadoActual, obtenerIdDebito } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CUIT_AUTENTICADO } = require('../../../fixtures/test-data');

function fechaISO(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  return d.toISOString().slice(0, 10);
}

async function pagarORechazar(cliente, { resumen, cuota, correcto }) {
  const venc1ISO = cuota.vencimientoCuota1.includes('/')
    ? cuota.vencimientoCuota1.split('/').reverse().join('-')
    : cuota.vencimientoCuota1;
  const emitir = cliente.buscarEmitirDRG(venc1ISO);
  await cliente.generarDebitoCuotaPorSolicitud({
    idSolicitud: resumen.content.IDSolicitud, fecha: emitir, esPrimerIntento: true,
  });
  await new Promise(r => setTimeout(r, 1500));
  let idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
  if (!idDebito) idDebito = await obtenerIdDebito(cuota.idTracerCuota);
  const payload = cliente.construirPayloadF3010({
    cuit: CUIT_AUTENTICADO,
    cuota: { ...cuota, vencimientoCuota1: venc1ISO },
    resumenPlan: resumen,
    correcto,
    idDebito: idDebito || 0,
  });
  return cliente.registrarPagoCuota3010(payload);
}

test('TC_REG_F3006_001 — caducar (si hace falta) y revertir la caducidad vía ReversarCaducidades', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env — ver .env.example y lib/mongoAdmin.js');

  const idSolicitud = PLANES_CONOCIDOS.vigente;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  let docs = await buscarPlanEnMongo(idSolicitud);
  let plan = docs.find(d => d.quota === 0);
  expect(plan, `Debe existir el plan ${idSolicitud} en Mongo`).toBeTruthy();
  console.log(`TC_REG_F3006_001 — estado inicial: ${estadoActual(plan, 'PFP')}`);

  if (estadoActual(plan, 'PFP') !== 'CADUCO') {
    // Mismo proceso que F3003_caducidad_por_solicitud.spec.js — llevar el
    // plan a CADUCO de verdad antes de poder revertirlo.
    const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
      cuit: CUIT_AUTENTICADO,
      anio: new Date().getFullYear(),
      solicitud: idSolicitud,
    });
    const cuotas = detalle?.cuotas ?? [];
    const cuota1 = cuotas.find(c => Number(c.numeroCuota) === 1);
    const cuota2 = cuotas.find(c => Number(c.numeroCuota) === 2);
    const cuota3 = cuotas.find(c => Number(c.numeroCuota) === 3);
    expect(cuota1 && cuota2 && cuota3, 'El plan debe tener al menos 3 cuotas para poder caducarlo').toBeTruthy();

    if (cuota1.estadoCuota !== 'PAGADA') {
      const r = await pagarORechazar(cliente, { resumen, cuota: cuota1, correcto: true });
      console.log(`TC_REG_F3006_001 — pago cuota 1: ${JSON.stringify(r)}`);
      await new Promise(res => setTimeout(res, 1500));
    }
    if (cuota2.estadoCuota === 'NO_VENCIDA') {
      const r = await pagarORechazar(cliente, { resumen, cuota: cuota2, correcto: false });
      console.log(`TC_REG_F3006_001 — rechazo cuota 2: ${JSON.stringify(r)}`);
    }
    if (cuota3.estadoCuota === 'NO_VENCIDA') {
      const r = await pagarORechazar(cliente, { resumen, cuota: cuota3, correcto: false });
      console.log(`TC_REG_F3006_001 — rechazo cuota 3: ${JSON.stringify(r)}`);
    }
    await new Promise(res => setTimeout(res, 1500));

    const vencCuota2 = fechaISO(120);
    const vencCuota3 = fechaISO(90);
    await actualizarFechasCuota(cuota2.idTracerCuota, {
      fechaPrimerVencimiento: vencCuota2,
      fechaSegundoVencimiento: fechaISO(107),
      fechaDebito: vencCuota2,
      fechaEmisionDRG: cliente.buscarEmitirDRG(vencCuota2),
    });
    await actualizarFechasCuota(cuota3.idTracerCuota, {
      fechaPrimerVencimiento: vencCuota3,
      fechaSegundoVencimiento: fechaISO(75),
      fechaDebito: vencCuota3,
      fechaEmisionDRG: cliente.buscarEmitirDRG(vencCuota3),
    });

    const hoy = fechaISO(0);
    const resultadoCaducidad = await cliente.generarCaducidadPorSolicitud({ solicitud: idSolicitud, fecha: hoy });
    console.log(`TC_REG_F3006_001 — GenerarCaducidadPorSolicitud: ${JSON.stringify(resultadoCaducidad)}`);

    await new Promise(res => setTimeout(res, 1500));
    docs = await buscarPlanEnMongo(idSolicitud);
    plan = docs.find(d => d.quota === 0);
    console.log(`TC_REG_F3006_001 — estado tras caducar: ${estadoActual(plan, 'PFP')}`);
    expect(estadoActual(plan, 'PFP')).toBe('CADUCO');
  }

  // Reversa real (F3006) vía API
  const resultadoReversa = await cliente.reversarCaducidades([idSolicitud]);
  console.log(`TC_REG_F3006_001 — ReversarCaducidades: ${JSON.stringify(resultadoReversa)}`);

  await new Promise(res => setTimeout(res, 1500));
  docs = await buscarPlanEnMongo(idSolicitud);
  plan = docs.find(d => d.quota === 0);
  console.log(`TC_REG_F3006_001 — estado final: ${estadoActual(plan, 'PFP')}`);
  expect(estadoActual(plan, 'PFP')).toBe('VIGENTE');
});
