// scripts/generar-postman.js
// Genera la colección de Postman de Planes de Facilidades (flujos de pago,
// rechazo y rehabilitación de cuotas + cambios de estado del plan) y los
// environments QA_AV / QA, a partir de lo ya validado en lib/pfpApiClient.js
// y lib/fabricaPlanes.js. La tabla Emisión DRG, el SIGN y los hosts salen de
// fixtures/ para no duplicarlos a mano.
//
// Uso: node scripts/generar-postman.js  → escribe en postman/
const fs = require('fs');
const path = require('path');
const { TABLA_EMISION_DRG } = require('../fixtures/pfpEmisionDRG');
const { AMBIENTES_API, SIGN_CCT, CUIT_AUTENTICADO, CONTRIBUYENTES } = require('../fixtures/test-data');

const SALIDA = path.join(__dirname, '..', 'postman');

// ─── Scripts compartidos (se inyectan en cada request) ──────────────────────

const COMUNES = `
const v = k => pm.collectionVariables.get(k);
const set = (k, x) => pm.collectionVariables.set(k, x === undefined || x === null ? '' : String(x));
const aISO = s => { if (!s) return ''; const t = String(s); const m = t.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : t.slice(0, 10); };
// Fechas del tracer: string ISO o extended JSON {"$date": ms}; las de relleno (año < 2000, ej. CA sin pedir) cuentan como vacías.
const aFecha = x => { if (!x) return ''; const d = new Date(typeof x === 'object' && '$date' in x ? x.$date : x); return isNaN(d) || d.getFullYear() < 2000 ? '' : d.toISOString().slice(0, 10); };
const siguiente = id => (pm.execution && pm.execution.setNextRequest) ? pm.execution.setNextRequest(id) : postman.setNextRequest(id);
// Precondición o espera fallida: marca el test y corta la corrida del Runner para no seguir mutando un plan en un estado inesperado.
const cortar = msg => { pm.test(msg, () => { throw new Error(msg); }); siguiente(null); };
let body = {}; try { body = pm.response.json(); } catch (e) { body = pm.response.text(); }
const libre = c => c.estadoCuota === 'NO_VENCIDA' && c.estadoDebito === 'NO_ENVIADO';
const resumen = c => c ? 'cuota ' + c.numeroCuota + ' ' + c.estadoCuota + '/' + c.estadoDebito : 'cuota inexistente';
// Reintenta este mismo request (Runner) hasta que ok sea true. Devuelve true si se cumplió, null si reintenta, false si se agotó.
function esperar(ok, que) {
  const k = 'intentos_' + pm.info.requestId;
  const n = Number(v(k) || 0) + 1;
  const max = Number(v('maxIntentos') || 30);
  if (ok) { pm.collectionVariables.unset(k); return true; }
  if (n < max) { set(k, n); console.log('Esperando ' + que + ' — intento ' + n + '/' + max); siguiente(pm.info.requestId); return null; }
  pm.collectionVariables.unset(k);
  return false;
}
`;

const LEER_PLAN = `
pm.test('HTTP 200', () => pm.response.to.have.status(200));
const plan = ((body && body.content) || [])[0];
let estadoPlan = '';
if (plan) {
  const st = (plan.states || []).find(s => s.statechart === 'PFP') || (plan.states || [])[0] || {};
  estadoPlan = st.state || '';
  set('idTracerPlan', plan._id); set('idDuty', plan.idDuty); set('idAcogimiento', plan.content && plan.content.ID_Acogimiento);
  set('period', plan.period); set('tax', plan.tax); set('estadoPlan', estadoPlan);
  const ca = plan.content && plan.content.CA_Fecha_Emision_DRG;
  if (aFecha(ca)) set('fechaEmisionCA', aFecha(ca));
  console.log('Plan ' + v('solicitud') + ': ' + estadoPlan);
}
`;

const LEER_DETALLE = `
pm.test('HTTP 200', () => pm.response.to.have.status(200));
const cuotas = (body && body.content && body.content.cuotas) || [];
set('cuotasResumen', cuotas.map(c => c.numeroCuota + ':' + c.estadoCuota + '/' + c.estadoDebito).join(' | '));
console.log('Cuotas: ' + v('cuotasResumen'));
const buscarCuota = nro => cuotas.find(x => Number(x.numeroCuota) === Number(nro));
// Deja la cuota elegida lista para los pasos siguientes (débito, pago, payloads).
const elegir = c => {
  if (!c) return c;
  set('cuotaFlujo', c.numeroCuota); set('cuotaJson', JSON.stringify(c)); set('idTracerCuota', c.idTracerCuota);
  set('vencObjetivo', aISO(Number(v('vencimiento')) === 2 ? c.vencimientoCuota2 : c.vencimientoCuota1));
  return c;
};
`;

// Arma {header, Datos} igual que PfpApiClient.construirPayloadF3010/F3014, desde la cuota elegida.
const ARMAR_PAYLOAD = `
const v = k => pm.collectionVariables.get(k);
const aISO = s => { if (!s) return ''; const t = String(s); const m = t.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : t.slice(0, 10); };
function armarPayload({ correcto = true, concepto, extra = {} } = {}) {
  const c = JSON.parse(v('cuotaJson') || '{}');
  if (!c.numeroCuota) throw new Error('No hay cuota elegida (cuotaJson vacío) — correr antes el paso de Detalle del flujo.');
  const nro = Number(c.numeroCuota);
  const nominal = Number(c.importeNominal || 0);
  const actualizado = Number(c.importeActualizado || nominal);
  return {
    header: { idPerson: Number(v('cuit')), period: Number(v('period') || 0), tax: Number(v('tax') || 0), asset: '', quota: nro, amount: nominal },
    Datos: Object.assign({
      Numero_Solicitud: Number(v('solicitud')),
      Numero_Cuota: nro,
      Importe_Nominal: nominal,
      Importe_Actualizado: actualizado,
      Fecha_Vencimiento_Cuota: aISO(c.vencimientoCuota1),
      Intereses_Resarcitorios: 0,
      Estado: correcto ? '' : 'falta de fondos',
      Codigo_De_Error: correcto ? '' : 'R10',
      Concepto: concepto || (nro === 1 ? 7528 : 5202),
      ID_Tracer_Plan: String(v('idTracerPlan') || ''),
      ID_Tracer_Cuota: String(c.idTracerCuota || ''),
      ID_Debito: Number(v('idDebito')) || 0,
      ID_Acogimiento: Number(c.idAcogimiento || v('idAcogimiento')),
    }, extra),
  };
}
`;

const PRE_ESPERA = `setTimeout(() => {}, Number(pm.collectionVariables.get('esperaMs') || 3000));`;

