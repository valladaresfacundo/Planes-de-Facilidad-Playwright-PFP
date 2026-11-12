// lib/deudaEjecucion.js
// Deuda de los CUITs de ejecución (CUITS_EJECUCION en fixtures/test-data.js).
// Los tests que generan planes (F3001, fábrica de planes, BUG_REDONDEO)
// consumen un período de deuda por plan: antes de usar un CUIT se cuentan sus
// períodos de IIBB Convenio Multilateral con capital suficiente y, si quedan
// menos del mínimo, se carga deuda nueva con la DJ 5866 (lib/cargaFormularios.js).
//
// Requiere MONGO_URI (los períodos ya cargados se leen de DocumentsRepo.5866).
const { PfpApiClient } = require('./pfpApiClient');
const { cargarFormulario, periodosLibres } = require('./cargaFormularios');
const { CUITS_EJECUCION, SIGN_CCT } = require('../fixtures/test-data');

// Planes por corrida: F3001 genera ~5 y la fábrica hasta 4 → con 6 alcanza para una corrida entera
const MINIMO_PERIODOS = Number(process.env.DEUDA_MINIMA_PERIODOS || 6);
// La fábrica tilda el primer período con capital >= $1M (con menos no alcanza el mínimo por cuota)
const CAPITAL_MINIMO = 1000000;
const DEUDA_POR_PERIODO = 5000000;
const espera = ms => new Promise(r => setTimeout(r, ms));

/** Períodos (YYYYMM00) de IIBB CM que el portal ofrece para acoger con capital >= `capitalMinimo`. */
async function periodosConDeuda(request, cuit, { capitalMinimo = CAPITAL_MINIMO } = {}) {
  const cliente = new PfpApiClient(request, 'qa-av');
  await cliente.autenticar(cuit, SIGN_CCT);
  const deudas = await cliente.obtenerDeudasParaAcoger({ cuit });
  return deudas
    .filter(d => d.concepto === 'CAPITAL' && !d.disabled && Number(d.importe) >= capitalMinimo)
    .map(d => d.periodo);
}

/**
 * Deja al CUIT con al menos `minimo` períodos con deuda: si tiene menos, carga
 * DJ 5866 de $5M en los períodos libres más recientes de la ventana y espera a
 * que el portal los ofrezca (la DJ queda "Queued" unos segundos). Devuelve la
 * cantidad final, que puede quedar corta si el CUIT agotó la ventana.
 */
async function asegurarDeuda(request, cuit, { minimo = MINIMO_PERIODOS } = {}) {
  const actuales = (await periodosConDeuda(request, cuit)).length;
  if (actuales >= minimo) return actuales;

  const libres = await periodosLibres(cuit);
  let cargados = 0;
  for (const { anio, mes } of libres) {
    if (actuales + cargados >= minimo) break;
    const [resultado] = await cargarFormulario(request, '5866', { cuits: cuit, anio, meses: [mes], deuda: DEUDA_POR_PERIODO });
    if (resultado.ok) cargados++;
  }
  console.log(`asegurarDeuda — CUIT ${cuit}: ${actuales} períodos con deuda, ${cargados} cargados (5866), ${libres.length - cargados} libres en la ventana`);
  if (!cargados) return actuales;

  let total = actuales;
  for (let i = 0; i < 12 && total < actuales + cargados; i++) {
    await espera(5000);
    total = (await periodosConDeuda(request, cuit)).length;
  }
  return total;
}

/**
 * Primer CUIT de CUITS_EJECUCION que queda con deuda (cargándola si le quedan
 * pocos períodos). Cuando uno agota la ventana de la 5866 se pasa al siguiente.
 */
async function cuitConDeuda(request) {
  for (const cuit of CUITS_EJECUCION) {
    if (await asegurarDeuda(request, cuit) > 0) return cuit;
  }
  throw new Error(`cuitConDeuda — ningún CUIT de CUITS_EJECUCION (${CUITS_EJECUCION.join(', ')}) tiene deuda ni períodos libres para cargarla (5866)`);
}

module.exports = { periodosConDeuda, asegurarDeuda, cuitConDeuda, MINIMO_PERIODOS };
