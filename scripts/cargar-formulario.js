#!/usr/bin/env node
// scripts/cargar-formulario.js
// Reemplazo por línea de comandos de "carga_unificada_formularios_final_v3.html":
// registra DJs/pagos de prueba en QA. Ver lib/cargaFormularios.js.
//
// Ejemplos:
//   node scripts/cargar-formulario.js 5866 --cuits 27236036044 --anio 2022 --meses 8-12 --deuda 5000000
//   node scripts/cargar-formulario.js 5866 --cuits 27236036044 --proximo --deuda 5000000
//   node scripts/cargar-formulario.js 1234 --cuits 27236036044 --tasas 2 --anio 2026 --meses 9 --deuda 10000 --concepto CAPITAL
//   node scripts/cargar-formulario.js 5556 --cuits 20123456789 --tasas 281,282 --anio 2025 --meses 3,6 --deuda 5000 --dry-run
require('dotenv').config({ quiet: true });
const { request } = require('@playwright/test');
const { FORMULARIOS, construirBodies, cargarFormulario, proximoPeriodoLibre } = require('../lib/cargaFormularios');

const AYUDA = `Uso: node scripts/cargar-formulario.js <formulario> [opciones]

Formularios:
${Object.entries(FORMULARIOS).map(([n, f]) => `  ${n}  ${f.nombre}`).join('\n')}

Opciones:
  --cuits     CUIT(s) separados por coma (obligatorio)
  --anio      Año del período
  --meses     "6", "1-5", "3,6,9" o "1-3,8"
  --proximo   (5866) en vez de --anio/--meses: el primer período sin DJ cargada (requiere MONGO_URI)
  --deuda     Deuda a cargar (en 1234: monto del pago/saldo a favor)
  --tasas     Tasas/impuestos separados por coma (obligatorio en 1234 y 5556)
  --ret       Retenciones (5220, 5225, 5866). Default 0
  --perc      Percepciones (5220, 5225, 5866). Default 0
  --concepto  (1234) CAPITAL | INTERES RESARCITORIO | MECENAZGO | RETARDO. Default CAPITAL
  --fecha     (1234/5556) YYYY-MM-DD. Default hoy
  --ambiente  qa | qa-av. Default qa (igual que el HTML; comparten datos)
  --dry-run   Muestra los bodies sin enviarlos`;

function leerArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const clave = a.slice(2);
    if (['dry-run', 'proximo', 'help'].includes(clave)) args[clave] = true;
    else args[clave] = argv[++i];
  }
  return args;
}

(async () => {
  const args = leerArgs(process.argv.slice(2));
  const formulario = args._[0];
  if (args.help || !formulario) { console.log(AYUDA); return; }

  const datos = {
    cuits: args.cuits, anio: args.anio, meses: args.meses, deuda: args.deuda, tasas: args.tasas,
    ret: args.ret, perc: args.perc, concepto: args.concepto, fecha: args.fecha,
  };
  if (args.proximo) {
    const libre = await proximoPeriodoLibre(String(args.cuits).split(',')[0].trim(), { formulario });
    if (!libre) throw new Error('No quedan períodos libres hasta el mes pasado');
    Object.assign(datos, { anio: libre.anio, meses: [libre.mes] });
    console.log(`Próximo período libre: ${libre.anio}/${String(libre.mes).padStart(2, '0')}`);
  }

  if (args['dry-run']) {
    for (const e of construirBodies(formulario, datos)) console.log(JSON.stringify(e.body, null, 2));
    return;
  }

  const contexto = await request.newContext();
  const resultados = await cargarFormulario(contexto, formulario, datos, { ambiente: args.ambiente || 'qa' });
  await contexto.dispose();
  const errores = resultados.filter(r => !r.ok).length;
  console.log(`\n${resultados.length - errores}/${resultados.length} OK`);
  process.exitCode = errores ? 1 : 0;
})().catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
