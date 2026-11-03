// tests/regression/pfp-api/BUG_52821_pago_sobre_plan_caduco.spec.js
// Reproducción del ticket 52821 (producción, contribuyente 20438194135,
// plan 1583008096) — ver memoria pfp-roadmap-fases para el análisis
// completo y la causa raíz confirmada.
//
// RESUMEN DEL TICKET: se rehabilitaron las cuotas 2 y 6 con débito
// programado a futuro (07/07); el plan caducó igual (26/07); el archivo de
// débitos del 12/08 igual envió a debitar esas cuotas rehabilitadas; el
// 25/08 se impactó el pago igual, generando una inconsistencia contable
// (2 movimientos por cuota, ambos reflejando el importe total en vez de
// discriminar cuota/interés).
//
// CAUSA RAÍZ CONFIRMADA (leyendo Param.RulePackage en Mongo, no es
// especulación): la regla de validación de F3010 (`RegistrarFormulario?
// formulario=3010`, el mismo endpoint que se usa para pagar/rechazar
// cualquier cuota) SOLO valida que la CUOTA no esté ya PAGADA
// (`Validar_cuota`) — NUNCA valida el estado del PLAN. Comparar con F3003
// (caducidad), que sí valida `estado !== "VIGENTE"` antes de actuar. F3010
// no tiene ese control equivalente, así que acepta y procesa un pago real
// sobre una cuota de un plan CADUCO (o NULO, o CANCELADO) sin ningún error.
//
// Esto EXPLICA el 2° y 3° punto del ticket: nada impide que el archivo de
// débitos y el impacto de pago posterior se ejecuten sobre un plan que ya
// caducó. Además, como F3003 (caducidad) tiene su propia regla
// `registro_Cuotas` que ya generó movimientos contables (901 total + 905
// interés) para esa misma cuota al momento de caducar (por estar impaga en
// ese momento), un pago posterior real vía F3010 agrega OTRO set de
// movimientos (902/906/907) para la misma cuota — dos registros contables
// superpuestos para un mismo hecho, consistente con la inconsistencia
// reportada por negocio.
//
// El 1er punto del ticket (por qué el proceso de caducidad avanzó pese a
// una rehabilitación con débito pendiente) no se pudo confirmar por código
// — la elegibilidad de qué planes caducan vive en C# compilado
// (PFPNeg.GenerarCaducidades), no en las reglas de Mongo.
//
// ESTE TEST DOCUMENTA EL BUG A PROPÓSITO: asume el comportamiento CORRECTO
// esperado (F3010 debería rechazar un pago sobre un plan que no está
// VIGENTE) — HOY FALLA, porque el bug todavía existe (confirmado en vivo
// 2026-09-11, plan 1543000154, transaction 648258: se pagó una cuota
// REHABILITADA/DEBITO_ENVIADO de un plan CADUCO sin ningún error). Sirve
// como criterio de aceptación: debería empezar a pasar solo, sin tocarlo,
// el día que el backend agregue la validación de estado de plan a F3010.
//
// Self-contained: si el plan no está CADUCO todavía, lo caduca de verdad
// primero (mismo mecanismo que F3003_caducidad_por_solicitud.spec.js).
//
// ⚠ MUTA datos reales: si el bug sigue presente, esto paga de verdad una
// cuota de un plan caduco (mismo efecto que el ticket real).
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../../lib/pfpApiClient');
const { actualizarFechasCuota, buscarPlanPorSolicitud: buscarPlanEnMongo, estadoActual, obtenerIdDebito } = require('../../../lib/mongoAdmin');
const { SIGN_CCT, PLANES_CONOCIDOS, CUIT_AUTENTICADO } = require('../../../fixtures/test-data');

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
  await cliente.generarDebitoCuotaPorSolicitud({ idSolicitud: resumen.content.IDSolicitud, fecha: emitir, esPrimerIntento: true });
  await new Promise(r => setTimeout(r, 1500));
  let idDebito = await cliente.esperarIdDebito(cuota.idTracerCuota);
  if (!idDebito) idDebito = await obtenerIdDebito(cuota.idTracerCuota);
  const payload = cliente.construirPayloadF3010({
    cuit: CUIT_AUTENTICADO,
    cuota: { ...cuota, vencimientoCuota1: venc1ISO },
    resumenPlan: resumen,
    correcto,
    idDebito: idDebito || 0,
  });
  return cliente.registrarPagoCuota3010(payload);
}