// Pre-request de la colección: token de Clave Ciudad, JWT automático y fecha de Emisión DRG.
const PRE_COLECCION = `
const v = k => pm.collectionVariables.get(k);
const set = (k, x) => pm.collectionVariables.set(k, x === undefined || x === null ? '' : String(x));

// 1) Token Clave Ciudad (mismo XML que pages/LoginPage.js), representando a {{cuit}}.
const expTime = Math.floor(Date.now() / 1000) + 3600;
const autenticado = pm.variables.get('cuitAutenticado');
const xml = '<?xml version="1.0" encoding="iso-8859-1"?><datos><servicio nombre="agip_scct_cicd" exp_time="' + expTime + '" /><autenticado cuit="' + autenticado + '" nombre="Usuario Prueba" isib="' + autenticado + '" cat="40" codcalle="2207" calle="BOLIVAR" puerta="4310" piso="" dpto="" codpostal="B1874CKB" codlocalidad="101" localidad="VILLA DOMINICO" codprov="1" provincia="BUENOS AIRES" telefono="43238600" email="desarrolloweb@agip.gob.ar" nivel="2" tipoDocumento="3003" documento="42090147"></autenticado><representados><representado cuit="' + v('cuit') + '" nombre="EMPRESA PRUEBA" isib="" cat="" codcalle="42570" calle="AVDA DEL LIBERTADOR" puerta="6363" piso="" dpto="" codpostal="C1428CKB" codlocalidad="1200" localidad="CIUDAD AUTONOMA DE BS AS" codprov="2" provincia="CAPITAL FEDERAL" telefono="" email="" tipoRepresentacion="1" tipoDocumento="" documento="" elegido="true"></representado></representados></datos>';
const cryptoJs = require('crypto-js');
set('tokenClaveCiudad', cryptoJs.enc.Base64.stringify(cryptoJs.enc.Utf8.parse(xml)));

// 2) Fecha de Emisión DRG para el vencimiento de la cuota elegida (misma lógica que fixtures/pfpEmisionDRG.js).
const tabla = JSON.parse(v('tablaEmisionDRG') || '[]');
function buscarEmitirDRG(venc) {
  if (!venc) return '';
  const exacto = tabla.find(r => r[0] === venc);
  if (exacto) return exacto[1];
  const f = new Date(venc);
  let mejor = null, menor = Infinity;
  for (const r of tabla) {
    const dif = new Date(r[0]) - f, dist = Math.abs(dif);
    if (dist < menor || (dist === menor && dif > 0)) { mejor = r; menor = dist; }
  }
  return mejor && menor <= 10 * 86400000 ? mejor[1] : '';
}
if (v('fechaEmisionDGRManual')) set('fechaEmisionDGR', v('fechaEmisionDGRManual'));
else if (v('vencObjetivo')) set('fechaEmisionDGR', buscarEmitirDRG(v('vencObjetivo')));

// 3) JWT automático para api-cct / txsapi (se renueva si cambia el CUIT o pasan 50 min).
const raw = pm.request.url.toString();
const usaJwt = /\\{\\{(cct|txsapi)\\}\\}|api-cct|txsapi/.test(raw) && !/DecodificarClaveCiudad|swagger|param\\/Tables/.test(raw);
const vencido = !v('jwt') || v('jwtCuit') !== v('cuit') || Date.now() - Number(v('jwtTs') || 0) > 50 * 60000;
if (usaJwt && vencido) {
  pm.sendRequest({
    url: pm.variables.replaceIn('{{cct}}/api/seguridad/DecodificarClaveCiudad'),
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    body: { mode: 'raw', raw: JSON.stringify({ token: v('tokenClaveCiudad'), sign: pm.variables.get('sign') }) },
  }, (err, res) => {
    const jwt = !err && res.json && (res.json() || {}).content;
    if (!jwt) { console.error('DecodificarClaveCiudad falló', err || res.text()); return; }
    set('jwt', jwt); set('jwtCuit', v('cuit')); set('jwtTs', Date.now());
    console.log('JWT renovado para CUIT ' + v('cuit'));
  });
}
`;

// ─── Constructores de items ─────────────────────────────────────────────────

const script = (tipo, codigo) => ({ listen: tipo, script: { type: 'text/javascript', exec: codigo.trim().split('\n') } });

function req({ nombre, metodo = 'GET', url, cuerpo, sinAuth = false, pre, test, desc }) {
  const item = {
    name: nombre,
    request: {
      method: metodo,
      header: cuerpo !== undefined ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url,
      description: desc,
    },
    event: [],
  };
  if (sinAuth) item.request.auth = { type: 'noauth' };
  if (cuerpo !== undefined) item.request.body = { mode: 'raw', raw: cuerpo, options: { raw: { language: 'json' } } };
  if (pre) item.event.push(script('prerequest', pre));
  if (test) item.event.push(script('test', COMUNES + test));
  return item;
}

const carpeta = (nombre, desc, items) => ({ name: nombre, description: desc, item: items });

// ─── Pasos reutilizables ────────────────────────────────────────────────────

const URL_PLANES = '{{cct}}/api/PlanesDePago/ObtenerPlanesDePago';
const CUERPO_PLANES = '{\n  "cuit": "{{cuit}}",\n  "anio": {{anio}},\n  "solicitud": {{solicitud}},\n  "estado": "Todos"\n}';
const URL_DETALLE = '{{cct}}/api/PlanesDePago/ObtenerPlanDePagoDetalle';
const CUERPO_DETALLE = '{\n  "IdAcogimiento": "{{idAcogimiento}}",\n  "IdTracer": "{{idTracerPlan}}",\n  "IdDuty": {{idDuty}},\n  "Estado": "{{estadoPlan}}"\n}';

const lista = estados => estados.map(e => `'${e}'`).join(', ');

/** Busca el plan por solicitud; si se pasan estados, corta la corrida si no está en ninguno. */
function buscarPlan(nombre, estados) {
  return req({
    nombre, metodo: 'POST', url: URL_PLANES, cuerpo: CUERPO_PLANES,
    desc: estados ? `Precondición: plan en ${estados.join(' o ')}.` : 'Carga idTracerPlan, idDuty, idAcogimiento, period, tax y estadoPlan.',
    test: LEER_PLAN + (estados
      ? `if (!plan) cortar('No se encontró el plan ' + v('solicitud') + ' (revisar cuit / anio / solicitud)');
else if (![${lista(estados)}].includes(estadoPlan)) cortar('El plan está ' + estadoPlan + ', se esperaba ${estados.join(' o ')}');
else pm.test('Plan en ${estados.join(' o ')}', () => pm.expect(estadoPlan).to.be.oneOf([${lista(estados)}]));`
      : ''),
  });
}

