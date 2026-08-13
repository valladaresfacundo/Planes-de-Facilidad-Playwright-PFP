// fixtures/test-data.js
// Datos de prueba basados en la parametría real de AGIP

// ─── Ambientes ────────────────────────────────────────────────────────────────
const AMBIENTES = {
  QA_HOMO: 'http://portal-cct-qa.apps.ocp-test-hc.agip.gob.ar/login',
  QA_AV:   'http://portal-cct-qa-av.apps.ocp-test-hc.agip.gob.ar/login',
  DEV20:   'http://portal-cct20-dev.apps.ocp-test-hc.agip.gob.ar/login', // NodeJS 20.3+
};

const AMBIENTES_AGENTE = {
  QA_HOMO: 'http://portal-agente-qa.apps.ocp-test-hc.agip.gob.ar/',
  QA_AV:   'http://portal-agente-qa-av.apps.ocp-test-hc.agip.gob.ar/',
  DEV20:   'http://portal-agente20-dev.apps.ocp-test-hc.agip.gob.ar/', // NodeJS 20.3+
};

// ─── Contribuyentes de prueba ─────────────────────────────────────────────────
// Reemplazá los CUITs con contribuyentes reales del padrón de QA
const CONTRIBUYENTES = {
  // Contribuyente con deuda y plan activo — para tests de PFP/Moratoria
  conPlan: {
    cuit: '30686855860',      // ← reemplazá
    nombre: 'EMPRESA CON PLAN SA',
  },
  // Contribuyente con deuda SIN plan activo — para probar acogimiento
  sinPlan: {
    cuit: '30686855860',      // ← reemplazá
    nombre: 'CONTRIBUYENTE SIN PLAN',
  },
  // Contribuyente sin deuda — para validar mensajes de "sin obligaciones"
  sinDeuda: {
    cuit: '30604731018',      // CUIT del token por defecto
    nombre: 'USUARIO PRUEBA',
  },
};

// ─── Configuración del token de login ────────────────────────────────────────
const SIGN_CCT = 'eRZ2xq6a0bAirY+CvHbcFgmNGCqmN+g9iBywKvN2RpdLGjz67zqKNf9C78JQh3sNtpwNfVdc6JIS43jC0jjDcnKqB5nfd/+P753gMz7DFbhLJkh5kzdJ2I9wAC/fxXgoxi940qXBHtZkg+h/QNNMQSnIi1ZtS90vtO5wKWYQDwM=';
const CUIT_AUTENTICADO = '30686855860';

// ─── Ambientes de la API PFP (Fase 2 — lib/pfpApiClient.js) ──────────────────
// Host/protocolo documentados por la herramienta HTML de trabajo del usuario
// ("pfp_flujo_completo (26).html", no versionada — ver memoria pfp-api-endpoints),
// que la describe como ya validada en vivo contra el ambiente real.
// ⚠ SIN CONFIRMAR TODAVÍA por esta suite: el único tráfico observado en vivo en
// esta sesión pegó a "https://api-cct-qa.agip.gob.ar" (sin ".apps.ocp-test-hc"),
// para un endpoint distinto (ObtenerDeudasParaAcogerNuevo2025, llamado por el
// frontend del portal). Podrían ser dos gateways al mismo backend. Confirmar
// con tests/api/TC_API_000_smoke.spec.js antes de asumir que esto es correcto.
// 2026-08-13: primer intento con host "api-cct-{a}.apps.ocp-test-hc.agip.gob.ar"
// sobre HTTPS devolvió el 503 genérico de OpenShift "Application is not
// available" — falsa alarma. El usuario volvió a pasar la herramienta HTML de
// trabajo ("pfp_flujo_completo (26).html") y confirma que TODOS los hosts son
// justo ese patrón "apps.ocp-test-hc.agip.gob.ar", pero sobre **HTTP, no
// HTTPS** (igual que AMBIENTES/AMBIENTES_AGENTE de más arriba, que también son
// http://). El 503 era el router de OpenShift respondiendo con su página por
// defecto porque esas rutas no tienen TLS configurado — probarlas por HTTPS
// pega contra el vhost por defecto del router, no contra el servicio real.
// Confirmado en vivo con TC_API_000_smoke.spec.js tras el cambio. "publicador"
// conecta bien (DNS + TCP ok) pero GenerarCancelaciones específicamente tardó
// 30s+ y devolvió 504 Gateway Timeout por curl directo — es un batch pesado
// (probablemente recorre todos los planes elegibles del ambiente, no uno
// puntual), no un host equivocado. Los métodos que la llaman en
// lib/pfpApiClient.js usan un timeout explícito más generoso por esto.
const AMBIENTES_API = {
  qa: {
    cct:        'http://api-cct-qa.apps.ocp-test-hc.agip.gob.ar',
    publicador: 'http://api-publicador-qa.apps.ocp-test-hc.agip.gob.ar',
    txsapi:     'http://txsapi-txs-core-qa.apps.ocp-test-hc.agip.gob.ar',
  },
  'qa-av': {
    cct:        'http://api-cct-qa-av.apps.ocp-test-hc.agip.gob.ar',
    publicador: 'http://api-publicador-qa-av.apps.ocp-test-hc.agip.gob.ar',
    txsapi:     'http://txsapi-txs-core-qa-av.apps.ocp-test-hc.agip.gob.ar',
  },
};

