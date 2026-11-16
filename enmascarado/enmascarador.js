// enmascarado/enmascarador.js
// Paso 3 del proceso: recibe el dato con información sensible (de Mongo o de
// una API), lo enmascara con la bóveda y verifica el resultado.
//
// Reglas: primero las reglas por ruta de la fuente (ej. reglas-padron.js), si
// no hay, las reglas genéricas por nombre de campo (reglas-genericas.js). Los
// textos sin regla pasan por la red de seguridad (CUIT/email/valores conocidos)
// y se informan como "no clasificados".
const { REDACTADO, RE_CUIT, esCuitValido } = require('./vault');
const { REDACTAR, ANIO, CONSERVAR } = require('./reglas-padron');
const { reglaPorClave } = require('./reglas-genericas');

const esObjetoPlano = v => v && typeof v === 'object' && !(v instanceof Date) && !v._bsontype;
const rutaSinIndices = r => r.replace(/\[\d+\]/g, '');
const comoTexto = v => (v instanceof Date ? v.toISOString() : String(v));

class Enmascarador {
  /**
   * @param {import('./vault').Vault} vault
   * @param {{reglasPorRuta?: Record<string,string>}} opciones
   */
  constructor(vault, { reglasPorRuta = {} } = {}) {
    this.vault = vault;
    this.reglasPorRuta = reglasPorRuta;
    this.noClasificados = new Set();
    this.redactados = [];
  }

  reglaPara(ruta) {
    return this.reglasPorRuta[ruta] || reglaPorClave(ruta);
  }

  hoja(valor, ruta, regla) {
    if (valor === null || valor === undefined || typeof valor === 'boolean') return valor;
    if (valor instanceof Date) return regla === ANIO ? String(valor.getUTCFullYear()) : valor;
    if (valor && valor._bsontype) return this.vault.alias(String(valor), 'ID_INTERNO');

    if (regla === REDACTAR) {
      if (valor === '') return valor;
      this.redactados.push(String(valor));
      return REDACTADO;
    }
    if (regla === CONSERVAR) return typeof valor === 'string' ? this.vault.enmascararTexto(valor) : valor;
    if (regla && regla !== ANIO) {
      const cat = regla.startsWith('PROFUNDO:') ? regla.slice('PROFUNDO:'.length) : regla;
      return this.vault.alias(valor, cat);
    }
    if (typeof valor === 'number') {
      return Number.isInteger(valor) && esCuitValido(String(valor)) ? this.vault.alias(valor, 'CUIT') : valor;
    }
    if (typeof valor === 'string') {
      if (valor.trim() !== '') this.noClasificados.add(ruta);
      return this.vault.enmascararTexto(valor);
    }
    return valor;
  }

  recorrer(valor, ruta, reglaHeredada) {
    const regla = this.reglaPara(ruta) || reglaHeredada;
    const profunda = regla && regla.startsWith('PROFUNDO:') ? regla : reglaHeredada;
    if (Array.isArray(valor)) return valor.map(x => this.recorrer(x, ruta, profunda));
    if (esObjetoPlano(valor)) {
      // Un objeto entero marcado como credencial se elimina completo.
      if (regla === REDACTAR) {
        this.redactados.push(JSON.stringify(valor));
        return REDACTADO;
      }
      const out = {};
      for (const [k, v] of Object.entries(valor)) out[k] = this.recorrer(v, ruta ? `${ruta}.${k}` : k, profunda);
      return out;
    }
    return this.hoja(valor, ruta, regla);
  }

  /**
   * Enmascara una lista de documentos en dos pasadas: la primera registra los
   * valores sensibles, así la red de seguridad de los textos libres ya los
   * conoce en la segunda.
   */
  enmascararTodo(docs) {
    docs.forEach(d => this.recorrer(d, '', undefined));
    this.noClasificados.clear();
    this.redactados = [];
    return docs.map(d => this.recorrer(d, '', undefined));
  }
}

// ---------------------------------------------------------------------------
// Verificación (en memoria; el resultado solo lleva conteos y rutas)
// ---------------------------------------------------------------------------
function hojas(valor, ruta = '', out = []) {
  if (Array.isArray(valor)) valor.forEach((x, i) => hojas(x, `${ruta}[${i}]`, out));
  else if (esObjetoPlano(valor)) for (const [k, v] of Object.entries(valor)) hojas(v, ruta ? `${ruta}.${k}` : k, out);
  else out.push({ ruta, valor });
  return out;
}

const FUERTES = new Set(['CUIT', 'DNI', 'ID_PERSONA', 'NRO_INSCRIPTO', 'TELEFONO', 'EMAIL', 'AGENTE', 'NOMBRE', 'APELLIDO', 'RAZON_SOCIAL', 'CALLE', 'DOMICILIO', 'ACTIVO', 'CUENTA', 'USUARIO']);

