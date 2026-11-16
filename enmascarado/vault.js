// enmascarado/vault.js
// Bóveda local de equivalencias dato real <-> alias.
//
// Reglas (ver plan de enmascaramiento):
// - La tabla de equivalencias se guarda FUERA del proyecto, en
//   %USERPROFILE%\.vault-qa\ (o VAULT_DIR), para que el asistente de IA no la
//   pueda leer desde la carpeta de trabajo.
// - Los alias son estables dentro de una sesión: el mismo valor real siempre
//   recibe el mismo alias (CUIT_0001), así el asistente puede relacionar datos.
// - Las credenciales (tokens, firmas) NO se tokenizan: se eliminan y nunca se
//   guardan en la bóveda, porque no hay motivo para poder recuperarlas.
const fs = require('fs');
const os = require('os');
const path = require('path');

const VAULT_DIR = process.env.VAULT_DIR || path.join(os.homedir(), '.vault-qa');
const REDACTADO = '[REDACTADO]';

// Prefijos válidos de CUIT/CUIL.
const RE_CUIT = /\b(20|23|24|27|30|33|34)-?(\d{8})-?(\d)\b/g;
const RE_EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// Alias generado por esta bóveda: CATEGORIA_0001.
const RE_ALIAS = /\b([A-Z][A-Z_]*?)_(\d{4,})\b/g;

/** Dígito verificador de CUIT/CUIL. Devuelve null si el número es inválido (resto 1). */
function digitoVerificadorCuit(diez) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(diez[i]), 0);
  const dv = 11 - (suma % 11);
  if (dv === 11) return 0;
  if (dv === 10) return null;
  return dv;
}

function esCuitValido(texto) {
  const s = String(texto).replace(/-/g, '');
  if (!/^\d{11}$/.test(s)) return false;
  if (!/^(20|23|24|27|30|33|34)/.test(s)) return false;
  return digitoVerificadorCuit(s.slice(0, 10)) === Number(s[10]);
}

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class Vault {
  constructor({ sesion } = {}) {
    this.sesion = sesion || new Date().toISOString().replace(/[:.]/g, '-');
    this.realAAlias = new Map(); // clave `${categoria}|${valorNormalizado}` -> alias
    this.aliasAReal = new Map(); // alias -> valor real (con su tipo original)
    this.contadores = {};
  }

  // Sin trim: dos valores que difieren en espacios reciben alias distintos,
  // así desenmascarar devuelve exactamente el valor original.
  static normalizar(valor) {
    return String(valor);
  }

  /**
   * Devuelve el alias del valor real, creándolo si no existe.
   * Los CUIT se normalizan sin guiones para que "20-1234..." y 201234... den el mismo alias.
   */
  alias(valor, categoria) {
    if (valor === null || valor === undefined) return valor;
    let norm = Vault.normalizar(valor);
    if (norm.trim() === '') return valor;
    // Un valor que ya es un alias de esta bóveda no se vuelve a enmascarar.
    if (this.aliasAReal.has(norm)) return norm;
    if (categoria === 'CUIT') norm = norm.replace(/-/g, '');
    const clave = `${categoria}|${norm}`;
    let a = this.realAAlias.get(clave);
    if (!a) {
      const n = (this.contadores[categoria] || 0) + 1;
      this.contadores[categoria] = n;
      a = `${categoria}_${String(n).padStart(4, '0')}`;
      this.realAAlias.set(clave, a);
      this.aliasAReal.set(a, valor);
    }
    return a;
  }

  /** Valores reales conocidos (para la red de seguridad y la verificación de fugas). */
  valoresConocidos() {
    return [...this.realAAlias.entries()].map(([clave, alias]) => ({
      valor: clave.slice(clave.indexOf('|') + 1),
      alias,
    }));
  }

  /**
   * Red de seguridad para texto libre: reemplaza valores ya conocidos
   * (palabra completa, de 4+ caracteres), CUITs con dígito verificador válido
   * y emails.
   */
  enmascararTexto(texto) {
    if (typeof texto !== 'string' || texto === '') return texto;
    let t = texto;
    const conocidos = this.valoresConocidos()
      .filter(k => k.valor.length >= 4)
      .sort((a, b) => b.valor.length - a.valor.length);
    for (const { valor, alias } of conocidos) {
      if (!t.includes(valor)) continue;
      t = t.replace(new RegExp(`(?<![\\w])${escaparRegex(valor)}(?![\\w])`, 'g'), alias);
    }
    t = t.replace(RE_CUIT, m => (esCuitValido(m) ? this.alias(m, 'CUIT') : m));
    t = t.replace(RE_EMAIL, m => this.alias(m, 'EMAIL'));
    return t;
  }

  /** Reemplaza alias por valores reales en un texto (p. ej. un request armado por el asistente). */
  desenmascararTexto(texto) {
    return String(texto).replace(RE_ALIAS, m => (this.aliasAReal.has(m) ? String(this.aliasAReal.get(m)) : m));
  }

  /** Igual que desenmascararTexto pero sobre un objeto: restaura también el tipo original (número, etc.). */
  desenmascararObjeto(obj) {
    if (Array.isArray(obj)) return obj.map(x => this.desenmascararObjeto(x));
    // Solo objetos planos: los tipos BSON (regex, ObjectId, fechas) se dejan intactos.
    if (obj && typeof obj === 'object' && Object.getPrototypeOf(obj) === Object.prototype) {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = this.desenmascararObjeto(v);
      return out;
    }
    if (typeof obj === 'string') {
      if (this.aliasAReal.has(obj)) return this.aliasAReal.get(obj);
      return this.desenmascararTexto(obj);
    }
    return obj;
  }

  /** Guarda la tabla de equivalencias fuera del proyecto. Devuelve la ruta. */
  guardar() {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const archivo = path.join(VAULT_DIR, `equivalencias-${this.sesion}.json`);
    const contenido = {
      sesion: this.sesion,
      creado: new Date().toISOString(),
      equivalencias: Object.fromEntries(this.aliasAReal),
    };
    fs.writeFileSync(archivo, JSON.stringify(contenido, null, 2), { encoding: 'utf8', mode: 0o600 });
    return archivo;
  }

  /**
   * Abre una sesión existente (mismos alias que consultas anteriores) o crea
   * una nueva con ese nombre. Así el asistente puede pedir una consulta usando
   * un alias que vio antes (CUIT_0048) y obtener el mismo alias en la respuesta.
   */
  static abrirSesion(sesion) {
    if (!sesion) return new Vault();
    if (!/^[\w.-]+$/.test(sesion)) throw new Error('Nombre de sesión inválido (solo letras, números, . _ -).');
    const archivo = path.join(VAULT_DIR, `equivalencias-${sesion}.json`);
    return fs.existsSync(archivo) ? Vault.cargar(archivo) : new Vault({ sesion });
  }

  static cargar(archivo) {
    const data = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    const v = new Vault({ sesion: data.sesion });
    for (const [alias, real] of Object.entries(data.equivalencias)) {
      v.aliasAReal.set(alias, real);
      const cat = alias.replace(/_\d+$/, '');
      let norm = Vault.normalizar(real);
      if (cat === 'CUIT') norm = norm.replace(/-/g, '');
      v.realAAlias.set(`${cat}|${norm}`, alias);
      const n = Number(alias.match(/_(\d+)$/)[1]);
      v.contadores[cat] = Math.max(v.contadores[cat] || 0, n);
    }
    return v;
  }
}

module.exports = { Vault, VAULT_DIR, REDACTADO, RE_CUIT, esCuitValido, digitoVerificadorCuit };
