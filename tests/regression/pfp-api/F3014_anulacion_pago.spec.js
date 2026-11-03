// tests/regression/pfp-api/F3014_anulacion_pago.spec.js
// F3014 — Anulación de Pago de Cuota (PAGADA → ANULADA · débito DEBITADO →
// ANULADO), vía API (sin pantalla propia — RegistrarFormulario?formulario=3014).
// Ver memoria pfp-formularios-catalogo / pfp-roadmap-fases.
//
// PAYLOAD CONFIRMADO REAL 2026-08-26: misma forma base que construirPayloadF3010
// (header + Datos) más 4 campos extra que el backend exige ("X is required."
// si faltan): Comprobante_anulado (= transaction del F3010 que pagó la
// cuota), Observaciones, Agente, Usuario_agente.
//
// 2026-10-14: el plan sale de lib/fabricaPlanes.js (receta "paraCuotas",
// compartida con F3012) y cada corrida paga y anula la primera cuota 2+ sin
// tocar — antes usaba siempre la cuota 3 de PLANES_CONOCIDOS.paraRehabilitar,
// que una vez anulada hacía fallar el pago con "Duplicate document". El pago
// va por api-publicador (débito + GenerarPagoCuotas), que devuelve el
// transaction del F3010 a usar como Comprobante_anulado. El resumen del plan
// y el CUIT salen de Mongo (mismos campos que ObtenerPlanesDePago).
//
// ⚠ MUTA datos reales: consume una cuota del plan por corrida.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { planParaCuotas, primeraCuotaLibre, estadoPlan, operarCuota } = require('../../../lib/fabricaPlanes');
const { SIGN_CCT } = require('../../../fixtures/test-data');

test('TC_REG_F3014_001 — pagar y anular el pago de una cuota', async ({ page, request }) => {
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env (la fábrica de planes valida el estado en Mongo)');
  test.setTimeout(240000);

  const solicitud = await planParaCuotas(page);
  test.skip(!solicitud, 'Sin plan VIGENTE con cuotas 2+ libres y NO_FABRICAR=1');

  const { nro } = await primeraCuotaLibre(solicitud);
  console.log(`TC_REG_F3014_001 — plan ${solicitud}, cuota ${nro}`);

  const cliente = new PfpApiClient(request, 'qa-av');
  const transactionPago = await operarCuota(cliente, solicitud, nro, { resultado: 'pago' });
  expect(transactionPago, 'El pago (F3010) debe devolver un transaction real').toBeTruthy();

  const { cuit, plan, cuotas } = await estadoPlan(solicitud);
  const pagada = cuotas.find(c => c.nro === nro);
  expect(`${pagada.estado}/${pagada.debito}`).toBe('PAGADA/DEBITADO');

  await cliente.autenticar(cuit, SIGN_CCT);
  const contenido = pagada.doc.content;
  const payloadAnulacion = cliente.construirPayloadF3014({
    cuit,
    cuota: {
      numeroCuota: nro,
      importeNominal: contenido.Importe_Nominal,
      importeActualizado: contenido.Importe_Actualizado,
      vencimientoCuota1: contenido.Fecha_Primer_Vencimiento.toISOString().slice(0, 10),
      idTracerCuota: pagada.doc._id,
    },
    resumenPlan: plan,
    idDebito: contenido.ID_Debito,
    comprobanteAnulado: transactionPago,
  });

  const resultadoAnulacion = await cliente.anularPagoCuota3014(payloadAnulacion);
  console.log(`TC_REG_F3014_001 — RegistrarFormulario?formulario=3014: ${JSON.stringify(resultadoAnulacion)}`);
  expect(resultadoAnulacion?.errores, `No debe haber errores: ${JSON.stringify(resultadoAnulacion?.errores)}`).toBeFalsy();

  await new Promise(r => setTimeout(r, 1500));
  const final = (await estadoPlan(solicitud)).cuotas.find(c => c.nro === nro);
  console.log(`TC_REG_F3014_001 — cuota ${nro} después: cuota=${final.estado} debito=${final.debito}`);
  expect(final.estado).toBe('ANULADA');
  expect(final.debito).toBe('ANULADO');
});
