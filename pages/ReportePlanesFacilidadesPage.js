// pages/ReportePlanesFacilidadesPage.js
// Portal Agente → Reportes → "Planes de Facilidades" (historia AG-791).
// Selectores relevados en vivo contra QA_AV el 2026-10-15: los filtros son
// v-select de Vuetify (role=button con el nombre del campo) y la consulta va
// a POST api-agente/api/Reportes/ReportePlanFacilidades (13–21 s en QA).
const { LoginAgentePage } = require('./LoginAgentePage');
const { AMBIENTES_AGENTE, AGENTE, SIGN_AGENTE } = require('../fixtures/test-data');

const TIMEOUT_CONSULTA = 120000;

class ReportePlanesFacilidadesPage {
  constructor(page) {
    this.page = page;
    this.portal = null;
  }

  async abrir(perfil = AGENTE.perfiles.AgentePFP) {
    const login = new LoginAgentePage(this.page);
    await login.login(AMBIENTES_AGENTE.QA_AV, AGENTE.usuario, perfil, SIGN_AGENTE);
    this.portal = login.obtenerPagina();
    await this.portal.waitForLoadState('networkidle');
    await this.portal.getByRole('link', { name: 'Reportes' }).click();
    await this.portal.waitForLoadState('networkidle');
    await this.elegir('Reporte', 'Planes de Facilidades');
    return this;
  }

  campo(nombre) {
    return this.portal.getByRole('button', { name: new RegExp(nombre) }).first();
  }

  get consultar() { return this.portal.getByRole('button', { name: 'Consultar' }); }
  get descargar() { return this.portal.getByRole('button', { name: /Descargar/ }); }
  get filas() { return this.portal.locator('table tbody tr'); }

  /** Todas las opciones de un filtro (scrolleando el menú, puede estar virtualizado). */
  async opciones(nombre) {
    await this.campo(nombre).click();
    const menu = this.portal.locator('.menuable__content__active');
    await menu.waitFor({ state: 'visible' });
    // Las opciones llegan del backend: recién abierta la pantalla el menú puede estar vacío
    await menu.getByRole('option').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const vistas = [];
    for (let i = 0; i < 20; i++) {
      for (const t of await menu.getByRole('option').allInnerTexts()) if (!vistas.includes(t.trim())) vistas.push(t.trim());
      const avanzo = await menu.evaluate(el => { const a = el.scrollTop; el.scrollTop += el.clientHeight; return el.scrollTop > a; });
      if (!avanzo) break;
      await this.portal.waitForTimeout(200);
    }
    await this.portal.keyboard.press('Escape');
    await this.portal.waitForTimeout(300);
    return vistas;
  }

  async elegir(nombre, opcion) {
    await this.campo(nombre).click();
    const menu = this.portal.locator('.menuable__content__active');
    await menu.waitFor({ state: 'visible' });
    const item = menu.getByRole('option', { name: opcion, exact: true });
    for (let i = 0; i < 20 && !(await item.isVisible().catch(() => false)); i++) {
      await menu.evaluate(el => { el.scrollTop += el.clientHeight; });
      await this.portal.waitForTimeout(200);
    }
    await item.click();
    await this.portal.waitForLoadState('networkidle');
    await this.portal.waitForTimeout(500);
  }

  get mensajeError() { return this.portal.getByText(/no podemos efectuar esta consulta|No fue posible generar el reporte/i); }

  /**
   * Completa los filtros (estado/impuesto opcionales) y consulta. Espera la
   * grilla, el mensaje de "sin resultados" o el banner de error, y devuelve
   * { segundos, status, respuesta } de la llamada al backend.
   */
  async consultarCon({ instrumento, anio, estado, impuesto }) {
    await this.elegir('Instrumento Legal', instrumento);
    await this.elegir('Año', String(anio));
    if (estado) await this.elegir('Estado', estado);
    if (impuesto) await this.elegir('Impuesto', impuesto);
    const inicio = Date.now();
    const [respuesta] = await Promise.all([
      this.portal.waitForResponse(r => r.url().includes('/api/Reportes/ReportePlanFacilidades') && !r.url().includes('Descarga'), { timeout: TIMEOUT_CONSULTA }),
      this.consultar.click(),
    ]);
    await Promise.race([
      this.filas.first().waitFor({ state: 'visible', timeout: 15000 }),
      this.portal.getByText('No encontramos registros para esta consulta').waitFor({ timeout: 15000 }),
      this.mensajeError.waitFor({ timeout: 15000 }),
    ]).catch(() => {});
    await this.portal.waitForTimeout(500);
    let cuerpo; try { cuerpo = await respuesta.json(); } catch { cuerpo = await respuesta.text().catch(() => ''); }
    return { segundos: (Date.now() - inicio) / 1000, status: respuesta.status(), respuesta: cuerpo };
  }

  async encabezados() {
    return (await this.portal.locator('table thead th').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim());
  }

  /** Filas visibles como arrays de celdas. */
  async leerGrilla() {
    const filas = [];
    for (let i = 0; i < await this.filas.count(); i++) {
      filas.push((await this.filas.nth(i).locator('td').allInnerTexts()).map(s => s.trim()));
    }
    return filas;
  }

  /** Texto "N de M" del paginador → { actual, total }. */
  async paginaActual() {
    const texto = await this.portal.locator('body').innerText();
    const m = texto.match(/(\d+)\s*de\s*(\d+)\s*(?:\n|$|Ir a Inicio)/) || texto.match(/(\d+)\s+de\s+(\d+)/);
    return m ? { actual: Number(m[1]), total: Number(m[2]) } : null;
  }

  /** Botones del paginador por orden: primera, anterior, siguiente, última. */
  botonesPaginador() {
    return this.portal.locator('.v-pagination button, nav button, [class*=pagin] button');
  }
}

module.exports = { ReportePlanesFacilidadesPage, TIMEOUT_CONSULTA };