/** Reconsulta el plan hasta que llegue a `estado` (poll). */
function esperarPlan(nombre, estado, { siguienteOk } = {}) {
  return req({
    nombre, metodo: 'POST', url: URL_PLANES, cuerpo: CUERPO_PLANES, pre: PRE_ESPERA,
    desc: `Reintenta cada {{esperaMs}} ms (hasta {{maxIntentos}} veces, sólo en el Runner) hasta que el plan quede ${estado}.`,
    test: LEER_PLAN + `
const r = esperar(estadoPlan === '${estado}', 'plan ${estado}');
if (r === false) cortar('El plan no llegó a ${estado} (quedó ' + estadoPlan + ')');
else if (r) { pm.test('Plan ${estado}', () => pm.expect(estadoPlan).to.eql('${estado}'));${siguienteOk ? ` siguiente('${siguienteOk}');` : ''} }`,
  });
}

/** Detalle del plan: fija el vencimiento (1|2) con el que se va a operar; `test` elige la cuota y valida la precondición. */
function detalle(nombre, { vencimiento = 1, test, desc }) {
  return req({
    nombre, metodo: 'POST', url: URL_DETALLE, cuerpo: CUERPO_DETALLE, desc,
    pre: `pm.collectionVariables.set('vencimiento', '${vencimiento}');`,
    test: LEER_DETALLE + test,
  });
}

/** Reconsulta el detalle hasta que la cuota del flujo cumpla `cond` (expresión JS sobre `c`). */
function esperarCuota(nombre, cond, que, { asserts = '', siguienteOk } = {}) {
  return req({
    nombre, metodo: 'POST', url: URL_DETALLE, cuerpo: CUERPO_DETALLE, pre: PRE_ESPERA,
    desc: `Reintenta cada {{esperaMs}} ms (hasta {{maxIntentos}} veces, sólo en el Runner) hasta que la cuota quede ${que}. El F3010 se procesa por cola y puede tardar ~1 min.`,
    test: LEER_DETALLE + `
const c = buscarCuota(v('cuotaFlujo'));
const r = esperar(!!c && (${cond}), '${que}');
if (r === false) cortar('La cuota no llegó a ${que} (' + resumen(c) + ')');
else if (r) {
  elegir(c);
  pm.test('Cuota ' + c.numeroCuota + ' ${que}', () => pm.expect(${cond}).to.be.true);${asserts}${siguienteOk ? `\n  siguiente('${siguienteOk}');` : ''}
}`,
  });
}

function debito(nombre) {
  return req({
    nombre, sinAuth: true,
    url: '{{publicador}}{{pfpIndiv}}/GenerarDebitoCuotaPorSolicitud?idSolicitud={{solicitud}}&fecha={{fechaEmisionDGR}}&esPrimerIntento={{esPrimerIntento}}',
    desc: 'Genera el débito de la cuota cuyo vencimiento coincide con la fecha de Emisión DRG. 1° vencimiento → esPrimerIntento=true, 2° → false. Con vencimientos muy lejanos responde 200 pero no persiste el débito: por eso el paso siguiente verifica DEBITO_ENVIADO.',
    pre: `const v = k => pm.collectionVariables.get(k);
pm.collectionVariables.set('esPrimerIntento', String(Number(v('vencimiento')) !== 2));
if (!v('fechaEmisionDGR')) throw new Error('No hay fecha de Emisión DRG para el vencimiento ' + v('vencObjetivo') + ' — cargar fechaEmisionDGRManual.');
console.log('Débito cuota ' + v('cuotaFlujo') + ' — vencimiento ' + v('vencObjetivo') + ' → emisión ' + v('fechaEmisionDGR'));`,
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log('Respuesta débito', body);`,
  });
}

function pagoCuota(nombre, { rechazado, ca = false, fecha = '{{fechaEmisionDGR}}' }) {
  return req({
    nombre, metodo: 'POST', sinAuth: true, cuerpo: '',
    url: `{{publicador}}{{pfpIndiv}}/GenerarPagoCuotas?fechaEmisionDGR=${fecha}&idSolicitud={{solicitud}}&pagoRechazado=${rechazado}&esCancelacionAnticipada=${ca}&pagarTodas=false`,
    desc: (ca ? 'Pago/rechazo del débito de Cancelación Anticipada (F3008). ' : '') + `Registra el F3010 del lado del servidor con ${rechazado ? 'rechazo (falta de fondos)' : 'pago correcto'}.`,
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
const tx = body && body.respuestaMasivo && body.respuestaMasivo[0] && body.respuestaMasivo[0].transaction;
${rechazado || ca ? '' : "if (tx) set('transactionPago', tx);\n"}console.log('F3010 transaction: ' + tx, body);`,
  });
}

function registrarFormulario(nombre, formulario, armado, desc) {
  return req({
    nombre, metodo: 'POST', desc,
    url: `{{cct}}/api/Registracion/RegistrarFormulario?formulario=${formulario}`,
    cuerpo: '{{payload}}',
    pre: ARMAR_PAYLOAD + `\nconst payload = ${armado};\npm.collectionVariables.set('payload', JSON.stringify(payload, null, 2));\nconsole.log('Payload F${formulario}', payload);`,
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
pm.test('Sin errores', () => pm.expect(body && body.errores, JSON.stringify(body && body.errores)).to.not.be.ok);
console.log('F${formulario} transaction: ' + (body && body.respuesta && body.respuesta.transaction), body);`,
  });
}

function tracerCuota(nombre) {
  return req({
    nombre, url: '{{txsapi}}/api/Tracer/{{idTracerCuota}}', pre: PRE_ESPERA,
    desc: 'Lee ID_Debito del tracer de la cuota (no siempre está disponible al instante: reintenta).',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
const idDebito = (body && body.content && body.content.ID_Debito) || (body && body.ID_Debito);
const r = esperar(!!idDebito, 'ID_Debito');
if (r === false) { set('idDebito', 0); console.warn('Sin ID_Debito, se sigue con 0 (igual que la herramienta)'); }
else if (r) { set('idDebito', idDebito); pm.test('ID_Debito ' + idDebito, () => pm.expect(idDebito).to.be.ok); }`,
  });
}

/** El detalle trae vencimientoCuota2 = "-" en cuotas sin tocar: el 2° vencimiento real sale del tracer de la cuota. */
function segundoVencimiento(nombre) {
  return req({
    nombre, url: '{{txsapi}}/api/Tracer/{{idTracerCuota}}',
    desc: 'Lee Fecha_Segundo_Vencimiento del tracer de la cuota y la usa para calcular la fecha de Emisión DRG del reintento.',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
const f = aFecha(body && body.content && body.content.Fecha_Segundo_Vencimiento);
if (!f) cortar('El tracer de la cuota no trae Fecha_Segundo_Vencimiento — cargar fechaEmisionDGRManual');
else { set('vencObjetivo', f); pm.test('2° vencimiento ' + v('vencObjetivo'), () => pm.expect(v('vencObjetivo')).to.match(/^\\d{4}-\\d{2}-\\d{2}$/)); }`,
  });
}

function tracerPlanCA(nombre) {
  return req({
    nombre, url: '{{txsapi}}/api/Tracer/{{idTracerPlan}}',
    desc: 'Lee CA_Fecha_Emision_DRG del tracer del plan (la fecha a usar en el débito y el pago de la CA). Si no viene, cargar fechaEmisionCA a mano (Mongo, doc quota:0).',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
const contenido = (body && body.content && body.content.content) || (body && body.content) || {};
if (aFecha(contenido.CA_Fecha_Emision_DRG)) set('fechaEmisionCA', aFecha(contenido.CA_Fecha_Emision_DRG));
if (!v('fechaEmisionCA')) cortar('No se encontró CA_Fecha_Emision_DRG — cargar fechaEmisionCA a mano');
else pm.test('fechaEmisionCA = ' + v('fechaEmisionCA'), () => pm.expect(v('fechaEmisionCA')).to.match(/^\\d{4}-\\d{2}-\\d{2}$/));`,
  });
}

