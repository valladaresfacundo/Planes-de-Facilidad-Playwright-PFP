// lib/fabricaPlanes.js
// Fábrica de planes de prueba: cada test pide un plan en el estado que
// necesita en vez de depender de un número fijo en PLANES_CONOCIDOS que otro
// test (o una corrida anterior) ya dejó en otro estado.
//
//   const solicitud = await obtenerPlan({ clave, valido, fabricar })
//
// 1. Prueba los candidatos conocidos (fixtures/planes-runtime.json, después
//    PLANES_CONOCIDOS[clave]) y devuelve el primero que cumple `valido(estado)`
//    — leído de Mongo, no de la API.
// 2. Si ninguno sirve, llama `fabricar()` (genera un plan nuevo por el
//    Portal y lo lleva al estado pedido vía api-publicador) y lo guarda en
//    planes-runtime.json para que la próxima corrida lo reuse mientras siga
//    sirviendo.
//
// ⚠ Fabricar un plan CONSUME un período de deuda real del CUIT
// (CONTRIBUYENTES.conPlan) — los tests de solo lectura reusan su plan entre
// corridas; sólo los que lo consumen (ej. F3008) fabrican cada vez. Con
// NO_FABRICAR=1 no se genera nada: el test se saltea con un mensaje claro.
const fs = require('fs');
const path = require('path');
const { LoginPage } = require('../pages/LoginPage');
const { PFPPage } = require('../pages/PFPPage');
const { buscarPlanPorSolicitud, estadoActual } = require('./mongoAdmin');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../fixtures/test-data');

const RUNTIME = path.join(__dirname, '..', 'fixtures', 'planes-runtime.json');
const espera = ms => new Promise(r => setTimeout(r, ms));

// planes-runtime.json: { clave: ["solicitud", ...] } — repuestos por receta,
// en orden de uso. Se pueden agregar a mano planes existentes que ya cumplan
// la receta (así no se gasta deuda); los que dejan de servir se descartan solos.
function leerRuntime() {
  try { return JSON.parse(fs.readFileSync(RUNTIME, 'utf8')); } catch { return {}; }
}

function escribirRuntime(clave, solicitudes) {
  const datos = leerRuntime();
  datos[clave] = [...new Set(solicitudes.map(String))];
  fs.writeFileSync(RUNTIME, JSON.stringify(datos, null, 2));
}

/**
 * Estado de un plan leído de Mongo: { solicitud, plan (doc quota:0), estado,
 * cuit, cuotas: [{ nro, estado, debito, doc }] } — null si no existe.
 */
async function estadoPlan(solicitud) {
  const docs = await buscarPlanPorSolicitud(solicitud);
  const plan = docs.find(d => d.quota === 0);
  if (!plan) return null;
  return {
    solicitud: String(solicitud),
    plan,
    estado: estadoActual(plan, 'PFP'),
    cuit: String(plan.idPerson),
    cuotas: docs.filter(d => d.quota > 0).map(d => ({
      nro: d.quota,
      estado: estadoActual(d, 'PFP_Cuota'),
      debito: estadoActual(d, 'PFP_Cuota_Debito'),
      doc: d,
    })),
  };
}

/** Cuota "sin tocar": no vencida y sin ningún débito enviado. */
const cuotaLibre = c => c.estado === 'NO_VENCIDA' && c.debito === 'NO_ENVIADO';

async function obtenerPlan({ clave, valido, fabricar }) {
  const repuestos = [].concat(leerRuntime()[clave] ?? []).map(String);
  const candidatos = [...new Set([...repuestos, PLANES_CONOCIDOS[clave]].filter(Boolean).map(String))];
  const descartados = [];
  try {
    for (const solicitud of candidatos) {
      const estado = await estadoPlan(solicitud);
      if (estado && valido(estado)) {
        console.log(`fabricaPlanes — "${clave}": reuso ${solicitud} (${estado.estado})`);
        return solicitud;
      }
      descartados.push(solicitud);
      console.log(`fabricaPlanes — "${clave}": ${solicitud} ya no sirve (${estado?.estado ?? 'no existe'})`);
    }
    if (process.env.NO_FABRICAR === '1') return null;
    const solicitud = await fabricar();
    const estado = await estadoPlan(solicitud);
    if (!estado || !valido(estado)) {
      throw new Error(`fabricaPlanes — "${clave}": el plan fabricado ${solicitud} no quedó en el estado esperado (${estado?.estado})`);
    }
    repuestos.unshift(solicitud);
    console.log(`fabricaPlanes — "${clave}": fabricado ${solicitud}`);
    return solicitud;
  } finally {
    escribirRuntime(clave, repuestos.filter(s => !descartados.includes(s)));
  }
}

