// tests/regression/portal-agente/AG791_reporte_planes_facilidades.spec.js
// AG-791 (#57085) — Reporte "Planes de Facilidades" en Portal Agente → Reportes.
// https://agip-scct.atlassian.net/browse/AG-791 — probado en QA_AV (estado "Testing AV").
//
// Cada consulta se valida contra Mongo con lib/oraculoReportePlanes.js, que
// aplica literalmente las reglas del CA03 (TracerInstance, businessTask PFP,
// Instrumento_Legal, año de Fecha_Consolidacion, estado, tax, orden por
// creación) y el mapeo del CA04 (Padron.businessName, Regimenes.DescripcionCorta).
// Solo lectura: no modifica datos (la descarga es un GET de reporte).
//
// Los defectos encontrados (AG-897 a AG-901, AG-944, AG-949) se verificaron
// corregidos el 2026-10-30. El único test.fail() que queda documenta una
// observación no cargada (orden de la grilla); si aparece como fallido en el
// reporte es porque lo corrigieron: sacarle el test.fail().
//
// ⚠ Las consultas tardan 1–21 s en QA_AV (461/2026/CM: ~20 s, 72.392 planes).
const { test, expect } = require('@playwright/test');
const { ReportePlanesFacilidadesPage } = require('../../../pages/ReportePlanesFacilidadesPage');
const { planesEsperados, impuestosPorInstrumento, filaGrilla } = require('../../../lib/oraculoReportePlanes');
const { leerXlsx } = require('../../../lib/leerXlsx');

const CM = 'IIBB - Convenio Multilateral';
const CL = 'IIBB - Contribuyentes Locales';
const TEXTO_CA06 = 'No encontramos registros para esta consulta';
const TEXTO_CA09 = 'No fue posible generar el reporte en este momento. Por favor, intente nuevamente más tarde.';

// Datos de QA_AV elegidos por volumen (relevados en Mongo el 2026-10-15)
const CONSULTA_CHICA = { instrumento: '890/MHFGC/20', anio: 2026, estado: 'Todos', impuesto: CM };    // 21 planes
const CONSULTA_ESTADO = { instrumento: '461/AGIP/25', anio: 2026, estado: 'Caduco', impuesto: CL };   // 16 planes
const CONSULTA_2_PAGINAS = { instrumento: '890/MHFGC/20', anio: 2025, estado: 'Todos', impuesto: CL }; // 81 planes
const CONSULTA_GRANDE = { instrumento: '461/AGIP/25', anio: 2026, estado: 'Todos', impuesto: CM };    // 72.392 planes
const CONSULTA_VACIA = { instrumento: '890/MHFGC/20', anio: 2026, estado: 'Todos', impuesto: 'Sellos - AR RELIT' };

// La grilla trunca la razón social larga con "..." — se compara por prefijo.
function compararFila(real, esperada, contexto) {
  expect(real.length, `${contexto}: cantidad de columnas`).toBe(10);
  for (let i = 0; i < 10; i++) {
    if (i === 3 && real[i].endsWith('...')) {
      expect(esperada[i].startsWith(real[i].slice(0, -3)), `${contexto}: razón social "${real[i]}" vs "${esperada[i]}"`).toBe(true);
    } else {
      expect(real[i], `${contexto}: columna ${i + 1}`).toBe(esperada[i]);
    }
  }
}

const iconoPaginador = { primera: 'agip-icons-pag-izq', anterior: 'agip-icons-icon-down-arrow-small-1', siguiente: 'agip-icons-icon-down-arrow-small', ultima: 'agip-icons-pag-der' };
const botonPaginador = (r, cual) => r.portal.locator(`button:has(i.${iconoPaginador[cual]})`);

async function irAPagina(r, cual) {
  const [resp] = await Promise.all([
    r.portal.waitForResponse(x => x.url().includes('/api/Reportes/ReportePlanFacilidades') && !x.url().includes('Descarga'), { timeout: 120000 }),
    botonPaginador(r, cual).click(),
  ]);
  await r.portal.waitForTimeout(1000);
  return resp.json().catch(() => ({}));
}

