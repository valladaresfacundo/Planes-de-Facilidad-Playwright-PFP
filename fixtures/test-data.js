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
module.exports = { AMBIENTES, AMBIENTES_AGENTE, CONTRIBUYENTES, SIGN_CCT, CUIT_AUTENTICADO, PFP, AGENTE, SIGN_AGENTE };