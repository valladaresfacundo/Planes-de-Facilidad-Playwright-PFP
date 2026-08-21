// tests/regression/pfp-api/F3010_pago_directo.spec.js
// F3010 — Pago Directo de cuota (NO_VENCIDA → PAGADA), vía API (sin pantalla
// propia — RegistrarFormulario?formulario=3010 + GenerarDebitoCuotaPorSolicitud).
// Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// Reorganizado 2026-08-19 a partir de tests/api/TC_API_010_pago_cuota1_f3010.spec.js
// (Fase 2), parametrizado sobre PLANES_CONOCIDOS.vigente en vez de un plan
// hardcodeado — el original (1783000149) ya quedó consumido en CA_PAGADA.
//
// ⚠ MUTA datos reales: paga la cuota 1 del plan vigente de verdad. Si el
// fixture ya la tiene PAGADA, no hace nada (no se puede pagar dos veces).
//
// 2026-08-20: en QA_AV el servicio Tracer (txsapi) devuelve 200 con body
// vacío incluso autenticado — esperarIdDebito() nunca encuentra nada ahí.
// Fallback a mongoAdmin.obtenerIdDebito() (lee content.ID_Debito directo del
// documento de la cuota, que sí se persiste bien tras GenerarDebitoCuotaPorSolicitud).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CUIT_AUTENTICADO } = require('../../../fixtures/test-data');

test('TC_REG_F3010_001 — pago real de la cuota 1 del plan VIGENTE conocido', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });

  const cuota1 = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === 1);
  expect(cuota1, 'Debe existir la cuota 1 en el detalle del plan').toBeTruthy();
  console.log(`TC_REG_F3010_001 — cuota 1 antes del pago: estado=${cuota1.estadoCuota} nominal=${cuota1.importeNominal}`);

  if (cuota1.estadoCuota === 'PAGADA') {
    console.log('TC_REG_F3010_001 — la cuota 1 ya está PAGADA, no hace falta pagar de nuevo.');
    return;
  }

  const venc1ISO = cuota1.vencimientoCuota1.includes('/')
    ? cuota1.vencimientoCuota1.split('/').reverse().join('-')
    : cuota1.vencimientoCuota1;
  const emitir = cliente.buscarEmitirDRG(venc1ISO);
  expect(emitir, `Debe existir EmitirDRG para vencimiento ${venc1ISO}`).toBeTruthy();

  const debito = await cliente.generarDebitoCuotaPorSolicitud({
    idSolicitud: PLANES_CONOCIDOS.vigente,
    fecha: emitir,
    esPrimerIntento: true,
  });
  console.log(`TC_REG_F3010_001 — GenerarDebitoCuotaPorSolicitud: ok=${debito.ok} status=${debito.status} body=${JSON.stringify(debito.body).slice(0, 200)}`);
  // Tolerante: si ya había un débito generado en un intento previo (queda en
  // DEBITO_ENVIADO), este endpoint responde "ninguna cuota apta" — no es un
  // error real, seguimos igual a buscar el ID_Debito ya existente.
  await new Promise(r => setTimeout(r, 1500));

  let idDebito = await cliente.esperarIdDebito(cuota1.idTracerCuota);
  if (!idDebito) {
    console.log('TC_REG_F3010_001 — Tracer no devolvió ID_Debito, probando fallback por Mongo...');
    idDebito = await obtenerIdDebito(cuota1.idTracerCuota);
  }
  console.log(`TC_REG_F3010_001 — ID_Debito: ${idDebito ?? '(ninguno, se registra con 0)'}`);

  const payload = cliente.construirPayloadF3010({
    cuit: CUIT_AUTENTICADO,
    cuota: {
      numeroCuota: cuota1.numeroCuota,
      importeNominal: cuota1.importeNominal,
      importeActualizado: cuota1.importeActualizado,
      vencimientoCuota1: venc1ISO,
      idTracerCuota: cuota1.idTracerCuota,
    },
    resumenPlan: resumen,
    correcto: true,
    idDebito: idDebito || 0,
  });

  const resultado = await cliente.registrarPagoCuota3010(payload);
  console.log(`TC_REG_F3010_001 — RegistrarFormulario?formulario=3010: ${JSON.stringify(resultado)}`);

  await new Promise(r => setTimeout(r, 1500));
  const { detalle: detalleFinal } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });
  const cuota1Final = (detalleFinal?.cuotas ?? []).find(c => Number(c.numeroCuota) === 1);
  console.log(`TC_REG_F3010_001 — cuota 1 después del pago: estado=${cuota1Final?.estadoCuota}`);
  expect(cuota1Final?.estadoCuota).toBe('PAGADA');
});
