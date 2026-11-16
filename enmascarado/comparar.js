// enmascarado/comparar.js
// Verificación MANUAL del analista: muestra, para un documento enmascarado,
// cada campo tokenizado junto a su valor real restaurado desde la tabla de
// equivalencias.
//
// ⚠ Imprime datos reales. Correrlo solo en una terminal propia, nunca dentro
// de una sesión con el asistente de IA ni pegar su salida en el chat.
//
// Uso:
//   node enmascarado/comparar.js <enmascarado/salida/SESION/NNN-....json> [indice=0]
const fs = require('fs');
const path = require('path');
const { Vault, VAULT_DIR } = require('./vault');

const [archivo, idx = '0'] = process.argv.slice(2);
if (!archivo) {
  console.error('Uso: node enmascarado/comparar.js <enmascarado/salida/SESION/NNN-....json> [indice]');
  process.exit(1);
}
const salida = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const vault = Vault.cargar(path.join(VAULT_DIR, `equivalencias-${salida.sesion}.json`));
const doc = Array.isArray(salida.datos) ? salida.datos[Number(idx)] : salida.datos;
console.log('Fuente (real):', vault.desenmascararTexto(JSON.stringify(salida.fuente)));

const filas = [];
(function recorrer(v, ruta) {
  if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, `${ruta}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) recorrer(x, ruta ? `${ruta}.${k}` : k);
  else if (typeof v === 'string' && (vault.aliasAReal.has(v) || v === '[REDACTADO]')) {
    filas.push({ campo: ruta, alias: v, real: v === '[REDACTADO]' ? '(eliminado, no recuperable)' : vault.aliasAReal.get(v) });
  }
})(doc, '');

console.table(filas);