// Precondiciones de cuota (fragmentos de test para `detalle`)
const elegirNroCuota = `const c = elegir(buscarCuota(v('nroCuota')));\n`;
const noCuota1 = `else if (Number(c.numeroCuota) === 1) cortar('No usar la cuota 1: su rechazo anula el plan (F3011). Para eso está el flujo 07.');\n`;

// ─── Flujos ─────────────────────────────────────────────────────────────────

const f00 = carpeta('00 · Consultas y utilidades', 'Requests sueltos para consultar sin modificar nada. Se pueden mandar a mano.', [
  req({
    nombre: '00.1 Autenticar (Clave Ciudad → JWT)', metodo: 'POST', sinAuth: true,
    url: '{{cct}}/api/seguridad/DecodificarClaveCiudad',
    cuerpo: '{\n  "token": "{{tokenClaveCiudad}}",\n  "sign": "{{sign}}"\n}',
    desc: 'No hace falta correrlo: la colección obtiene el JWT sola antes de cada llamada a api-cct/txsapi. Sirve para forzar la renovación.',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
pm.test('Devuelve JWT', () => pm.expect(body.content).to.be.a('string'));
set('jwt', body.content); set('jwtCuit', v('cuit')); set('jwtTs', Date.now());`,
  }),
  buscarPlan('00.2 Buscar plan por solicitud'),
  detalle('00.3 Detalle del plan (cuotas)', {
    desc: 'Lista las cuotas con estado de cuota y de débito (ver la consola) y elige {{nroCuota}}.',
    test: `elegir(buscarCuota(v('nroCuota')));
pm.test('Cuotas: ' + v('cuotasResumen'), () => pm.expect(cuotas.length).to.be.above(0));`,
  }),
  req({ nombre: '00.4 Tracer del plan', url: '{{txsapi}}/api/Tracer/{{idTracerPlan}}', test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));` }),
  req({ nombre: '00.5 Tracer de la cuota', url: '{{txsapi}}/api/Tracer/{{idTracerCuota}}', test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));` }),
  req({ nombre: '00.6 Tabla PFP_Emision_DRG (en vivo)', sinAuth: true, url: '{{txsapi}}/param/Tables/content/PFP_Emision_DRG/~', desc: 'Para refrescar la tabla embebida en la variable tablaEmisionDRG si aparecen vencimientos nuevos.' }),
  req({ nombre: '00.7 Swagger api-cct', sinAuth: true, url: '{{cct}}/swagger/v1/swagger.json' }),
  req({ nombre: '00.8 Swagger api-publicador', sinAuth: true, url: '{{publicador}}/swagger/v1/swagger.json' }),
]);

const f01 = carpeta('01 · Pago de cuota (NO_VENCIDA → PAGADA)',
  'Débito + pago correcto de la cuota {{nroCuota}} en su 1° vencimiento. Precondición: plan VIGENTE y cuota sin tocar (NO_VENCIDA/NO_ENVIADO). Resultado: PAGADA/DEBITADO y guarda transactionPago (sirve para el flujo 06).', [
  buscarPlan('01.1 Buscar plan', ['VIGENTE']),
  detalle('01.2 Detalle — elegir cuota', {
    test: elegirNroCuota + `if (!c) cortar('No existe la cuota ' + v('nroCuota'));
else if (!libre(c)) cortar('La cuota no está libre (' + resumen(c) + ')');
else pm.test('Cuota ' + c.numeroCuota + ' libre', () => pm.expect(libre(c)).to.be.true);`,
  }),
  debito('01.3 Generar débito (1° vencimiento)'),
  esperarCuota('01.4 Esperar DEBITO_ENVIADO', "c.estadoDebito === 'DEBITO_ENVIADO'", 'DEBITO_ENVIADO'),
  pagoCuota('01.5 Pago correcto (F3010)', { rechazado: false }),
  esperarCuota('01.6 Esperar PAGADA/DEBITADO', "c.estadoDebito !== 'DEBITO_ENVIADO'", 'procesada', {
    asserts: `\n  pm.test('PAGADA/DEBITADO', () => pm.expect(c.estadoCuota + '/' + c.estadoDebito).to.eql('PAGADA/DEBITADO'));`,
  }),
  buscarPlan('01.7 Plan sigue VIGENTE', ['VIGENTE']),
]);

const f02 = carpeta('02 · Rechazo de cuota — 1° vencimiento (→ RECHAZADA)',
  'Débito + rechazo (falta de fondos, R10) de la cuota {{nroCuota}} en su 1° vencimiento. Nunca con la cuota 1: anula el plan (F3011). Resultado: RECHAZADA/RECHAZADO, plan sigue VIGENTE.', [
  buscarPlan('02.1 Buscar plan', ['VIGENTE']),
  detalle('02.2 Detalle — elegir cuota', {
    test: elegirNroCuota + `if (!c) cortar('No existe la cuota ' + v('nroCuota'));
${noCuota1}else if (!libre(c)) cortar('La cuota no está libre (' + resumen(c) + ')');
else pm.test('Cuota ' + c.numeroCuota + ' libre', () => pm.expect(libre(c)).to.be.true);`,
  }),
  debito('02.3 Generar débito (1° vencimiento)'),
  esperarCuota('02.4 Esperar DEBITO_ENVIADO', "c.estadoDebito === 'DEBITO_ENVIADO'", 'DEBITO_ENVIADO'),
  pagoCuota('02.5 Rechazo (F3010 con R10)', { rechazado: true }),
  esperarCuota('02.6 Esperar RECHAZADA/RECHAZADO', "c.estadoDebito !== 'DEBITO_ENVIADO'", 'procesada', {
    asserts: `\n  pm.test('RECHAZADA/RECHAZADO', () => pm.expect(c.estadoCuota + '/' + c.estadoDebito).to.eql('RECHAZADA/RECHAZADO'));`,
  }),
  buscarPlan('02.7 Plan sigue VIGENTE', ['VIGENTE']),
]);

const f03 = carpeta('03 · Segundo rechazo — 2° vencimiento (RECHAZADA → A_REHABILITAR)',
  'Reintento de débito en el 2° vencimiento (esPrimerIntento=false) y nuevo rechazo. Precondición: cuota {{nroCuota}} RECHAZADA (flujo 02). Resultado: A_REHABILITAR/RECHAZADO.', [
  buscarPlan('03.1 Buscar plan', ['VIGENTE']),
  detalle('03.2 Detalle — cuota RECHAZADA', {
    vencimiento: 2,
    test: elegirNroCuota + `if (!c) cortar('No existe la cuota ' + v('nroCuota'));
${noCuota1}else if (c.estadoCuota !== 'RECHAZADA') cortar('La cuota debe estar RECHAZADA (' + resumen(c) + ') — correr antes el flujo 02');
else pm.test('Cuota ' + c.numeroCuota + ' RECHAZADA', () => pm.expect(c.estadoCuota).to.eql('RECHAZADA'));`,
  }),
  segundoVencimiento('03.3 Tracer cuota → 2° vencimiento'),
  debito('03.4 Generar débito (2° vencimiento)'),
  esperarCuota('03.5 Esperar DEBITO_ENVIADO', "c.estadoDebito === 'DEBITO_ENVIADO'", 'DEBITO_ENVIADO'),
  pagoCuota('03.6 Rechazo (F3010 con R10)', { rechazado: true }),
  esperarCuota('03.7 Esperar A_REHABILITAR', "c.estadoDebito !== 'DEBITO_ENVIADO'", 'procesada', {
    asserts: `\n  pm.test('A_REHABILITAR/RECHAZADO', () => pm.expect(c.estadoCuota + '/' + c.estadoDebito).to.eql('A_REHABILITAR/RECHAZADO'));`,
  }),
]);

const f04 = carpeta('04 · Pago en el reintento — 2° vencimiento (RECHAZADA → PAGADA)',
  'Reintento de débito en el 2° vencimiento y pago correcto. Precondición: cuota {{nroCuota}} RECHAZADA (flujo 02). Resultado: PAGADA/DEBITADO.', [
  buscarPlan('04.1 Buscar plan', ['VIGENTE', 'CADUCO']),
  detalle('04.2 Detalle — cuota RECHAZADA', {
    vencimiento: 2,
    test: elegirNroCuota + `if (!c) cortar('No existe la cuota ' + v('nroCuota'));
else if (c.estadoCuota !== 'RECHAZADA') cortar('La cuota debe estar RECHAZADA (' + resumen(c) + ') — correr antes el flujo 02');
else pm.test('Cuota ' + c.numeroCuota + ' RECHAZADA', () => pm.expect(c.estadoCuota).to.eql('RECHAZADA'));`,
  }),
  segundoVencimiento('04.3 Tracer cuota → 2° vencimiento'),
  debito('04.4 Generar débito (2° vencimiento)'),
  esperarCuota('04.5 Esperar DEBITO_ENVIADO', "c.estadoDebito === 'DEBITO_ENVIADO'", 'DEBITO_ENVIADO'),
  pagoCuota('04.6 Pago correcto (F3010)', { rechazado: false }),
  esperarCuota('04.7 Esperar PAGADA/DEBITADO', "c.estadoDebito !== 'DEBITO_ENVIADO'", 'procesada', {
    asserts: `\n  pm.test('PAGADA/DEBITADO', () => pm.expect(c.estadoCuota + '/' + c.estadoDebito).to.eql('PAGADA/DEBITADO'));`,
  }),
]);

const f05 = carpeta('05 · Rehabilitación de cuota (A_REHABILITAR → REHABILITADA, F3012)',
  'Consulta de importes + rehabilitación de la cuota {{nroCuota}}. Precondición: plan VIGENTE y cuota A_REHABILITAR (flujos 02 + 03). El nuevo débito de la cuota rehabilitada lo genera el batch GenerarDebitosCuotasRehabilitadas (carpeta 99).', [
  buscarPlan('05.1 Buscar plan', ['VIGENTE']),
  detalle('05.2 Detalle — cuota A_REHABILITAR', {
    test: elegirNroCuota + `if (!c) cortar('No existe la cuota ' + v('nroCuota'));
else if (c.estadoCuota !== 'A_REHABILITAR') cortar('La cuota debe estar A_REHABILITAR (' + resumen(c) + ') — correr antes los flujos 02 y 03');
else pm.test('Cuota ' + c.numeroCuota + ' A_REHABILITAR', () => pm.expect(c.estadoCuota).to.eql('A_REHABILITAR'));`,
  }),
  req({
    nombre: '05.3 Obtener rehabilitación (importes)',
    url: '{{cct}}/api/PlanesDePago/ObtenerRehabilitacionCuota?idCuota={{idTracerCuota}}',
    desc: 'Informativo, no rehabilita.',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
pm.test('codigo 1', () => pm.expect(body.codigo).to.eql(1));
console.log('Importes de rehabilitación', body.content);`,
  }),
  req({
    nombre: '05.4 Generar rehabilitación',
    url: '{{cct}}/api/PlanesDePago/GenerarRehabilitacionCuota?idCuota={{idTracerCuota}}&idPlan={{idTracerPlan}}',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
if (body.codigo !== 1) cortar('GenerarRehabilitacionCuota no confirmó éxito: ' + JSON.stringify(body));
else pm.test('codigo 1 — transaction ' + (body.content && body.content.respuesta && body.content.respuesta.transaction), () => pm.expect(body.codigo).to.eql(1));`,
  }),
  esperarCuota('05.5 Esperar REHABILITADA', "c.estadoCuota === 'REHABILITADA'", 'REHABILITADA'),
]);

const f06 = carpeta('06 · Anulación de pago (PAGADA → ANULADA, F3014)',
  'Anula el pago de la cuota {{nroCuota}}. Precondición: cuota PAGADA/DEBITADO y transactionPago con el transaction del F3010 que la pagó (lo deja el flujo 01; si no, cargarlo a mano). Resultado: ANULADA/ANULADO.', [
  buscarPlan('06.1 Buscar plan', ['VIGENTE']),
  detalle('06.2 Detalle — cuota PAGADA', {
    test: elegirNroCuota + `if (!c) cortar('No existe la cuota ' + v('nroCuota'));
else if (c.estadoCuota + '/' + c.estadoDebito !== 'PAGADA/DEBITADO') cortar('La cuota debe estar PAGADA/DEBITADO (' + resumen(c) + ')');
else if (!v('transactionPago')) cortar('Falta transactionPago (transaction del F3010 que pagó la cuota)');
else pm.test('Cuota ' + c.numeroCuota + ' PAGADA — comprobante ' + v('transactionPago'), () => pm.expect(c.estadoCuota).to.eql('PAGADA'));`,
  }),
  tracerCuota('06.3 Tracer cuota → ID_Debito'),
  registrarFormulario('06.4 Anular pago (F3014)', 3014,
    "armarPayload({ extra: { Comprobante_anulado: String(v('transactionPago')), Observaciones: 'Anulacion de pago - prueba QA Postman', Agente: 'sistema', Usuario_agente: 'sistema' } })"),
  esperarCuota('06.5 Esperar ANULADA/ANULADO', "c.estadoCuota === 'ANULADA'", 'ANULADA', {
    asserts: `\n  pm.test('Débito ANULADO', () => pm.expect(c.estadoDebito).to.eql('ANULADO'));`,
  }),
]);

const f07 = carpeta('07 · Nulidad del plan (VIGENTE → NULO, F3011)',
  'Rechazar la cuota 1 anula el plan entero automáticamente. Usa siempre la cuota 1 (ignora {{nroCuota}}). Precondición: plan VIGENTE y cuota 1 libre. Para volver a VIGENTE: flujo 08.', [
  buscarPlan('07.1 Buscar plan', ['VIGENTE']),
  detalle('07.2 Detalle — cuota 1 libre', {
    test: `const c = elegir(buscarCuota(1));
if (!c) cortar('No existe la cuota 1');
else if (!libre(c)) cortar('La cuota 1 no está libre (' + resumen(c) + ')');
else pm.test('Cuota 1 libre', () => pm.expect(libre(c)).to.be.true);`,
  }),
  debito('07.3 Generar débito cuota 1'),
  esperarCuota('07.4 Esperar DEBITO_ENVIADO', "c.estadoDebito === 'DEBITO_ENVIADO'", 'DEBITO_ENVIADO'),
  pagoCuota('07.5 Rechazo cuota 1 (F3010 con R10)', { rechazado: true }),
  esperarPlan('07.6 Esperar plan NULO', 'NULO'),
]);

const f08 = carpeta('08 · Reversa de nulidad (NULO → VIGENTE, F3013)', 'Precondición: plan NULO (flujo 07).', [
  buscarPlan('08.1 Buscar plan', ['NULO']),
  req({
    nombre: '08.2 Reversar nulidad', metodo: 'POST', sinAuth: true,
    url: '{{publicador}}/publicador/PFP/ReversarNulidades', cuerpo: '["{{solicitud}}"]',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log((body && body.lstMessages) || body);`,
  }),
  esperarPlan('08.3 Esperar plan VIGENTE', 'VIGENTE'),
]);

