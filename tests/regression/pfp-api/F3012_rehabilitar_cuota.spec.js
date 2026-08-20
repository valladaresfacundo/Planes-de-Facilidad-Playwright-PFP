// tests/regression/pfp-api/F3012_rehabilitar_cuota.spec.js
// F3012 — Rehabilitar Cuota (RECHAZADA → A_REHABILITAR → REHABILITADA), vía
// API (sin pantalla propia). Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// Usa PLANES_CONOCIDOS.paraRehabilitar (plan dedicado, separado de `vigente`)
// — no comparte plan con F3003_caducidad_por_solicitud.spec.js. Motivo real
// (2026-08-20): GenerarDebitoCuotaPorSolicitud solo persiste algo real para
// cuotas dentro de una ventana de anticipación corta — la cuota 4 de un plan
// de 4 cuotas (vencimiento en diciembre) respondía 200 pero no generaba nada
// en Mongo; una cuota más cercana (noviembre) sí. Un plan aparte con una
// cuota bien próxima evita ese límite y evita pisarse con F3003.
//
// ⚠ MUTA datos reales: si la cuota no está en NO_VENCIDA, este test puede no
// reproducir tal cual (una cuota ya RECHAZADA/A_REHABILITAR se salta el paso
// de rechazo y va directo a intentar rehabilitar).
// En QA_AV el servicio Tracer (txsapi) devuelve 200 con body vacío incluso
// autenticado — esperarIdDebito() nunca encuentra nada ahí. Fallback a
// mongoAdmin.obtenerIdDebito() (ver F3010_pago_directo.spec.js).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { obtenerIdDebito } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CONTRIBUYENTES } = require('../../../fixtures/test-data');

const NUMERO_CUOTA_A_REHABILITAR = 1;

test(`TC_REG_F3012_001 — rechazar cuota ${NUMERO_CUOTA_A_REHABILITAR} y rehabilitarla (RECHAZADA → REHABILITADA)`, async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.paraRehabilitar, 'Requiere PLANES_CONOCIDOS.paraRehabilitar en fixtures/test-data.js');

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

  const venc1ISO = cuota.vencimientoCuota1.includes('/')
    ? cuota.vencimientoCuota1.split('/').reverse().join('-')
    : cuota.vencimientoCuota1;

  // Paso 1 — si todavía no está rechazada, la rechazamos con un F3010 de pago erróneo
  if (cuota.estadoCuota === 'NO_VENCIDA') {
    const emitir = cliente.buscarEmitirDRG(venc1ISO);
    expect(emitir, `Debe existir EmitirDRG para vencimiento ${venc1ISO}`).toBeTruthy();

    const debito = await cliente.generarDebitoCuotaPorSolicitud({
      idSolicitud: PLANES_CONOCIDOS.paraRehabilitar,
      fecha: emitir,
      esPrimerIntento: true,
    });
    console.log(`TC_REG_F3012_001 — GenerarDebitoCuotaPorSolicitud: ok=${debito.ok} status=${debito.status} body=${JSON.stringify(debito.body).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 1500));

    let idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
    if (!idDebito) {
      console.log('TC_REG_F3012_001 — Tracer no devolvió ID_Debito, probando fallback por Mongo...');
      idDebito = await obtenerIdDebito(cuota.idTracerCuota);
    }
    console.log(`TC_REG_F3012_001 — ID_Debito: ${idDebito ?? '(ninguno, se registra con 0)'}`);
    expect(idDebito, 'Debe conseguirse un ID_Debito real antes de rechazar (si no, RegistrarFormulario da "Duplicate document")').toBeTruthy();

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
    solicitud: PLANES_CONOCIDOS.paraRehabilitar,
  });
  const cuotaFinal = (detalleFinal?.cuotas ?? []).find(c => Number(c.numeroCuota) === NUMERO_CUOTA_A_REHABILITAR);
  console.log(`TC_REG_F3012_001 — cuota ${NUMERO_CUOTA_A_REHABILITAR} después: estado=${cuotaFinal?.estadoCuota}`);
  expect(cuotaFinal?.estadoCuota).toBe('REHABILITADA');
});
