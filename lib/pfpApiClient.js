// lib/pfpApiClient.js
// Cliente API para el ciclo de vida del PFP (Plan de Facilidades de Pago) —
// Fase 2 de la automatización. Portea la lógica ya validada contra el ambiente
// real por la herramienta HTML de trabajo del usuario ("pfp_flujo_completo (26).html",
// no versionada en el repo — ver memoria pfp-api-endpoints). Desbloquea F3002,
// F3003, F3008, F3009, F3010, F3012, F3014 (ver memoria pfp-formularios-catalogo),
// que no tienen pantalla propia en ningún portal.
//
// Usa el fixture `request` (APIRequestContext) que provee @playwright/test — no
// abre su propio contexto para que las llamadas queden trazadas/reporteadas igual
// que el resto de la suite. Ver tests/api/TC_API_000_smoke.spec.js para el
// reconocimiento en vivo de host/protocolo antes de confiar en este cliente.
const { CUIT_AUTENTICADO, AMBIENTES_API } = require('../fixtures/test-data');
const { buscarEmitirDRG } = require('../fixtures/pfpEmisionDRG');

// GenerarCancelaciones (y probablemente GenerarCaducidades) son batch pesados
// que recorren todos los planes elegibles del ambiente — confirmado en vivo
// que GenerarCancelaciones puede tardar 30s+ y devolver 504 con el timeout por
// defecto. Se les da más margen que al resto de las llamadas.
const TIMEOUT_BATCH_MS = 90000;

class PfpApiClient {
  /**
   * @param {import('@playwright/test').APIRequestContext} request - fixture `request` de Playwright
   * @param {'qa'|'qa-av'} ambiente
   */
  constructor(request, ambiente = 'qa') {
    if (!AMBIENTES_API[ambiente]) {
      throw new Error(`Ambiente API desconocido: "${ambiente}". Usar "qa" o "qa-av".`);
    }
    this.request = request;
    this.ambiente = ambiente;
    this.hosts = AMBIENTES_API[ambiente];
    this.token = null; // JWT Bearer, seteado por autenticar()
  }

  /**
   * Base de los endpoints "puntuales por solicitud" de api-publicador.
   * ⚠ CONFIRMADO EN VIVO (2026-08-20) vía swagger.json que el path cambia
   * según el ambiente: "qa" los tiene bajo /publicador/PFP/, "qa-av" los tiene
   * bajo /publicador/PFPIndividuales/ (deployment más nuevo). Mismos nombres
   * de parámetro en ambos. "qa-av" además tiene GenerarCancelacionPorSolicitud
   * (F3002/F3008 puntual), que no se confirmó que exista en "qa".
   */
  get _publicadorIndividualesBase() {
    return this.ambiente === 'qa-av' ? '/publicador/PFPIndividuales' : '/publicador/PFP';
  }

  // Mismo XML/Base64 que pages/LoginPage.js — confirmado idéntico contra el ambiente real.
  generarToken(cuitRepresentado) {
    const expTime = Math.floor(Date.now() / 1000) + 3600;
    const data = `<?xml version="1.0" encoding="iso-8859-1"?><datos><servicio nombre="agip_scct_cicd" exp_time="${expTime}" /><autenticado cuit="${CUIT_AUTENTICADO}" nombre="Usuario Prueba" isib="${CUIT_AUTENTICADO}" cat="40" codcalle="2207" calle="BOLIVAR" puerta="4310" piso="" dpto="" codpostal="B1874CKB" codlocalidad="101" localidad="VILLA DOMINICO" codprov="1" provincia="BUENOS AIRES" telefono="43238600" email="desarrolloweb@agip.gob.ar" nivel="2" tipoDocumento="3003" documento="42090147"><\/autenticado><representados><representado cuit="${cuitRepresentado}" nombre="EMPRESA PRUEBA" isib="" cat="" codcalle="42570" calle="AVDA DEL LIBERTADOR" puerta="6363" piso="" dpto="" codpostal="C1428CKB" codlocalidad="1200" localidad="CIUDAD AUTONOMA DE BS AS" codprov="2" provincia="CAPITAL FEDERAL" telefono="" email="" tipoRepresentacion="1" tipoDocumento="" documento="" elegido="true"><\/representado><\/representados><\/datos>`;
    return Buffer.from(data).toString('base64');
  }

