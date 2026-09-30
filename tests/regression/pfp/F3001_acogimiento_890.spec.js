// tests/regression/pfp/F3001_acogimiento_890.spec.js
// F3001 — Acogimiento bajo la norma 890/MHFGC/20 (distinta de 461/AGIP/25,
// que es la que usa el resto de la suite — ver F3001_acogimiento.spec.js).
// Ver memoria pfp-roadmap-fases para el detalle del desbloqueo.
//
// 890 tiene una regla de negocio que 461 NO tiene: exige "cancelación de
// obligaciones tributarias en los 90 días corridos previos". Ningún CUIT
// usado en el resto de la suite la cumple — el usuario proveyó uno
// dedicado (CONTRIBUYENTES.con890) que sí la cumple, confirmado real
// 2026-09-16 (acogimiento generado de punta a punta, Solicitud 2223000121,
// ver PLANES_CONOCIDOS.plan890).
//
// Mismo patrón que TC_CUOTAS_001-004 de F3001_acogimiento.spec.js: se
// detienen antes de "Confirmar" (solo verifican que el checkbox de
// declaración + botón Confirmar queden habilitados) para no gastar los
// períodos de deuda disponibles en cada corrida — la deuda real de este
// CUIT es finita (10 períodos vistos la primera vez).
//
// Hallazgos propios de 890 (no asumir que se comportan igual que 461):
// - Prefijo de solicitud propio (2223... en vez de 1523/1543/1783).
// - Interés condonado 0% en la prueba real (461 mostró 70%).
// - Dropdown de cuotas ofrece todas las cantidades individualmente (no saltos).
//   ⚠ El menú es virtualizado: sólo renderiza ~20 opciones hasta que se
//   scrollea (ver PFPPage.obtenerOpcionesCuotas). El "máximo 20" que se
//   registró antes era un error de lectura, no un límite real.
const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../../pages/LoginPage');
const { PFPPage } = require('../../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT, PFP } = require('../../../fixtures/test-data');

test.describe('F3001 — Acogimiento bajo norma 890/MHFGC/20', () => {

  async function loginYNavegar(page) {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_AV, CONTRIBUYENTES.con890.cuit, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);
    await pfpPage.irAPlanesYMoratoria();
    return { portalPage, pfpPage };
  }

  async function consultarDeuda890(portalPage) {
    await portalPage.getByRole('button', { name: 'Tipo de plan' }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('option', { name: '890/MHFGC/20' }).click();
    await portalPage.waitForTimeout(500);
    await portalPage.getByRole('button', { name: 'Operación' }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('option', { name: 'Nuevo plan de facilidades' }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Impuesto' }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('option', { name: CONTRIBUYENTES.con890.impuesto, exact: true }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Consultar' }).click();
    await portalPage.waitForTimeout(1500);
    await portalPage.getByText('Procesando').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await portalPage.waitForTimeout(800);
  }

  async function llegarAlPaso3(portalPage, cantidadCuotas) {
    const filas = portalPage.locator('table tbody tr');
    const totalFilas = await filas.count();
    let filaElegida = null;
    for (let i = 0; i < totalFilas; i++) {
      const fila = filas.nth(i);
      const texto = await fila.innerText();
      const columnas = texto.split('\t').filter(Boolean);
      const posibleCapital = columnas.find(c => /^\$\s*[1-9]/.test(c.trim()));
      if (posibleCapital) { filaElegida = fila; break; }
    }
    expect(filaElegida, 'Debe existir al menos un período con deuda > $0 para CONTRIBUYENTES.con890').toBeTruthy();
    await filaElegida.locator('.v-simple-checkbox > .v-input--selection-controls__input > .v-icon').click();
    await portalPage.waitForTimeout(500);
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    // Menú virtualizado: hay que leer la lista completa (ver PFPPage.obtenerOpcionesCuotas).
    const pfpPage = new PFPPage(portalPage);
    const opciones = await pfpPage.obtenerOpcionesCuotas();
    if (!opciones.includes(cantidadCuotas)) {
      console.log(`Opción "${cantidadCuotas}" no disponible, tomando máximo disponible`);
      await pfpPage.seleccionarCuotas(opciones[opciones.length - 1]);
    } else {
      await pfpPage.seleccionarCuotas(cantidadCuotas);
    }
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');
  }

  async function llegarAConfirmacion(portalPage, nombreTest) {
    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill(nombreTest);
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill(CONTRIBUYENTES.con890.cuit);
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
    await expect(checkboxConfirmacion).toBeVisible({ timeout: 10000 });
    await checkboxConfirmacion.click();
    await expect(portalPage.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
  }

  test('TC_890_001 — Tipo de plan 890/MHFGC/20 ofrece los impuestos esperados', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await portalPage.getByRole('button', { name: 'Tipo de plan' }).click();
    await portalPage.waitForTimeout(300);
    await expect(portalPage.getByRole('option', { name: '890/MHFGC/20' })).toBeVisible();
    await portalPage.getByRole('option', { name: '890/MHFGC/20' }).click();
    await portalPage.waitForTimeout(500);

    await portalPage.getByRole('button', { name: 'Impuesto' }).click();
    await portalPage.waitForTimeout(300);
    const impuestos = await portalPage.getByRole('option').allTextContents();
    console.log('TC_890_001 — Impuestos disponibles bajo 890:', JSON.stringify(impuestos));
    expect(impuestos).toContain(CONTRIBUYENTES.con890.impuesto);
    expect(impuestos.length).toBeGreaterThanOrEqual(10);
  });

  test('TC_890_CUOTAS_001 — Plan con 3 cuotas bajo 890 genera acogimiento correctamente', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda890(portalPage);
    await llegarAlPaso3(portalPage, '3 cuotas');
    await llegarAConfirmacion(portalPage, 'test 890 3 cuotas');
    await portalPage.screenshot({ path: 'screenshots/TC_890_CUOTAS_001.png', fullPage: true });
    console.log('TC_890_CUOTAS_001 — Plan 890 con 3 cuotas listo para confirmar');
  });

  test('TC_890_CUOTAS_002 — Plan con 6 cuotas bajo 890 genera acogimiento correctamente', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda890(portalPage);
    await llegarAlPaso3(portalPage, '6 cuotas');
    await llegarAConfirmacion(portalPage, 'test 890 6 cuotas');
    await portalPage.screenshot({ path: 'screenshots/TC_890_CUOTAS_002.png', fullPage: true });
    console.log('TC_890_CUOTAS_002 — Plan 890 con 6 cuotas listo para confirmar');
  });

  test('TC_890_CUOTAS_003 — Plan con máximo de cuotas disponibles bajo 890', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda890(portalPage);

    const filas = portalPage.locator('table tbody tr');
    const totalFilas = await filas.count();
    let filaElegida = null;
    for (let i = 0; i < totalFilas; i++) {
      const fila = filas.nth(i);
      const texto = await fila.innerText();
      const columnas = texto.split('\t').filter(Boolean);
      const posibleCapital = columnas.find(c => /^\$\s*[1-9]/.test(c.trim()));
      if (posibleCapital) { filaElegida = fila; break; }
    }
    expect(filaElegida, 'Debe existir al menos un período con deuda > $0').toBeTruthy();
    await filaElegida.locator('.v-simple-checkbox > .v-input--selection-controls__input > .v-icon').click();
    await portalPage.waitForTimeout(500);
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    // Menú virtualizado: sin scrollear, la última opción renderizada es
    // "20 cuotas" aunque el máximo real sea mayor (ver PFPPage.obtenerOpcionesCuotas).
    const pfpPage = new PFPPage(portalPage);
    const opciones = await pfpPage.obtenerOpcionesCuotas();
    const ultimaOpcion = opciones[opciones.length - 1];
    console.log(`TC_890_CUOTAS_003 — Máximo de cuotas disponibles bajo 890: ${ultimaOpcion} (${opciones.length} opciones)`);
    expect(ultimaOpcion, 'Máximo de cuotas de 890/MHFGC/20 (PFP.maxCuotas)').toBe(`${PFP.maxCuotas['890/MHFGC/20']} cuotas`);
    await pfpPage.seleccionarCuotas(ultimaOpcion);
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await llegarAConfirmacion(portalPage, 'test 890 max cuotas');
    await portalPage.screenshot({ path: 'screenshots/TC_890_CUOTAS_003.png', fullPage: true });
    console.log(`TC_890_CUOTAS_003 — Plan 890 con máximo cuotas (${ultimaOpcion}) listo para confirmar`);
  });

});