/**
 * Carga $5.000.000 de deuda de Convenio Multilateral en el próximo período
 * libre del CUIT (DJ 5866) y espera a que se procese (la registración queda
 * "Queued" y tarda unos segundos en verse en el portal).
 */
async function cargarDeudaParaPlan(request, cuit) {
  const { proximoPeriodoLibre, cargarFormulario } = require('./cargaFormularios');
  const libre = await proximoPeriodoLibre(cuit);
  if (!libre) throw new Error(`cargarDeudaParaPlan — el CUIT ${cuit} no tiene períodos libres para cargar deuda (5866)`);
  const [resultado] = await cargarFormulario(request, '5866', { cuits: cuit, anio: libre.anio, meses: [libre.mes], deuda: 5000000 });
  if (!resultado.ok) throw new Error(`cargarDeudaParaPlan — la carga 5866 ${libre.anio}/${libre.mes} falló: ${JSON.stringify(resultado.respuesta).slice(0, 200)}`);
  await espera(20000);
}

/**
 * Genera un plan 461/AGIP/25 real por el Portal Contribuyente (QA_AV) con el
 * primer período que tenga capital > $0, y devuelve el Nro. de solicitud.
 * Usa una pestaña propia — no interfiere con la que use después el test.
 */
async function generarPlanPorUI(page, { cuotas = 3, cuit = CONTRIBUYENTES.conPlan.cuit } = {}) {
  const loginPage = new LoginPage(page);
  await loginPage.login(AMBIENTES.QA_AV, cuit, SIGN_CCT);
  const portal = loginPage.obtenerPagina();
  const pfpPage = new PFPPage(portal);

  // Tilda el primer período con capital >= $1.000.000 (los chicos no alcanzan
  // el importe mínimo por cuota). Si no hay ninguno, carga deuda nueva (DJ
  // 5866, ver lib/cargaFormularios.js) en el próximo período libre y reintenta.
  let tildado = false;
  for (let intento = 0; intento < 2 && !tildado; intento++) {
    if (intento > 0) await cargarDeudaParaPlan(page.request, cuit);
    await pfpPage.irAPlanesYMoratoria();
    await pfpPage.consultarDeudaConFallback({
      tipoPlan: '461/AGIP/25',
      operacion: 'Nuevo plan de facilidades',
      impuestoPreferido: 'IIBB - Convenio Multilateral',
      impuestosFallback: [],
    }).catch(() => null);
    const filas = portal.locator('table tbody tr');
    for (let i = 0; i < await filas.count() && !tildado; i++) {
      const columnas = (await filas.nth(i).innerText()).split('\t').filter(Boolean);
      if (columnas.find(c => /^\$\s*\d{1,3}(\.\d{3}){2,}/.test(c.trim()))) {
        await filas.nth(i).locator('.v-simple-checkbox > .v-input--selection-controls__input > .v-icon').click();
        tildado = true;
      }
    }
  }
  if (!tildado) throw new Error('generarPlanPorUI — el CUIT no tiene períodos con deuda y la carga automática (5866) no la generó');
  await portal.getByRole('button', { name: 'Continuar' }).last().click();
  await portal.waitForLoadState('networkidle');

  await pfpPage.seleccionarCuotas(`${cuotas} cuotas`);
  await portal.waitForTimeout(1500);
  if (await portal.getByText('no alcanza el importe mínimo').isVisible().catch(() => false)) {
    throw new Error(`generarPlanPorUI — con ${cuotas} cuotas el período no alcanza el importe mínimo`);
  }
  await portal.getByRole('button', { name: 'Continuar' }).last().click();
  await portal.waitForLoadState('networkidle');

  for (const [campo, valor] of [['Titular de Cuenta', 'fabrica planes qa'], ['CUIT', cuit], ['CBU', '0065639511100051073131']]) {
    await portal.getByRole('textbox', { name: campo }).fill(valor);
    await portal.getByRole('textbox', { name: campo }).press('Tab');
  }
  await portal.getByRole('button', { name: 'Continuar' }).last().click();
  await portal.waitForLoadState('networkidle');

  const checkbox = portal.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
  await checkbox.waitFor({ state: 'visible', timeout: 10000 });
  await checkbox.click();
  await portal.getByRole('button', { name: 'Confirmar' }).click();
  await portal.waitForLoadState('networkidle');
  await portal.getByRole('button', { name: 'Descargar' }).waitFor({ state: 'visible', timeout: 30000 });

  const solicitud = ((await portal.locator('body').innerText()).match(/\b\d{10}\b/) || [])[0];
  if (!solicitud) throw new Error('generarPlanPorUI — no se pudo leer el Nro. de solicitud de la pantalla de resultado');
  await portal.close();
  // El tracer puede tardar en aparecer en Mongo
  for (let i = 0; i < 10 && !(await estadoPlan(solicitud)); i++) await espera(1500);
  console.log(`generarPlanPorUI — plan ${solicitud} generado (${cuotas} cuotas)`);
  return solicitud;
}

