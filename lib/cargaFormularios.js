// lib/cargaFormularios.js
// Port de la herramienta interna "carga_unificada_formularios_final_v3.html"
// (no versionada, provista por el usuario 2026-10-14): registra DJs/pagos de
// prueba en QA para un CUIT. Mismos endpoints y mismos bodies que el HTML.
//
//   1234 — Saldo a favor en la cuenta corriente ("Saldo Reimputar Pago": pago ACREDITADO)
//   5220 — DJ Contribuyentes Locales (impuesto 4)
//   5225 — DJ Agentes de Recaudación (impuesto 20)
//   5556 — DJ Sellos (impuesto = cada tasa indicada)
//   5866 — DJ Convenio Multilateral (impuesto 2) — la DEUDA que usan los
//          planes 461 de la suite (así se cargaron los $5.000.000 por período
//          del CUIT 27236036044, 2021/01–2022/07)
//
// Uso desde código: cargarFormulario(request, '5866', { cuits, anio, meses, deuda })
// Uso manual: scripts/cargar-formulario.js (ver --help).
//
// ⚠ Escribe en el ambiente QA compartido (QA_HOMO y QA_AV comparten datos).
// Igual que el HTML, apunta por default a los hosts de "qa".
const { withClient } = require('./mongoAdmin');
const { AMBIENTES_API } = require('../fixtures/test-data');

const FORMULARIOS = {
  1234: { nombre: 'Saldo a favor (Saldo Reimputar Pago)', host: 'cct', ruta: '/api/Registracion/RegistrarFormulario?formulario=1234' },
  5220: { nombre: 'Contribuyentes Locales', host: 'txsapi', ruta: '/api/Receptor/5220/1.0.1' },
  5225: { nombre: 'Agentes de Recaudación', host: 'cct', ruta: '/api/Registracion/RegistrarFormulario?formulario=5225' },
  5556: { nombre: 'Sellos', host: 'cct', ruta: '/api/Registracion/RegistrarFormulario?formulario=5556' },
  5866: { nombre: 'Convenio Multilateral', host: 'txsapi', ruta: '/api/Receptor/5866/1.0.1' },
};

const pad2 = n => String(n).padStart(2, '0');

// ID de 8 dígitos sin ceros (generarIDString del HTML).
function generarIdDj() {
  let id = '';
  while (id.length < 8) id += String(1 + Math.floor(Math.random() * 9));
  return id;
}