  /**
   * Autentica contra api-cct y guarda el JWT para las siguientes llamadas.
   * @param {string} cuit - CUIT representado (mismo patrón que el login UI)
   * @param {string} sign - SIGN_CCT de fixtures/test-data.js
   */
  async autenticar(cuit, sign) {
    const token = this.generarToken(cuit);
    const resp = await this.request.post(`${this.hosts.cct}/api/seguridad/DecodificarClaveCiudad`, {
      data: { token, sign },
    });
    if (!resp.ok()) {
      throw new Error(`DecodificarClaveCiudad falló: HTTP ${resp.status()} — ${await resp.text()}`);
    }
    const body = await resp.json();
    // Forma real confirmada en vivo (2026-08-13): {codigo, errores, content:"<JWT>"} —
    // sin wrapper "data" (a diferencia de lo que decía la doc de la herramienta HTML).
    this.token = body?.content;
    if (!this.token) {
      throw new Error(`DecodificarClaveCiudad no devolvió token — body: ${JSON.stringify(body)}`);
    }
    return this.token;
  }

  _authHeaders() {
    if (!this.token) throw new Error('Llamar autenticar() antes de usar el cliente.');
    return { Authorization: `Bearer ${this.token}` };
  }

  // ─── Consulta de planes ────────────────────────────────────────────────────

  async obtenerPlanesDePago({ cuit, anio, solicitud, estado = 'Todos' }) {
    const resp = await this.request.post(`${this.hosts.cct}/api/PlanesDePago/ObtenerPlanesDePago`, {
      headers: this._authHeaders(),
      data: { cuit: String(cuit), anio: Number(anio), solicitud: Number(solicitud), estado },
    });
    if (!resp.ok()) throw new Error(`ObtenerPlanesDePago falló: HTTP ${resp.status()} — ${await resp.text()}`);
    const body = await resp.json();
    return body?.content ?? [];
  }

  async obtenerPlanDePagoDetalle({ idAcogimiento, idTracer, idDuty, estado }) {
    const resp = await this.request.post(`${this.hosts.cct}/api/PlanesDePago/ObtenerPlanDePagoDetalle`, {
      headers: this._authHeaders(),
      data: { IdAcogimiento: String(idAcogimiento), IdTracer: String(idTracer), IdDuty: Number(idDuty), Estado: estado },
    });
    if (!resp.ok()) throw new Error(`ObtenerPlanDePagoDetalle falló: HTTP ${resp.status()} — ${await resp.text()}`);
    const body = await resp.json();
    return body?.content;
  }

  /**
   * Busca un plan por Nro. de solicitud y devuelve resumen (item crudo de
   * ObtenerPlanesDePago) + detalle (cuotas incluidas). El resumen es el que
   * hay que pasarle a construirPayloadF3010/construirPayloadF3012 como
   * `resumenPlan` (necesitan `_id`, `idDuty`, `period`, `tax`,
   * `content.ID_Acogimiento`).
   */
  async buscarPlanPorSolicitud({ cuit, anio, solicitud }) {
    const planes = await this.obtenerPlanesDePago({ cuit, anio, solicitud, estado: 'Todos' });
    const plan = planes[0];
    if (!plan) throw new Error(`No se encontró ningún plan para solicitud ${solicitud} (cuit ${cuit}, año ${anio})`);
    const detalle = await this.obtenerPlanDePagoDetalle({
      idAcogimiento: plan.content?.ID_Acogimiento,
      idTracer: plan._id,
      idDuty: plan.idDuty,
      estado: plan.states?.[0]?.state,
    });
    return { resumen: plan, detalle };
  }

  // ─── Tracer / débitos ──────────────────────────────────────────────────────

