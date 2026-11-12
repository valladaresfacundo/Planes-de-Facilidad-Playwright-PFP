// lib/globalSetupDeuda.js
// globalSetup de playwright.config.qa-av.js: antes de la corrida deja cada CUIT
// de CUITS_EJECUCION con al menos DEUDA_MINIMA_PERIODOS períodos de deuda,
// cargando DJ 5866 si le faltan (ver lib/deudaEjecucion.js). Durante la corrida
// los tests vuelven a chequear antes de consumir deuda (cuitConDeuda).
//
// Se saltea sin MONGO_URI (no se pueden leer los períodos cargados) o con
// SIN_CARGA_DEUDA=1 (ej. para correr sólo el smoke).
const { request } = require('@playwright/test');

module.exports = async () => {
  if (!process.env.MONGO_URI || process.env.SIN_CARGA_DEUDA) return;
  const { asegurarDeuda, MINIMO_PERIODOS } = require('./deudaEjecucion');
  const { CUITS_EJECUCION } = require('../fixtures/test-data');
  const contexto = await request.newContext();
  try {
    for (const cuit of CUITS_EJECUCION) {
      const periodos = await asegurarDeuda(contexto, cuit)
        .catch(e => { console.log(`globalSetupDeuda — CUIT ${cuit}: ${e.message}`); return null; });
      console.log(`globalSetupDeuda — CUIT ${cuit}: ${periodos ?? '?'} períodos con deuda (mínimo ${MINIMO_PERIODOS})`);
    }
  } finally {
    await contexto.dispose();
  }
};