test.describe('AG-791 — Reporte Planes de Facilidades (Portal Agente)', () => {
  test.skip(!process.env.MONGO_URI, 'Requiere MONGO_URI en .env (el oráculo lee Mongo)');
  test.setTimeout(240000);

  // 2026-10-30: corregidos AG-944 ("nuevo/2025" en Instrumento Legal) y AG-949
  // (Año e Impuesto armados con los planes existentes). Año y Estado se habilitan
  // tras elegir el instrumento, e Impuesto tras elegir el Año.
  test('CA01 — filtros disponibles y sus valores', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    expect([...await r.opciones('Instrumento Legal')].sort()).toEqual(['461/AGIP/25', '890/MHFGC/20']);
    const anioActual = new Date().getFullYear();
    for (const instrumento of ['890/MHFGC/20', '461/AGIP/25']) {
      await r.elegir('Instrumento Legal', instrumento);
      const anios = (await r.opciones('Año')).map(Number).sort();
      expect(anios, `Años de ${instrumento}`).toEqual(Array.from({ length: anioActual - 2021 }, (_, i) => 2022 + i));
      await r.elegir('Año', String(anioActual));
      expect([...await r.opciones('Estado')].sort(), `Estados de ${instrumento}`).toEqual(['Caduco', 'Cancelado', 'Nulo', 'Todos', 'Vigente']);
    }
    // Obligatorios con asterisco (el nombre accesible del campo lo incluye)
    for (const campo of ['Reporte', 'Instrumento Legal', 'Año']) {
      expect(await r.campo(campo).innerText(), `${campo} debe tener asterisco`).toContain('*');
    }
    await expect(r.portal.getByText('* Campo obligatorio')).toBeVisible();
    await r.portal.screenshot({ path: 'screenshots/AG791_CA01_filtros.png', fullPage: true });
  });

  test('CA01 — impuestos por instrumento y año según PFP_Impuestos_Incluidos + Regimenes', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    const anioActual = new Date().getFullYear();
    for (const instrumento of ['890/MHFGC/20', '461/AGIP/25']) {
      const esperados = await impuestosPorInstrumento(instrumento);
      await r.elegir('Instrumento Legal', instrumento);
      for (let anio = 2022; anio <= anioActual; anio++) {
        await r.elegir('Año', String(anio));
        const enPantalla = (await r.opciones('Impuesto')).filter(o => o !== 'Todos');
        console.log(`AG791 — ${instrumento} ${anio}: ${enPantalla.length} impuestos en pantalla, ${esperados.length} en la tabla`);
        expect([...enPantalla].sort(), `Impuestos de ${instrumento} ${anio}`).toEqual([...esperados].sort());
      }
    }
  });

  // 2026-10-20: corregido en el back — Impuesto pasó a obligatorio (asterisco y
  // "Consultar" deshabilitado sin él), como piden CA01/CA02/CA03. Antes era test.fail().
  test('CA01/CA02 — Impuesto obligatorio', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.elegir('Instrumento Legal', '890/MHFGC/20');
    await r.elegir('Año', '2026');
    expect(await r.campo('Impuesto').innerText(), 'Impuesto debería tener asterisco').toContain('*');
    await expect(r.consultar, 'Sin Impuesto no debería poder consultar').toBeDisabled();
  });

  test('CA02 — sin Instrumento Legal, Año o Impuesto no permite consultar', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await expect(r.consultar).toBeDisabled();
    await r.elegir('Instrumento Legal', '890/MHFGC/20');
    await expect(r.consultar, 'Falta Año').toBeDisabled();
    await r.elegir('Año', '2026');
    await expect(r.consultar, 'Falta Impuesto').toBeDisabled();
    await r.elegir('Impuesto', CM);
    await expect(r.consultar, 'Obligatorios completos').toBeEnabled();
  });

  test('CA03/CA04 — grilla igual a Mongo, fila por fila (890/2026/CM)', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    const res = await r.consultarCon(CONSULTA_CHICA);
    console.log(`AG791 — consulta en ${res.segundos.toFixed(1)} s`);
    expect(res.respuesta?.codigo, JSON.stringify(res.respuesta?.errores)).toBe(1);
    expect(await r.encabezados()).toEqual(['N° Solicitud', 'Instrumento Legal', 'CUIT', 'Razón Social', 'Impuesto', 'Fecha de Alta',
      'Cant. de Cuotas', 'Deuda nominal', 'Interés resarcitorio', 'Interés financiero']);
    // Contenido fila por fila, buscando cada plan por N° de solicitud (el orden se valida aparte)
    const esperados = new Map((await planesEsperados(CONSULTA_CHICA)).map(p => [p.solicitud, filaGrilla(p)]));
    const grilla = await r.leerGrilla();
    expect(grilla.length).toBe(esperados.size);
    grilla.forEach((fila, i) => {
      expect(esperados.has(fila[0]), `fila ${i + 1}: ${fila[0]} no está en la base`).toBe(true);
      compararFila(fila, esperados.get(fila[0]), `fila ${i + 1} (${fila[0]})`);
    });
    await r.portal.screenshot({ path: 'screenshots/AG791_CA03_CA04_grilla.png', fullPage: true });
  });

  test('CA03 — orden ascendente por fecha de creación (890/2026/CM)', async ({ page }) => {
    test.fail(true, 'Observación (no cargada en Jira): la grilla ordena por orden de inserción (_id), no por created. Solo se nota en 2223000125, cuyo created fue editado a mano (01/05/2026): aparece 19.º en vez de 2.º.');
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_CHICA);
    const esperados = await planesEsperados(CONSULTA_CHICA);
    expect((await r.leerGrilla()).map(f => f[0])).toEqual(esperados.map(p => p.solicitud));
  });

  test('CA03 — filtro por Estado (461/2026/CL/Caduco)', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    const res = await r.consultarCon(CONSULTA_ESTADO);
    expect(res.respuesta?.codigo, JSON.stringify(res.respuesta?.errores)).toBe(1);
    const esperados = await planesEsperados(CONSULTA_ESTADO);
    expect((await r.leerGrilla()).map(f => f[0])).toEqual(esperados.map(p => p.solicitud));
  });

  test('CA05 — paginación de 50 con primera/anterior/siguiente/última (890/2025/CL)', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    const res = await r.consultarCon(CONSULTA_2_PAGINAS);
    const esperados = await planesEsperados(CONSULTA_2_PAGINAS);
    const totalPaginas = Math.ceil(esperados.length / 50);
    expect(totalPaginas, 'el dato tiene que tener más de 50 planes').toBeGreaterThan(1);
    expect(res.respuesta?.content?.totalItems).toBe(esperados.length);
    expect(res.respuesta?.content?.totalPaginas).toBe(totalPaginas);

    expect(await r.filas.count()).toBe(50);
    await expect(r.portal.getByText(new RegExp(`de\\s*${totalPaginas}\\b`))).toBeVisible();
    await expect(botonPaginador(r, 'primera')).toBeDisabled();
    await expect(botonPaginador(r, 'anterior')).toBeDisabled();

    let body = await irAPagina(r, 'siguiente');
    expect(body.codigo, JSON.stringify(body.errores)).toBe(1);
    expect(body.content.paginaActual).toBe(2);
    expect((await r.leerGrilla()).map(f => f[0])).toEqual(esperados.slice(50, 100).map(p => p.solicitud));

    body = await irAPagina(r, 'primera');
    expect(body.content.paginaActual).toBe(1);
    expect((await r.leerGrilla()).map(f => f[0])).toEqual(esperados.slice(0, 50).map(p => p.solicitud));

    body = await irAPagina(r, 'ultima');
    expect(body.content.paginaActual).toBe(totalPaginas);
    await expect(botonPaginador(r, 'siguiente')).toBeDisabled();
    await expect(botonPaginador(r, 'ultima')).toBeDisabled();

    body = await irAPagina(r, 'anterior');
    expect(body.content.paginaActual).toBe(totalPaginas - 1);
  });

  // AG-900 (corregido 28/10): antes respondía "Persona Inexistente" si la página tenía
  // un CUIT fuera de CCT.Padron; ahora el plan sale con la razón social vacía.
  test('CA05 — página 2 de 461/2026/CM (planes de CUITs que no están en el padrón)', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_GRANDE);
    const body = await irAPagina(r, 'siguiente');
    await r.portal.screenshot({ path: 'screenshots/AG791_CA05_pagina2.png', fullPage: true });
    expect(body.codigo, `Respuesta: ${JSON.stringify(body.errores)}`).toBe(1);
    expect(await r.filas.count()).toBe(50);
  });

  test('CA06 — consulta sin resultados: sin grilla ni descarga', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    expect(await planesEsperados(CONSULTA_VACIA), 'el dato tiene que dar 0 planes en Mongo').toHaveLength(0);
    await r.consultarCon(CONSULTA_VACIA);
    await r.portal.screenshot({ path: 'screenshots/AG791_CA06_sin_resultados.png', fullPage: true });
    await expect(r.portal.getByText(/No se encontraron datos|No encontramos registros/)).toBeVisible();
    await expect(r.filas).toHaveCount(0);
    await expect(r.descargar).toHaveCount(0);
  });

  // AG-901 (corregido 28/10): antes mostraba "No se encontraron datos para los filtros de búsqueda seleccionados."
  test('CA06 — texto del mensaje sin resultados', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_VACIA);
    await expect(r.portal.getByText(TEXTO_CA06)).toBeVisible();
  });

  test('CA07/CA08 — Excel con los mismos planes que la consulta (890/2026/CM)', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_CHICA);
    await expect(r.descargar).toBeVisible();
    const [descarga] = await Promise.all([r.portal.waitForEvent('download', { timeout: 120000 }), r.descargar.click()]);
    const archivo = test.info().outputPath(descarga.suggestedFilename());
    await descarga.saveAs(archivo);
    await test.info().attach('reporte.xlsx', { path: archivo });
    const [encabezado, ...filas] = leerXlsx(archivo);
    console.log(`AG791 — Excel ${descarga.suggestedFilename()}: ${filas.length} filas · ${JSON.stringify(encabezado)}`);
    const esperados = new Map((await planesEsperados(CONSULTA_CHICA)).map(p => [p.solicitud, p]));
    expect(encabezado).toHaveLength(10);
    expect(filas.map(f => String(f[0])).sort()).toEqual([...esperados.keys()].sort());
    filas.forEach(f => {
      const p = esperados.get(String(f[0]));
      expect([f[1], f[2], f[4], Number(f[6]), Number(f[7])], `fila ${p.solicitud}`).toEqual([p.instrumento, p.cuit, p.impuesto, p.cuotas, p.deudaNominal]);
    });
  });

  // AG-897 (corregido 28/10): los importes perdían el separador decimal (intereses ×100).
  test('CA08 — Excel: importes de intereses iguales a la consulta', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_CHICA);
    const [descarga] = await Promise.all([r.portal.waitForEvent('download', { timeout: 120000 }), r.descargar.click()]);
    const archivo = test.info().outputPath(descarga.suggestedFilename());
    await descarga.saveAs(archivo);
    const [, ...filas] = leerXlsx(archivo);
    const esperados = new Map((await planesEsperados(CONSULTA_CHICA)).map(p => [p.solicitud, p]));
    expect(filas).toHaveLength(esperados.size);
    filas.forEach(f => {
      const p = esperados.get(String(f[0]));
      expect([Number(f[7]), Number(f[8]), Number(f[9])], `importes de ${f[0]}`).toEqual([p.deudaNominal, p.interesResarcitorio, p.interesFinanciero]);
    });
  });

  test('CA08 — Excel: Fecha Alta igual a la grilla (alta entre 21:00 y 23:59, plan 2223000125)', async ({ page }) => {
    test.fail(true, 'Defecto (02/11): el Excel guarda la Fecha Alta en UTC con formato dd/MM/yyyy, así que un alta entre las 21:00 y las 23:59 hora argentina sale con un día más que en la grilla. Ej. 2223000125: grilla 30/04/2026, Excel 01/05/2026. 7 planes de QA en esa franja.');
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_CHICA);
    const enGrilla = (await r.leerGrilla()).find(f => f[0] === '2223000125');
    const [descarga] = await Promise.all([r.portal.waitForEvent('download', { timeout: 120000 }), r.descargar.click()]);
    const archivo = test.info().outputPath(descarga.suggestedFilename());
    await descarga.saveAs(archivo);
    const [, ...filas] = leerXlsx(archivo);
    // Excel muestra el serial tal cual (sin zona horaria) con el formato dd/MM/yyyy de la celda
    const iso = new Date(Math.round((Number(filas.find(f => String(f[0]) === '2223000125')[5]) - 25569) * 86400000)).toISOString();
    expect(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`).toBe(enGrilla[5]);
  });

  // AG-898 (corregido 28/10): la descarga respondía HTTP 500 con gran volumen.
  test('CA08 — Excel de una consulta grande (461/2026/CM, 72.392 planes)', async ({ page }) => {
    test.setTimeout(400000);
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_GRANDE);
    const [descarga] = await Promise.all([r.portal.waitForEvent('download', { timeout: 240000 }), r.descargar.click()]);
    expect(descarga.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  // AG-899 (corregido 28/10): antes mostraba "Actualmente no podemos efectuar esta consulta…" y borraba la grilla.
  test('CA09 — error al generar el Excel muestra el mensaje del criterio', async ({ page }) => {
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    await r.consultarCon(CONSULTA_CHICA);
    // Se fuerza el error de la descarga devolviendo lo mismo que el backend real ante un 500
    await r.portal.route('**/api/Reportes/ReportePlanFacilidadesDescarga', ruta => ruta.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ mensaje: TEXTO_CA09 }),
    }));
    await r.descargar.click();
    await r.portal.waitForTimeout(3000);
    await r.portal.screenshot({ path: 'screenshots/AG791_CA09_error_descarga.png', fullPage: true });
    await expect(r.portal.getByText(TEXTO_CA09)).toBeVisible();
    expect(await r.filas.count(), 'la grilla consultada no debería desaparecer').toBeGreaterThan(0);
  });

  // Corregido 28/10: el plan 1583024404 (Fecha_Consolidacion y created guardados como
  // string) antes no aparecía en el reporte.
  test('CA03 — plan con Fecha_Consolidacion guardada como texto (1583024404, 461/2025/Automotor)', async ({ page }) => {
    const consulta = { instrumento: '461/AGIP/25', anio: 2025, estado: 'Todos', impuesto: 'Automotor' };
    const r = await new ReportePlanesFacilidadesPage(page).abrir();
    const res = await r.consultarCon(consulta);
    expect(res.respuesta?.codigo, JSON.stringify(res.respuesta?.errores)).toBe(1);
    const esperados = await planesEsperados(consulta);
    const enPantalla = (await r.leerGrilla()).map(f => f[0]);
    console.log(`AG791 — 461/2025/Automotor: ${enPantalla.length} en pantalla, ${esperados.length} en Mongo · 1583024404 ${enPantalla.includes('1583024404') ? 'SÍ' : 'NO'} aparece`);
    expect(enPantalla).toEqual(esperados.map(p => p.solicitud).slice(0, 50));
  });
});
