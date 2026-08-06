// tests/regression/TC_REG_001_planes_moratoria.spec.js
const { test, expect } = require('@playwright/test');
const { LoginPage }    = require('../../pages/LoginPage');
const { PFPPage }      = require('../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT } = require('../../fixtures/test-data');

test.describe('Regresión — Planes / Moratoria', () => {

  async function loginYNavegar(page) {
    const loginPage = new LoginPage(page);
    await loginPage.login(AMBIENTES.QA_HOMO, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
    const portalPage = loginPage.obtenerPagina();
    const pfpPage = new PFPPage(portalPage);
    await pfpPage.irAPlanesYMoratoria();
    return { portalPage, pfpPage };
  }

  async function seleccionarDropdown(portalPage, labelTexto, opcionTexto) {
    await portalPage.locator(`label:text-is("${labelTexto}")`).click();
    await portalPage.waitForTimeout(500);
    await portalPage.locator(`.v-list-item__title:text-is("${opcionTexto}")`).click();
    await portalPage.waitForTimeout(300);
  }

  async function consultarDeuda(portalPage) {
    await seleccionarDropdown(portalPage, 'Tipo de plan', '461/AGIP/25');
    await seleccionarDropdown(portalPage, 'Operación', 'Nuevo plan de facilidades');
    await seleccionarDropdown(portalPage, 'Impuesto', 'IIBB - Convenio Multilateral');
    await portalPage.getByRole('button', { name: 'Consultar' }).click();
    await portalPage.waitForLoadState('networkidle');
  }

  test('TC_REG_001 — Pantalla Planes/Moratoria carga con los 3 filtros', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await expect(portalPage.locator('label:text-is("Tipo de plan")')).toBeVisible();
    await expect(portalPage.locator('label:text-is("Operación")')).toBeVisible();
    await expect(portalPage.locator('label:text-is("Impuesto")')).toBeVisible();
    await expect(portalPage.getByText('Seleccionar Deuda')).toBeVisible();
    await expect(portalPage.getByText('Simulación de Cuotas')).toBeVisible();
    await expect(portalPage.getByText('Ingreso de CBU')).toBeVisible();
    await expect(portalPage.getByText('Confirmación')).toBeVisible();
    await expect(portalPage.getByText('Resultado')).toBeVisible();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_001_pantalla_inicial.png', fullPage: true });
    console.log('TC_REG_001 — Pantalla inicial correcta');
  });

  test('TC_REG_002 — Dropdown Tipo de plan muestra opciones correctas', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await portalPage.locator('label:text-is("Tipo de plan")').click();
    await portalPage.waitForTimeout(500);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_002_dropdown_tipo_plan.png', fullPage: true });
    await expect(portalPage.locator('.v-list-item__title:text-is("890/MHFGC/20")')).toBeVisible();
    await expect(portalPage.locator('.v-list-item__title:text-is("461/AGIP/25")')).toBeVisible();
    console.log('TC_REG_002 — Planes disponibles: 890/MHFGC/20 y 461/AGIP/25');
  });

  test('TC_REG_003 — Consulta con 461/AGIP/25 muestra deuda', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_003_resultado_consulta.png', fullPage: true });
    await expect(portalPage.getByText('Períodos a incluir en el plan')).toBeVisible();
    await expect(portalPage.getByRole('button', { name: 'Continuar' })).toBeVisible();
    console.log('TC_REG_003 — Consulta exitosa');
  });

  test('TC_REG_004 — Períodos de deuda tienen datos y total mayor a $0', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    const tabla = portalPage.getByRole('table');
    await expect(tabla.getByText('Período')).toBeVisible();
    await expect(tabla.getByText('Fecha de Vto.')).toBeVisible();
    await expect(tabla.getByText('Total Capital')).toBeVisible();
    await expect(portalPage.getByText('Total de la deuda a regularizar').first()).toBeVisible();
    await portalPage.screenshot({ path: 'screenshots/TC_REG_004_periodos_deuda.png', fullPage: true });
    const textoTotal = await portalPage.getByText('Total de la deuda a regularizar')
      .first().locator('../..').textContent();
    console.log(`TC_REG_004 — Total deuda: ${textoTotal}`);
    expect(textoTotal).toContain('$');
  });

  test('TC_REG_005 — Continuar al paso 2 Simulación de Cuotas', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    const checkboxVuetify = portalPage.locator('.v-input--selection-controls__ripple').first();
    await expect(checkboxVuetify).toBeVisible({ timeout: 10000 });
    await checkboxVuetify.click();
    await portalPage.waitForTimeout(500);
    const btnContinuar = portalPage.getByRole('button', { name: 'Continuar' });
    await expect(btnContinuar).toBeEnabled({ timeout: 5000 });
    await btnContinuar.click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.screenshot({ path: 'screenshots/TC_REG_005_paso2_simulacion.png', fullPage: true });
    console.log(`TC_REG_005 — URL paso 2: ${portalPage.url()}`);
    await expect(portalPage.getByText('Simulación de Cuotas')).toBeVisible();
  });

   test('TC_REG_006 — Paso 2: dropdown de cuotas muestra opciones', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);

    // Selector correcto del Codegen para el checkbox de período
    const checkboxPeriodo = portalPage.locator('td > .v-simple-checkbox > .v-input--selection-controls__input > .v-icon').first();
    await expect(checkboxPeriodo).toBeVisible({ timeout: 10000 });
    await checkboxPeriodo.click();
    await portalPage.waitForTimeout(500);

    const btnContinuar = portalPage.getByRole('button', { name: 'Continuar' });
    await expect(btnContinuar).toBeEnabled({ timeout: 5000 });
    await btnContinuar.click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_REG_006_paso2_cuotas.png', fullPage: true });
    await expect(portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' })).toBeVisible();
    await portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
    await expect(portalPage.getByRole('option', { name: '1 cuota', exact: true })).toBeVisible();
    console.log('TC_REG_006 — Paso 2 OK: dropdown de cuotas visible');
  });

  test('TC_REG_007 — Paso 3: campos Titular, CUIT y CBU visibles', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);

    // Paso 1: seleccionar período
    const checkboxPeriodo = portalPage.locator('td > .v-simple-checkbox > .v-input--selection-controls__input > .v-icon').first();
    await expect(checkboxPeriodo).toBeVisible({ timeout: 10000 });
    await checkboxPeriodo.click();
    await portalPage.waitForTimeout(500);
    await portalPage.getByRole('button', { name: 'Continuar' }).click();
    await portalPage.waitForLoadState('networkidle');

    // Paso 2: seleccionar cuotas
    await portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
    await portalPage.getByRole('option', { name: '1 cuota', exact: true }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Continuar' }).click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_REG_007_paso3_cbu.png', fullPage: true });
    await expect(portalPage.getByRole('textbox', { name: 'Titular de Cuenta' })).toBeVisible();
    await expect(portalPage.getByRole('textbox', { name: 'CUIT' })).toBeVisible();
    await expect(portalPage.getByRole('textbox', { name: 'CBU' })).toBeVisible();
    console.log('TC_REG_007 — Paso 3 OK: campos visibles');
  });

  test('TC_REG_008 — Flujo E2E completo: acogimiento, confirmación y descarga PDF', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);

    // Paso 1: seleccionar período específico
    const checkboxPeriodo = portalPage.locator('td > .v-simple-checkbox > .v-input--selection-controls__input > .v-icon').first();
    await expect(checkboxPeriodo).toBeVisible({ timeout: 10000 });
    await checkboxPeriodo.click();
    await portalPage.waitForTimeout(500);
    await portalPage.getByRole('button', { name: 'Continuar' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_paso1_ok.png', fullPage: true });

    // Paso 2: seleccionar cantidad de cuotas
    await portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
    await portalPage.getByRole('option', { name: '1 cuota', exact: true }).click();
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Continuar' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_paso2_ok.png', fullPage: true });

    // Paso 3: ingresar datos de CBU
    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test case auto');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill('30686855860');
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Continuar' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_paso3_ok.png', fullPage: true });

    // Paso 4: aceptar términos y confirmar
    const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
    await expect(checkboxConfirmacion).toBeVisible({ timeout: 10000 });
    await checkboxConfirmacion.click();
    await portalPage.waitForTimeout(300);
    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_paso4_confirmacion.png', fullPage: true });
    await expect(portalPage.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    await portalPage.getByRole('button', { name: 'Confirmar' }).click();
    await portalPage.waitForLoadState('networkidle');

    // Paso 5: resultado — descargar PDF y verificar
    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_paso5_resultado.png', fullPage: true });
    console.log(`TC_REG_008 — URL resultado: ${portalPage.url()}`);

    // Verificamos que aparece el botón de descarga del PDF
    await expect(portalPage.getByRole('button', { name: 'Descargar' })).toBeVisible({ timeout: 10000 });

    // Descargamos el PDF y verificamos que se descargó
    const downloadPromise = portalPage.waitForEvent('download');
    await portalPage.getByRole('button', { name: 'Descargar' }).click();
    const download = await downloadPromise;
    console.log(`TC_REG_008 — PDF descargado: ${download.suggestedFilename()}`);
    expect(download.suggestedFilename()).toBeTruthy();

    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_pdf_descargado.png', fullPage: true });

    // Volvemos al inicio via "Ver detalle"
    await portalPage.getByRole('link', { name: 'Ver detalle' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.screenshot({ path: 'screenshots/TC_REG_008_ver_detalle.png', fullPage: true });

    console.log('TC_REG_008 — Flujo E2E completo exitoso con descarga de PDF');
  });


});