  async obtenerTracer(idTracerCuota) {
    const resp = await this.request.get(`${this.hosts.txsapi}/api/Tracer/${idTracerCuota}`, {
      headers: this._authHeaders(),
    });
    if (!resp.ok()) throw new Error(`Tracer falló: HTTP ${resp.status()} — ${await resp.text()}`);
    return resp.json();
  }

  /** Poll de Tracer hasta que aparece ID_Debito — no siempre está disponible al toque. */
  async esperarIdDebito(idTracerCuota, { intentos = 6, esperaMs = 800 } = {}) {
    for (let i = 0; i < intentos; i++) {
      const body = await this.obtenerTracer(idTracerCuota).catch(() => null);
      const idDebito = body?.content?.ID_Debito || body?.ID_Debito;
      if (idDebito) return idDebito;
      await new Promise(r => setTimeout(r, esperaMs));
    }
    return null; // igual que la herramienta: si no aparece, se sigue con ID_Debito=0
  }

  /**
   * GET con query params — confirmado por la herramienta real del usuario. El
   * diagrama de estados v4 documenta esto como POST con JSON body; se prioriza
   * lo que la herramienta ya validó en vivo. Sin auth.
   */
  async generarDebitoCuotaPorSolicitud({ idSolicitud, fecha, esPrimerIntento = true }) {
    const resp = await this.request.get(`${this.hosts.publicador}${this._publicadorIndividualesBase}/GenerarDebitoCuotaPorSolicitud`, {
      params: { idSolicitud: String(idSolicitud), fecha, esPrimerIntento: String(esPrimerIntento) },
    });
    // La herramienta tolera error acá (ej. "no está en estado apto") y sigue
    // igual al F3010 — no lanzamos, devolvemos ok:false para que el caller decida.
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { ok: resp.ok(), status: resp.status(), body };
  }

  // ─── F3010 — Pago directo de cuota / F3012 — Rehabilitar / F3014 — Anular ──

