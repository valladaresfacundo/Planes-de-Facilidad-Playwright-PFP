// enmascarado/reglas-genericas.js
// Reglas por NOMBRE de campo, para cualquier fuente que no tenga reglas propias
// (respuestas de API, otras colecciones). Se comparan contra el último tramo de
// la ruta, en minúsculas y sin "_" ni "-": "NumeroDocumento", "numero_documento"
// y "numeroDocumento" caen todos en "numerodocumento".
const { REDACTAR } = require('./reglas-padron');

const POR_CLAVE = {
  CUIT: ['cuit', 'cuil', 'cuitrepresentado', 'cuitautenticado', 'cuitcontribuyente', 'nrocuit'],
  DNI: ['dni', 'documento', 'nrodocumento', 'numerodocumento', 'documentnumber'],
  NOMBRE: ['nombre', 'nombres', 'firstname', 'nombrecompleto', 'fullname'],
  APELLIDO: ['apellido', 'apellidos', 'lastname', 'surname'],
  RAZON_SOCIAL: ['razonsocial', 'businessname', 'denominacion'],
  EMAIL: ['email', 'mail', 'correo', 'correoelectronico'],
  TELEFONO: ['telefono', 'telefonos', 'phone', 'celular', 'tel'],
  DOMICILIO: ['domicilio', 'direccion', 'domiciliofiscal'],
  CALLE: ['calle', 'street'],
  ALTURA: ['puerta', 'altura'],
  COD_POSTAL: ['codigopostal', 'codpostal', 'zipcode', 'cp'],
  CUENTA: ['cbu', 'cvu', 'nrocuenta', 'numerocuenta', 'cuentabancaria', 'aliascbu'],
  NRO_INSCRIPTO: ['isib', 'nroinscripto', 'nroinscripcion', 'numeroinscripcion'],
  ID_PERSONA: ['idperson', 'idpersona'],
  // Patente / partida / bien (Patentes, ABL): identifican al contribuyente
  ACTIVO: ['objetobien', 'dominio', 'patente', 'partida', 'nropartida'],
  USUARIO: ['usuario', 'username', 'user', 'login'],
  [REDACTAR]: ['token', 'tokenagip', 'tokenapicct', 'jwt', 'sign', 'signagip', 'firma', 'password', 'contrasena', 'clave', 'secret', 'authorization', 'apikey'],
};

const INDICE = new Map();
for (const [regla, claves] of Object.entries(POR_CLAVE)) for (const c of claves) INDICE.set(c, regla);

const normalizarClave = k => String(k).toLowerCase().replace(/[_\-\s]/g, '');

/** Regla genérica para la última clave de una ruta, o undefined. */
function reglaPorClave(ruta) {
  const ultima = ruta.split('.').pop();
  return INDICE.get(normalizarClave(ultima));
}

module.exports = { reglaPorClave, POR_CLAVE };