/**
 * Débito + pago (o rechazo) de una cuota vía api-publicador — el mismo camino
 * que el simulador del banco. `vencimiento` 1 = primer intento, 2 = reintento
 * sobre el 2° vencimiento (después de un rechazo). Devuelve el transaction del
 * F3010 registrado. Dos rechazos (venc 1 y 2) dejan la cuota en A_REHABILITAR;
 * un rechazo de la cuota 1 dispara la nulidad del plan (F3011).
 * @param {import('./pfpApiClient').PfpApiClient} cliente
 */
async function operarCuota(cliente, solicitud, nroCuota, { resultado = 'pago', vencimiento = 1 } = {}) {
  const cuota = (await estadoPlan(solicitud)).cuotas.find(c => c.nro === nroCuota);
  const venc = (vencimiento === 2 ? cuota.doc.content.Fecha_Segundo_Vencimiento : cuota.doc.content.Fecha_Primer_Vencimiento)
    .toISOString().slice(0, 10);
  const fecha = cliente.buscarEmitirDRG(venc);
  if (!fecha) throw new Error(`operarCuota — no hay EmitirDRG para el vencimiento ${venc} (cuota ${nroCuota})`);

  const debito = await cliente.generarDebitoCuotaPorSolicitud({ idSolicitud: solicitud, fecha, esPrimerIntento: vencimiento === 1 });
  if (!debito.ok) throw new Error(`operarCuota — débito cuota ${nroCuota} falló: HTTP ${debito.status} ${JSON.stringify(debito.body)}`);
  // Con vencimientos muy lejanos el servicio responde 200 pero no persiste el
  // débito (ver memoria pfp-roadmap-fases) — cortar con un error claro si no aparece.
  const trasDebito = await esperarCuota(solicitud, nroCuota, c => c.debito === 'DEBITO_ENVIADO');
  if (trasDebito.debito !== 'DEBITO_ENVIADO') {
    throw new Error(`operarCuota — el débito de la cuota ${nroCuota} no quedó registrado (débito: ${trasDebito.debito}) — respuesta: ${JSON.stringify(debito.body).slice(0, 200)}`);
  }

  const pago = await cliente.generarPagoCuotas({ fechaEmisionDGR: fecha, idSolicitud: solicitud, pagoRechazado: resultado === 'rechazo' });
  const transaction = pago?.respuestaMasivo?.[0]?.transaction;
  // El F3010 se procesa por cola: con el ambiente cargado tarda (visto 2026-10-16,
  // ~1 min). Esperar a que el débito deje de estar DEBITO_ENVIADO.
  const final = await esperarCuota(solicitud, nroCuota, c => c.debito !== 'DEBITO_ENVIADO');
  if (final.debito === 'DEBITO_ENVIADO') {
    throw new Error(`operarCuota — el ${resultado} de la cuota ${nroCuota} (F3010 ${transaction}) no se procesó en ${ESPERA_MAX_MS / 1000} s`);
  }
  console.log(`operarCuota — ${solicitud} cuota ${nroCuota} ${resultado} (venc ${vencimiento}, emisión ${fecha}): transaction ${transaction} → ${final.estado}/${final.debito}`);
  return transaction;
}

const ESPERA_MAX_MS = 90000;

