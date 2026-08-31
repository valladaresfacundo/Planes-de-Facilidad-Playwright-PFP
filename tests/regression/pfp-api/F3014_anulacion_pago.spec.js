// tests/regression/pfp-api/F3014_anulacion_pago.spec.js
// F3014 — Anulación de Pago de Cuota (PAGADA → ANULADA · débito DEBITADO →
// ANULADO), vía API (sin pantalla propia — RegistrarFormulario?formulario=3014).
// Ver memoria pfp-formularios-catalogo / pfp-roadmap-fases.
//
// PAYLOAD CONFIRMADO REAL 2026-08-26: misma forma base que construirPayloadF3010
// (header + Datos) más 4 campos extra que el backend exige ("X is required."
// si faltan): Comprobante_anulado, Observaciones, Agente, Usuario_agente.
// Probado contra plan 1543000154 cuota 1 -> respuesta real
// {"respuesta":{"transaction":633270,...}} sin errores, verificado en Mongo
// (PFP_Cuota: ANULADA, PFP_Cuota_Debito: ANULADO) el 2026-08-31 al volver la
// VPN de AGIP.
//
// Self-contained como F3010/F3012: si la cuota elegida no está PAGADA, la
// paga primero de verdad (F3010) para tener un `transaction` real que usar
// como Comprobante_anulado — no tiene sentido anular un pago sin uno.
//
// ⚠ MUTA datos reales. Reusa PLANES_CONOCIDOS.paraRehabilitar (mismo plan que
// F3012, CUIT_AUTENTICADO) pero con la CUOTA 3 — la 1 ya se usó para validar
// este mismo F3014 (quedó ANULADA) y la 2 para F3012 (quedó REHABILITADA).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito, withTracerInstance } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CUIT_AUTENTICADO } = require('../../../fixtures/test-data');

const NUMERO_CUOTA_A_ANULAR = 3;

test(`TC_REG_F3014_001 — pagar (si hace falta) y anular el pago de la cuota ${NUMERO_CUOTA_A_ANULAR}`, async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraRehabilitar, 'Requiere PLANES_CONOCIDOS.paraRehabilitar en fixtures/test-data.js');

  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.paraRehabilitar,
  });

  const cuota = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === NUMERO_CUOTA_A_ANULAR);
  expect(cuota, `Debe existir la cuota ${NUMERO_CUOTA_A_ANULAR} en el detalle del plan`).toBeTruthy();
  console.log(`TC_REG_F3014_001 — cuota ${NUMERO_CUOTA_A_ANULAR} antes: estado=${cuota.estadoCuota}`);

  const venc1ISO = cuota.vencimientoCuota1.includes('/')
    ? cuota.vencimientoCuota1.split('/').reverse().join('-')
    : cuota.vencimientoCuota1;

  let transactionPago;

  if (cuota.estadoCuota !== 'PAGADA') {
    // Pagarla primero (F3010) para tener un transaction real que anular.
    const emitir = cliente.buscarEmitirDRG(venc1ISO);
    expect(emitir, `Debe existir EmitirDRG para vencimiento ${venc1ISO}`).toBeTruthy();

    await cliente.generarDebitoCuotaPorSolicitud({
      idSolicitud: PLANES_CONOCIDOS.paraRehabilitar,
      fecha: emitir,
      esPrimerIntento: true,
    });
    await new Promise(r => setTimeout(r, 1500));

    let idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
    if (!idDebito) idDebito = await obtenerIdDebito(cuota.idTracerCuota);
    expect(idDebito, 'Debe conseguirse un ID_Debito real antes de pagar').toBeTruthy();

    const payloadPago = cliente.construirPayloadF3010({
      cuit: CUIT_AUTENTICADO,
      cuota: {
        numeroCuota: cuota.numeroCuota,
        importeNominal: cuota.importeNominal,
        importeActualizado: cuota.importeActualizado,
        vencimientoCuota1: venc1ISO,
        idTracerCuota: cuota.idTracerCuota,
      },
      resumenPlan: resumen,
      correcto: true,
      idDebito,
    });
    const resultadoPago = await cliente.registrarPagoCuota3010(payloadPago);
    console.log(`TC_REG_F3014_001 — F3010 (pago): ${JSON.stringify(resultadoPago)}`);
    transactionPago = resultadoPago?.respuesta?.transaction;
    expect(transactionPago, 'RegistrarFormulario?formulario=3010 debe devolver un transaction real').toBeTruthy();
    await new Promise(r => setTimeout(r, 1500));
  } else {
    // Ya estaba paga de antes — recuperar el transaction original no es
    // posible por API, así que usamos el ID_Debito como referencia del
    // comprobante (mejor esfuerzo, documentado).
    console.log(`TC_REG_F3014_001 — la cuota ${NUMERO_CUOTA_A_ANULAR} ya estaba PAGADA, sin transaction de pago capturado en esta corrida.`);
  }

  const docTrasPago = await withTracerInstance(col => col.findOne({ _id: cuota.idTracerCuota }));
  const idDebitoFinal = docTrasPago.content.ID_Debito;

  const payloadAnulacion = cliente.construirPayloadF3014({
    cuit: CUIT_AUTENTICADO,
    cuota: {
      numeroCuota: cuota.numeroCuota,
      importeNominal: cuota.importeNominal,
      importeActualizado: docTrasPago.content.Importe_Actualizado ?? cuota.importeActualizado,
      vencimientoCuota1: venc1ISO,
      idTracerCuota: cuota.idTracerCuota,
    },
    resumenPlan: resumen,
    idDebito: idDebitoFinal,
    comprobanteAnulado: transactionPago || idDebitoFinal,
  });

  const resultadoAnulacion = await cliente.anularPagoCuota3014(payloadAnulacion);
  console.log(`TC_REG_F3014_001 — RegistrarFormulario?formulario=3014: ${JSON.stringify(resultadoAnulacion)}`);
  expect(resultadoAnulacion?.errores, `No debe haber errores: ${JSON.stringify(resultadoAnulacion?.errores)}`).toBeFalsy();

  await new Promise(r => setTimeout(r, 1500));
  const docFinal = await withTracerInstance(col => col.findOne({ _id: cuota.idTracerCuota }));
  const estadoCuotaFinal = docFinal.states?.find(s => s.statechart === 'PFP_Cuota')?.state;
  const estadoDebitoFinal = docFinal.states?.find(s => s.statechart === 'PFP_Cuota_Debito')?.state;
  console.log(`TC_REG_F3014_001 — cuota ${NUMERO_CUOTA_A_ANULAR} después: cuota=${estadoCuotaFinal} debito=${estadoDebitoFinal}`);
  expect(estadoCuotaFinal).toBe('ANULADA');
  expect(estadoDebitoFinal).toBe('ANULADO');
});