const f09 = carpeta('09 · Caducidad del plan (VIGENTE → CADUCO, F3003)',
  'Caducidad puntual por solicitud. Precondición: al menos 2 cuotas RECHAZADA (flujo 02 dos veces, con nroCuota 2 y 3). La fecha de proceso se calcula como el 2° vencimiento de la última cuota rechazada + 120 días (receta probada); se puede forzar con fechaCaducidadManual.', [
  buscarPlan('09.1 Buscar plan', ['VIGENTE']),
  detalle('09.2 Detalle — ≥ 2 cuotas RECHAZADA', {
    test: `const rechazadas = cuotas.filter(c => c.estadoCuota === 'RECHAZADA');
// El detalle puede traer vencimientoCuota2 = "-": se estima como 1° vencimiento + 15 días (el 2° cae entre 14 y 18 días después).
const venc2 = c => /^\\d{4}-/.test(aISO(c.vencimientoCuota2)) ? aISO(c.vencimientoCuota2) : new Date(new Date(aISO(c.vencimientoCuota1)).getTime() + 15 * 86400000).toISOString().slice(0, 10);
const ultimo = rechazadas.map(venc2).sort().pop();
const fecha = v('fechaCaducidadManual') || (ultimo ? new Date(new Date(ultimo).getTime() + 120 * 86400000).toISOString().slice(0, 10) : '');
set('fechaCaducidad', fecha);
if (rechazadas.length < 2) cortar('Hacen falta 2 cuotas RECHAZADA (hay ' + rechazadas.length + ') — correr el flujo 02 con dos cuotas');
else pm.test(rechazadas.length + ' cuotas RECHAZADA — fecha de proceso ' + fecha, () => pm.expect(fecha).to.match(/^\\d{4}-\\d{2}-\\d{2}$/));`,
  }),
  req({
    nombre: '09.3 Generar caducidad por solicitud', sinAuth: true,
    url: '{{publicador}}{{pfpIndiv}}/GenerarCaducidadPorSolicitud?solicitud={{solicitud}}&fecha={{fechaCaducidad}}',
    desc: 'Ojo: el parámetro es "solicitud", no "idSolicitud" (con el nombre mal responde 200 con respuestaMasivo vacío y no hace nada). Puede tardar más de 30 s.',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
pm.test('Procesó el plan', () => pm.expect((body && body.respuestaMasivo) || [], 'respuestaMasivo vacío: no se procesó').to.not.be.empty);
console.log(body);`,
  }),
  esperarPlan('09.4 Esperar plan CADUCO', 'CADUCO'),
]);

const f10 = carpeta('10 · Reversa de caducidad (CADUCO → VIGENTE, F3006)',
  'Precondición: plan CADUCO (flujo 09). La reversa no toca las cuotas: las RECHAZADA quedan como estaban.', [
  buscarPlan('10.1 Buscar plan', ['CADUCO']),
  req({
    nombre: '10.2 Reversar caducidad', metodo: 'POST', sinAuth: true,
    url: '{{publicador}}/publicador/PFP/ReversarCaducidades', cuerpo: '["{{solicitud}}"]',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log((body && body.lstMessages) || body);`,
  }),
  esperarPlan('10.3 Esperar plan VIGENTE', 'VIGENTE'),
]);