function verificar({ originales, enmascarados, vault, enmascarador }) {
  const r = {};
  const json = JSON.stringify(enmascarados);

  // 1. Valores reales conocidos (4+ caracteres) en la salida, campo por campo y
  //    por palabra completa. Un número de categoría débil (altura, código
  //    postal) igual a un campo numérico se informa como coincidencia.
  const conocidos = vault
    .valoresConocidos()
    .filter(k => k.valor.trim().length >= 4)
    .map(k => ({ ...k, cat: k.alias.replace(/_\d+$/, ''), re: new RegExp(`(?<![\\w])${k.valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`) }));
  const fugas = [];
  const coincidencias = {};
  for (const doc of enmascarados) {
    for (const h of hojas(doc)) {
      if (typeof h.valor !== 'string' && typeof h.valor !== 'number') continue;
      const s = String(h.valor);
      for (const k of conocidos) {
        if (!s.includes(k.valor) || !k.re.test(s)) continue;
        if (!FUERTES.has(k.cat) && /^\d+$/.test(s) && s === k.valor) {
          const clave = `${rutaSinIndices(h.ruta)} = ${k.cat}`;
          coincidencias[clave] = (coincidencias[clave] || 0) + 1;
        } else {
          fugas.push(`${k.cat} en ${rutaSinIndices(h.ruta)}`);
        }
      }
    }
  }
  r.fugasConocidas = { revisados: conocidos.length, encontrados: [...new Set(fugas)] };
  r.coincidencias = coincidencias;

  // 2. Credenciales eliminadas que aparezcan en la salida
  r.credenciales = {
    eliminadas: enmascarador.redactados.length,
    encontradas: enmascarador.redactados.filter(v => v.length >= 4 && json.includes(v)).length,
  };

  // 3. Red de seguridad: CUIT con dígito verificador válido o emails en la salida
  r.patrones = {
    cuits: (json.match(RE_CUIT) || []).filter(esCuitValido).length,
    emails: (json.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).length,
  };

  // 4. Estructura conservada
  let difEstructura = 0;
  originales.forEach((o, i) => {
    if (hojas(o).map(h => h.ruta).join('\n') !== hojas(enmascarados[i]).map(h => h.ruta).join('\n')) difEstructura++;
  });
  r.estructura = { documentos: originales.length, conDiferencias: difEstructura };

  // 5. Consistencia: mismo dato real -> mismo alias
  let tokenizados = 0;
  let inconsistentes = 0;
  originales.forEach((o, i) => {
    const ho = hojas(o);
    const he = hojas(enmascarados[i]);
    if (ho.length !== he.length) return;
    const porValor = new Map();
    ho.forEach((h, j) => {
      const e = he[j];
      if (typeof e.valor !== 'string' || !/^[A-Z_]+_\d{4,}$/.test(e.valor)) return;
      const cat = e.valor.replace(/_\d+$/, '');
      const clave = `${cat}|${cat === 'CUIT' ? comoTexto(h.valor).replace(/-/g, '') : comoTexto(h.valor)}`;
      if (!porValor.has(clave)) porValor.set(clave, new Set());
      porValor.get(clave).add(e.valor);
      tokenizados++;
    });
    for (const s of porValor.values()) if (s.size > 1) inconsistentes++;
  });
  r.consistencia = { camposTokenizados: tokenizados, valoresConVariosAlias: inconsistentes };

  // 6. Reversibilidad (salvo credenciales y fechas generalizadas)
  let comparados = 0;
  let noReversibles = 0;
  const rutasNR = new Set();
  originales.forEach((o, i) => {
    const ho = hojas(o);
    const hr = hojas(vault.desenmascararObjeto(enmascarados[i]));
    const he = hojas(enmascarados[i]);
    ho.forEach((h, j) => {
      const rr = rutaSinIndices(h.ruta);
      const regla = enmascarador.reglaPara(rr);
      if (regla === REDACTAR || regla === ANIO || (he[j] && he[j].valor === REDACTADO)) return;
      comparados++;
      if (!hr[j] || comoTexto(h.valor) !== comoTexto(hr[j].valor)) {
        noReversibles++;
        rutasNR.add(rr);
      }
    });
  });
  r.reversibilidad = { camposComparados: comparados, noReversibles, rutas: [...rutasNR] };

  r.noClasificados = [...enmascarador.noClasificados].map(rutaSinIndices).filter((x, i, a) => a.indexOf(x) === i);

  r.ok =
    r.fugasConocidas.encontrados.length === 0 &&
    r.credenciales.encontradas === 0 &&
    r.patrones.cuits === 0 &&
    r.patrones.emails === 0 &&
    r.estructura.conDiferencias === 0 &&
    r.consistencia.valoresConVariosAlias === 0 &&
    r.reversibilidad.noReversibles === 0;
  return r;
}

module.exports = { Enmascarador, verificar, hojas };
