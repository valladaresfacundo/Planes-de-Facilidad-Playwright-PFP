// tests/api/TC_API_010_pago_cuota1_f3010.spec.js
// Fase 2 — F3010 (Pago Directo) real contra QA_HOMO: paga la cuota 1 del plan
// PLANES_CONOCIDOS.vigente (1783000149) para habilitar el caso POSITIVO de
// F3005 (Cancelación Anticipada) que quedó pendiente en Fase 1 (la CA exige la
// 1° cuota paga — ver TC_REG_009 en tests/regression/TC_REG_003_ca_cbu.spec.js,
// que hoy solo cubre el caso negativo con este mismo plan sin pagar).
//
// ⚠ MUTA datos reales en QA — ejecutado con decisión explícita del usuario
// (2026-08-13, ver memoria pfp-roadmap-fases) sobre este plan puntual. Después
// de correr esto, PLANES_CONOCIDOS.vigente queda con la cuota 1 PAGADA —
// TC_REG_009 (caso negativo de F3005) deja de reproducir con este plan.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../lib/pfpApiClient');
const { SIGN_CCT, CUIT_AUTENTICADO, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test('TC_API_010 — F3010: pago real de la cuota 1 del plan VIGENTE conocido', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente');

  const cliente = new PfpApiClient(request, 'qa');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });

  const cuota1 = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === 1);
  expect(cuota1, 'Debe existir la cuota 1 en el detalle del plan').toBeTruthy();
  console.log(`TC_API_010 — cuota 1 antes del pago: estado=${cuota1.estadoCuota} nominal=${cuota1.importeNominal}`);

  if (cuota1.estadoCuota === 'PAGADA') {
    console.log('TC_API_010 — la cuota 1 ya está PAGADA, no hace falta pagar de nuevo.');
    return;
  }

  const venc1ISO = cuota1.vencimientoCuota1.includes('/')
    ? cuota1.vencimientoCuota1.split('/').reverse().join('-')
    : cuota1.vencimientoCuota1;
  const emitir = cliente.buscarEmitirDRG(venc1ISO);
  expect(emitir, `Debe existir EmitirDRG para vencimiento ${venc1ISO}`).toBeTruthy();
  console.log(`TC_API_010 — EmitirDRG resuelto: ${emitir}`);

  // 1. Generar débito por solicitud (tolerante a error, igual que la herramienta real)
  const debito = await cliente.generarDebitoCuotaPorSolicitud({
    idSolicitud: PLANES_CONOCIDOS.vigente,
    fecha: emitir,
    esPrimerIntento: true,
  });
  console.log(`TC_API_010 — GenerarDebitoCuotaPorSolicitud: ok=${debito.ok} status=${debito.status} body=${JSON.stringify(debito.body).slice(0, 300)}`);

  // 2. Poll Tracer para ID_Debito
  const idDebito = await cliente.esperarIdDebito(cuota1.idTracerCuota);
  console.log(`TC_API_010 — ID_Debito: ${idDebito ?? '(no apareció, se registra F3010 con 0)'}`);

  // 3. Registrar F3010 (pago correcto)
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
  console.log(`TC_API_010 — payload F3010: ${JSON.stringify(payload)}`);

  const resultado = await cliente.registrarPagoCuota3010(payload);
  console.log(`TC_API_010 — RegistrarFormulario?formulario=3010 respuesta: ${JSON.stringify(resultado)}`);

  // 4. Verificar que la cuota quedó PAGADA
  await new Promise(r => setTimeout(r, 1500));
  const { detalle: detalleFinal } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });
  const cuota1Final = (detalleFinal?.cuotas ?? []).find(c => Number(c.numeroCuota) === 1);
  console.log(`TC_API_010 — cuota 1 después del pago: estado=${cuota1Final?.estadoCuota}`);
  expect(cuota1Final?.estadoCuota).toBe('PAGADA');
});
