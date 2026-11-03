// tests/regression/TC_AGENTE_002_perfiles.spec.js
// Tests de regresión del Portal Agente — validación de perfiles y permisos
// Perfil AgentePFP vs Consultor en QA_AV
// (migrado de DEV20 el 2026-08-19 — DEV20 ya no se prueba más, ver memoria pfp-roadmap-fases)

const { test, expect } = require('@playwright/test');
const { LoginAgentePage } = require('../../../pages/LoginAgentePage');
const { AMBIENTES_AGENTE, AGENTE, SIGN_AGENTE } = require('../../../fixtures/test-data');

const URL_AGENTE_QA_AV = AMBIENTES_AGENTE.QA_AV;

test.describe('Regresión — Portal Agente QA_AV — Perfiles y Permisos', () => {

  // ─── Helper genérico de login ──────────────────────────────────────────────
  async function loginConPerfil(page, perfil) {
    const loginPage = new LoginAgentePage(page);
    await loginPage.login(URL_AGENTE_QA_AV, AGENTE.usuario, perfil, SIGN_AGENTE);
    const portalPage = loginPage.obtenerPagina();
    await portalPage.waitForLoadState('networkidle');
    return { portalPage, loginPage };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFIL: AgentePFP
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Perfil AgentePFP', () => {

    test('TC_AGPFP_001 — Login exitoso con AgentePFP', async ({ page }) => {
      const { portalPage, loginPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      const exitoso = await loginPage.verificarLoginExitoso();
      await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_001_login.png', fullPage: true });

      expect(exitoso).toBe(true);
      console.log(`✅ Login AgentePFP OK — URL: ${loginPage.obtenerUrl()}`);
    });

    test('TC_AGPFP_002 — AgentePFP ve menú completo: Consultas, Operaciones, Reportes', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      await expect(portalPage.getByRole('link',   { name: 'Inicio' })).toBeVisible();
      await expect(portalPage.getByRole('button', { name: 'Consultas' })).toBeVisible();
      await expect(portalPage.getByRole('button', { name: 'Operaciones' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Reportes' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Cerrar Sesión' })).toBeVisible();

      await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_002_menu.png', fullPage: true });
      console.log('✅ Menú completo AgentePFP verificado');
    });

    test('TC_AGPFP_003 — AgentePFP accede a Consultas → Contribuyentes → Consultar PF', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      await portalPage.getByRole('button', { name: 'Consultas' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Contribuyentes' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Consultar PF' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_003_consultar_pf.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Consultar PF accesible — URL: ${url}`);
    });

    test('TC_AGPFP_004 — AgentePFP accede a Operaciones → Riesgo Fiscal', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Riesgo Fiscal' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_004_riesgo_fiscal.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Riesgo Fiscal accesible — URL: ${url}`);
    });

    test('TC_AGPFP_005 — AgentePFP accede a Reportes', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      await portalPage.getByRole('link', { name: 'Reportes' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_005_reportes.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Reportes accesible — URL: ${url}`);
    });

    test('TC_AGPFP_006 — AgentePFP NO ve Agenda de Venc. en su menú', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      // Agenda de Venc. no debe estar disponible para AgentePFP
      const agendaVisible = await portalPage
        .getByRole('link', { name: 'Agenda de Venc.' })
        .isVisible()
        .catch(() => false);

      await portalPage.screenshot({ path: 'screenshots/TC_AGPFP_006_sin_agenda.png', fullPage: true });

      expect(agendaVisible, 'AgentePFP NO debe ver Agenda de Venc.').toBe(false);
      console.log('✅ Agenda de Venc. correctamente oculta para AgentePFP');
    });

  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFIL: Consultor
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Perfil Consultor', () => {

    test('TC_AGCONSUL_001 — Login exitoso con perfil Consultor', async ({ page }) => {
      const { portalPage, loginPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      const exitoso = await loginPage.verificarLoginExitoso();
      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_001_login.png', fullPage: true });

      expect(exitoso).toBe(true);
      console.log(`✅ Login Consultor OK — URL: ${loginPage.obtenerUrl()}`);
    });

    test('TC_AGCONSUL_002 — Consultor ve menú reducido: Consultas, Reportes, Agenda', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      // Módulos que SÍ debe ver
      await expect(portalPage.getByRole('button', { name: 'Consultas' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Reportes' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Agenda de Venc.' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Cerrar Sesión' })).toBeVisible();

      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_002_menu.png', fullPage: true });
      console.log('✅ Menú Consultor verificado');
    });

    // 2026-10-14: confirmado por el usuario que es correcto que el Consultor
    // vea "Operaciones" (antes el test esperaba que no). Relevado en vivo: su
    // submenú tiene SOLO "Anular SAF" — ninguna de las operaciones de
    // AgentePFP (Riesgo Fiscal) ni de AgenteRec (Anular Operación, Deb/Cred
    // Especiales, Devolución SAF).
    test('TC_AGCONSUL_003 — Consultor ve Operaciones sólo con "Anular SAF"', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForTimeout(800);
      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_003_operaciones.png', fullPage: true });

      await expect(portalPage.getByRole('link', { name: 'Anular SAF' })).toBeVisible();
      for (const opcion of ['Riesgo Fiscal', 'Anular Operación', 'Deb / Cred Especiales', 'Devolucion SAF']) {
        await expect(portalPage.getByRole('link', { name: opcion }), `Consultor NO debe ver "${opcion}"`).toHaveCount(0);
      }
      console.log('✅ Operaciones del Consultor: sólo "Anular SAF"');
    });

    test('TC_AGCONSUL_004 — Consultor accede a Consultas → Contribuyentes → Consultar PF', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      await portalPage.getByRole('button', { name: 'Consultas' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Contribuyentes' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Consultar PF' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_004_consultar_pf.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Consultar PF accesible para Consultor — URL: ${url}`);
    });

    test('TC_AGCONSUL_005 — Consultor accede a Reportes', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      await portalPage.getByRole('link', { name: 'Reportes' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_005_reportes.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Reportes accesible para Consultor — URL: ${url}`);
    });

    test('TC_AGCONSUL_006 — Consultor accede a Agenda de Venc.', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      await portalPage.getByRole('link', { name: 'Agenda de Venc.' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_006_agenda.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Agenda de Venc. accesible para Consultor — URL: ${url}`);
    });

    test('TC_AGCONSUL_007 — Logout correcto desde perfil Consultor', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.Consultor);

      await portalPage.getByRole('link', { name: 'Cerrar Sesión' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGCONSUL_007_logout.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('/inicio');
      console.log(`✅ Logout Consultor OK — URL: ${url}`);
    });

  });

// ═══════════════════════════════════════════════════════════════════════════
  // PERFIL: AgenteRec (Agente de Recaudación)
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Perfil AgenteRec', () => {

    test('TC_AGREC_001 — Login exitoso con perfil AgenteRec', async ({ page }) => {
      const { portalPage, loginPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      const exitoso = await loginPage.verificarLoginExitoso();
      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_001_login.png', fullPage: true });

      expect(exitoso).toBe(true);
      console.log(`✅ Login AgenteRec OK — URL: ${loginPage.obtenerUrl()}`);
    });

    test('TC_AGREC_002 — AgenteRec ve menú completo con Operaciones extendido', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      // Módulos que SÍ debe ver
      await expect(portalPage.getByRole('button', { name: 'Consultas' })).toBeVisible();
      await expect(portalPage.getByRole('button', { name: 'Operaciones' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Reportes' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Agenda de Venc.' })).toBeVisible();
      await expect(portalPage.getByRole('link',   { name: 'Cerrar Sesión' })).toBeVisible();

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_002_menu.png', fullPage: true });
      console.log('✅ Menú AgenteRec verificado');
    });

    test('TC_AGREC_003 — AgenteRec accede a Consultas → Consultar PF', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('button', { name: 'Consultas' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Contribuyentes' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Consultar PF' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_003_consultar_pf.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Consultar PF OK para AgenteRec — URL: ${url}`);
    });

    test('TC_AGREC_004 — AgenteRec accede a Operaciones → Anular Operación', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Anular Operación' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_004_anular_operacion.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Anular Operación accesible — URL: ${url}`);
    });

    test('TC_AGREC_005 — AgenteRec accede a Operaciones → Deb/Cred Especiales', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Deb / Cred Especiales' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_005_deb_cred.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Deb/Cred Especiales accesible — URL: ${url}`);
    });

    test('TC_AGREC_006 — AgenteRec accede a Operaciones → Devolución SAF', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Devolucion SAF' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_006_devolucion_saf.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Devolución SAF accesible para AgenteRec — URL: ${url}`);
    });

    test('TC_AGREC_007 — AgenteRec accede a Operaciones → Riesgo Fiscal', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForLoadState('networkidle');
      await portalPage.getByRole('link', { name: 'Riesgo Fiscal' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_007_riesgo_fiscal.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Riesgo Fiscal accesible para AgenteRec — URL: ${url}`);
    });

    test('TC_AGREC_008 — AgenteRec accede a Reportes', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('link', { name: 'Reportes' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_008_reportes.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Reportes accesible para AgenteRec — URL: ${url}`);
    });

    test('TC_AGREC_009 — AgenteRec accede a Agenda de Venc.', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('link', { name: 'Agenda de Venc.' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_009_agenda.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('error');
      console.log(`✅ Agenda de Venc. accesible para AgenteRec — URL: ${url}`);
    });

    // ── Casos negativos: AgenteRec NO debe ver lo que solo ve AgentePFP ────────
    test('TC_AGREC_010 — AgenteRec NO tiene Anular Operación disponible para AgentePFP', async ({ page }) => {
      // Verificamos que AgentePFP NO tiene Anular Operación (caso negativo cruzado)
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgentePFP);

      await portalPage.getByRole('button', { name: 'Operaciones' }).click();
      await portalPage.waitForLoadState('networkidle');

      const anularVisible = await portalPage
        .getByRole('link', { name: 'Anular Operación' })
        .isVisible()
        .catch(() => false);

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_010_agentepfp_sin_anular.png', fullPage: true });

      expect(anularVisible, 'AgentePFP NO debe ver Anular Operación').toBe(false);
      console.log('✅ Anular Operación correctamente oculto para AgentePFP');
    });

    test('TC_AGREC_011 — Logout correcto desde perfil AgenteRec', async ({ page }) => {
      const { portalPage } = await loginConPerfil(page, AGENTE.perfiles.AgenteRec);

      await portalPage.getByRole('link', { name: 'Cerrar Sesión' }).click();
      await portalPage.waitForLoadState('networkidle');

      await portalPage.screenshot({ path: 'screenshots/TC_AGREC_011_logout.png', fullPage: true });

      const url = portalPage.url();
      expect(url).not.toContain('/inicio');
      console.log(`✅ Logout AgenteRec OK — URL: ${url}`);
    });

  });

});