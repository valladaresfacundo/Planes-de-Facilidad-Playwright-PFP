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
  async seleccionarTipoPlan(tipoPlan) {
    await this.page.getByText('Tipo de plan').click();
    await this.page.waitForTimeout(500);
    await this.page.getByText(tipoPlan).click();
    await this.page.waitForLoadState('networkidle');
  }

  // Selecciona la operación en el segundo dropdown
  async seleccionarOperacion(operacion) {
    await this.page.getByText('Operación').click();
    await this.page.waitForTimeout(500);
    await this.page.getByText(operacion).click();
    await this.page.waitForLoadState('networkidle');
  }

  // Selecciona el impuesto en el tercer dropdown
  async seleccionarImpuesto(impuesto) {
    await this.page.getByText('Impuesto').click();
    await this.page.waitForTimeout(500);
    await this.page.getByText(impuesto).click();
    await this.page.waitForLoadState('networkidle');
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
}

module.exports = { PFPPage };