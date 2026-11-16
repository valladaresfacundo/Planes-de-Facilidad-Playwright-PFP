// enmascarado/piloto-padron.js
// Atajo del piloto: muestra aleatoria de CCT.Padron con CUIT cuyo número
// central (posiciones 3 a 10) es >= --desde, pasada por el proceso completo
// de consultar.js (consulta -> dato -> enmascarado -> JSON con fuente).
//
// Uso:
//   node enmascarado/piloto-padron.js [--n 25] [--desde 34000000] [--prefijos 20,23,24,27] [--sesion piloto-padron]
const { ejecutar } = require('./consultar');

function args() {
  const a = process.argv.slice(2);
  const get = (k, def) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : def;
  };
  return {
    n: Number(get('n', 25)),
    desde: Number(get('desde', 34000000)),
    prefijos: get('prefijos') ? get('prefijos').split(',').map(s => s.trim()) : null,
    sesion: get('sesion', `piloto-padron-${new Date().toISOString().slice(0, 10)}`),
  };
}

async function main() {
  const { n, desde, prefijos, sesion } = args();
  const pipeline = [
    { $match: { _id: { $type: 'string', $regex: '^\\d{11}$' } } },
    { $addFields: { __central: { $toLong: { $substrCP: ['$_id', 2, 8] } }, __prefijo: { $substrCP: ['$_id', 0, 2] } } },
    { $match: { __central: { $gte: desde }, ...(prefijos ? { __prefijo: { $in: prefijos } } : {}) } },
    { $sample: { size: n } },
    { $project: { __central: 0, __prefijo: 0 } },
  ];
  const r = await ejecutar('mongo', {
    base: 'CCT',
    coleccion: 'Padron',
    pipeline: JSON.stringify(pipeline),
    sesion,
    etiqueta: `padron-muestra${n}${prefijos ? `-${prefijos.join('_')}` : ''}`,
  });
  console.log(`Sesión: ${r.sesion}`);
  console.log(JSON.stringify(r.resumen, null, 2));
  if (r.ok) console.log(`JSON enmascarado: ${r.archivo}`);
  else {
    console.log('VERIFICACIÓN FALLIDA: no se escribe el JSON enmascarado.');
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error('ERROR:', String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>').slice(0, 300));
  process.exit(1);
});