/** Consulta Mongo hasta que la cuota cumpla `condicion` (o se agote ESPERA_MAX_MS); devuelve su último estado. */
async function esperarCuota(solicitud, nroCuota, condicion) {
  const limite = Date.now() + ESPERA_MAX_MS;
  for (;;) {
    await espera(2000);
    const cuota = (await estadoPlan(solicitud)).cuotas.find(c => c.nro === nroCuota);
    if (condicion(cuota) || Date.now() > limite) return cuota;
  }
}

// ─── Recetas compartidas ─────────────────────────────────────────────────────
// Una clave por tipo de plan: los tests que necesitan el mismo estado piden la
// misma receta y comparten el plan. `request` es el fixture de Playwright,
// sólo hace falta en las recetas que operan cuotas.

/** VIGENTE, 3+ cuotas, ninguna tocada. Solo lectura (F3005 negativo, F3007): se reusa entre corridas. */
function planSinTocar(page) {
  return obtenerPlan({
    clave: 'sinTocar',
    valido: e => e.estado === 'VIGENTE' && e.cuotas.length >= 3 && e.cuotas.every(cuotaLibre),
    fabricar: () => generarPlanPorUI(page, { cuotas: 3 }),
  });
}

/** VIGENTE, cuota 1 PAGADA y el resto sin tocar (F3005 positivo): solo lectura, se reusa. */
function planCuota1Paga(page, request) {
  return obtenerPlan({
    clave: 'cuota1Paga',
    valido: e => e.estado === 'VIGENTE' && e.cuotas.length >= 3
      && e.cuotas[0].estado === 'PAGADA' && e.cuotas[0].debito === 'DEBITADO'
      && e.cuotas.slice(1).every(cuotaLibre),
    fabricar: async () => {
      const { PfpApiClient } = require('./pfpApiClient');
      const solicitud = await generarPlanPorUI(page, { cuotas: 3 });
      await operarCuota(new PfpApiClient(request, 'qa-av'), solicitud, 1, { resultado: 'pago' });
      return solicitud;
    },
  });
}

/** VIGENTE, 3+ cuotas, cuotas 2+ sin tocar (F3008 — lo consume: CA_PAGADA al final). */
function planParaCA(page) {
  return obtenerPlan({
    clave: 'paraCancelacionAnticipada',
    valido: e => e.estado === 'VIGENTE' && e.cuotas.length >= 3
      && (cuotaLibre(e.cuotas[0]) || (e.cuotas[0].estado === 'PAGADA' && e.cuotas[0].debito === 'DEBITADO'))
      && e.cuotas.slice(1).every(cuotaLibre),
    fabricar: () => generarPlanPorUI(page, { cuotas: 3 }),
  });
}

/** NULO (F3013 por UI, que no confirma la reversa): se reusa mientras siga NULO. */
function planNulo(page, request) {
  return obtenerPlan({
    clave: 'nulo',
    valido: e => e.estado === 'NULO',
    fabricar: async () => {
      const { PfpApiClient } = require('./pfpApiClient');
      const solicitud = await generarPlanPorUI(page, { cuotas: 3 });
      // Rechazar la cuota 1 dispara F3011 (Nulidad automática) del plan entero
      await operarCuota(new PfpApiClient(request, 'qa-av'), solicitud, 1, { resultado: 'rechazo' });
      return solicitud;
    },
  });
}

/**
 * VIGENTE con al menos una cuota 2+ sin tocar (F3012, F3014). Cada corrida usa
 * la siguiente cuota libre — un plan de 12 cuotas alcanza para varias corridas.
 */
function planParaCuotas(page) {
  return obtenerPlan({
    clave: 'paraCuotas',
    valido: e => e.estado === 'VIGENTE' && e.cuotas.some(c => c.nro >= 2 && cuotaLibre(c)),
    fabricar: () => generarPlanPorUI(page, { cuotas: 12 }),
  });
}

/** Primera cuota 2+ sin tocar (nunca la 1: rechazarla anula el plan). */
async function primeraCuotaLibre(solicitud) {
  return (await estadoPlan(solicitud)).cuotas.find(c => c.nro >= 2 && cuotaLibre(c));
}

module.exports = {
  obtenerPlan, estadoPlan, cuotaLibre, generarPlanPorUI, operarCuota, primeraCuotaLibre,
  planSinTocar, planCuota1Paga, planParaCA, planNulo, planParaCuotas,
};
