// tests/regression/pfp-api/F3012_rehabilitar_cuota.spec.js
// F3012 — Rehabilitar Cuota (RECHAZADA → A_REHABILITAR → REHABILITADA), vía
// API (sin pantalla propia). Ver memoria pfp-formularios-catalogo / pfp-api-endpoints.
//
// MECANISMO REAL (confirmado por el usuario 2026-08-20):
//   1. Rechazar la cuota en su 1° Y 2° vencimiento — DOS rechazos sobre la
//      MISMA cuota. Recién con los dos el estado pasa de RECHAZADA a A_REHABILITAR.
//   2. ObtenerRehabilitacionCuota?idCuota=... (informativo, confirma que está lista).
//   3. GenerarRehabilitacionCuota?idCuota=...&idPlan=... (real, rehabilita).
// NO hace falta (ni funciona) RegistrarFormulario?formulario=3012.
//
// ⚠⚠⚠ NUNCA usar la cuota 1: rechazarla dispara F3011 (Nulidad automática)
// del PLAN ENTERO. primeraCuotaLibre() sólo devuelve cuotas 2+.
//
// 2026-10-14: el plan sale de lib/fabricaPlanes.js (receta "paraCuotas",
// compartida con F3014) y cada corrida usa la primera cuota 2+ sin tocar —
// antes usaba siempre la cuota 2 de PLANES_CONOCIDOS.paraRehabilitar, que una
// vez rehabilitada dejaba el test roto para siempre. Los rechazos van por
// api-publicador (débito + GenerarPagoCuotas con pagoRechazado), el mismo
// camino que el simulador del banco; el estado se lee de Mongo. El CUIT sale
// del propio plan, no de una constante.
//
// ⚠ MUTA datos reales: consume una cuota del plan por corrida.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { planParaCuotas, primeraCuotaLibre, estadoPlan, operarCuota } = require('../../../lib/fabricaPlanes');
const { SIGN_CCT } = require('../../../fixtures/test-data');

test('TC_REG_F3012_001 — rechazar una cuota en ambos vencimientos y rehabilitarla', async ({ page, request }) => {
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env (la fábrica de planes valida el estado en Mongo)');
  test.setTimeout(240000);

  const solicitud = await planParaCuotas(page);
  test.skip(!solicitud, 'Sin plan VIGENTE con cuotas 2+ libres y NO_FABRICAR=1');

  const cuota = await primeraCuotaLibre(solicitud);
  expect(cuota.nro, 'NUNCA usar cuota 1 — dispara Nulidad automática del plan (F3011)').toBeGreaterThan(1);
  console.log(`TC_REG_F3012_001 — plan ${solicitud}, cuota ${cuota.nro}`);

  const cliente = new PfpApiClient(request, 'qa-av');
  const estadoCuota = async () => (await estadoPlan(solicitud)).cuotas.find(c => c.nro === cuota.nro).estado;

  await operarCuota(cliente, solicitud, cuota.nro, { resultado: 'rechazo', vencimiento: 1 });
  expect(await estadoCuota(), 'Tras el rechazo del 1° vencimiento').toBe('RECHAZADA');

  await operarCuota(cliente, solicitud, cuota.nro, { resultado: 'rechazo', vencimiento: 2 });
  expect(await estadoCuota(), 'Tras el rechazo del 2° vencimiento').toBe('A_REHABILITAR');

  const { cuit, plan } = await estadoPlan(solicitud);
  await cliente.autenticar(cuit, SIGN_CCT);

  // Paso 2 — ObtenerRehabilitacionCuota (informativo, confirma que está lista)
  const infoRehab = await cliente.obtenerRehabilitacionCuota(cuota.doc._id);
  console.log(`TC_REG_F3012_001 — ObtenerRehabilitacionCuota: ${JSON.stringify(infoRehab)}`);
  expect(infoRehab?.codigo).toBe(1);

  // Paso 3 — GenerarRehabilitacionCuota (real)
  const rehabilitacion = await cliente.generarRehabilitacionCuota({ idCuota: cuota.doc._id, idPlan: plan._id });
  console.log(`TC_REG_F3012_001 — GenerarRehabilitacionCuota: ${JSON.stringify(rehabilitacion)}`);

  await new Promise(r => setTimeout(r, 1500));
  expect(await estadoCuota()).toBe('REHABILITADA');
});
