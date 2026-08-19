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

/** Estado actual (statechart "PFP" o "PFP_Cuota") — último elemento de states[]. */
function estadoActual(doc) {
  return doc?.states?.[doc.states.length - 1]?.state ?? null;
}

module.exports = {
  conectar,
  withClient,
  withTracerInstance,
  buscarPlanPorSolicitud,
  actualizarFechasCuota,
  estadoActual,
};
