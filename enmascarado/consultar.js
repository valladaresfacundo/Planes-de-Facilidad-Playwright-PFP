// enmascarado/consultar.js
// Proceso completo de enmascaramiento, en 4 pasos:
//
//   1. Consulta  -> MongoDB o API (local, con las credenciales del .env)
//   2. Dato      -> la respuesta con datos sensibles queda solo en memoria
//   3. Enmascara -> reemplaza los datos sensibles por alias y verifica que no queden reales
//   4. JSON      -> escribe un JSON enmascarado con la FUENTE de la consulta
//                   (base/colección/filtro o método/URL/body) para que el
//                   asistente de IA tenga contexto. El asistente lee SOLO ese JSON.
//
// La consulta se puede escribir con alias que el asistente vio antes
// (ej. {"_id":"CUIT_0048"}): con --sesion se usa la misma tabla de
// equivalencias, los alias se traducen al dato real solo para ejecutar la
// consulta, y la respuesta vuelve con los mismos alias.
//
// Uso:
//   node enmascarado/consultar.js mongo --base CCT --coleccion Padron --filtro '{"_id":"CUIT_0048"}' [--proyeccion '{...}'] [--limite 20] [--sesion piloto] [--etiqueta padron-cuit]
//   node enmascarado/consultar.js mongo --base CCT --coleccion Padron --pipeline '[{"$sample":{"size":5}}]' --sesion piloto
//   node enmascarado/consultar.js api --metodo POST --url http://host/api/... --body '{"cuit":"CUIT_0048"}' [--auth cct --cuit-auth CUIT_0048] --sesion piloto
//
// Por consola solo se imprime el resumen y la ruta del JSON. Si la verificación
// falla, el JSON no se escribe.
const fs = require('fs');
const path = require('path');
const { BSON } = require('mongodb');
const { Vault, esCuitValido } = require('./vault');
const { Enmascarador, verificar } = require('./enmascarador');
const { REGLAS: REGLAS_PADRON } = require('./reglas-padron');
const { consultarMongo, consultarApi } = require('./fuentes');

const SALIDA = path.join(__dirname, 'salida');
const REGLAS_POR_COLECCION = { 'CCT.Padron': REGLAS_PADRON };

function leerArgs(argv) {
  const [tipo, ...resto] = argv;
  const opts = {};
  for (let i = 0; i < resto.length; i++) {
    if (resto[i].startsWith('--')) {
      const k = resto[i].slice(2);
      const v = resto[i + 1] && !resto[i + 1].startsWith('--') ? resto[++i] : true;
      opts[k] = v;
    }
  }
  return { tipo, opts };
}

/** Versión para mostrar en la fuente: JSON tal como se escribió (sin tipos BSON). */
const comoSeEscribio = texto => {
  if (texto === undefined) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
};

const parsear = (texto, nombre) => {
  if (texto === undefined) return undefined;
  try {
    return BSON.EJSON.parse(texto, { relaxed: true });
  } catch (e) {
    throw new Error(`--${nombre} no es JSON válido: ${e.message}`);
  }
};

/** Enmascara también la descripción de la fuente (por si alguien escribió un dato real en la consulta). */
// Solo red de seguridad (CUIT, emails, valores reales conocidos): las reglas por
// nombre de campo no aplican a la consulta (una proyección {"lastName": 1} no
// tiene datos personales, y un alias ya escrito no se vuelve a enmascarar).
function enmascararFuente(vault, fuente) {
  const recorrer = v => {
    if (Array.isArray(v)) return v.map(recorrer);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, recorrer(x)]));
    if (typeof v === 'string') return vault.enmascararTexto(v);
    if (typeof v === 'number' && Number.isInteger(v) && esCuitValido(String(v))) return vault.alias(v, 'CUIT');
    return v;
  };
  const f = recorrer(JSON.parse(JSON.stringify(fuente)));
  if (typeof f.url === 'string') {
    f.url = f.url.replace(/([?&](token|sign|key|apikey|password|clave)[^=]*=)[^&]*/gi, '$1[REDACTADO]');
  }
  return f;
}

/**
 * Ejecuta los 4 pasos y devuelve { ok, archivo, resumen }.
 * @param {'mongo'|'api'} tipo
 */
