// pages/PFPPage.js
// Selectores basados en la estructura REAL del portal CCT de AGIP

class PFPPage {

  constructor(page) {
    this.page = page;
  }

  actualizarPagina(page) {
    this.page = page;
  }

  // Navega a Operaciones > Planes / Moratoria
    async irAPlanesYMoratoria() {
    await this.page.waitForLoadState('networkidle');

    // Click en "Operaciones" para abrir el submenú
    await this.page.getByText('Operaciones').first().click();
    await this.page.waitForLoadState('networkidle');

    // Click en "Planes / Moratoria" en el submenú
    await this.page.getByText('Planes / Moratoria').first().click();

    // Esperamos que cargue la página — usamos el stepper como indicador
    // ya que el título exacto puede variar entre versiones del portal
    await this.page.waitForSelector('text=Seleccionar Deuda', {
      timeout: 15000,
    }).catch(async () => {
      // Si no aparece el stepper, esperamos networkidle como fallback
      await this.page.waitForLoadState('networkidle');
    });
  }

  // Verifica que la pantalla de Planes/Moratoria cargó correctamente
  async verificarPantallaPlanes() {
    // Verificamos que el stepper de 5 pasos está visible
    const titulo = await this.page.getByText('Operaciones / Planes - Moratoria').isVisible();
    const stepper = await this.page.getByText('Seleccionar Deuda').isVisible();
    const dropdownTipoPlan = await this.page.getByText('Tipo de plan').isVisible();
    return titulo && stepper && dropdownTipoPlan;
  }

  // Selecciona el tipo de plan en el primer dropdown
  // getByRole('button', ...) en vez de getByText — el label "Tipo de plan"
  // colisiona con otro texto de la pantalla en QA_AV ("Tipo de Plan" en un
  // comprobante), rompiendo el modo estricto de Playwright. Descubierto
  // 2026-08-19 al migrar de QA_HOMO (donde nunca se llegaba a esta pantalla
  // por el outage) — ver memoria pfp-roadmap-fases.
  async seleccionarTipoPlan(tipoPlan) {
    await this.page.getByRole('button', { name: 'Tipo de plan' }).click();
    await this.page.waitForTimeout(500);
    await this.page.getByText(tipoPlan).first().click();
    await this.page.waitForLoadState('networkidle');
  }

  // Selecciona la operación en el segundo dropdown
  async seleccionarOperacion(operacion) {
    await this.page.getByRole('button', { name: 'Operación' }).click();
    await this.page.waitForTimeout(500);
    await this.page.getByText(operacion).first().click();
    await this.page.waitForLoadState('networkidle');
  }

