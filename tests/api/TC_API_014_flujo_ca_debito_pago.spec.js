// tests/api/TC_API_014_flujo_ca_debito_pago.spec.js
// Fase 2 — cierra el flujo de Cancelación Anticipada real generada en
// TC_API_012 (F3005, plan PLANES_CONOCIDOS.vigente = 1783000149, ahora en
// CA_PENDIENTE): F3009 (débito CA) → CA_PAGADA → F3008 (cierre, GenerarCancelaciones).
//
// La fecha a usar en ambos pasos es CA_Fecha_Emision_DRG, que devuelve el
// plan una vez generada la CA de verdad — NO se calcula con buscarEmitirDRG()
// sobre el vencimiento de una cuota (esa tabla es para pagos de cuota normal,
// no para el flujo de CA). Confirmado real: CA_Fecha_Emision_DRG =
// "2026-08-14T17:30:29-03:00" (ver TC_API_013).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../lib/pfpApiClient');
const { SIGN_CCT, CUIT_AUTENTICADO, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test('TC_API_014 — F3009 (débito CA) + F3008 (cierre): CA_PENDIENTE → CA_ENVIADA_DEBITO → CA_PAGADA → CA', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

  const cliente = new PfpApiClient(request, 'qa');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  // Estado inicial — confirmar CA_PENDIENTE y extraer CA_Fecha_Emision_DRG del plan real
  let planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: PLANES_CONOCIDOS.vigente, estado: 'Todos',
  });
  let plan = planes[0];
  console.log(`TC_API_014 — estado inicial: ${plan.states?.[0]?.state}`);
  expect(plan.states?.[0]?.state).toBe('CA_PENDIENTE');

  const fechaEmisionDGR = String(plan.content.CA_Fecha_Emision_DRG).slice(0, 10);
  console.log(`TC_API_014 — CA_Fecha_Emision_DRG (del plan real): ${fechaEmisionDGR}`);
  expect(fechaEmisionDGR).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // Paso F3009 — GenerarDebitosCancelacionAnticipada: CA_PENDIENTE → CA_ENVIADA_DEBITO
  const resultDebito = await cliente.generarDebitosCancelacionAnticipada(fechaEmisionDGR);
  console.log(`TC_API_014 — GenerarDebitosCancelacionAnticipada: ${JSON.stringify(resultDebito).slice(0, 500)}`);

  await new Promise(r => setTimeout(r, 1500));
  planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: PLANES_CONOCIDOS.vigente, estado: 'Todos',
  });
  plan = planes[0];
  console.log(`TC_API_014 — estado tras F3009: ${plan.states?.[0]?.state}`);
  expect(plan.states?.[0]?.state).toBe('CA_ENVIADA_DEBITO');

  // Paso pago CA — GenerarPagoCuotas(esCancelacionAnticipada=true, pagoRechazado=false): CA_ENVIADA_DEBITO → CA_PAGADA
  const resultPago = await cliente.generarPagoCuotas({
    fechaEmisionDGR,
    idSolicitud: PLANES_CONOCIDOS.vigente, // idSolicitud = idPlan acá, NO el idCA
    pagoRechazado: false,
    esCancelacionAnticipada: true,
  });
  console.log(`TC_API_014 — GenerarPagoCuotas (CA_PAGADA): ${JSON.stringify(resultPago).slice(0, 500)}`);

  await new Promise(r => setTimeout(r, 1500));
  planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: PLANES_CONOCIDOS.vigente, estado: 'Todos',
  });
  plan = planes[0];
  console.log(`TC_API_014 — estado tras pago CA: ${plan.states?.[0]?.state}`);
  expect(plan.states?.[0]?.state).toBe('CA_PAGADA');

  // Paso F3008 — GenerarCancelaciones: CA_PAGADA → CA (estado final). Es un
  // batch pesado (ver memoria pfp-api-endpoints) — el cliente ya usa un
  // timeout largo para esto.
  const resultCancelaciones = await cliente.generarCancelaciones();
  console.log(`TC_API_014 — GenerarCancelaciones: ${JSON.stringify(resultCancelaciones).slice(0, 500)}`);

  await new Promise(r => setTimeout(r, 1500));
  planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: PLANES_CONOCIDOS.vigente, estado: 'Todos',
  });
  plan = planes[0];
  console.log(`TC_API_014 — estado final: ${plan.states?.[0]?.state}`);
});
