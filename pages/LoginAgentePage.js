// pages/LoginAgentePage.js
// Page Object para el login del Portal Agente de AGIP

class LoginAgentePage {

  constructor(page) {
    this.page     = page;
    this.portalPage = null;
  }

  // Genera el token del agente en base64 igual que el HTML de login
  generarTokenAgente(usuario, perfil) {
    const data = `{\r\n"per_legajo":"12345678",\r\n"per_login":"${usuario}",\r\n"per_apenom":"${usuario}",\r\n  "per_tofi_codigo": "0500021200000000",\r\n  "per_tofi_descripcion": "SUBDIRECCION GENERAL SISTEMATIZACION DE LA RECAUDACION",\r\n"aplicaciones": [\r\n{\r\n"per_nivel":"1",\r\n"apl_nivel": "1",\r\n"apl_cod": "webagentecct",\r\n      "apl_icon": "Ac",\r\n      "apl_estilos": "violeta",\r\n      "apl_detalle": null,\r\n      "apl_id": "110",\r\n"apl_descripcion": null,\r\n"apl_perfil":"${perfil}"}\r\n]\r\n}`;
    return Buffer.from(data).toString('base64');
  }

  // Login al Portal Agente — abre nueva pestaña igual que el CCT
  async login(urlAmbiente, usuario, perfil, sign) {
    const token = this.generarTokenAgente(usuario, perfil);

    await this.page.goto(urlAmbiente, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const [nuevaPagina] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.page.evaluate(
        ({ url, token, sign, agente }) => {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = url;
          form.target = '_blank';
          const campos = { token, sign, agente };
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
        { url: urlAmbiente, token, sign, agente: usuario }
      ),
    ]);

    // Traemos la pestaña nueva al frente — el form.submit() con target="_blank"
    // la abre en segundo plano y Playwright no la enfoca solo. Si el portal usa
    // la Page Visibility API para medir inactividad, una pestaña que nunca gana
    // foco real puede reportarse "oculta" todo el tiempo y disparar el logout
    // por inactividad mucho antes de lo esperado — algo que no pasa en una
    // sesión manual porque el usuario sí clickea/enfoca la pestaña nueva.
    await nuevaPagina.bringToFront();

    await nuevaPagina.waitForLoadState('domcontentloaded', { timeout: 60000 });

    // Esperamos que desaparezca el "Validando Usuario" si aparece
    await nuevaPagina.waitForSelector('text=Validando Usuario', {
      state: 'hidden',
      timeout: 30000,
    }).catch(() => {});

    await nuevaPagina.waitForLoadState('networkidle', { timeout: 60000 });
    this.portalPage = nuevaPagina;
  }

  async verificarLoginExitoso() {
    const url = this.portalPage ? this.portalPage.url() : '';
    console.log(`URL Portal Agente: ${url}`);
    return !url.includes('/login') && !url.includes('error');
  }

  obtenerPagina() {
    return this.portalPage || this.page;
  }

  obtenerUrl() {
    return this.portalPage ? this.portalPage.url() : '';
  }
}

module.exports = { LoginAgentePage };