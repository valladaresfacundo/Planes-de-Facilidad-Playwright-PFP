// tests/regression/pfp/BUG_redondeo_simulacion_cuotas.spec.js
// Bug de UI encontrado 2026-09-16: en el paso "Simulación de Cuotas" del
// wizard de acogimiento (Operaciones → Planes/Moratoria), el modal
// "VER DETALLE" muestra una tabla por cuota (Importe Nominal / Interés
// financiero / Importe total) donde la columna "Importe total" NO es el
// resultado real de sumar Importe Nominal + Interés financiero de esa
// misma fila — es un valor promedio (Total_Plan / Cantidad_Cuotas,
// redondeado) repetido igual en todas las filas. Cuando la división no cae
// justa al centavo, alguna fila queda mal cuadrada contra sus propias
// columnas (diferencia de $0,01).
//
// CONFIRMADO REAL 2026-09-16 con un plan real (Solicitud 1523073114, 4
// cuotas, CUIT 27236036044): la cuota 3 mostraba "Importe total" $6.554,38
// pero Importe Nominal ($6.299,86) + Interés financiero ($254,51) = $6.554,37
// — 1 centavo de diferencia. Verificado también contra Mongo
// (content.Importe_Nominal + content.Interes_Financiero de esa cuota):
// el backend calcula bien el TOTAL del plan (Total_Plan coincide con la
// suma real de las 4 filas) — el bug es puramente de presentación en esta
// tabla del wizard, no de cálculo de fondo.
//
// Este test NO necesita generar el plan de facilidades — el detalle
// completo ya está visible en el paso 2 del wizard, antes de tocar CBU/
// Confirmación. No muta datos reales (nunca confirma nada).
//
// Se prueban las 4 cantidades de cuotas válidas para este chequeo (3 a 6,
// pedido explícito del usuario) — al variar la cantidad de cuotas cambia
// cómo cae el redondeo, así que probar varias aumenta la chance real de
// exponer el bug en al menos una.
//
// Usa test.fail() (mismo criterio que BUG_52821_pago_sobre_plan_caduco.spec.js):
// hoy "pasa" (falla como se espera, sin romper la suite) porque el bug
// está confirmado presente; el día que se arregle el cálculo de "Importe
// total" por fila, este test va a pasar de verdad y Playwright lo va a
// marcar como alerta ("expected to fail, but passed") — señal de sacar el
// test.fail() y dejarlo como regresión normal.
// ⚠ Es un bug de redondeo dependiente de los montos reales de deuda del
// ambiente — en una corrida puntual podría no manifestarse si la división
// cae justa (poco probable en la práctica, pero posible).
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage } = require('../../../pages/PFPPage');
const { AMBIENTES, SIGN_CCT } = require('../../../fixtures/test-data');
const { cuitConDeuda } = require('../../../lib/deudaEjecucion');

function parsearMoneda(texto) {
  const limpio = texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(limpio);
}

async function elegirPeriodoConDeuda(page) {
  const filas = page.locator('table tbody tr');
  const totalFilas = await filas.count();
  for (let i = 0; i < totalFilas; i++) {
    const fila = filas.nth(i);
    const texto = await fila.innerText();
    const columnas = texto.split('\t').filter(Boolean);
    const posibleCapital = columnas.find(c => /^\$\s*[1-9]/.test(c.trim()));
    if (posibleCapital) {
      await fila.locator('.v-simple-checkbox > .v-input--selection-controls__input > .v-icon').click();
      return true;
    }
  }
  return false;
}

async function leerDetalleCuotas(page, cantidadCuotas) {
  await page.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: `${cantidadCuotas} cuotas`, exact: true }).click();
  await page.waitForTimeout(800);

  await page.getByText('VER DETALLE').click();
  await page.waitForTimeout(800);

  const filasDetalle = page.locator('table tbody tr').filter({ hasText: /^\s*0?\d/ });
  const cantidad = await filasDetalle.count();
  const filas = [];
  for (let i = 0; i < cantidad; i++) {
    const texto = await filasDetalle.nth(i).innerText();
    const columnas = texto.split('\t').filter(Boolean).map(c => c.trim());
    // columnas esperadas: [Nro, Fecha, ImporteNominal, InteresFinanciero, ImporteTotal]
    if (columnas.length < 5) continue;
    filas.push({
      numero: columnas[0],
      importeNominal: parsearMoneda(columnas[2]),
      interesFinanciero: parsearMoneda(columnas[3]),
      importeTotal: parsearMoneda(columnas[4]),
    });
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  return filas;
}

// 2026-10-14: antes era un test por cantidad de cuotas, y cada uno fallaba
// "como se esperaba" sólo si SU división caía mal — el de 3 cuotas "pasó" en
// la corrida del 2026-10-13 porque los montos cerraron justo, aunque 4/5/6
// seguían mostrando el bug. Ahora es UN solo test que revisa 3 a 6 cuotas en
// la misma simulación: falla (como se espera) si alguna fila de alguna
// cantidad tiene diferencia, y sólo "pasa" — la alerta de que lo arreglaron —
// si ninguna de las 4 la tiene.
test('BUG_REDONDEO_CUOTAS — Importe Nominal + Interés financiero debe coincidir con Importe total por fila (3 a 6 cuotas)', async ({ page }) => {
  test.fail(true, 'Bug real confirmado 2026-09-16 — la columna "Importe total" del detalle de simulación usa un promedio en vez del cálculo real por fila.');

  const loginPage = new LoginPage(page);
  await loginPage.login(AMBIENTES.QA_AV, await cuitConDeuda(page.request), SIGN_CCT);
  const portalPage = loginPage.obtenerPagina();
  const pfpPage = new PFPPage(portalPage);

  await pfpPage.irAPlanesYMoratoria();
  await pfpPage.consultarDeudaConFallback({
    tipoPlan: '461/AGIP/25',
    operacion: 'Nuevo plan de facilidades',
    impuestoPreferido: 'IIBB - Convenio Multilateral',
    impuestosFallback: ['Sellos'],
  });

  const encontroPeriodo = await elegirPeriodoConDeuda(portalPage);
  expect(encontroPeriodo, 'Debe existir al menos un período con deuda > $0').toBe(true);
  await portalPage.waitForTimeout(500);
  await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
  await portalPage.waitForLoadState('networkidle');

  const discrepancias = [];
  for (const cantidadCuotas of [3, 4, 5, 6]) {
    const filas = await leerDetalleCuotas(portalPage, cantidadCuotas);
    expect(filas.length, `Debe haber ${cantidadCuotas} filas en el detalle`).toBe(cantidadCuotas);
    const conDiferencia = filas
      .map(f => ({ cuotas: cantidadCuotas, ...f, esperado: Math.round((f.importeNominal + f.interesFinanciero) * 100) / 100 }))
      .filter(f => Math.abs(f.esperado - f.importeTotal) >= 0.005);
    console.log(`BUG_REDONDEO_CUOTAS — ${cantidadCuotas} cuotas: ${conDiferencia.length ? JSON.stringify(conDiferencia) : 'sin discrepancias'}`);
    discrepancias.push(...conDiferencia);
  }

  // No muta datos reales: nunca se confirma nada.
  expect(discrepancias, 'Ninguna fila debería tener diferencia entre Importe Nominal+Interés y el Importe total mostrado').toEqual([]);
});