  async registrarFormulario(formulario, payload) {
    const resp = await this.request.post(`${this.hosts.cct}/api/Registracion/RegistrarFormulario`, {
      headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
      params: { formulario: String(formulario) },
      data: payload,
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`RegistrarFormulario?formulario=${formulario} falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  /**
   * Arma el payload {header, Datos} de F3010 (pago directo de cuota) tal como
   * lo construye la herramienta real. `cuota` es un item de
   * detalle.content.cuotas (numeroCuota, importeNominal, importeActualizado,
   * vencimientoCuota1, idTracerCuota, idAcogimiento). `resumenPlan` es el item
   * de ObtenerPlanesDePago (necesita _id, period, tax).
   * Concepto: cuota 1 = 7528, cuota 2+ = 5202 (no cubre el caso CA = 7529, que
   * en la herramienta real se resuelve vía generarPagoCuotas con
   * esCancelacionAnticipada=true, no con un F3010 manual).
   */
  construirPayloadF3010({ cuit, cuota, resumenPlan, correcto = true, idDebito = 0 }) {
    const nominal = Number(cuota.importeNominal || 0);
    const actualizado = Number(cuota.importeActualizado || nominal);
    const nroCuota = Number(cuota.numeroCuota || 1);
    const concepto = nroCuota === 1 ? 7528 : 5202;
    const vencimiento = (cuota.vencimientoCuota1 || cuota.fechaPrimerVencimiento || '').slice(0, 10);
    const idAcogimiento = Number(cuota.idAcogimiento ?? resumenPlan?.content?.ID_Acogimiento);

    return {
      header: {
        idPerson: Number(cuit),
        period: Number(resumenPlan?.period || 0),
        tax: Number(resumenPlan?.tax || 0),
        asset: '',
        quota: nroCuota,
        amount: nominal,
      },
      Datos: {
        Numero_Solicitud: Number(resumenPlan?.content?.IDSolicitud),
        Numero_Cuota: nroCuota,
        Importe_Nominal: nominal,
        Importe_Actualizado: actualizado,
        Fecha_Vencimiento_Cuota: vencimiento,
        Intereses_Resarcitorios: 0,
        Estado: correcto ? '' : 'falta de fondos',
        Codigo_De_Error: correcto ? '' : 'R10',
        Concepto: concepto,
        ID_Tracer_Plan: String(resumenPlan?._id || ''),
        ID_Tracer_Cuota: String(cuota.idTracerCuota || ''),
        ID_Debito: Number(idDebito) || 0,
        ID_Acogimiento: idAcogimiento,
      },
    };
  }

  /** F3010 — Pago directo de cuota. `payload` = construirPayloadF3010(...) o {header, Datos} manual. */
  async registrarPagoCuota3010(payload) {
    return this.registrarFormulario(3010, payload);
  }

  /**
   * ⚠⚠⚠ RESULTÓ NO SER EL CAMINO REAL (confirmado por el usuario 2026-08-20,
   * ver memoria pfp-formularios-catalogo/pfp-roadmap-fases) — el paso
   * RECHAZADA → A_REHABILITAR es AUTOMÁTICO tras rechazar la cuota en su 1° Y
   * 2° vencimiento (dos F3010 erróneos), no algo que se registre a mano con
   * este payload. RegistrarFormulario?formulario=3012 con esta forma
   * (header+Datos, heredada sin validar de la herramienta HTML) devuelve
   * muchos "campo requerido" (Impuesto, Inscripto, Codigo_Entidad, CBU, Anio,
   * Cuota, Importe, Numero_Obligacion...) — el esquema real de ese formulario
   * es otro y no se llegó a confirmar. Se deja el método por si en algún
   * momento hace falta un F3012 manual real, pero NO USAR para el flujo
   * normal de rehabilitación — ver F3012_rehabilitar_cuota.spec.js para el
   * flujo correcto (doble rechazo + ObtenerRehabilitacionCuota +
   * GenerarRehabilitacionCuota, sin este método).
   */
  construirPayloadF3012({ cuit, cuota, resumenPlan }) {
    const nominal = Number(cuota.importeNominal || 0);
    const actualizado = Number(cuota.importeActualizado || nominal);
    const nroCuota = Number(cuota.numeroCuota || 1);
    const vencimiento = (cuota.vencimientoCuota1 || cuota.fechaPrimerVencimiento || '').slice(0, 10);
    const idAcogimiento = Number(cuota.idAcogimiento ?? resumenPlan?.content?.ID_Acogimiento);

    return {
      header: {
        idPerson: Number(cuit),
        period: Number(resumenPlan?.period || 0),
        tax: Number(resumenPlan?.tax || 0),
        asset: '',
        quota: nroCuota,
        amount: nominal,
      },
      Datos: {
        Numero_Solicitud: Number(resumenPlan?.content?.IDSolicitud),
        Numero_Cuota: nroCuota,
        Importe_Nominal: nominal,
        Importe_Actualizado: actualizado,
        Fecha_Vencimiento_Cuota: vencimiento,
        Intereses_Resarcitorios: 0,
        Estado: '',
        Codigo_De_Error: '',
        Concepto: 7530,
        ID_Tracer_Plan: String(resumenPlan?._id || ''),
        ID_Tracer_Cuota: String(cuota.idTracerCuota || ''),
        ID_Debito: 0,
        ID_Acogimiento: idAcogimiento,
      },
    };
  }

  /** F3012 — registra el paso RECHAZADA → A_REHABILITAR. `payload` = construirPayloadF3012(...). */
  async registrarRehabilitacion3012(payload) {
    return this.registrarFormulario(3012, payload);
  }

  /** F3014 — Anulación de pago de cuota (misma forma de payload que F3010, ver catálogo). */
  async anularPagoCuota3014(payload) {
    return this.registrarFormulario(3014, payload);
  }

  /**
   * POST sin body real (body:'' con Content-Type json, igual que la
   * herramienta) — a pesar de lo documentado en pfp-api-endpoints (que decía
   * GET), la herramienta real usa POST tanto para pago normal
   * (esCancelacionAnticipada=false) como para pago/rechazo de CA
   * (esCancelacionAnticipada=true, donde idSolicitud es el idPlan, no el idCA).
   * Registra F3010 automáticamente del lado del servidor.
   */
  async generarPagoCuotas({ fechaEmisionDGR, idSolicitud, pagoRechazado = false, esCancelacionAnticipada = false }) {
    const resp = await this.request.post(`${this.hosts.publicador}/publicador/PFP/GenerarPagoCuotas`, {
      headers: { accept: '*/*', 'Content-Type': 'application/json' },
      params: {
        fechaEmisionDGR,
        idSolicitud: String(idSolicitud),
        pagoRechazado: String(pagoRechazado),
        esCancelacionAnticipada: String(esCancelacionAnticipada),
      },
      data: '',
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarPagoCuotas falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  // ─── F3012 — Rehabilitar cuota ─────────────────────────────────────────────

  /** Consulta informativa de importes (respuesta trae content.importe_Actualizado) — NO rehabilita. */
  async obtenerRehabilitacionCuota(idCuota) {
    const resp = await this.request.get(`${this.hosts.cct}/api/PlanesDePago/ObtenerRehabilitacionCuota`, {
      headers: this._authHeaders(),
      params: { idCuota: String(idCuota) },
    });
    if (!resp.ok()) throw new Error(`ObtenerRehabilitacionCuota falló: HTTP ${resp.status()} — ${await resp.text()}`);
    return resp.json();
  }

  /** Rehabilita de verdad (A_REHABILITAR → REHABILITADA). idCuota=idTracerCuota, idPlan=idTracerPlan (resumenPlan._id). */
  async generarRehabilitacionCuota({ idCuota, idPlan }) {
    const resp = await this.request.get(`${this.hosts.cct}/api/PlanesDePago/GenerarRehabilitacionCuota`, {
      headers: this._authHeaders(),
      params: { idCuota: String(idCuota), idPlan: String(idPlan) },
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarRehabilitacionCuota falló: HTTP ${resp.status()} — ${text}`);
    if (body?.codigo !== 1) throw new Error(`GenerarRehabilitacionCuota no confirmó éxito — body: ${JSON.stringify(body)}`);
    return body.content;
  }

  async generarDebitosCuotasRehabilitadas(fecha) {
    const resp = await this.request.get(`${this.hosts.publicador}/publicador/PFP/GenerarDebitosCuotasRehabilitadas`, {
      params: { fecha },
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarDebitosCuotasRehabilitadas falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  // ─── F3002 / F3008 — Cancelación (fin de plan / fin de flujo CA) ───────────
  // Mismo endpoint para ambos formularios: F3002 cuando todas las cuotas están
  // pagas, F3008 cuando se llega acá tras CA_PAGADA (fin del flujo de CA).
  // ⚠ CONFIRMADO POR EL USUARIO (2026-08-19): el 504 NO es un problema
  // transitorio de infra — es el comportamiento esperado de este endpoint.
  // GenerarCancelaciones no toma un plan puntual: le pega a TODOS los planes
  // del ambiente que ya tienen todas las cuotas pagas, así que en QA (con
  // volumen real) directamente nunca termina a tiempo.
  // ACTUALIZACIÓN 2026-08-20: el endpoint puntual que se creía pendiente de
  // AGIP YA EXISTE en "qa-av" — ver generarCancelacionPorSolicitud() acá
  // abajo, descubierto vía swagger.json. Preferirlo siempre sobre este.
  async generarCancelaciones() {
    const resp = await this.request.get(`${this.hosts.publicador}/publicador/PFP/GenerarCancelaciones`, {
      timeout: TIMEOUT_BATCH_MS,
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarCancelaciones falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  // ─── F3009 — Débito de Cancelación Anticipada ──────────────────────────────

  async generarDebitosCancelacionAnticipada(fecha) {
    const resp = await this.request.get(`${this.hosts.publicador}/publicador/PFP/GenerarDebitosCancelacionAnticipada`, {
      params: { fecha },
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarDebitosCancelacionAnticipada falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  // ─── F3003 — Caducidad ──────────────────────────────────────────────────────
  // ⚠⚠⚠ PELIGROSO: a diferencia de todos los demás métodos de esta clase, este
  // endpoint NO toma un plan puntual — impacta TODOS los planes elegibles del
  // ambiente (ver pfp-formularios-catalogo). NO llamar en un test de regresión
  // normal ni en CI. Solo bajo confirmación explícita del usuario, en una
  // corrida aislada, sabiendo que va a caducar planes de otra gente en QA.
  // Preferir generarCaducidadPorSolicitud() de acá abajo — SÍ es puntual.
  async generarCaducidades() {
    const resp = await this.request.get(`${this.hosts.publicador}/publicador/PFP/GenerarCaducidades`, {
      timeout: TIMEOUT_BATCH_MS,
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarCaducidades falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  /**
   * F3003 puntual — SEGURO, a diferencia de generarCaducidades(): solo evalúa
   * el plan indicado. Confirmado real en vivo (2026-08-19) contra QA_HOMO.
   * ⚠ El parámetro real es "solicitud", NO "idSolicitud" — con el nombre
   * incorrecto el endpoint responde HTTP 200 con `respuestaMasivo: []` (el
   * binding queda null y no matchea nada) en vez de un error, así que parece
   * "andar" pero no hace nada. Confirmado vía swagger.json del servicio
   * (`GET {host}/swagger/v1/swagger.json`) cuando la doc previa (endpoint con
   * otro nombre/path) resultó ser incorrecta.
   * Precondición real del plan para que procese algo (confirmado empírico):
   * al menos 2 cuotas en estado RECHAZADA con vencimientos varios meses en el
   * pasado respecto a `fecha` — un gap de ~60 días entre ellas SÍ funcionó,
   * pero un gap de ~30 días (abril→mayo) TAMBIÉN funcionó, así que la regla de
   * "60 días exactos" del catálogo puede ser más laxa en la práctica de lo que
   * se documentó — no asumir el umbral exacto sin más pruebas.
   * @param {string} fecha - formato "YYYY-MM-DD"
   */
  async generarCaducidadPorSolicitud({ solicitud, fecha }) {
    const resp = await this.request.get(`${this.hosts.publicador}${this._publicadorIndividualesBase}/GenerarCaducidadPorSolicitud`, {
      params: { solicitud: String(solicitud), fecha },
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarCaducidadPorSolicitud falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  /**
   * F3002/F3008 puntual — SEGURO, a diferencia de generarCancelaciones()
   * (impacta TODOS los planes del ambiente). Descubierto en vivo 2026-08-20
   * consultando el swagger.json de api-publicador-qa-av — resuelve el bloqueo
   * que veníamos documentando como "hay que esperar a que AGIP lo entregue".
   * ⚠ Solo confirmado que existe en "qa-av" — no se confirmó en "qa" todavía.
   */
  async generarCancelacionPorSolicitud({ idSolicitud }) {
    const resp = await this.request.get(`${this.hosts.publicador}${this._publicadorIndividualesBase}/GenerarCancelacionPorSolicitud`, {
      params: { idSolicitud: String(idSolicitud) },
    });
    const text = await resp.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!resp.ok()) throw new Error(`GenerarCancelacionPorSolicitud falló: HTTP ${resp.status()} — ${text}`);
    return body;
  }

  // ─── Tabla PFP_Emision_DRG ──────────────────────────────────────────────────
  // Mapea VencimientoCuota → EmitirDRG (necesaria para calcular la fecha a
  // pasar a generarDebitoCuotaPorSolicitud/generarPagoCuotas). Preferir
  // fixtures/pfpEmisionDRG.js (buscarEmitirDRG) — es lo que usa la herramienta
  // real (tabla estática embebida), sin depender de txsapi en cada test. Este
  // método queda como respaldo para refrescarla si hace falta.

  buscarEmitirDRG(fechaVencimiento) {
    return buscarEmitirDRG(fechaVencimiento);
  }

  async obtenerTablaEmisionDRG() {
    const resp = await this.request.get(`${this.hosts.txsapi}/param/Tables/content/PFP_Emision_DRG/~`);
    if (!resp.ok()) throw new Error(`PFP_Emision_DRG falló: HTTP ${resp.status()} — ${await resp.text()}`);
    return resp.json();
  }
}

module.exports = { PfpApiClient };