/** "6" · "1-5" · "3,6,9" · "1-3,8" → [meses ordenados 1..12] (expandMonths del HTML). */
function expandirMeses(valor) {
  const meses = new Set();
  for (const parte of String(valor ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [a, b] = parte.split('-').map(n => parseInt(n, 10));
    const [desde, hasta] = Number.isNaN(b) || b === undefined ? [a, a] : [Math.min(a, b), Math.max(a, b)];
    for (let m = desde; m <= hasta; m++) if (m >= 1 && m <= 12) meses.add(m);
  }
  return [...meses].sort((x, y) => x - y);
}

const lista = v => (Array.isArray(v) ? v : String(v ?? '').split(',')).map(s => String(s).trim()).filter(Boolean);

// ─── Bodies (copiados del HTML, sólo se parametrizan CUIT/período/montos) ────

function body1234({ cuit, anio, mes, tasa, monto, concepto = 'CAPITAL', fecha }) {
  const id = generarIdDj();
  return {
    header: {
      idPerson: Number(cuit), period: Number(`${anio}${pad2(mes)}00`), tax: Number(tasa), asset: '',
      quota: Number(tasa) === 40 ? Math.ceil(mes / 2) : mes, amount: monto,
    },
    Registros: {
      Estado: 'ACREDITADO', Fecha_operacion: fecha, Fecha_pago: fecha,
      Nro_VEP: 0, Transaccion_VEP: 0, Nro_cheque: 0, Nro_resolucion: 0,
      Comprobante: id, Nro_hub_de_pago: id, Monto: monto, Concepto: concepto,
    },
  };
}

function body5220({ cuit, anio, mes, deuda, ret = 0, perc = 0 }) {
  const mm = pad2(mes);
  return {
    header: { idPerson: Number(cuit), tax: 4, period: Number(`${anio}${mm}00`), quota: mes, asset: '', amount: deuda },
    Registros: {
      ID_DJ: generarIdDj(),
      Fecha_operacion: `${anio}-${mm}-01T14:23:11.0177181-03:00`,
      Fecha_presentacion: `${anio}-${mm}-01T14:23:11.0177181-03:00`,
      Fecha_vencimiento: `${anio}-${mm}-20T00:00:00`,
      Concepto: 0, Razon_social: 'SHU XUEMEI', Fecha_pago: `${anio}-${mm}-02T00:00:00`, ISIB: 156169008,
      Total_ingresos_no_grabados: 0.0, Total_ingresos_exentos: 0.0, Total_deducciones: 0.0,
      Conceptos_no_integran_base_imponible: 0.0, Retenciones: ret, Percepciones: perc,
      Pagos_a_cuenta: 0.0, Saldos_favor: 0.0, Impuesto_determinado: deuda, Otros_debitos: 0.0,
      Otros_creditos: 0.0, Mecenazgo: 0.0, Diferimiento: 0.0, Compania_de_seguros: 0.0,
      Credito_periodo_anterior: 0.0, Saldo_favor_no_monetario_a_reimputar: 0.0,
      Saldo_favor_monetario_a_reimputar: 0.0, Pago_mecenazgo_promotor: 0.0,
      Pago_mecenazgo_benefactor: 0.0, Promocion_hotelera: 0.0, Saldo_favor_anual_cia_seguros: 0.0,
      Fibra_optica: 0.0, Pago_cuenta_empresas_de_transporte: 0.0, Pago_cuenta_mecenazgo: 0.0,
      Pago_cuenta_pago_inscripcion: 0.0, Pago_cuenta_plan_facilidades: 0.0, Pago_cuenta_promocion_hotelera: 0.0,
    },
    Actividades: [{ Descripcion: '', Cod_actividad: 471130, Alicuota: 3.0, Base_imponible: 2660818.84, Impuesto_actividad: 79824.57 }],
  };
}

function body5225({ cuit, anio, mes, deuda, ret = 0, perc = 0 }) {
  const mm = pad2(mes);
  return {
    header: { idPerson: Number(cuit), period: Number(`${anio}${mm}00`), tax: 20, asset: '', quota: mes, amount: deuda },
    Registros: {
      ID_DJ: generarIdDj(),
      Fecha_operacion: `${anio}-${mm}-01`, Fecha_presentacion: `${anio}-${mm}-01`, Fecha_vencimiento: `${anio}-${mm}-20`,
      Razon_social: 'ABCDEFGH', Concepto: 0, Tipo_agente: 'ABCDEFGHIJKL', Situacion_IVA: 'ABCDEFGH',
      Domicilio_fiscal: 'ABCDEFGHI', Nro_agente: 123, Nombre_apellido: 'Pablo Calligo', Caracter_de: 'ABCDEFGHI',
      Tipo_doc: 'DNI', Nro_documento: 369233646, Total_ret_percep_practicadas: deuda, Total_pagos_a_cuenta: 0.00,
      Total_notas_credito: 0.00, Total_DJ: deuda, Monto_interes: 0.00, Monto_retardo: 0.00, Importe_a_depositar: deuda,
    },
    Retenciones: [{ Descripcion: 'ABCDEFGHIJKL', Alicuota: 1.00, Registros: 1, Monto: ret, Monto_retenido: ret }],
    Percepciones: [{ Descripcion: 'ABCDEFGH', Alicuota: 1.00, Registros: 1, Monto: perc, Monto_percibido: perc }],
  };
}

function body5556({ cuit, anio, mes, tasa, deuda, fecha }) {
  const mm = pad2(mes);
  return {
    header: { idPerson: Number(cuit), period: Number(`${anio}${mm}00`), tax: Number(tasa), asset: '', quota: mes, amount: deuda },
    Registros: {
      Cabecera_id: 100, ID_DJ: generarIdDj(), Obligacion: '201500000000122719', Secuencial: 0,
      Cantidad_presentaciones: 2, Total_presentacion: deuda, Pago_declarado: 0, Saldo_declarado: deuda,
      Comision: 0.00, IVA: 0.00, Fecha_presentacion: fecha, Fecha_vencimiento: `${anio}-${mm}-20`,
    },
  };
}

function body5866({ cuit, anio, mes, deuda, ret = 0, perc = 0 }) {
  const mm = pad2(mes);
  const fecha = `${anio}-${mm}-01T00:00:00.000-03:00`;
  return {
    header: { idPerson: Number(cuit), period: Number(`${anio}${mm}00`), tax: 2, asset: '', quota: mes, amount: deuda },
    Registros: {
      ID_DJ: generarIdDj(), Tipo_dj: 4, Fecha_presentacion: fecha, Fecha_operacion: fecha, Concepto: 0,
      Razon_social: 'Test razon social', Inscripto: '7777777777', Cod_jurisdiccion: 901, Base_imponible: 0.0,
      Impuesto_determinado: deuda, Ingresos_gravados: 0.0, Ingresos_no_gravados: 0.0, Ingresos_exentos: 0.0,
      Coeficiente_unificado: 0.0, Saldos_a_favor_periodos_anteriores: 0.0, Percepciones_soportadas: perc,
      Compensaciones_percepcion: 0.0, Retenciones_bancarias: 0.0, Retenciones: ret, Percepciones_aduaneras: 0.0,
      Otros_debitos: 0.0, Creditos_anticipo: 0.0, Pagos_no_bancarios: 0.0, Mecenazgo: 0.0, Diferimiento: 0.0,
      Compania_de_seguros: 0.0, Otros_creditos: 0.0, Fibra_optica: 0.0, Promocion_hotelera: 0.0,
      Pago_cuenta_empresas_carga_camiones: 0.0, Monto_exportacion: 0.0, Ingresos_totales: 0.0,
      Monto_imponible_art_2: 0.0, Monto_imponible_inicio_de_actividad: 0.0,
      Monto_imponible_regimenes_especiales: 0.0, Transaccion_afip: '777777777',
    },
    Jurisdicciones: [{ Cod_jurisdiccion: 901, Coeficiente_unificado: 0.0 }],
    Actividades: [{ Cod_actividad: 641930, Cod_regimen: 8, Tratamiento_fiscal: 0, Base_imponible: 20149272.2, Base_ajustada: 20149272.2, Alicuota: 8.0, Impuesto_actividad: 50000.00 }],
  };
}

/**
 * Arma los bodies de un formulario para todas las combinaciones
 * CUIT × mes (× tasa en 1234/5556), igual que el botón "Enviar" del HTML.
 * @param {'1234'|'5220'|'5225'|'5556'|'5866'} formulario
 * @param {{cuits, anio, meses, tasas?, deuda?, monto?, ret?, perc?, concepto?, fecha?}} datos
 *   cuits/tasas: array o "a, b"; meses: array o "1-5,8"; fecha (1234/5556): YYYY-MM-DD, default hoy.
 */
function construirBodies(formulario, datos) {
  const cuits = lista(datos.cuits);
  const meses = Array.isArray(datos.meses) ? datos.meses : expandirMeses(datos.meses);
  const anio = Number(datos.anio);
  if (!FORMULARIOS[formulario]) throw new Error(`Formulario desconocido: ${formulario}. Opciones: ${Object.keys(FORMULARIOS).join(', ')}`);
  if (!cuits.length || !anio || !meses.length) throw new Error('Completar CUIT(s), año y mes(es) — ej. mes: "06", "1-5" o "3,6,9"');

  const fecha = datos.fecha || new Date().toISOString().slice(0, 10);
  const tasas = lista(datos.tasas);
  if (['1234', '5556'].includes(String(formulario)) && !tasas.length) throw new Error(`El formulario ${formulario} necesita tasas`);
  const deuda = Number(datos.deuda ?? datos.monto);
  const comun = { anio, ret: Number(datos.ret || 0), perc: Number(datos.perc || 0), fecha };

  const envios = [];
  for (const cuit of cuits) {
    for (const mes of meses) {
      const base = { ...comun, cuit, mes };
      switch (String(formulario)) {
        case '1234':
          for (const tasa of tasas) envios.push({ cuit, mes, tasa, body: body1234({ ...base, tasa, monto: deuda, concepto: datos.concepto }) });
          break;
        case '5556':
          for (const tasa of tasas) envios.push({ cuit, mes, tasa, body: body5556({ ...base, tasa, deuda }) });
          break;
        case '5220': envios.push({ cuit, mes, body: body5220({ ...base, deuda }) }); break;
        case '5225': envios.push({ cuit, mes, body: body5225({ ...base, deuda }) }); break;
        case '5866': envios.push({ cuit, mes, body: body5866({ ...base, deuda }) }); break;
      }
    }
  }
  return envios;
}

/**
 * Registra el formulario para cada combinación y devuelve
 * [{ cuit, mes, tasa?, body, status, ok, respuesta }]. No corta ante un error
 * puntual (igual que el HTML): revisar `ok` de cada envío.
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function cargarFormulario(request, formulario, datos, { ambiente = 'qa' } = {}) {
  const { host, ruta } = FORMULARIOS[formulario] ?? {};
  const url = `${AMBIENTES_API[ambiente][host]}${ruta}`;
  const resultados = [];
  for (const envio of construirBodies(formulario, datos)) {
    const resp = await request.post(url, { data: envio.body, timeout: 60000 }).catch(e => ({ error: e }));
    const texto = resp.error ? String(resp.error.message) : await resp.text();
    let respuesta; try { respuesta = JSON.parse(texto); } catch { respuesta = texto; }
    const ok = !resp.error && resp.ok() && !respuesta?.errores?.length;
    const etiqueta = `${formulario} CUIT ${envio.cuit}${envio.tasa ? ` tasa ${envio.tasa}` : ''} ${datos.anio}/${pad2(envio.mes)}`;
    console.log(`cargarFormulario — ${etiqueta}: ${ok ? 'OK' : 'ERROR'} ${texto.slice(0, 200)}`);
    resultados.push({ ...envio, status: resp.error ? 0 : resp.status(), ok, respuesta });
  }
  return resultados;
}

/** Períodos (YYYYMM00) que ya tienen el formulario registrado para el CUIT (DocumentsRepo). */
async function periodosCargados(cuit, formulario = '5866') {
  return withClient(async client => {
    const docs = await client.db('DocumentsRepo').collection(String(formulario))
      .find({ 'content.header.idPerson': Number(cuit) }, { projection: { 'content.header.period': 1 } })
      .toArray();
    return new Set(docs.map(d => d.content.header.period));
  });
}

/**
 * Período más reciente sin DJ cargada, buscando HACIA ATRÁS desde `hasta`
 * (incluido) hasta `minimo`. null si no hay.
 *
 * Default `hasta` = 2022/07 por la regla activa de validación del 5866
 * (Param.RulePackage F5866_V1.0.1_FORM_VALIDATION_DEFAULT_V1.0.4, modificada
 * 2026-09-04): su condición "comprobar_cuit" quedó invertida —
 * `!(period < 20220800) && !tablaCUITS` — y rechaza con "Error 5066-01" TODO
 * período desde 2022/08, para cualquier CUIT, mientras acepta sin validar
 * todo lo anterior. Confirmado en vivo 2026-10-14 (2022/08 y 2022/09
 * rechazados). Si corrigen la regla, se puede pasar otro `hasta`.
 */
async function proximoPeriodoLibre(cuit, { formulario = '5866', hasta = { anio: 2022, mes: 7 }, minimo = { anio: 2015, mes: 1 } } = {}) {
  const cargados = await periodosCargados(cuit, formulario);
  for (let { anio, mes } = hasta; anio * 100 + mes >= minimo.anio * 100 + minimo.mes;) {
    if (!cargados.has(Number(`${anio}${pad2(mes)}00`))) return { anio, mes };
    if (--mes < 1) { mes = 12; anio--; }
  }
  return null;
}

module.exports = {
  FORMULARIOS, expandirMeses, construirBodies, cargarFormulario, periodosCargados, proximoPeriodoLibre,
};