  // Selecciona el impuesto en el tercer dropdown
  async seleccionarImpuesto(impuesto) {
    await this.page.getByRole('button', { name: 'Impuesto' }).click();
    await this.page.waitForTimeout(500);
    await this.page.getByText(impuesto).first().click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Consulta deuda con fallback de impuesto: si el impuesto preferido no trae
   * deuda cargada, reintenta con los de `impuestosFallback` en orden (default
   * ["Sellos"], que en QA suele tener deuda cargada casi siempre). Evita que
   * el acogimiento falle simplemente porque el CUIT/ambiente de turno no tiene
   * deuda en el impuesto puntual que se le pidió.
   * ⚠ Confirmado en vivo 2026-08-20 (QA_AV) que la consulta puede tardar más
   * de lo que tarda networkidle en resolver — la pantalla queda mostrando
   * "Procesando..." bastante después. El primer intento con solo 5s de
   * espera post-Consultar daba falso negativo ("sin deuda") cuando en
   * realidad la consulta seguía en curso. Por eso se espera explícitamente a
   * que "Procesando..." desaparezca antes de chequear el resultado.
   * @returns {Promise<string>} el impuesto que sí encontró deuda
   */
  async consultarDeudaConFallback({ tipoPlan, operacion, impuestoPreferido, impuestosFallback = ['Sellos'] }) {
    const intentos = [impuestoPreferido, ...impuestosFallback];

    for (let i = 0; i < intentos.length; i++) {
      const impuesto = intentos[i];
      if (i > 0) {
        // Volvemos a la pantalla de selección para reintentar con otro impuesto
        await this.irAPlanesYMoratoria();
      }
      await this.seleccionarTipoPlan(tipoPlan);
      await this.seleccionarOperacion(operacion);
      await this.seleccionarImpuesto(impuesto);
      await this.page.getByRole('button', { name: 'Consultar' }).click();
      await this.page.waitForLoadState('networkidle');
      await this.page.getByText('Procesando...', { exact: false })
        .waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

      const hayDeuda = await this.page.getByText('Períodos a incluir en el plan')
        .isVisible({ timeout: 20000 }).catch(() => false);

      if (hayDeuda) {
        console.log(`consultarDeudaConFallback — deuda encontrada con impuesto "${impuesto}"`);
        return impuesto;
      }
      console.log(`consultarDeudaConFallback — sin deuda para "${impuesto}"${i < intentos.length - 1 ? ', probando siguiente...' : ''}`);
    }

    throw new Error(`consultarDeudaConFallback — no se encontró deuda para ningún impuesto probado: ${intentos.join(', ')}`);
  }

  // Hace click en Continuar
  async clickContinuar() {
    await this.page.getByRole('button', { name: 'Continuar' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  // Verifica en qué paso del stepper estamos (1 al 5)
  async verificarPasoActual(numeroPaso) {
    const pasos = [
      'Seleccionar Deuda',
      'Simulación de Cuotas',
      'Ingreso de CBU',
      'Confirmación',
      'Resultado',
    ];
    const textoPaso = pasos[numeroPaso - 1];
    return await this.page.getByText(textoPaso).isVisible();
  }

  // Navega a Operaciones (menú general)
  async irAOperacionesPlanes() {
    await this.page.waitForLoadState('networkidle');
    await this.page.getByText('Operaciones').first().click();
    await this.page.waitForLoadState('networkidle');
    await this.page.screenshot({
      path: 'screenshots/operaciones_submenu.png',
      fullPage: true,
    });
  }

  // Alias para mantener compatibilidad con los smoke tests
  async irAPlanFacilidadesPago() {
    await this.irAPlanesYMoratoria();
  }

  async capturarEvidencia(nombreArchivo) {
    await this.page.screenshot({
      path: `screenshots/${nombreArchivo}.png`,
      fullPage: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fase 1 — Operaciones sobre un plan ya existente (F3005/F3006/F3007/F3013)
  // Navegación y selectores confirmados en vivo contra QA_HOMO (2026-08-12)
  // usando el plan real 1783000149 (ver fixtures/test-data.js → PLANES_CONOCIDOS).
  // ═══════════════════════════════════════════════════════════════════════════

  // Navega a Cuenta Corriente > Planes de Facilidades — pantalla de búsqueda de
  // planes existentes (distinta de "Operaciones > Planes/Moratoria", que es el
  // wizard de alta de un plan nuevo).
  async irAPlanesDeFacilidades() {
    await this.page.waitForLoadState('networkidle');
    await this.page.getByText('Cuenta Corriente').first().click();
    await this.page.waitForLoadState('networkidle');
    await this.page.getByText('Planes de Facilidades', { exact: false }).first().click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
  }

  // Busca un plan puntual por Nro. de solicitud, y entra a su pantalla de detalle
  // (la lista solo muestra los datos generales; los botones de acción — Cambiar
  // CBU / Cancelación Anticipada — están en el detalle, al hacer click en el
  // Nº de solicitud de la fila).
  async buscarPlanPorNroSolicitud(nroSolicitud) {
    await this.page.getByRole('textbox', { name: 'Nro. de solicitud' }).fill(String(nroSolicitud));
    await this.page.getByRole('button', { name: 'Consultar' }).click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
    await this.page.getByText(String(nroSolicitud), { exact: false }).first().click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
  }

  // F3007 — Abre el modal "Cambiar CBU" sobre el plan encontrado.
  async abrirCambioCBU() {
    await this.page.getByRole('button', { name: 'Cambiar CBU' }).click();
    await this.page.waitForTimeout(800);
  }

  // F3005 — Inicia el flujo de Cancelación Anticipada sobre el plan encontrado.
  // Precondición real confirmada: la 1° cuota del plan debe estar PAGADA, si no
  // el wizard ("Operaciones / Pagar") bloquea en el paso 1 con un mensaje de error.
  async iniciarCancelacionAnticipada() {
    await this.page.getByRole('button', { name: 'Cancelación Anticipada' }).click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = { PFPPage };