async function ejecutar(tipo, opts) {
  const vault = Vault.abrirSesion(opts.sesion);

  // Paso 1: consulta (los alias se traducen al dato real solo en memoria)
  let originales;
  let fuente;
  let reglasPorRuta = {};
  if (tipo === 'mongo') {
    const filtro = parsear(opts.filtro, 'filtro') || {};
    const proyeccion = parsear(opts.proyeccion, 'proyeccion');
    const pipeline = parsear(opts.pipeline, 'pipeline');
    const limite = Number(opts.limite || 20);
    fuente = {
      tipo: 'mongo',
      base: opts.base,
      coleccion: opts.coleccion,
      ...(pipeline
        ? { pipeline: comoSeEscribio(opts.pipeline) }
        : { filtro: comoSeEscribio(opts.filtro) || {}, ...(proyeccion ? { proyeccion: comoSeEscribio(opts.proyeccion) } : {}), limite }),
    };
    // Paso 2: dato con información sensible, en memoria
    originales = await consultarMongo({
      base: opts.base,
      coleccion: opts.coleccion,
      filtro: vault.desenmascararObjeto(filtro),
      proyeccion,
      limite,
      pipeline: pipeline && vault.desenmascararObjeto(pipeline),
    });
    reglasPorRuta = REGLAS_POR_COLECCION[`${opts.base}.${opts.coleccion}`] || {};
  } else if (tipo === 'api') {
    const metodo = String(opts.metodo || 'GET').toUpperCase();
    const body = parsear(opts.body, 'body');
    fuente = {
      tipo: 'api',
      metodo,
      url: opts.url,
      ...(body !== undefined ? { body } : {}),
      autenticacion: opts.auth ? { tipo: opts.auth, cuit: opts['cuit-auth'] } : 'ninguna',
    };
    const resp = await consultarApi({
      metodo,
      url: vault.desenmascararTexto(opts.url || ''),
      body: body === undefined ? undefined : vault.desenmascararObjeto(body),
      auth: opts.auth ? { tipo: opts.auth, cuit: String(vault.desenmascararTexto(opts['cuit-auth'] || '')), ambiente: opts.ambiente } : undefined,
    });
    fuente.estadoHttp = resp.status;
    originales = [resp.body];
  } else {
    throw new Error('Tipo de fuente desconocido: usar "mongo" o "api".');
  }

  // Paso 3: enmascarar y verificar
  const enm = new Enmascarador(vault, { reglasPorRuta });
  const enmascarados = enm.enmascararTodo(originales);
  const v = verificar({ originales, enmascarados, vault, enmascarador: enm });
  originales = null;

  const fuenteEnmascarada = enmascararFuente(vault, fuente);
  // La descripción de la fuente también pasa por los controles de patrones.
  const fuenteJson = JSON.stringify(fuenteEnmascarada);
  const cuitEnFuente = /\b(20|23|24|27|30|33|34)-?\d{8}-?\d\b/.test(fuenteJson);
  const ok = v.ok && !cuitEnFuente;

  const resumen = {
    resultado: ok ? 'PASS' : 'FAIL',
    fugasDeValoresConocidos: v.fugasConocidas.encontrados.length,
    credencialesEliminadas: v.credenciales.eliminadas,
    credencialesEnSalida: v.credenciales.encontradas,
    cuitsSueltos: v.patrones.cuits + (cuitEnFuente ? 1 : 0),
    emailsSueltos: v.patrones.emails,
    estructuraConservada: v.estructura.conDiferencias === 0,
    mismoDatoMismoAlias: v.consistencia.valoresConVariosAlias === 0,
    reversible: v.reversibilidad.noReversibles === 0,
    camposTextoSinRegla: v.noClasificados,
    coincidenciasNumericasDebiles: v.coincidencias,
    ...(v.fugasConocidas.encontrados.length ? { detalleFugas: v.fugasConocidas.encontrados } : {}),
    ...(v.reversibilidad.rutas.length ? { rutasNoReversibles: v.reversibilidad.rutas } : {}),
  };

  vault.guardar();
  if (!ok) return { ok, archivo: null, resumen, sesion: vault.sesion };

  // Paso 4: JSON enmascarado con la fuente
  const salida = {
    fuente: fuenteEnmascarada,
    ambiente: opts.ambiente || process.env.AMBIENTE_DATOS || 'homologacion',
    consultadoEn: new Date().toISOString(),
    sesion: vault.sesion,
    reglas: Object.keys(reglasPorRuta).length ? `${opts.base}.${opts.coleccion}` : 'genericas por nombre de campo',
    nota: 'Datos enmascarados: los valores CATEGORIA_NNNN son alias. Para consultar de nuevo, usar los mismos alias con la misma sesion.',
    verificacion: resumen,
    cantidad: enmascarados.length,
    datos: tipo === 'api' ? enmascarados[0] : enmascarados,
  };
  const dir = path.join(SALIDA, vault.sesion);
  fs.mkdirSync(dir, { recursive: true });
  const n = String(fs.readdirSync(dir).filter(f => f.endsWith('.json')).length + 1).padStart(3, '0');
  const etiqueta = String(opts.etiqueta || (tipo === 'mongo' ? `${opts.base}-${opts.coleccion}` : 'api')).replace(/[^\w.-]/g, '_');
  const archivo = path.join(dir, `${n}-${tipo}-${etiqueta}.json`);
  fs.writeFileSync(archivo, JSON.stringify(salida, null, 2), 'utf8');
  return { ok, archivo, resumen, sesion: vault.sesion };
}

async function main() {
  const { tipo, opts } = leerArgs(process.argv.slice(2));
  const r = await ejecutar(tipo, opts);
  console.log(`Sesión: ${r.sesion}`);
  console.log(JSON.stringify(r.resumen, null, 2));
  if (r.ok) console.log(`JSON enmascarado: ${path.relative(process.cwd(), r.archivo)}`);
  else {
    console.log('VERIFICACIÓN FALLIDA: no se escribe el JSON enmascarado.');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(e => {
    // Nunca imprimir la URI ni el error crudo completo (puede traer datos)
    const { Vault: V } = require('./vault');
    const msg = new V().enmascararTexto(String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>')).slice(0, 300);
    console.error('ERROR:', msg);
    process.exit(1);
  });
}

module.exports = { ejecutar };
