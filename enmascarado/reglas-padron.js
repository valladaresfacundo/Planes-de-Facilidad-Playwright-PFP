// enmascarado/reglas-padron.js
// Reglas de enmascaramiento para documentos de CCT.Padron.
//
// Cada ruta (sin índices de array: "address.street") tiene una acción:
//   'CATEGORIA' -> se reemplaza por un alias estable (CUIT_0001, NOMBRE_0003...)
//   REDACTAR    -> se elimina (credenciales); no se guarda en la bóveda
//   ANIO        -> fecha generalizada al año (fecha de nacimiento / defunción)
//   PROFUNDO:X  -> todo valor (string/número) debajo de esa ruta va a la categoría X
//   CONSERVAR   -> dato operativo, pasa sin cambios (igual se le aplica la red de seguridad si es texto)
// Rutas sin regla: los textos pasan por la red de seguridad (CUIT/email/valores
// conocidos) y se informan como "no clasificados" para revisión humana.
const REDACTAR = 'REDACTAR';
const ANIO = 'ANIO';
const CONSERVAR = 'CONSERVAR';

const clavesCiudadPersona = prefijo => ({
  [`${prefijo}.Cuit`]: 'CUIT',
  [`${prefijo}.Nombre`]: 'NOMBRE',
  [`${prefijo}.Isib`]: 'NRO_INSCRIPTO',
  [`${prefijo}.Calle`]: 'CALLE',
  // El código de calle permite reconstruir el nombre de la calle: se enmascara.
  [`${prefijo}.CodigoCalle`]: 'CODIGO_CALLE',
  [`${prefijo}.Puerta`]: 'ALTURA',
  [`${prefijo}.Piso`]: CONSERVAR,
  [`${prefijo}.Dpto`]: CONSERVAR,
  [`${prefijo}.CodigoPostal`]: 'COD_POSTAL',
  [`${prefijo}.Telefono`]: 'TELEFONO',
  [`${prefijo}.Email`]: 'EMAIL',
  [`${prefijo}.NumeroDocumento`]: 'DNI',
  [`${prefijo}.TipoDocumento`]: CONSERVAR,
  [`${prefijo}.Categoria`]: CONSERVAR,
  [`${prefijo}.CodigoLocalidad`]: CONSERVAR,
  [`${prefijo}.Localidad`]: CONSERVAR,
  [`${prefijo}.CodigoProvincia`]: CONSERVAR,
  [`${prefijo}.Provincia`]: CONSERVAR,
  [`${prefijo}.Nivel`]: CONSERVAR,
  [`${prefijo}.TipoRepresentacion`]: CONSERVAR,
});

const REGLAS = {
  // Identificación
  _id: 'CUIT',
  idPerson: 'ID_PERSONA',
  documentNumber: 'DNI',
  businessName: 'RAZON_SOCIAL',
  abbreviation: 'RAZON_SOCIAL',
  lastName: 'APELLIDO',
  mothersLastName: 'APELLIDO',
  marriedLastName: 'APELLIDO',
  name: 'NOMBRE',
  birthDate: ANIO,
  deathDate: ANIO,
  nroInscripto: 'NRO_INSCRIPTO',
  'taxesInscription.NroInscriptoRV': 'NRO_INSCRIPTO',
  agente: 'AGENTE',

  // Contacto
  email: 'EMAIL',
  zipCode: 'COD_POSTAL',
  telephones: 'PROFUNDO:TELEFONO',

  // Domicilios
  'address.street': 'CALLE',
  'address.number': 'ALTURA',
  'address.address': 'DOMICILIO',
  'address.zipCode': 'COD_POSTAL',
  'address.funcionalUnit': 'UNIDAD_FUNCIONAL',
  'address.latitude': 'COORDENADA',
  'address.longitude': 'COORDENADA',
  'address.otherData': 'DOMICILIO',
  'address.localName': 'DOMICILIO',
  registroDomicilioExplotacion: 'PROFUNDO:DOMICILIO',

  // Bienes inscriptos (patentes, partidas)
  'taxesInscription.asset': 'ACTIVO',
  'taxesInscription.assetAddress': 'DOMICILIO',

  // Personas relacionadas y usuarios
  legalPerson: 'PROFUNDO:PERSONA_RELACIONADA',
  'controlledBy.controller': 'USUARIO',

  // Credenciales de Clave Ciudad: se eliminan
  'claveCiudad.TokenApiCCT': REDACTAR,
  'claveCiudad.TokenAgip': REDACTAR,
  'claveCiudad.SignAgip': REDACTAR,
  'claveCiudad.TokenServicioAgip': REDACTAR,
  'claveCiudad.Servicio': CONSERVAR,
  ...clavesCiudadPersona('claveCiudad.Autenticado'),
  ...clavesCiudadPersona('claveCiudad.Representados'),

  // Datos operativos que el asistente necesita para razonar
  personType: CONSERVAR,
  idType: CONSERVAR,
  documentType: CONSERVAR,
  sex: CONSERVAR,
  state: CONSERVAR,
  segment: CONSERVAR,
  riskProfile: CONSERVAR,
  country: CONSERVAR,
  operativeUnit: CONSERVAR,
  subOperativeUnit: CONSERVAR,
  observations: CONSERVAR,
  'address.district': CONSERVAR,
  'address.province': CONSERVAR,
  'address.floor': CONSERVAR,
  'address.department': CONSERVAR,
  'address.tower': CONSERVAR,
};

module.exports = { REGLAS, REDACTAR, ANIO, CONSERVAR };
