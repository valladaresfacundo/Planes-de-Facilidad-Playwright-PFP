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
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { SIGN_CCT, CUIT_AUTENTICADO, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

test('TC_REG_F3010_001 — pago real de la cuota 1 del plan VIGENTE conocido', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

  const cliente = new PfpApiClient(request, 'qa');
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
  console.log(`TC_REG_F3010_001 — GenerarDebitoCuotaPorSolicitud: ok=${debito.ok} status=${debito.status}`);

  const idDebito = await cliente.esperarIdDebito(cuota1.idTracerCuota);

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