// ─── Parámetros reales del PFP (Plan de Facilidades de Pago / Moratoria) ─────
// Extraídos de la parametría oficial del sistema
const PFP = {
  // Planes de moratoria vigentes
  planes: {
    PLAN_890:   '890/MHFGC/20',     // Plan general (hasta 36 cuotas)
    PLAN_NUEVO: 'nuevo/2025',        // Plan 2025 (hasta 48 cuotas)
    PLAN_4323:  '4323/MHFGC/22',    // Plan 2022 (hasta 6 cuotas)
  },

  // Cantidad máxima de cuotas por plan
  maxCuotas: {
    '890/MHFGC/20': 36,
    'nuevo/2025':    48,
    '4323/MHFGC/22': 6,
  },

  // Impuestos incluidos en los planes (código → nombre)
  impuestos: {
    2:   'Ingresos Brutos (CL)',
    4:   'Inmobiliario ABL',
    7:   'Sellos',
    8:   'Sellos (otro)',
    20:  'IIBB Régimen Simplificado',
    40:  'Automotor',
    281: 'IIBB Convenio Multilateral',
  },

  // Estados posibles del plan
  estadosPlan: ['VIGENTE', 'CANCELADO', 'CA_PENDIENTE', 'CA_ENVIADA_DEBITO',
                'CA_PAGADA', 'CA_RECHAZADA', 'CADUCO', 'NULO', 'REFORMULADO'],

  // Estados posibles de una cuota
  estadosCuota: ['NO_VENCIDA', 'RECHAZADA', 'A_REHABILITAR',
                 'REHABILITADA', 'PAGADA', 'ANULADA', 'REFORMULADA'],

  // Conceptos de deuda incluibles en un plan
  conceptos: {
    1: 'CAPITAL',
    2: 'INTERES RESARCITORIO',
    3: 'INTERES PUNITORIO',
    4: 'RETARDO',
    5: 'MULTA AUTOMATICA',
    6: 'MULTA FORMAL',
    7: 'MULTA MATERIAL',
  },

  // Tipos de deuda
  tiposDeuda: ['Administrativa', 'Judicial'],

  // Universos
  universos: ['MASIVO', 'GRANDE'],
  
};
// ─── Portal Agente ────────────────────────────────────────────────────────────
const AGENTE = {
  usuario: 'sistema',
  perfiles: {
    AgentePFP:  'AgentePFP',
    Consultor:  'Consultor',
    AgenteRec:  'AgenteRec',   // ← agregar esta línea
    AgenteN1_2: 'AgenteN1_2',
    AgenteN2_2: 'AgenteN2_2',
    AgenteN3_2: 'AgenteN3_2',
    MonitorIT:  'Monitor IT',
  },
};

