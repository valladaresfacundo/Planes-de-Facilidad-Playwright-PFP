// enmascarado/fuentes.js
// Pasos 1 y 2 del proceso: consultar la fuente (MongoDB o API) y obtener el
// dato con información sensible. Este módulo nunca escribe ni imprime lo que
// obtiene: lo devuelve en memoria para que lo enmascare enmascarador.js.
require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');

// Solo lectura: se rechazan etapas de agregación que escriben.
const ETAPAS_PROHIBIDAS = ['$out', '$merge'];

async function consultarMongo({ base, coleccion, filtro = {}, proyeccion, limite = 20, pipeline }) {
  if (!process.env.MONGO_URI) throw new Error('Falta MONGO_URI en .env');
  if (!base || !coleccion) throw new Error('Mongo: faltan --base y --coleccion');
  if (pipeline && JSON.stringify(pipeline).match(/"\$(out|merge)"/)) {
    throw new Error(`Mongo: el pipeline no puede usar ${ETAPAS_PROHIBIDAS.join(' ni ')} (solo lectura).`);
  }
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  try {
    const col = client.db(base).collection(coleccion);
    if (pipeline) return await col.aggregate(pipeline).toArray();
    return await col.find(filtro, proyeccion ? { projection: proyeccion } : {}).limit(limite).toArray();
  } finally {
    await client.close();
  }
}

// Adaptador mínimo para reusar lib/pfpApiClient.js (pensado para el fixture
// `request` de Playwright) desde un script con fetch.
function adaptadorFetch() {
  const envolver = async resp => {
    const texto = await resp.text();
    return { ok: () => resp.ok, status: () => resp.status, text: async () => texto, json: async () => JSON.parse(texto) };
  };
  const llamar = metodo => async (url, { headers = {}, data } = {}) =>
    envolver(
      await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: data === undefined ? undefined : JSON.stringify(data),
      })
    );
  return { get: llamar('GET'), post: llamar('POST'), put: llamar('PUT'), delete: llamar('DELETE') };
}

/**
 * @param {{metodo?: string, url: string, body?: any, auth?: {tipo: 'cct', cuit: string, ambiente?: string}}} p
 * @returns {Promise<{status: number, body: any}>}
 */
async function consultarApi({ metodo = 'GET', url, body, auth }) {
  if (!url) throw new Error('API: falta --url');
  const headers = { 'Content-Type': 'application/json' };
  if (auth && auth.tipo === 'cct') {
    const { PfpApiClient } = require('../lib/pfpApiClient');
    const { SIGN_CCT } = require('../fixtures/test-data');
    const cliente = new PfpApiClient(adaptadorFetch(), auth.ambiente || 'qa');
    await cliente.autenticar(auth.cuit, SIGN_CCT);
    headers.Authorization = `Bearer ${cliente.token}`;
  }
  const resp = await fetch(url, {
    method: metodo.toUpperCase(),
    headers,
    body: body === undefined || metodo.toUpperCase() === 'GET' ? undefined : JSON.stringify(body),
  });
  const texto = await resp.text();
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = { texto };
  }
  return { status: resp.status, body: cuerpo };
}

module.exports = { consultarMongo, consultarApi };
