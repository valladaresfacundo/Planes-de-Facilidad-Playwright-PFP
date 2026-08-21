// tests/regression/pfp-api/F3012_rehabilitar_cuota.spec.js
// F3012 — Rehabilitar Cuota (RECHAZADA → A_REHABILITAR → REHABILITADA), vía
// API (sin pantalla propia). Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// MECANISMO REAL (confirmado por el usuario 2026-08-20 — NO es lo que se
// había asumido antes, portado sin validar de la herramienta HTML):
//   1. Rechazar la cuota (F3010 pago erróneo) en su 1° Y 2° vencimiento — DOS
//      rechazos sobre la MISMA cuota, no uno. Recién con los dos el estado
//      pasa de RECHAZADA a A_REHABILITAR.
//   2. ObtenerRehabilitacionCuota?idCuota=... (informativo, confirma que está lista).
//   3. GenerarRehabilitacionCuota?idCuota=...&idPlan=... (real, rehabilita).
// NO hace falta (ni funciona) RegistrarFormulario?formulario=3012 — el primer
// intento de esta sesión usaba ese endpoint con un payload adivinado
// (header+Datos) que el backend rechazaba con muchos "campo requerido"; el
// usuario aclaró que el flujo real es el de arriba, sin ese paso.
//
// ⚠⚠⚠ NUNCA usar la cuota 1 para esto: rechazarla (aunque sea una sola vez)
// dispara F3011 (Nulidad automática) del PLAN ENTERO — confirmado real en
// Mongo (VIGENTE → NULO, mismo timestamp que el rechazo). Usar SIEMPRE cuota
// 2 en adelante. Ver memoria pfp-formularios-catalogo.
//
// Nota técnica: una vez que la cuota queda RECHAZADA, ObtenerPlanDePagoDetalle
// deja de devolver vencimientoCuota2 (queda "-") aunque el dato sigue en
// Mongo (content.Fecha_Segundo_Vencimiento) — para el 2° rechazo hay que leer
// la fecha directo de Mongo, no de la respuesta de la API.
//
// ⚠ MUTA datos reales: si la cuota no está en NO_VENCIDA, este test puede no
// reproducir tal cual. En QA_AV el servicio Tracer (txsapi) devuelve 200 con
// body vacío incluso autenticado — esperarIdDebito() nunca encuentra nada
// ahí, por eso se usa el fallback mongoAdmin.obtenerIdDebito() en su lugar.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, withTracerInstance } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

const NUMERO_CUOTA_A_REHABILITAR = 2; // NUNCA 1 — ver advertencia arriba

async function rechazarVencimiento(cliente, { resumen, cuota, fechaVencimientoISO }) {
  const emitir = cliente.buscarEmitirDRG(fechaVencimientoISO);
  expect(emitir, `Debe existir EmitirDRG para vencimiento ${fechaVencimientoISO}`).toBeTruthy();

  await cliente.generarDebitoCuotaPorSolicitud({
    idSolicitud: PLANES_CONOCIDOS.paraRehabilitar,
    fecha: emitir,
    esPrimerIntento: true,
  });
  await new Promise(r => setTimeout(r, 1500));

  let idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
  if (!idDebito) idDebito = await obtenerIdDebito(cuota.idTracerCuota);
  expect(idDebito, 'Debe conseguirse un ID_Debito real antes de rechazar').toBeTruthy();

  const payload = cliente.construirPayloadF3010({
    cuit: CONTRIBUYENTES.conPlan.cuit,
    cuota: {
      numeroCuota: cuota.numeroCuota,
      importeNominal: cuota.importeNominal,
      importeActualizado: cuota.importeActualizado,
      vencimientoCuota1: fechaVencimientoISO,
      idTracerCuota: cuota.idTracerCuota,
    },
    resumenPlan: resumen,
    correcto: false,
    idDebito,
  });
  const resultado = await cliente.registrarPagoCuota3010(payload);
  console.log(`TC_REG_F3012_001 — F3010 (rechazo ${fechaVencimientoISO}): ${JSON.stringify(resultado)}`);
  await new Promise(r => setTimeout(r, 1500));
}