const SIGN_AGENTE = 'hbx9zff2MNCa/s3DvvECFPv60gsSoNNVtlpQim5Xq/qk3Z4KVesCnjonER6X52/PBiWIxWE4jC2kn3N5hxuzxpRtXxa/LPQM8WqTVjOOjpdaBzwMqm5A+Zwn4SLsG6laALYP8TLgZ/FmEtOgH5ju8weJpG4dqAerPsKokiiv/f8=';

// ─── Planes conocidos para pruebas post-acogimiento (Fase 1 — F3005/F3006/F3007/F3013) ─────
// Estos tests necesitan un Nro. de solicitud real de un plan ya existente en el estado
// correspondiente (no se puede fabricar en el momento sin la capa API de Fase 2).
// Completar con datos reales de QA_HOMO — los tests que los usan se saltean solos
// (test.skip) mientras estos campos queden en null.
const PLANES_CONOCIDOS = {
  // Plan real VIGENTE, CUIT 30686855860, impuesto "Sellos - AR RELIT", confirmado en QA_HOMO el 2026-08-12.
  // ⚠ 2026-08-13: este plan se usó para validar el flujo de Cancelación Anticipada
  // COMPLETO de verdad (Fase 2, lib/pfpApiClient.js) y quedó consumido — YA NO ESTÁ
  // VIGENTE. Secuencia real ejecutada: F3010 (pago cuota 1) → F3005 (CA real, UI) →
  // F3009 (débito CA) → pago CA → CA_PAGADA. El cierre final (F3008,
  // GenerarCancelaciones → estado CA) quedó pendiente: el endpoint da 504 Gateway
  // Timeout consistente a los ~30s (confirmado con curl directo y desde el cliente,
  // es un límite de infra/gateway, no del cliente) — ver memoria pfp-roadmap-fases.
  // Este plan ya NO sirve como fixture "vigente" para ningún test de Fase 1
  // (TC_REG_009/TC_REG_010 en tests/regression/TC_REG_003_ca_cbu.spec.js van a
  // fallar si se corren contra este número) — pedirle al usuario un plan VIGENTE
  // nuevo antes de reusar esos tests.
  vigente: '1783000149',
  // Planes reales CADUCO/NULO, mismo CUIT 30686855860.
  // ⚠ Si se corre el flujo de reversa hasta el final (Continuar → Confirmar), el plan pasa
  // a VIGENTE de verdad y deja de servir como fixture CADUCO/NULO — pedir un reemplazo si eso pasa.
  // caduco: confirmado solo en DEV20 (2026-08-12) — falta reconfirmar que existe en QA_HOMO.
  caduco: '1523072913', // → F3006 Reversa de Caducidad (Portal Agente)
  // nulo: reemplazo provisto por el usuario el 2026-08-12 — el anterior (1523072944) se
  // consumió validando F3013 end-to-end y quedó VIGENTE. Mismo cuidado: si TC_AGPFP_008
  // corre hasta el final, este número también queda VIGENTE y hay que pedir otro reemplazo.
  nulo: '1523000121',
};

// Expediente estándar a usar siempre en las Reversas (F3006/F3013) — provisto por el usuario y
// validado end-to-end en QA_HOMO el 2026-08-12 (flujo F3013 completo, ver PLANES_CONOCIDOS.nulo).
// ⚠ Completar el formulario con estos datos y confirmar hasta el final SÍ ejecuta la reversa
// de verdad (el plan pasa a VIGENTE) — ver PLANES_CONOCIDOS.caduco arriba.
const EXPEDIENTE_REVERSA = {
  tipoActuacion: 'EXPEDIENTES', // texto real de la opción del dropdown, en mayúsculas
  anio: '2022',
  numero: '00146527',
  ente: 'GCABA',
  reparticion: 'DGR',
};

module.exports = { AMBIENTES, AMBIENTES_AGENTE, AMBIENTES_API, CONTRIBUYENTES, SIGN_CCT, CUIT_AUTENTICADO, PFP, AGENTE, SIGN_AGENTE, PLANES_CONOCIDOS, EXPEDIENTE_REVERSA };