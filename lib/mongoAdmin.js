// lib/mongoAdmin.js
// Acceso directo a MongoDB (Tracers.TracerInstance) — bypasea la API y su
// lógica de negocio, así que es una herramienta de ÚLTIMO RECURSO para
// escenarios que la API no permite fabricar de otra forma (ej. backdatear
// fechas de cuota para probar F3003/Caducidad — ver memoria pfp-roadmap-fases,
// sesión 2026-08-19). No usar para nada que la API ya resuelva.
//
// Requiere MONGO_URI (y opcionalmente MONGO_DB, default "Tracers") en el
// entorno — ver .env.example. Nunca hardcodear la connection string acá ni en
// ningún archivo versionado: son credenciales reales de un cluster QA
// compartido con acceso de escritura.
require('dotenv').config();
const { MongoClient } = require('mongodb');

const DB_DEFAULT = process.env.MONGO_DB || 'Tracers';
const COLECCION_TRACER_INSTANCE = 'TracerInstance';

function requerirUri() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Falta MONGO_URI en el entorno — copiar .env.example a .env y completar con la connection string real.');
  }
  return uri;
}

/** Abre una conexión — quien la use es responsable de cerrarla (client.close()) o usar withTracerInstance/withClient. */
async function conectar() {
  const client = new MongoClient(requerirUri());
  await client.connect();
  return client;
}

/** Ejecuta `fn(client)` y cierra la conexión al terminar, incluso si `fn` tira. */
async function withClient(fn) {
  const client = await conectar();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** Ejecuta `fn(collection)` sobre Tracers.TracerInstance y cierra la conexión al terminar. */
async function withTracerInstance(fn) {
  return withClient(client => fn(client.db(DB_DEFAULT).collection(COLECCION_TRACER_INSTANCE)));
}

/**
 * Trae todos los documentos de un plan por Nro. de solicitud: el documento
 * "plan" (quota:0, businessTask:"PFP") + un documento por cuota (quota:1..N,
 * businessTask:"PFP_Cuota"). Útil como bypass de ObtenerPlanesDePago cuando
 * ese endpoint está caído (confirmado que pasa — ver memoria pfp-api-endpoints).
 */
async function buscarPlanPorSolicitud(idSolicitud) {
  return withTracerInstance(col =>
    col.find({ 'content.IDSolicitud': String(idSolicitud) }).sort({ quota: 1 }).toArray()
  );
}

/**
 * Trae el ID_Debito guardado en el documento de una cuota — fallback directo
 * cuando el polling de Tracer (api/pfpApiClient.js::esperarIdDebito) no sirve.
 * Confirmado 2026-08-20: en QA_AV el servicio Tracer (txsapi) devuelve 200
 * con body vacío incluso autenticado — pero GenerarDebitoCuotaPorSolicitud sí
 * persiste ID_Debito en Mongo, así que se puede leer directo de ahí.
 * @param {string} idTracerCuota
 * @returns {Promise<string|null>}
 */
async function obtenerIdDebito(idTracerCuota, { intentos = 6, esperaMs = 1500 } = {}) {
  for (let i = 0; i < intentos; i++) {
    const idDebito = await withTracerInstance(async col => {
      const doc = await col.findOne({ _id: idTracerCuota });
      return doc?.content?.ID_Debito || null;
    });
    if (idDebito) return idDebito;
    await new Promise(r => setTimeout(r, esperaMs));
  }
  return null;
}

/**
 * Actualiza a mano los 4 campos de fecha de una cuota (content.*) — usado para
 * fabricar escenarios de Caducidad (F3003) fuera del alcance normal de la API.
 * `fechas` acepta Date o string ISO para cada campo; los que no se pasen quedan
 * intactos. ⚠ Escritura real sobre una base compartida — confirmar con el
 * usuario los valores exactos antes de llamar esto, no adivinar.
 * @param {string} idTracerCuota - el _id del documento de la cuota (string, no ObjectId real — este cluster usa strings como _id)
 * @param {{fechaPrimerVencimiento?: Date|string, fechaSegundoVencimiento?: Date|string, fechaDebito?: Date|string, fechaEmisionDRG?: Date|string}} fechas
 */
async function actualizarFechasCuota(idTracerCuota, fechas) {
  const set = {};
  if (fechas.fechaPrimerVencimiento) set['content.Fecha_Primer_Vencimiento'] = new Date(fechas.fechaPrimerVencimiento);
  if (fechas.fechaSegundoVencimiento) set['content.Fecha_Segundo_Vencimiento'] = new Date(fechas.fechaSegundoVencimiento);
  if (fechas.fechaDebito) set['content.Fecha_Debito'] = new Date(fechas.fechaDebito);
  if (fechas.fechaEmisionDRG) set['content.Fecha_Emision_DRG'] = new Date(fechas.fechaEmisionDRG);
  if (Object.keys(set).length === 0) {
    throw new Error('actualizarFechasCuota: no se pasó ningún campo de fecha para actualizar.');
  }
  return withTracerInstance(col => col.updateOne({ _id: idTracerCuota }, { $set: set }));
}

/**
 * Estado actual de un documento TracerInstance. Un documento de cuota tiene
 * DOS statecharts en states[] (PFP_Cuota y PFP_Cuota_Debito) — sin filtrar,
 * el último elemento del array puede ser el del débito, no el de la cuota.
 * Default "PFP_Cuota" (documentos de cuota) — pasar "PFP" para el documento
 * de plan (quota:0), o "PFP_Cuota_Debito" para el estado del débito.
 */
function estadoActual(doc, statechart = 'PFP_Cuota') {
  const encontrado = doc?.states?.find(s => s.statechart === statechart);
  if (encontrado) return encontrado.state;
  // Fallback: documento de plan usa statechart "PFP", no "PFP_Cuota" — si no
  // matcheó nada, probamos con el último estado tal cual (mejor que null).
  return doc?.states?.[doc.states.length - 1]?.state ?? null;
}

module.exports = {
  conectar,
  withClient,
  withTracerInstance,
  buscarPlanPorSolicitud,
  obtenerIdDebito,
  actualizarFechasCuota,
  estadoActual,
};
