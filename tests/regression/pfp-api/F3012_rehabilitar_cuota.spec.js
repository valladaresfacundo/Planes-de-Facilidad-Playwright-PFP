// tests/regression/pfp-api/F3012_rehabilitar_cuota.spec.js
// F3012 — Rehabilitar Cuota (RECHAZADA → A_REHABILITAR → REHABILITADA), vía
// API (sin pantalla propia). Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// Self-contained: rechaza una cuota del plan PLANES_CONOCIDOS.vigente (F3010
// pago erróneo) y después la rehabilita — no necesita un fixture aparte ya
// preparado, arma el escenario dentro del mismo test.
//
// Usa NUMERO_CUOTA_A_REHABILITAR = 4 (no 1/2/3) a propósito: F3003_caducidad_por_solicitud.spec.js
// usa cuota 1/2/3 del mismo plan vigente — si este test tocara alguna de esas,
// se pisarían entre sí al correr ambos contra el mismo PLANES_CONOCIDOS.vigente.
// Requiere que el plan tenga al menos 4 cuotas.
//
// ⚠ MUTA datos reales: si la cuota no está en NO_VENCIDA, este test puede no
// reproducir tal cual (una cuota ya RECHAZADA/A_REHABILITAR se salta el paso
// de rechazo y va directo a intentar rehabilitar).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

const NUMERO_CUOTA_A_REHABILITAR = 4;

test(`TC_REG_F3012_001 — rechazar cuota ${NUMERO_CUOTA_A_REHABILITAR} y rehabilitarla (RECHAZADA → REHABILITADA)`, async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CONTRIBUYENTES.conPlan.cuit,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });

  const cuota = (detalle?.cuotas ?? []).find(c => Number(c.numeroCuota) === NUMERO_CUOTA_A_REHABILITAR);
  expect(cuota, `Debe existir la cuota ${NUMERO_CUOTA_A_REHABILITAR} en el detalle del plan`).toBeTruthy();
  console.log(`TC_REG_F3012_001 — cuota ${NUMERO_CUOTA_A_REHABILITAR} antes: estado=${cuota.estadoCuota}`);

  const venc1ISO = cuota.vencimientoCuota1.includes('/')
    ? cuota.vencimientoCuota1.split('/').reverse().join('-')
    : cuota.vencimientoCuota1;

  // Paso 1 — si todavía no está rechazada, la rechazamos con un F3010 de pago erróneo
  if (cuota.estadoCuota === 'NO_VENCIDA') {
    const emitir = cliente.buscarEmitirDRG(venc1ISO);
    expect(emitir, `Debe existir EmitirDRG para vencimiento ${venc1ISO}`).toBeTruthy();

    const debito = await cliente.generarDebitoCuotaPorSolicitud({
      idSolicitud: PLANES_CONOCIDOS.vigente,
      fecha: emitir,
      esPrimerIntento: true,
    });
    console.log(`TC_REG_F3012_001 — GenerarDebitoCuotaPorSolicitud: ok=${debito.ok} status=${debito.status}`);

    const idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
    const payloadRechazo = cliente.construirPayloadF3010({
      cuit: CONTRIBUYENTES.conPlan.cuit,
      cuota: {
        numeroCuota: cuota.numeroCuota,
        importeNominal: cuota.importeNominal,
        importeActualizado: cuota.importeActualizado,
        vencimientoCuota1: venc1ISO,
        idTracerCuota: cuota.idTracerCuota,
      },
      resumenPlan: resumen,
      correcto: false,
      idDebito: idDebito || 0,
    });
    const resultadoRechazo = await cliente.registrarPagoCuota3010(payloadRechazo);
    console.log(`TC_REG_F3012_001 — F3010 (rechazo): ${JSON.stringify(resultadoRechazo)}`);
    await new Promise(r => setTimeout(r, 1500));
  }

  // Paso 2 — registrar F3012 (RECHAZADA → A_REHABILITAR)
  const payloadF3012 = cliente.construirPayloadF3012({
    cuit: CONTRIBUYENTES.conPlan.cuit,
    cuota: {
      numeroCuota: cuota.numeroCuota,
      importeNominal: cuota.importeNominal,
      importeActualizado: cuota.importeActualizado,
      vencimientoCuota1: venc1ISO,
      idTracerCuota: cuota.idTracerCuota,
    },
    resumenPlan: resumen,
  });
  const resultadoF3012 = await cliente.registrarRehabilitacion3012(payloadF3012);
  console.log(`TC_REG_F3012_001 — F3012: ${JSON.stringify(resultadoF3012)}`);
  await new Promise(r => setTimeout(r, 1000));

  // Paso 3 — consulta informativa (no rehabilita, solo trae importes actualizados)
  const infoRehab = await cliente.obtenerRehabilitacionCuota(cuota.idTracerCuota).catch(e => {
    console.log(`TC_REG_F3012_001 — ObtenerRehabilitacionCuota falló (no bloqueante): ${e.message}`);
    return null;
  });
  if (infoRehab) console.log(`TC_REG_F3012_001 — ObtenerRehabilitacionCuota: ${JSON.stringify(infoRehab)}`);

  // Paso 4 — GenerarRehabilitacionCuota (A_REHABILITAR → REHABILITADA, de verdad)
  const rehabilitacion = await cliente.generarRehabilitacionCuota({
    idCuota: cuota.idTracerCuota,
    idPlan: resumen._id,
  });
  console.log(`TC_REG_F3012_001 — GenerarRehabilitacionCuota: ${JSON.stringify(rehabilitacion)}`);

  // Verificación final
  await new Promise(r => setTimeout(r, 1500));
  const { detalle: detalleFinal } = await cliente.buscarPlanPorSolicitud({
    cuit: CONTRIBUYENTES.conPlan.cuit,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });
  const cuotaFinal = (detalleFinal?.cuotas ?? []).find(c => Number(c.numeroCuota) === NUMERO_CUOTA_A_REHABILITAR);
  console.log(`TC_REG_F3012_001 — cuota ${NUMERO_CUOTA_A_REHABILITAR} después: estado=${cuotaFinal?.estadoCuota}`);
  expect(cuotaFinal?.estadoCuota).toBe('REHABILITADA');
});
