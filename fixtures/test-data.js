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
  // Cuota 1 en estado "No Vencida" (sin pagar) — habilita F3007 (Cambiar CBU) pero NO F3005
  // (la Cancelación Anticipada exige la 1° cuota paga; con este plan se prueba el caso negativo).
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

module.exports = { AMBIENTES, AMBIENTES_AGENTE, CONTRIBUYENTES, SIGN_CCT, CUIT_AUTENTICADO, PFP, AGENTE, SIGN_AGENTE, PLANES_CONOCIDOS, EXPEDIENTE_REVERSA };