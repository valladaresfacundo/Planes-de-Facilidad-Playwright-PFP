// tests/regression/pfp/BUG_huso_horario_fecha_alta.spec.js
// Reproducción de un reclamo real de producción: la "Fecha de alta" que
// muestra el Portal para un plan de facilidades no coincide con la fecha
// real de consolidación cuando esa fecha cae entre las 21:00 y las 23:59
// (hora Argentina) — ver memoria pfp-roadmap-fases para el detalle
// completo del reporte original (plan real de producción 1523005608).
//
// CAUSA RAÍZ CONFIRMADA (reproducida en vivo, con un control):
// - El backend está bien: `ObtenerPlanesDePago` devuelve el campo
//   `created`/`content.Fecha_Consolidacion` con el offset -03:00 intacto
//   (ej. "2026-04-30T21:00:04.456-03:00").
// - El FRONTEND es el que falla — en AMBOS portales (Contribuyente y
//   Agente) — al mostrar "Fecha de alta". Muestra un día después de la
//   fecha real, únicamente cuando la hora de consolidación cae en la
//   ventana 21:00:00–23:59:59 hora Argentina (justo cuando el momento
//   equivalente en UTC ya cruzó al día siguiente: 21hs ARG = 00hs UTC del
//   día siguiente). Confirmado con un control real: la MISMA fecha a
//   mediodía (que no cruza medianoche UTC) se muestra correcta.
// - Patrón típico de esta clase de bug: extraer año/mes/día del valor en
//   UTC (`getUTCDate()`, `toISOString().slice(0,10)`) en vez de en hora
//   local de Argentina.
//
// Self-contained y NO destructivo: guarda la fecha real del plan usado,
// la pisa temporalmente para reproducir la ventana horaria del bug, y la
// restaura al final (en un finally) — el plan queda exactamente como
// estaba antes de correr el test, se puede repetir indefinidamente.
//
// Usa test.fail() (mismo criterio que BUG_52821 y BUG_redondeo_simulacion_
// cuotas): hoy "pasa" (falla como se espera, sin romper la suite); el día
// que se arregle el formateo de fecha en el frontend, va a pasar de
// verdad y Playwright lo va a marcar como alerta ("expected to fail, but
// passed").
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage } = require('../../../pages/PFPPage');
const { withTracerInstance } = require('../../../lib/mongoAdmin');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PLANES_CONOCIDOS } = require('../../../fixtures/test-data');

// Mismo valor exacto del caso real de producción — 30/04, 21hs Argentina,
// cae justo después de cruzar la medianoche UTC.
const FECHA_CON_BUG = new Date('2026-04-30T21:00:04.456-03:00');

test('BUG_HUSO_HORARIO — "Fecha de alta" debe mostrar la fecha en hora Argentina, no en UTC', async ({ page }) => {
  test.fail(true, 'Bug real confirmado — reclamo de producción (plan 1523005608). El frontend muestra un día de más cuando la consolidación cae entre las 21:00 y las 23:59 hora Argentina.');
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env — ver .env.example y lib/mongoAdmin.js');
  test.skip(!PLANES_CONOCIDOS.paraCancelar, 'Requiere PLANES_CONOCIDOS.paraCancelar en fixtures/test-data.js');

  const idSolicitud = PLANES_CONOCIDOS.paraCancelar;
  const filtro = { 'content.IDSolicitud': idSolicitud, quota: 0 };

  const docOriginal = await withTracerInstance(col => col.findOne(filtro));
  expect(docOriginal, `Debe existir el plan ${idSolicitud} en Mongo`).toBeTruthy();
  const fechaOriginal = docOriginal.created;

  try {
    await withTracerInstance(col => col.updateOne(filtro, {
      $set: { created: FECHA_CON_BUG, modified: FECHA_CON_BUG, 'content.Fecha_Consolidacion': FECHA_CON_BUG },
    }));

    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_AV, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);

    await pfpPage.irAPlanesDeFacilidades();
    await pfpPage.buscarPlanPorNroSolicitud(idSolicitud);
    await portalPage.waitForTimeout(1500);

    const texto = await portalPage.locator('body').innerText();
    const idx = texto.indexOf('Fecha de alta');
    const lineaFecha = texto.slice(idx, idx + 40);
    const match = lineaFecha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    expect(match, 'Debe poder leerse la "Fecha de alta" en el detalle del plan').toBeTruthy();
    const fechaMostrada = `${match[1]}/${match[2]}/${match[3]}`;
    console.log(`BUG_HUSO_HORARIO — Fecha de alta mostrada: ${fechaMostrada} (real: 30/04/2026, hora Argentina)`);

    // Comportamiento correcto esperado: 30/04/2026 (fecha real en hora
    // Argentina). HOY esto falla porque el frontend muestra 01/05/2026.
    expect(fechaMostrada).toBe('30/04/2026');
  } finally {
    // Restaurar SIEMPRE la fecha real del plan, pase lo que pase arriba.
    await withTracerInstance(col => col.updateOne(filtro, {
      $set: { created: fechaOriginal, modified: fechaOriginal, 'content.Fecha_Consolidacion': fechaOriginal },
    }));
  }
});
