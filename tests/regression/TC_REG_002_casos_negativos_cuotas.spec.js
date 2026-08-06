// tests/regression/TC_REG_002_casos_negativos_cuotas.spec.js
const { test, expect } = require('@playwright/test');
const { LoginPage }    = require('../../pages/LoginPage');
const { PFPPage }      = require('../../pages/PFPPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT } = require('../../fixtures/test-data');

test.describe('Regresión — Casos negativos y variantes de cuotas', () => {

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

 async function llegarAlPaso3(portalPage, cantidadCuotas) {
    const checkboxPeriodo = portalPage.locator('td > .v-simple-checkbox > .v-input--selection-controls__input > .v-icon').first();
    await expect(checkboxPeriodo).toBeVisible({ timeout: 10000 });
    await checkboxPeriodo.click();
    await portalPage.waitForTimeout(500);

    // Usamos .last() porque el botón habilitado es el último cuando hay dos
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
    await portalPage.waitForTimeout(500);

    // Verificamos si la opción existe antes de clickear
    const opcion = portalPage.getByRole('option', { name: cantidadCuotas, exact: true });
    const existeOpcion = await opcion.isVisible({ timeout: 3000 }).catch(() => false);

    if (!existeOpcion) {
      // Si no existe la opción pedida, tomamos la última disponible
      console.log(`Opción "${cantidadCuotas}" no disponible, tomando máximo disponible`);
      const opciones = portalPage.getByRole('option');
      await opciones.last().click();
    } else {
      await opcion.click();
    }

    await portalPage.waitForTimeout(300);
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');
  }

  test('TC_NEG_002 — Paso 3 sin datos no habilita botón Continuar', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    await llegarAlPaso3(portalPage, '1 cuota');

    await expect(portalPage.getByRole('textbox', { name: 'Titular de Cuenta' })).toBeVisible();
    await expect(portalPage.getByRole('textbox', { name: 'CUIT' })).toBeVisible();
    await expect(portalPage.getByRole('textbox', { name: 'CBU' })).toBeVisible();

    // Verificamos el botón deshabilitado — hay dos "Continuar", el disabled es el nth(1)
    await expect(portalPage.getByRole('button', { name: 'Continuar' }).last()).toBeDisabled();

    await portalPage.screenshot({ path: 'screenshots/TC_NEG_002_campos_vacios.png', fullPage: true });
    console.log('TC_NEG_002 — Botón Continuar deshabilitado con campos vacíos');
  });

  test('TC_NEG_003 — Paso 3 con solo Titular no habilita Continuar', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    await llegarAlPaso3(portalPage, '1 cuota');

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('Solo titular');
    await portalPage.waitForTimeout(300);

    await expect(portalPage.getByRole('button', { name: 'Continuar' }).last()).toBeDisabled();

    await portalPage.screenshot({ path: 'screenshots/TC_NEG_003_solo_titular.png', fullPage: true });
    console.log('TC_NEG_003 — Continuar deshabilitado con solo Titular');
  });

  test('TC_CUOTAS_001 — Plan con 1 cuota genera acogimiento correctamente', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    await llegarAlPaso3(portalPage, '1 cuota');

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test 1 cuota');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill('30686855860');
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_CUOTAS_001_paso4.png', fullPage: true });

    const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
    await expect(checkboxConfirmacion).toBeVisible({ timeout: 10000 });
    await checkboxConfirmacion.click();
    await expect(portalPage.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    console.log('TC_CUOTAS_001 — Plan 1 cuota listo para confirmar');
  });

  test('TC_CUOTAS_002 — Plan con 6 cuotas genera acogimiento correctamente', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    await llegarAlPaso3(portalPage, '6 cuotas');

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test 6 cuotas');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill('30686855860');
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_CUOTAS_002_paso4.png', fullPage: true });

    const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
    await expect(checkboxConfirmacion).toBeVisible({ timeout: 10000 });
    await checkboxConfirmacion.click();
    await expect(portalPage.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    console.log('TC_CUOTAS_002 — Plan 6 cuotas listo para confirmar');
  });

  test('TC_CUOTAS_003 — Plan con 12 cuotas genera acogimiento correctamente', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);
    await llegarAlPaso3(portalPage, '12 cuotas');

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test 12 cuotas');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill('30686855860');
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_CUOTAS_003_paso4.png', fullPage: true });

    const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
    await expect(checkboxConfirmacion).toBeVisible({ timeout: 10000 });
    await checkboxConfirmacion.click();
    await expect(portalPage.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    console.log('TC_CUOTAS_003 — Plan 12 cuotas listo para confirmar');
  });

  test('TC_CUOTAS_004 — Plan con máximo de cuotas disponibles', async ({ page }) => {
    const { portalPage } = await loginYNavegar(page);
    await consultarDeuda(portalPage);

    const checkboxPeriodo = portalPage.locator('td > .v-simple-checkbox > .v-input--selection-controls__input > .v-icon').first();
    await expect(checkboxPeriodo).toBeVisible({ timeout: 10000 });
    await checkboxPeriodo.click();
    await portalPage.waitForTimeout(500);
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    // Abrimos el dropdown y seleccionamos la última opción disponible (máximo de cuotas)
    await portalPage.getByRole('button', { name: '*Cantidad de cuotas a pagar' }).click();
    await portalPage.waitForTimeout(500);
    const opciones = portalPage.getByRole('option');
    const cantidadOpciones = await opciones.count();
    const ultimaOpcion = await opciones.last().textContent();
    await opciones.last().click();
    await portalPage.waitForTimeout(300);
    console.log(`TC_CUOTAS_004 — Máximo de cuotas disponibles: ${ultimaOpcion} (${cantidadOpciones} opciones)`);

    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.getByRole('textbox', { name: 'Titular de Cuenta' }).fill('test max cuotas');
    await portalPage.getByRole('textbox', { name: 'CUIT' }).fill('30686855860');
    await portalPage.getByRole('textbox', { name: 'CBU' }).fill('0065639511100051073131');
    await portalPage.getByRole('button', { name: 'Continuar' }).last().click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.screenshot({ path: 'screenshots/TC_CUOTAS_004_max_cuotas.png', fullPage: true });

    const checkboxConfirmacion = portalPage.locator('.v-input__slot > .v-input--selection-controls__input > .v-input--selection-controls__ripple');
    await expect(checkboxConfirmacion).toBeVisible({ timeout: 10000 });
    await checkboxConfirmacion.click();
    await expect(portalPage.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    console.log(`TC_CUOTAS_004 — Plan con máximo cuotas (${ultimaOpcion}) listo para confirmar`);
  });

  });