// lib/leerXlsx.js
// Lector mínimo de .xlsx sin dependencias (un .xlsx es un zip con XML): lee la
// primera hoja y devuelve las filas como arrays de strings. Alcanza para
// validar reportes descargados (texto, números, shared strings); no interpreta
// estilos ni fórmulas.
const fs = require('fs');
const zlib = require('zlib');

/** Entradas del zip → { nombre: Buffer descomprimido }, leyendo el directorio central. */
function leerZip(buffer) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('leerXlsx — el archivo no es un zip/xlsx válido');
  const cantidad = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const archivos = {};
  for (let i = 0; i < cantidad; i++) {
    const metodo = buffer.readUInt16LE(p + 10);
    const tamComprimido = buffer.readUInt32LE(p + 20);
    const largoNombre = buffer.readUInt16LE(p + 28);
    const largoExtra = buffer.readUInt16LE(p + 30);
    const largoComentario = buffer.readUInt16LE(p + 32);
    const offsetLocal = buffer.readUInt32LE(p + 42);
    const nombre = buffer.toString('utf8', p + 46, p + 46 + largoNombre);
    const inicioDatos = offsetLocal + 30 + buffer.readUInt16LE(offsetLocal + 26) + buffer.readUInt16LE(offsetLocal + 28);
    const datos = buffer.subarray(inicioDatos, inicioDatos + tamComprimido);
    archivos[nombre] = metodo === 8 ? zlib.inflateRawSync(datos) : datos;
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

const desescapar = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Las etiquetas pueden venir con prefijo de namespace (<x:row>, como las
// genera .NET/OpenXML SDK) o sin él.
const textoDe = xml => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => desescapar(m[1])).join('');

/** Columna "AB" → índice 27 (base 0 → 27). */
function indiceColumna(ref) {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** @returns {string[][]} filas de la primera hoja (celdas vacías como ''). */
function leerXlsx(rutaOBuffer) {
  const archivos = leerZip(Buffer.isBuffer(rutaOBuffer) ? rutaOBuffer : fs.readFileSync(rutaOBuffer));
  const compartidos = archivos['xl/sharedStrings.xml']
    ? [...archivos['xl/sharedStrings.xml'].toString('utf8').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => textoDe(m[1]))
    : [];
  const nombreHoja = Object.keys(archivos).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!nombreHoja) throw new Error('leerXlsx — el archivo no tiene hojas');
  const hoja = archivos[nombreHoja].toString('utf8');
  const filas = [];
  for (const fila of hoja.matchAll(/<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const celdas = [];
    for (const c of fila[1].matchAll(/<(?:\w+:)?c ([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = c[1];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const tipo = (attrs.match(/t="(\w+)"/) || [])[1];
      const cuerpo = c[2] || '';
      const v = (cuerpo.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
      let valor = '';
      if (tipo === 's') valor = compartidos[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else if (v !== undefined) valor = desescapar(v);
      celdas[ref ? indiceColumna(ref) : celdas.length] = valor;
    }
    filas.push(Array.from(celdas, x => x ?? ''));
  }
  return filas;
}

module.exports = { leerXlsx };