test(`TC_REG_F3012_001 — rechazar cuota ${NUMERO_CUOTA_A_REHABILITAR} en ambos vencimientos y rehabilitarla`, async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraRehabilitar, 'Requiere PLANES_CONOCIDOS.paraRehabilitar en fixtures/test-data.js — plan VIGENTE nuevo, la cuota 2 debe estar libre');
  expect(NUMERO_CUOTA_A_REHABILITAR, 'NUNCA usar cuota 1 — dispara Nulidad automática del plan (F3011)').toBeGreaterThan(1);

  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CONTRIBUYENTES.conPlan.cuit,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.paraRehabilitar,
  });

  const cuota = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === NUMERO_CUOTA_A_REHABILITAR);
  expect(cuota, `Debe existir la cuota ${NUMERO_CUOTA_A_REHABILITAR} en el detalle del plan`).toBeTruthy();
  console.log(`TC_REG_F3012_001 — cuota ${NUMERO_CUOTA_A_REHABILITAR} antes: estado=${cuota.estadoCuota}`);

  if (cuota.estadoCuota === 'NO_VENCIDA') {
    // 1er vencimiento — todavía visible en la respuesta de la API en este punto
    const venc1ISO = cuota.vencimientoCuota1.includes('/')
      ? cuota.vencimientoCuota1.split('/').reverse().join('-')
      : cuota.vencimientoCuota1;
    await rechazarVencimiento(cliente, { resumen, cuota, fechaVencimientoISO: venc1ISO });

    // 2do vencimiento — la API ya no lo devuelve tras el 1er rechazo ("-"), leer de Mongo
    const docMongo = await withTracerInstance(col => col.findOne({ _id: cuota.idTracerCuota }));
    const venc2ISO = new Date(docMongo.content.Fecha_Segundo_Vencimiento).toISOString().slice(0, 10);
    await rechazarVencimiento(cliente, { resumen, cuota, fechaVencimientoISO: venc2ISO });
  }

  // Verificar A_REHABILITAR antes de seguir — directo en Mongo (más confiable
  // que la API de detalle en este estado)
  const docTrasRechazos = await withTracerInstance(col => col.findOne({ _id: cuota.idTracerCuota }));
  const estadoTrasRechazos = docTrasRechazos.states?.find(s => s.statechart === 'PFP_Cuota')?.state;
  console.log(`TC_REG_F3012_001 — estado tras los 2 rechazos: ${estadoTrasRechazos}`);
  expect(estadoTrasRechazos).toBe('A_REHABILITAR');

  // Paso 2 — ObtenerRehabilitacionCuota (informativo, confirma que está lista)
  const infoRehab = await cliente.obtenerRehabilitacionCuota(cuota.idTracerCuota);
  console.log(`TC_REG_F3012_001 — ObtenerRehabilitacionCuota: ${JSON.stringify(infoRehab)}`);
  expect(infoRehab?.codigo).toBe(1);

  // Paso 3 — GenerarRehabilitacionCuota (real)
  const rehabilitacion = await cliente.generarRehabilitacionCuota({
    idCuota: cuota.idTracerCuota,
    idPlan: resumen._id,
  });
  console.log(`TC_REG_F3012_001 — GenerarRehabilitacionCuota: ${JSON.stringify(rehabilitacion)}`);

  // Verificación final
  await new Promise(r => setTimeout(r, 1500));
  const docFinal = await withTracerInstance(col => col.findOne({ _id: cuota.idTracerCuota }));
  const estadoFinal = docFinal.states?.find(s => s.statechart === 'PFP_Cuota')?.state;
  console.log(`TC_REG_F3012_001 — cuota ${NUMERO_CUOTA_A_REHABILITAR} después: estado=${estadoFinal}`);
  expect(estadoFinal).toBe('REHABILITADA');
});
