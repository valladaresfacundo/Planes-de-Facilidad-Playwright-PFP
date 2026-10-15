// lib/oraculoReportePlanes.js
// Oráculo del reporte "Planes de Facilidades" del Portal Agente (AG-791):
// calcula desde Mongo lo que el reporte DEBERÍA devolver, aplicando
// literalmente las reglas de los criterios de aceptación.
//
//   CA03: Tracers.TracerInstance, businessTask = "PFP", content.Instrumento_Legal,
//         año de content.Fecha_Consolidacion, states.state, tax; orden
//         ascendente por fecha de creación.
//   CA04: Razón Social = businessName del padrón (CCT.Padron);
//         Impuesto = descripción corta de la tabla Regimenes.
//   CA01: impuestos por instrumento = PFP_Impuestos_Incluidos + Regimenes.
const { withClient } = require('./mongoAdmin');

const ZONA = 'America/Argentina/Buenos_Aires';

/** Contenido (array) de la última versión de una tabla de Param.Tables (ej. "Regimenes"). */
async function tablaParam(nombre) {
  return withClient(async client => {
    const docs = await client.db('Param').collection('Tables')
      .find({ _id: new RegExp(`^${nombre}_V\\d`) }).toArray();
    if (!docs.length) throw new Error(`oraculo — no existe la tabla ${nombre} en Param.Tables`);
    const version = id => id.match(/_V([\d.]+)$/)[1].split('.').map(Number);
    docs.sort((a, b) => {
      const [x, y] = [version(a._id), version(b._id)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return 0;
    });
    const contenido = docs[0].content;
    return typeof contenido === 'string' ? JSON.parse(contenido) : contenido;
  });
}

/** Descripciones de los impuestos habilitados para un instrumento (en el orden de la tabla). */
async function impuestosPorInstrumento(instrumento) {
  const [incluidos, regimenes] = await Promise.all([tablaParam('PFP_Impuestos_Incluidos'), tablaParam('Regimenes')]);
  return incluidos
    .filter(i => i.Norma === instrumento)
    .map(i => regimenes.find(r => r.Id === i.Impuesto)?.Descripcion ?? `(sin descripción: ${i.Impuesto})`);
}

/** Código de impuesto a partir de su descripción ("IIBB - Convenio Multilateral" → 2). */
async function codigoImpuesto(descripcion) {
  const r = (await tablaParam('Regimenes')).find(x => x.Descripcion === descripcion);
  if (!r) throw new Error(`oraculo — impuesto desconocido: ${descripcion}`);
  return r.Id;
}

/**
 * Planes que el reporte debería listar, en orden (created ascendente).
 * `estado`: 'Vigente' | 'Cancelado' | 'Nulo' | 'Caduco' | 'Todos' (o undefined).
 * `impuesto`: descripción como figura en el filtro (o undefined = todos).
 */
async function planesEsperados({ instrumento, anio, estado, impuesto }) {
  const tax = impuesto && impuesto !== 'Todos' ? await codigoImpuesto(impuesto) : null;
  const regimenes = await tablaParam('Regimenes');
  return withClient(async client => {
    const desde = new Date(`${anio}-01-01T00:00:00-03:00`);
    const hasta = new Date(`${Number(anio) + 1}-01-01T00:00:00-03:00`);
    const q = {
      businessTask: 'PFP',
      'content.Instrumento_Legal': instrumento,
      // Fecha_Consolidacion suele ser Date, pero hay planes con la fecha como
      // string ISO (ej. 1583024404) — se aceptan los dos.
      $or: [
        { 'content.Fecha_Consolidacion': { $gte: desde, $lt: hasta } },
        { 'content.Fecha_Consolidacion': { $regex: `^${anio}-` } },
      ],
    };
    if (tax !== null) q.tax = tax;
    if (estado && estado !== 'Todos') q.states = { $elemMatch: { statechart: 'PFP', state: estado.toUpperCase() } };
    const docs = await client.db('Tracers').collection('TracerInstance')
      .find(q, { projection: { idPerson: 1, tax: 1, created: 1, content: 1 } })
      .sort({ created: 1 }).toArray();
    // Razón social: CCT.Padron (el padrón que nombra el CA04); ClaveCiudad sólo de respaldo.
    const cuits = [...new Set(docs.map(d => String(d.idPerson)))];
    const padron = new Map();
    for (const coleccion of ['ClaveCiudad', 'Padron']) {
      for (const p of await client.db('CCT').collection(coleccion)
        .find({ _id: { $in: cuits } }, { projection: { businessName: 1 } }).toArray()) {
        if (p.businessName) padron.set(String(p._id), p.businessName);
      }
    }
    return docs.map(d => ({
      solicitud: String(d.content.IDSolicitud),
      instrumento: d.content.Instrumento_Legal,
      cuit: String(d.idPerson),
      razonSocial: padron.get(String(d.idPerson)) ?? null,
      impuesto: regimenes.find(r => r.Id === d.tax)?.DescripcionCorta ?? null,
      fechaAlta: new Date(d.content.Fecha_Consolidacion),
      cuotas: Number(d.content.Cantidad_Cuotas),
      deudaNominal: Number(d.content.Importe_Total_Consolidado),
      interesResarcitorio: Number(d.content.Intereses_Resarcitorios),
      interesFinanciero: Number(d.content.Total_Intereses_Financieros),
    }));
  });
}

// ─── Formatos tal como los muestra la grilla ─────────────────────────────────
const formatoCuit = c => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
const formatoFecha = d => d.toLocaleDateString('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
const formatoMonto = n => `$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

/** Fila esperada de la grilla (10 celdas, en el orden del CA04). */
function filaGrilla(p) {
  return [p.solicitud, p.instrumento, formatoCuit(p.cuit), p.razonSocial ?? '', p.impuesto ?? '', formatoFecha(p.fechaAlta),
    String(p.cuotas), formatoMonto(p.deudaNominal), formatoMonto(p.interesResarcitorio), formatoMonto(p.interesFinanciero)];
}

module.exports = { tablaParam, impuestosPorInstrumento, codigoImpuesto, planesEsperados, filaGrilla, formatoCuit, formatoFecha, formatoMonto, ZONA };
