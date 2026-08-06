// pages/LoginPage.js
const { CUIT_AUTENTICADO } = require('../fixtures/test-data');

class LoginPage {

  constructor(page) {
    this.page     = page;
    this.portalPage = null; // acá guardamos la nueva pestaña del portal
  }

  generarToken(cuitRepresentado) {
    const expTime = Math.floor(Date.now() / 1000) + 3600;
    const data = `<?xml version="1.0" encoding="iso-8859-1"?><datos><servicio nombre="agip_scct_cicd" exp_time="${expTime}" /><autenticado cuit="${CUIT_AUTENTICADO}" nombre="Usuario Prueba" isib="${CUIT_AUTENTICADO}" cat="40" codcalle="2207" calle="BOLIVAR" puerta="4310" piso="" dpto="" codpostal="B1874CKB" codlocalidad="101" localidad="VILLA DOMINICO" codprov="1" provincia="BUENOS AIRES" telefono="43238600" email="desarrolloweb@agip.gob.ar" nivel="2" tipoDocumento="3003" documento="42090147"><\/autenticado><representados><representado cuit="${cuitRepresentado}" nombre="EMPRESA PRUEBA" isib="" cat="" codcalle="42570" calle="AVDA DEL LIBERTADOR" puerta="6363" piso="" dpto="" codpostal="C1428CKB" codlocalidad="1200" localidad="CIUDAD AUTONOMA DE BS AS" codprov="2" provincia="CAPITAL FEDERAL" telefono="" email="" tipoRepresentacion="1" tipoDocumento="" documento="" elegido="true"><\/representado><\/representados><\/datos>`;
    return Buffer.from(data).toString('base64');
  }

  async login(urlAmbiente, cuit, sign) {
    const token = this.generarToken(cuit);

    // Paso 1: navegamos a la URL del ambiente
    await this.page.goto(urlAmbiente, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Paso 2: enviamos el POST y esperamos que abra la nueva pestaña
    const [nuevaPagina] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.page.evaluate(
        ({ url, token, sign, cuit }) => {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = url;
          form.target = '_blank';
          const campos = { token, sign, representado: cuit };
          for (const [nombre, valor] of Object.entries(campos)) {
            const input = document.createElement('input');
            input.type  = 'hidden';
            input.name  = nombre;
            input.value = valor;
            form.appendChild(input);
          }
          document.body.appendChild(form);
          form.submit();
        },
        { url: urlAmbiente, token, sign, cuit }
      ),
    ]);

    // Paso 3: esperamos que la nueva pestaña termine de cargar
    await nuevaPagina.waitForLoadState('domcontentloaded', { timeout: 60000 });

    // Paso 4: esperamos que desaparezca el cartel "Validando Usuario"
    await nuevaPagina.waitForSelector('text=Validando Usuario', {
      state: 'hidden',
      timeout: 30000,
    }).catch(() => {});

    // Paso 5: esperamos que aparezca el menú del portal (confirma login exitoso)
    await nuevaPagina.waitForSelector('text=Operaciones', {
      timeout: 30000,
    }).catch(() => {});

    // Paso 6: guardamos la nueva pestaña para usarla en los tests
    this.portalPage = nuevaPagina;
  }

  async verificarLoginExitoso() {
    const url = this.portalPage ? this.portalPage.url() : this.page.url();
    console.log(`URL actual: ${url}`);
    return url.includes('/inicio');
  }

  obtenerUrl() {
    return this.portalPage ? this.portalPage.url() : this.page.url();
  }

  // Devuelve la pestaña del portal — usala en PFPPage
  obtenerPagina() {
    return this.portalPage || this.page;
  }
}

module.exports = { LoginPage };