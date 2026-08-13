// tests/regression/TC_AGENTE_003_reversas.spec.js
// Regresión — Portal Agente (perfil AgentePFP): Reversa de Caducidad (F3006) y
// Reversa de Nulidad (F3013). Fase 1 de la matriz de cobertura de formularios PFP.
//
// Ambiente: QA_HOMO (AMBIENTES_AGENTE.QA_HOMO) — DEV20 ya no es el ambiente de
// regresión real, solo se usa para los smoke tests de migración NodeJS 20
// (tests/smoke/TC_MIGRACION_NodeJS20.spec.js).
//
// Ambas reversas comparten el mismo componente de "Expediente" (3 pasos:
// Expediente → Confirmación → Resultado) con 5 campos: Tipo Actuación
// (dropdown, botón — no label), Año (4 dígitos), Número (8 dígitos), Ente
// (5 caracteres), Repartición (2 a 9 caracteres).
//
// Ambos flujos se grabaron con Codegen por el usuario contra QA_HOMO real el
// 2026-08-12 (la automatización vía Bash no abre ventana visible en su
// escritorio — login manual + grabación de su lado). De ahí salieron los
// nombres reales de botón, irregulares entre sí:
//   - F3013: "Reversa de nulidad" (minúscula)
//   - F3006: "Reversa caducidad" (sin "de")
// y el resto del formulario, común a ambos: "Tipo Actuación" es un
// getByRole('button') (no label), la opción del dropdown es "EXPEDIENTES" en
// mayúsculas, y cada campo de texto lleva un Tab después del fill (parece
// necesario para que la validación habilite "Continuar").
//
// El flujo F3013 se corrió hasta confirmar de verdad una vez (ver memoria
// pfp-roadmap-fases) — quedó probado que funciona end-to-end. Estos dos tests
// quedan parados en "Continuar habilitado" y NO confirman, para que sean
// repetibles sin consumir un plan CADUCO/NULO nuevo en cada corrida.
const { test, expect } = require('@playwright/test');
const { LoginAgentePage } = require('../../pages/LoginAgentePage');
const { AMBIENTES_AGENTE, AGENTE, SIGN_AGENTE, PLANES_CONOCIDOS, EXPEDIENTE_REVERSA } = require('../../fixtures/test-data');

const URL_AGENTE_QA = AMBIENTES_AGENTE.QA_HOMO;

test.describe('Regresión — Portal Agente: Reversas de plan (AgentePFP)', () => {

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

  // Completa los 5 campos del expediente con EXPEDIENTE_REVERSA — confirmado
  // real contra QA_HOMO (F3013 y F3006, 2026-08-12). El Tab después de cada
  // campo replica exacto lo grabado con Codegen.
  //
  // "Tipo Actuación" es una lista larga y alfabética con scroll virtualizado
  // (confirmado visualmente: al abrirla solo se renderizan los primeros ítems
  // — ACORDADA, ACTA, ACTO ADMINISTRATIVO... — "EXPEDIENTES" no existe en el
  // DOM hasta hacer scroll de verdad). getByText().scrollIntoViewIfNeeded() no
  // alcanza porque el nodo todavía no está renderizado; hace falta simular
  // rueda de mouse dentro del menú para que la lista lo vaya montando.
  async function completarExpediente(portalPage) {
    const btnTipoActuacion = portalPage.getByRole('button', { name: 'Tipo Actuación' });
    await btnTipoActuacion.click();
    await portalPage.waitForTimeout(500);

    const opcion = portalPage.getByText(EXPEDIENTE_REVERSA.tipoActuacion, { exact: true });

    // Posicionamos el mouse dentro del menú desplegable (debajo del botón que
    // lo abre) para que mouse.wheel scrollee la lista y no la página de fondo.
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

    // pressSequentially en vez de fill() — simula tecla por tecla. fill() pega
    // el valor de una sola vez y algunos campos de este form (validados por
    // Vue vía eventos de teclado reales) no llegan a marcarse como válidos con
    // eso, aunque el valor visible sea correcto — "Continuar" queda
    // deshabilitado igual. Confirmado comparando contra el llenado manual del
    // usuario con los mismos datos.
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

  test('TC_AGPFP_007 — Reversa de Caducidad (F3006): expediente completo, "Continuar" habilitado', async ({ page }) => {
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

  test('TC_AGPFP_008 — Reversa de Nulidad (F3013): expediente completo, "Continuar" habilitado', async ({ page }) => {
    test.skip(!PLANES_CONOCIDOS.nulo, 'Requiere PLANES_CONOCIDOS.nulo en fixtures/test-data.js — ver memoria pfp-roadmap-fases');

    const { portalPage } = await loginYBuscarPlan(page, PLANES_CONOCIDOS.nulo);
    await expect(portalPage.getByText('Nulo')).toBeVisible();
    await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_008_plan_nulo.png', fullPage: true });

    await portalPage.getByRole('button', { name: 'Reversa de nulidad' }).click();
    await portalPage.waitForLoadState('networkidle');

    await expect(portalPage.getByText('Ingresá el expediente que avala la reversa de nulidad')).toBeVisible();
    await verificarPasoExpediente(portalPage);

    await completarExpediente(portalPage);
    const btnContinuar008 = portalPage.getByRole('button', { name: 'Continuar' });
    await btnContinuar008.scrollIntoViewIfNeeded();
    await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_008_form_expediente.png', fullPage: true });
    await expect(btnContinuar008).toBeEnabled();
    console.log('TC_AGPFP_008 — Expediente F3013 completo y "Continuar" habilitado (sin confirmar envío)');
  });

});
