// tests/regression/pfp/F3006_reversa_caducidad.spec.js
// F3006 — Reversa de Caducidad (CADUCO → VIGENTE), Portal Agente perfil
// AgentePFP, Consultas → Consultar PF. Ver memoria pfp-formularios-catalogo.
// Reorganizado 2026-08-19 (antes: TC_AGPFP_007 en TC_AGENTE_003_reversas.spec.js)
// para agrupar la regresión por formulario. Ver F3013_reversa_nulidad.spec.js
// para el mismo componente de "Expediente" aplicado a Nulidad.
//
// Queda parado en "Continuar habilitado" y NO confirma, para ser repetible sin
// consumir un plan CADUCO nuevo en cada corrida (confirmar de verdad pasa el
// plan a VIGENTE). Ver memoria pfp-roadmap-fases para el detalle de cómo se
// descubrieron los selectores (scroll virtualizado, pressSequentially vs fill).
const { test, expect } = require('@playwright/test');
const { LoginAgentePage } = require('../../../pages/LoginAgentePage');
const { AMBIENTES_AGENTE, AGENTE, SIGN_AGENTE, PLANES_CONOCIDOS, EXPEDIENTE_REVERSA } = require('../../../fixtures/test-data');

const URL_AGENTE_QA = AMBIENTES_AGENTE.QA_HOMO;

test.describe('F3006 — Reversa de Caducidad (Portal Agente)', () => {

  async function loginYBuscarPlan(page, nroSolicitud) {
    const loginPage = new LoginAgentePage(page);
    await loginPage.login(URL_AGENTE_QA, AGENTE.usuario, AGENTE.perfiles.AgentePFP, SIGN_AGENTE);
    const portalPage = loginPage.obtenerPagina();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.getByRole('button', { name: 'Consultas' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.getByRole('link', { name: 'Consultar PF' }).click();
    await portalPage.waitForLoadState('networkidle');

    await portalPage.getByRole('textbox', { name: 'Ingresá el dato a buscar' }).fill(String(nroSolicitud));
    await portalPage.getByRole('button', { name: 'Consultar' }).click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.waitForTimeout(1000);

    return { portalPage };
  }

  function verificarPasoExpediente(portalPage) {
    return Promise.all([
      expect(portalPage.getByText('Expediente', { exact: true })).toBeVisible(),
      expect(portalPage.getByText('Confirmación', { exact: true })).toBeVisible(),
      expect(portalPage.getByText('Resultado', { exact: true }).first()).toBeVisible(),
      expect(portalPage.getByRole('button', { name: 'Tipo Actuación' })).toBeVisible(),
      expect(portalPage.getByRole('textbox', { name: 'Año' })).toBeVisible(),
      expect(portalPage.getByRole('textbox', { name: 'Número' })).toBeVisible(),
      expect(portalPage.getByRole('textbox', { name: 'Ente' })).toBeVisible(),
      expect(portalPage.getByRole('textbox', { name: 'Repartición' })).toBeVisible(),
    ]);
  }

  // "Tipo Actuación" es una lista larga y alfabética con scroll virtualizado —
  // hace falta simular rueda de mouse dentro del menú. pressSequentially en
  // vez de fill() porque la validación de estos campos necesita eventos de
  // teclado reales. Ver memoria pfp-roadmap-fases para el detalle completo.
  async function completarExpediente(portalPage) {
    const btnTipoActuacion = portalPage.getByRole('button', { name: 'Tipo Actuación' });
    await btnTipoActuacion.click();
    await portalPage.waitForTimeout(500);

    const opcion = portalPage.getByText(EXPEDIENTE_REVERSA.tipoActuacion, { exact: true });

    const triggerBox = await btnTipoActuacion.boundingBox();
    if (triggerBox) {
      await portalPage.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height + 60);
    }

    let visible = false;
    for (let intento = 0; intento < 40; intento++) {
      visible = await opcion.isVisible().catch(() => false);
      if (visible) break;
      await portalPage.mouse.wheel(0, 160);
      await portalPage.waitForTimeout(80);
    }
    if (!visible) {
      throw new Error(`No se encontró la opción "${EXPEDIENTE_REVERSA.tipoActuacion}" tras scrollear el dropdown "Tipo Actuación"`);
    }
    await opcion.click();
    await portalPage.waitForTimeout(300);

    await portalPage.getByRole('textbox', { name: 'Año' }).pressSequentially(EXPEDIENTE_REVERSA.anio);
    await portalPage.getByRole('textbox', { name: 'Año' }).press('Tab');
    await portalPage.getByRole('textbox', { name: 'Número' }).pressSequentially(EXPEDIENTE_REVERSA.numero);
    await portalPage.getByRole('textbox', { name: 'Número' }).press('Tab');
    await portalPage.getByRole('textbox', { name: 'Ente' }).pressSequentially(EXPEDIENTE_REVERSA.ente);
    await portalPage.getByRole('textbox', { name: 'Ente' }).press('Tab');
    await portalPage.getByRole('textbox', { name: 'Repartición' }).pressSequentially(EXPEDIENTE_REVERSA.reparticion);
    await portalPage.getByRole('textbox', { name: 'Repartición' }).press('Tab');
    await portalPage.waitForTimeout(500);
  }

  test('TC_AGPFP_007 — Expediente completo, "Continuar" habilitado', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.caduco, 'Requiere PLANES_CONOCIDOS.caduco en fixtures/test-data.js — ver memoria pfp-roadmap-fases');

    const { portalPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.caduco);
    await expect(portalPage.getByText('Caduco')).toBeVisible();
    await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_007_plan_caduco.png', fullPage: true });

    await portalPage.getByRole('button', { name: 'Reversa caducidad' }).click();
    await portalPage.waitForLoadState('networkidle');

    await expect(portalPage.getByText('Ingresá el expediente que avala la reversa de caducidad')).toBeVisible();
    await verificarPasoExpediente(portalPage);

    await completarExpediente(portalPage);
    const btnContinuar007 = portalPage.getByRole('button', { name: 'Continuar' });
    await btnContinuar007.scrollIntoViewIfNeeded();
    await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_007_form_expediente.png', fullPage: true });
    await expect(btnContinuar007).toBeEnabled();
    console.log('TC_AGPFP_007 — Expediente F3006 completo y "Continuar" habilitado (sin confirmar envío)');
  });

});
