// tests/regression/pfp-api/F3003_caducidad_por_solicitud.spec.js
// F3003 — Caducidad puntual (VIGENTE → CADUCO) vía GenerarCaducidadPorSolicitud
// (api-publicador) — la alternativa SEGURA al GenerarCaducidades global, que
// impacta TODOS los planes elegibles del ambiente (ver pfp-formularios-catalogo
// / pfp-api-endpoints, NO usar ese otro en ningún test).
//
// Reorganizado 2026-08-19 a partir de la sesión que validó esto por primera
// vez en vivo (ver memoria pfp-roadmap-fases) — automatiza acá el proceso
// manual completo: paga cuota 1, rechaza cuota 2 y cuota 3, backdatea sus
// fechas directo en Mongo (Tracers.TracerInstance — requiere MONGO_URI en
// .env, ver lib/mongoAdmin.js) y recién ahí llama al endpoint puntual.
//
// Regla real de negocio (dato del usuario, no documentado originalmente):
// hacen falta ≥2 cuotas RECHAZADA con vencimientos varios meses en el pasado
// — un gap de ~30 días entre ellas alcanzó en la prueba real, aunque el
// catálogo original hablaba de 60 días exactos. Acá se usa 90/120 días atrás
// respecto a hoy (gap de 30 días entre sí) para tener margen de sobra.
//
// ⚠⚠⚠ MUTA datos reales de forma IRREVERSIBLE: el plan usado queda CADUCO al
// final — consume PLANES_CONOCIDOS.vigente por completo (no vuelve a ser
// VIGENTE salvo con una Reversa de Caducidad real, F3006). No correr esto sin
// tener un plan VIGENTE de sobra para gastar.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { actualizarFechasCuota, buscarPlanPorSolicitud: buscarPlanEnMongo, estadoActual } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, CUIT_AUTENTICADO, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

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
  const idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
  const payload = cliente.construirPayloadF3010({
    cuit: CUIT_AUTENTICADO,
    cuota: { ...cuota, vencimientoCuota1: venc1ISO },
    resumenPlan: resumen,
    correcto,
    idDebito: idDebito || 0,
  });
  return cliente.registrarPagoCuota3010(payload);
}

test('TC_REG_F3003_001 — caducar el plan VIGENTE conocido vía GenerarCaducidadPorSolicitud', async ({ request }) => {
  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env — ver .env.example y lib/mongoAdmin.js');

  const cliente = new PfpApiClient(request, 'qa');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
  });
  const cuotas = detalle?.cuotas ?? [];
  const cuota1 = cuotas.find(c => Number(c.numeroCuota) === 1);
  const cuota2 = cuotas.find(c => Number(c.numeroCuota) === 2);
  const cuota3 = cuotas.find(c => Number(c.numeroCuota) === 3);
  expect(cuota1 && cuota2 && cuota3, 'El plan debe tener al menos 3 cuotas').toBeTruthy();

  // Paso 1 — pagar cuota 1 (regla real: la 1° cuota debe estar paga)
  if (cuota1.estadoCuota !== 'PAGADA') {
    const r = await pagarORechazar(cliente, { resumen, cuota: cuota1, correcto: true });
    console.log(`TC_REG_F3003_001 — pago cuota 1: ${JSON.stringify(r)}`);
    await new Promise(res => setTimeout(res, 1500));
  }

  // Paso 2 — rechazar cuota 2 y cuota 3
  if (cuota2.estadoCuota === 'NO_VENCIDA') {
    const r = await pagarORechazar(cliente, { resumen, cuota: cuota2, correcto: false });
    console.log(`TC_REG_F3003_001 — rechazo cuota 2: ${JSON.stringify(r)}`);
  }
  if (cuota3.estadoCuota === 'NO_VENCIDA') {
    const r = await pagarORechazar(cliente, { resumen, cuota: cuota3, correcto: false });
    console.log(`TC_REG_F3003_001 — rechazo cuota 3: ${JSON.stringify(r)}`);
  }
  await new Promise(res => setTimeout(res, 1500));

  // Paso 3 — backdatear las fechas de cuota 2 y 3 directo en Mongo (90/120 días
  // atrás, 30 días de diferencia entre sí — ver nota de la regla real arriba)
  const vencCuota2 = fechaISO(120);
  const vencCuota3 = fechaISO(90);
  await actualizarFechasCuota(cuota2.idTracerCuota, {
    fechaPrimerVencimiento: vencCuota2,
    fechaSegundoVencimiento: fechaISO(107), // ~13 días después del 1° venc, mismo patrón que el original
    fechaDebito: vencCuota2,
    fechaEmisionDRG: cliente.buscarEmitirDRG(vencCuota2),
  });
  await actualizarFechasCuota(cuota3.idTracerCuota, {
    fechaPrimerVencimiento: vencCuota3,
    fechaSegundoVencimiento: fechaISO(75), // ~15 días después del 1° venc
    fechaDebito: vencCuota3,
    fechaEmisionDRG: cliente.buscarEmitirDRG(vencCuota3),
  });
  console.log(`TC_REG_F3003_001 — fechas backdateadas: cuota2=${vencCuota2} cuota3=${vencCuota3}`);

  // Paso 4 — GenerarCaducidadPorSolicitud (el endpoint puntual y seguro)
  const hoy = fechaISO(0);
  const resultado = await cliente.generarCaducidadPorSolicitud({ solicitud: PLANES_CONOCIDOS.vigente, fecha: hoy });
  console.log(`TC_REG_F3003_001 — GenerarCaducidadPorSolicitud: ${JSON.stringify(resultado)}`);

  // Verificación final — directo en Mongo, ya que ObtenerPlanesDePago puede
  // estar caído (ver memoria pfp-api-endpoints)
  await new Promise(res => setTimeout(res, 1500));
  const docs = await buscarPlanEnMongo(PLANES_CONOCIDOS.vigente);
  const plan = docs.find(d => d.quota === 0);
  console.log(`TC_REG_F3003_001 — estado final: ${estadoActual(plan)}`);
  expect(estadoActual(plan)).toBe('CADUCO');
});