const f11 = carpeta('11 · Cancelación del plan (todas pagas → CANCELADO, F3002)',
  'Paga en bucle todas las cuotas libres (1° vencimiento) y cancela el plan con el endpoint puntual. Correr con el Runner: los pasos 11.2 a 11.6 se repiten por cada cuota. Precondición: plan VIGENTE, cuotas PAGADA o libres. GenerarCancelacionPorSolicitud sólo está confirmado en QA_AV.', [
  buscarPlan('11.1 Buscar plan', ['VIGENTE']),
  detalle('11.2 Siguiente cuota impaga', {
    test: `const impagas = cuotas.filter(c => c.estadoCuota !== 'PAGADA');
const c = impagas[0];
if (!c) { pm.test('Todas las cuotas PAGADA', () => pm.expect(cuotas.length).to.be.above(0)); siguiente('11.7 Cancelar plan por solicitud'); }
else if (!libre(c)) cortar('La cuota ' + c.numeroCuota + ' no está PAGADA ni libre (' + resumen(c) + ') — resolverla antes');
else { elegir(c); pm.test('Próxima a pagar: cuota ' + c.numeroCuota + ' (quedan ' + impagas.length + ')', () => pm.expect(libre(c)).to.be.true); }`,
  }),
  debito('11.3 Generar débito'),
  esperarCuota('11.4 Esperar DEBITO_ENVIADO', "c.estadoDebito === 'DEBITO_ENVIADO'", 'DEBITO_ENVIADO'),
  pagoCuota('11.5 Pago correcto (F3010)', { rechazado: false }),
  esperarCuota('11.6 Esperar PAGADA y volver a 11.2', "c.estadoDebito !== 'DEBITO_ENVIADO'", 'procesada', {
    asserts: `\n  pm.test('PAGADA/DEBITADO', () => pm.expect(c.estadoCuota + '/' + c.estadoDebito).to.eql('PAGADA/DEBITADO'));`,
    siguienteOk: '11.2 Siguiente cuota impaga',
  }),
  req({
    nombre: '11.7 Cancelar plan por solicitud', sinAuth: true,
    url: '{{publicador}}{{pfpIndiv}}/GenerarCancelacionPorSolicitud?idSolicitud={{solicitud}}',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
  esperarPlan('11.8 Esperar plan CANCELADO', 'CANCELADO'),
]);

const f12 = carpeta('12 · CA — Solicitud y débito (VIGENTE → CA_PENDIENTE → CA_ENVIADA_DEBITO, F3005 + F3009)',
  'Solicita la Cancelación Anticipada por API y genera su débito. Precondición: plan VIGENTE de 3+ cuotas, cuota 1 PAGADA, ninguna cuota con débito en curso y al menos una cuota adeudada (usar un plan limpio). Después: flujo 13 (pago) o 14 (rechazo).', [
  buscarPlan('12.1 Buscar plan', ['VIGENTE']),
  detalle('12.2 Detalle — plan apto para CA', {
    test: `const enCurso = cuotas.filter(c => c.estadoDebito === 'DEBITO_ENVIADO');
const c1 = buscarCuota(1);
if (cuotas.length < 3) cortar('La CA necesita un plan de 3+ cuotas (tiene ' + cuotas.length + ')');
else if (!c1 || c1.estadoCuota !== 'PAGADA') cortar('La cuota 1 debe estar PAGADA (' + resumen(c1) + ') — correr el flujo 01 con nroCuota=1');
else if (enCurso.length) cortar('Hay débitos en curso (cuotas ' + enCurso.map(c => c.numeroCuota).join(', ') + '): el portal bloquea la CA');
else if (cuotas.every(c => c.estadoCuota === 'PAGADA')) cortar('No existen cuotas adeudadas');
else pm.test('Plan apto para CA', () => pm.expect(enCurso).to.be.empty);`,
  }),
  req({
    nombre: '12.3 Obtener cancelación anticipada (informativo)',
    url: '{{cct}}/api/PlanesDePago/ObtenerCancelacionAnticipada?idTracer={{idTracerPlan}}&idDuty={{idDuty}}',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
  req({
    nombre: '12.4 Solicitar cancelación anticipada (F3005)',
    url: '{{cct}}/api/PlanesDePago/SolicitarCancelacionAnticipada?idTracer={{idTracerPlan}}&idDuty={{idDuty}}&usuario={{cuit}}',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
  esperarPlan('12.5 Esperar CA_PENDIENTE', 'CA_PENDIENTE'),
  tracerPlanCA('12.6 Tracer plan → CA_Fecha_Emision_DRG'),
  req({
    nombre: '12.7 Generar débitos de CA (F3009)', sinAuth: true,
    url: '{{publicador}}/publicador/PFP/GenerarDebitosCancelacionAnticipada?fecha={{fechaEmisionCA}}',
    desc: '⚠ Toma todas las CA_PENDIENTE del ambiente con esa fecha de emisión, no sólo este plan (mismo uso que los tests de regresión).',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
  esperarPlan('12.8 Esperar CA_ENVIADA_DEBITO', 'CA_ENVIADA_DEBITO'),
]);

const f13 = carpeta('13 · CA — Pago (CA_ENVIADA_DEBITO → CA_PAGADA, F3008)',
  'Pago del débito de la Cancelación Anticipada. Precondición: plan CA_ENVIADA_DEBITO (flujo 12 o 15).', [
  buscarPlan('13.1 Buscar plan', ['CA_ENVIADA_DEBITO']),
  tracerPlanCA('13.2 Tracer plan → CA_Fecha_Emision_DRG'),
  pagoCuota('13.3 Pago de la CA', { rechazado: false, ca: true, fecha: '{{fechaEmisionCA}}' }),
  esperarPlan('13.4 Esperar CA_PAGADA', 'CA_PAGADA'),
]);

const f14 = carpeta('14 · CA — Rechazo (CA_ENVIADA_DEBITO → CA_RECHAZADA)',
  'Rechazo del débito de la CA: F3010 con concepto 7529 y código R10 sobre la cuota con el débito de CA enviado. Precondición: plan CA_ENVIADA_DEBITO (flujo 12). Después: flujo 15.', [
  buscarPlan('14.1 Buscar plan', ['CA_ENVIADA_DEBITO']),
  detalle('14.2 Detalle — cuota con débito de CA', {
    test: `const c = elegir(cuotas.find(x => x.estadoDebito === 'DEBITO_ENVIADO'));
if (!c) cortar('No hay cuota con DEBITO_ENVIADO (débito de la CA)');
else pm.test('Débito de CA en cuota ' + c.numeroCuota, () => pm.expect(c.estadoDebito).to.eql('DEBITO_ENVIADO'));`,
  }),
  tracerCuota('14.3 Tracer cuota → ID_Debito'),
  registrarFormulario('14.4 Rechazar CA (F3010 concepto 7529)', 3010, 'armarPayload({ correcto: false, concepto: 7529 })'),
  esperarPlan('14.5 Esperar CA_RECHAZADA', 'CA_RECHAZADA'),
]);

const f15 = carpeta('15 · CA — Rehabilitación (CA_RECHAZADA → CA_REHABILITADA → CA_ENVIADA_DEBITO)',
  'Vuelve a solicitar la CA por API (el botón del portal queda deshabilitado fuera de VIGENTE) y genera el nuevo débito. Precondición: plan CA_RECHAZADA (flujo 14). Después: flujo 13 para pagarla.', [
  buscarPlan('15.1 Buscar plan', ['CA_RECHAZADA']),
  req({
    nombre: '15.2 Solicitar cancelación anticipada de nuevo (F3005)',
    url: '{{cct}}/api/PlanesDePago/SolicitarCancelacionAnticipada?idTracer={{idTracerPlan}}&idDuty={{idDuty}}&usuario={{cuit}}',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
  esperarPlan('15.3 Esperar CA_REHABILITADA', 'CA_REHABILITADA'),
  tracerPlanCA('15.4 Tracer plan → CA_Fecha_Emision_DRG'),
  req({
    nombre: '15.5 Generar débitos de CA (F3009)', sinAuth: true,
    url: '{{publicador}}/publicador/PFP/GenerarDebitosCancelacionAnticipada?fecha={{fechaEmisionCA}}',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
  esperarPlan('15.6 Esperar CA_ENVIADA_DEBITO', 'CA_ENVIADA_DEBITO'),
]);

const f99 = carpeta('99 · Procesos batch por fecha ⚠',
  'No son puntuales por plan: procesan todo lo elegible del ambiente para la fecha. No se incluyen GenerarCaducidades ni GenerarCancelaciones globales (caducan/cancelan planes de otros y dan 504).', [
  req({
    nombre: '99.1 Generar débitos de cuotas rehabilitadas', sinAuth: true,
    url: '{{publicador}}/publicador/PFP/GenerarDebitosCuotasRehabilitadas?fecha={{fechaDebitosRehabilitadas}}',
    desc: 'Nuevo débito para las cuotas REHABILITADA. Cargar fechaDebitosRehabilitadas (YYYY-MM-DD).',
    test: `pm.test('HTTP 200', () => pm.response.to.have.status(200));
console.log(body);`,
  }),
]);

// ─── Colección y environments ───────────────────────────────────────────────

const variable = (key, value, description) => ({ key, value: String(value), type: 'string', description });

const DESCRIPCION = `Flujos de Planes de Facilidades de Pago (PFP) sobre la API real: pago, rechazo, rehabilitación y anulación de cuotas, y cambios de estado del plan (nulidad, caducidad, cancelación, cancelación anticipada y sus reversas).

**Cómo usarla**
1. Importar la colección y el environment (QA_AV o QA) y seleccionarlo.
2. En las variables de la colección cargar \`cuit\`, \`solicitud\`, \`anio\` y \`nroCuota\`.
3. Correr cada carpeta con el Runner (Run folder). Las esperas de estado se reintentan solas sólo en el Runner; mandando a mano, repetir el request de espera.

El JWT se obtiene solo (pre-request de la colección) y se renueva si cambia el CUIT. La fecha de Emisión DRG se calcula a partir del vencimiento de la cuota con la tabla embebida en \`tablaEmisionDRG\` (forzable con \`fechaEmisionDGRManual\`).

Cada flujo valida su precondición en el primer paso y corta la corrida si el plan o la cuota no están en el estado esperado.

**Reglas a tener en cuenta**
- Rechazar la cuota 1 anula el plan entero (F3011). Los flujos 02/03 no lo permiten; para eso está el 07.
- A_REHABILITAR requiere dos rechazos de la misma cuota: 1° vencimiento (flujo 02) y 2° vencimiento (flujo 03).
- La Cancelación Anticipada necesita un plan de 3+ cuotas, con la cuota 1 paga y sin débitos en curso: usar un plan limpio.

**Encadenamientos típicos**
- Rehabilitación: 02 → 03 → 05
- Caducidad: 02 (cuota 2) → 02 (cuota 3) → 09 → 10
- CA completa: 01 (cuota 1) → 12 → 13
- CA con rechazo: 01 (cuota 1) → 12 → 14 → 15 → 13

Generada por scripts/generar-postman.js (repo agip-automation): no editar el JSON a mano, regenerar.`;

const coleccion = {
  info: {
    name: 'PFP — Planes de Facilidades (flujos de cuotas y estados)',
    description: DESCRIPCION,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{jwt}}', type: 'string' }] },
  event: [script('prerequest', PRE_COLECCION)],
  variable: [
    variable('cuit', CONTRIBUYENTES.conPlan.cuit, 'CUIT del contribuyente titular del plan'),
    variable('solicitud', '1523073212', 'Nro. de solicitud del plan'),
    variable('anio', new Date().getFullYear(), 'Año para ObtenerPlanesDePago'),
    variable('nroCuota', 2, 'Cuota sobre la que operan los flujos 01-06 (nunca 1 para rechazos)'),
    variable('maxIntentos', 30, 'Reintentos de los pasos "Esperar ..."'),
    variable('esperaMs', 3000, 'Pausa entre reintentos (ms)'),
    variable('fechaEmisionDGRManual', '', 'Opcional: fuerza la fecha de Emisión DRG (YYYY-MM-DD)'),
    variable('fechaCaducidadManual', '', 'Opcional: fuerza la fecha de proceso de la caducidad (YYYY-MM-DD)'),
    variable('fechaDebitosRehabilitadas', '', 'Fecha para el batch 99.1 (YYYY-MM-DD)'),
    variable('transactionPago', '', 'Transaction del F3010 que pagó la cuota (lo deja el flujo 01, lo usa el 06)'),
    variable('fechaEmisionCA', '', 'CA_Fecha_Emision_DRG del plan (la cargan los flujos de CA)'),
    variable('tablaEmisionDRG', JSON.stringify(TABLA_EMISION_DRG.map(r => [r.VencimientoCuota, r.EmitirDRG])), 'Tabla PFP_Emision_DRG [vencimiento, emisión] — fixtures/pfpEmisionDRG.js'),
    ...['jwt', 'jwtCuit', 'jwtTs', 'tokenClaveCiudad', 'idTracerPlan', 'idDuty', 'idAcogimiento', 'period', 'tax', 'estadoPlan',
      'cuotasResumen', 'cuotaFlujo', 'cuotaJson', 'idTracerCuota', 'vencimiento', 'vencObjetivo', 'fechaEmisionDGR',
      'esPrimerIntento', 'idDebito', 'fechaCaducidad', 'payload'].map(k => variable(k, '', 'Uso interno (lo setean los scripts)')),
  ],
  item: [f00, f01, f02, f03, f04, f05, f06, f07, f08, f09, f10, f11, f12, f13, f14, f15, f99],
};

function environment(nombre, hosts, pfpIndiv) {
  return {
    name: `PFP ${nombre}`,
    values: [
      { key: 'cct', value: hosts.cct, type: 'default', enabled: true },
      { key: 'publicador', value: hosts.publicador, type: 'default', enabled: true },
      { key: 'txsapi', value: hosts.txsapi, type: 'default', enabled: true },
      { key: 'pfpIndiv', value: pfpIndiv, type: 'default', enabled: true },
      { key: 'sign', value: SIGN_CCT, type: 'secret', enabled: true },
      { key: 'cuitAutenticado', value: CUIT_AUTENTICADO, type: 'default', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
}

fs.mkdirSync(SALIDA, { recursive: true });
const escribir = (archivo, datos) => fs.writeFileSync(path.join(SALIDA, archivo), JSON.stringify(datos, null, 2) + '\n');
escribir('PFP_Planes_de_Facilidades.postman_collection.json', coleccion);
escribir('PFP_QA_AV.postman_environment.json', environment('QA_AV', AMBIENTES_API['qa-av'], '/publicador/PFPIndividuales'));
escribir('PFP_QA.postman_environment.json', environment('QA', AMBIENTES_API.qa, '/publicador/PFP'));
console.log(`Colección y environments generados en ${SALIDA}`);