test('BUG_52821 — F3010 no debería aceptar el pago de una cuota si el plan no está VIGENTE', async ({ request }) => {
  // Marca este test como "falla esperada" (ticket 52821, bug real
  // confirmado 2026-09-11) — así no rompe la suite mientras el bug siga
  // presente. El día que el backend agregue la validación de estado de
  // plan a F3010, este test va a empezar a PASAR solo, y Playwright lo va
  // a reportar como una alerta ("expected to fail, but passed") — señal de
  // que hay que sacar este test.fail() y dejarlo como regresión normal.
  test.fail(true, 'Bug real confirmado — ticket 52821, ver comentario del archivo. F3010 no valida el estado del plan.');

  test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env — ver .env.example y lib/mongoAdmin.js');

  const idSolicitud = PLANES_CONOCIDOS.vigente;
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: idSolicitud,
  });
  const cuotas = detalle?.cuotas ?? [];
  const cuota1 = cuotas.find(c => Number(c.numeroCuota) === 1);
  const cuota2 = cuotas.find(c => Number(c.numeroCuota) === 2);
  const cuota3 = cuotas.find(c => Number(c.numeroCuota) === 3);
  expect(cuota1 && cuota2 && cuota3, 'El plan debe tener al menos 3 cuotas').toBeTruthy();

  let docs = await buscarPlanEnMongo(idSolicitud);
  let plan = docs.find(d => d.quota === 0);

  if (estadoActual(plan, 'PFP') !== 'CADUCO') {
    // Mismo proceso que F3003_caducidad_por_solicitud.spec.js — llevar el
    // plan a CADUCO de verdad primero.
    if (cuota1.estadoCuota !== 'PAGADA') {
      await pagarORechazar(cliente, { resumen, cuota: cuota1, correcto: true });
      await new Promise(r => setTimeout(r, 1500));
    }
    if (cuota2.estadoCuota === 'NO_VENCIDA') await pagarORechazar(cliente, { resumen, cuota: cuota2, correcto: false });
    if (cuota3.estadoCuota === 'NO_VENCIDA') await pagarORechazar(cliente, { resumen, cuota: cuota3, correcto: false });
    await new Promise(r => setTimeout(r, 1500));

    const vencCuota2 = fechaISO(120);
    const vencCuota3 = fechaISO(90);
    await actualizarFechasCuota(cuota2.idTracerCuota, {
      fechaPrimerVencimiento: vencCuota2, fechaSegundoVencimiento: fechaISO(107),
      fechaDebito: vencCuota2, fechaEmisionDRG: cliente.buscarEmitirDRG(vencCuota2),
    });
    await actualizarFechasCuota(cuota3.idTracerCuota, {
      fechaPrimerVencimiento: vencCuota3, fechaSegundoVencimiento: fechaISO(75),
      fechaDebito: vencCuota3, fechaEmisionDRG: cliente.buscarEmitirDRG(vencCuota3),
    });

    const resultadoCaducidad = await cliente.generarCaducidadPorSolicitud({ solicitud: idSolicitud, fecha: fechaISO(0) });
    console.log(`BUG_52821 — GenerarCaducidadPorSolicitud: ${JSON.stringify(resultadoCaducidad)}`);

    await new Promise(r => setTimeout(r, 1500));
    docs = await buscarPlanEnMongo(idSolicitud);
    plan = docs.find(d => d.quota === 0);
    expect(estadoActual(plan, 'PFP'), 'Precondición del test: el plan debe quedar CADUCO').toBe('CADUCO');
  }
  console.log(`BUG_52821 — plan ${idSolicitud} confirmado CADUCO — cuota 2: ${estadoActual(docs.find(d => d.quota === 2), 'PFP_Cuota')} | cuota 3: ${estadoActual(docs.find(d => d.quota === 3), 'PFP_Cuota')}`);

  // Intento real de pago sobre una cuota RECHAZADA del plan ya CADUCO —
  // esto es lo que el ticket 52821 reporta que NO debería suceder. Elegimos
  // dinámicamente cuota 2 o 3 (la que siga sin PAGAR) para que el test
  // tenga más de una vida antes de necesitar un plan de reemplazo.
  const candidata = [2, 3]
    .map(n => docs.find(d => d.quota === n))
    .find(d => estadoActual(d, 'PFP_Cuota') !== 'PAGADA');
  test.skip(!candidata, `Las cuotas 2 y 3 de ${idSolicitud} ya están PAGADA — pedir un plan CADUCO nuevo con alguna cuota sin pagar para PLANES_CONOCIDOS.vigente.`);
  const numeroCuota = candidata.quota;

  // ⚠ Importante: hay que generar un ID_Debito NUEVO acá (no reusar el que
  // ya haya quedado de una corrida anterior) — si se reusa uno viejo, F3010
  // lo rechaza por "Duplicate document" (un check distinto, de idempotencia)
  // y el test daría un falso positivo sin haber probado nada sobre el
  // estado del plan.
  const venc1ISO = new Date(candidata.content.Fecha_Primer_Vencimiento).toISOString().slice(0, 10);
  const emitirCuota = cliente.buscarEmitirDRG(venc1ISO);
  await cliente.generarDebitoCuotaPorSolicitud({ idSolicitud, fecha: emitirCuota, esPrimerIntento: true });
  console.log(`BUG_52821 — GenerarDebitoCuotaPorSolicitud (cuota ${numeroCuota}) sobre plan CADUCO: ¿se generó igual?`);
  await new Promise(r => setTimeout(r, 1500));
  let idDebito = await cliente.esperarIdDebito(candidata._id);
  if (!idDebito) idDebito = await obtenerIdDebito(candidata._id);
  console.log(`BUG_52821 — ID_Debito fresco obtenido: ${idDebito}`);
  const payload = cliente.construirPayloadF3010({
    cuit: CUIT_AUTENTICADO,
    cuota: {
      numeroCuota,
      importeNominal: candidata.content.Importe_Nominal,
      importeActualizado: candidata.content.Importe_Actualizado,
      vencimientoCuota1: venc1ISO,
      idTracerCuota: candidata._id,
    },
    resumenPlan: { _id: plan._id, period: plan.period, tax: plan.tax, content: plan.content },
    correcto: true,
    idDebito: idDebito || candidata.content.ID_Debito,
  });

  let resultado;
  let huboError = false;
  try {
    resultado = await cliente.registrarPagoCuota3010(payload);
    console.log(`BUG_52821 — RegistrarFormulario aceptó el pago (sin validar el plan): ${JSON.stringify(resultado)}`);
  } catch (e) {
    huboError = true;
    console.log(`BUG_52821 — RegistrarFormulario rechazó el pago (comportamiento correcto): ${e.message}`);
  }

  await new Promise(r => setTimeout(r, 2000));
  const docsFinal = await buscarPlanEnMongo(idSolicitud);
  const cuota2Final = docsFinal.find(d => d.quota === numeroCuota);
  const estadoCuota2Final = estadoActual(cuota2Final, 'PFP_Cuota');
  console.log(`BUG_52821 — estado final cuota ${numeroCuota}: ${estadoCuota2Final} (plan sigue: ${estadoActual(docsFinal.find(d => d.quota === 0), 'PFP')})`);

  // Comportamiento CORRECTO esperado: el pago debería haber sido rechazado
  // (por error de API o, como mínimo, sin cambiar el estado de la cuota a
  // PAGADA). HOY esto falla porque el bug real todavía existe.
  expect(huboError || estadoCuota2Final !== 'PAGADA', 'F3010 no debería aceptar un pago sobre un plan que no está VIGENTE — ver ticket 52821').toBe(true);
});
