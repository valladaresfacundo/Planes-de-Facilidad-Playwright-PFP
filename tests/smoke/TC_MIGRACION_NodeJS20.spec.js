// tests/smoke/TC_MIGRACION_NodeJS20.spec.js
// Focos de riesgo específicos de la migración NodeJS 16 → 20.3+
// Se corre contra DEV20: portal-cct20-dev.apps.ocp-test-hc.agip.gob.ar

const { test, expect } = require('@playwright/test');
const { LoginPage }    = require('../../pages/LoginPage');
const { AMBIENTES, CONTRIBUYENTES, SIGN_CCT } = require('../../fixtures/test-data');

const URL_BASE_DEV20 = 'http://portal-cct20-dev.apps.ocp-test-hc.agip.gob.ar';
const URL_LOGIN_DEV20 = AMBIENTES.DEV20;

// ─── Helper: login en DEV20 y activa monitor de consola/red ──────────────────
async function loginDev20ConMonitor(page) {
  const errores   = [];
  const assets404 = [];

  // Activamos el monitor ANTES del login para capturar todo desde el inicio
  page.on('console', msg => {
    if (msg.type() === 'error') errores.push(msg.text());
  });

  const loginPage = new LoginPage(page);
  await loginPage.login(URL_LOGIN_DEV20, CONTRIBUYENTES.conPlan.cuit, SIGN_CCT);
  const portalPage = loginPage.obtenerPagina();

  portalPage.on('console', msg => {
    if (msg.type() === 'error') errores.push(msg.text());
  });
  portalPage.on('response', response => {
    if (response.status() === 404) {
      const url = response.url();
      if (url.match(/\.(js|css|woff2?|ttf|png|svg|ico)(\?|$)/)) {
        assets404.push(url);
      }
    }
  });

  await portalPage.waitForLoadState('networkidle', { timeout: 60000 });
  return { portalPage, errores, assets404, loginPage };
}

test.describe('Migración NodeJS 20 — DEV20 — Focos de Riesgo', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // FOCO 1: WHITE SCREEN OF DEATH
  // ═══════════════════════════════════════════════════════════════════════════

  test('TC_MIG_001 — Carga inicial DEV20 sin White Screen of Death', async ({ page }) => {
    const errores   = [];
    const assets404 = [];
    const jsRequests = [];

    page.on('console', msg => {
      if (msg.type() === 'error') errores.push(msg.text());
    });
    page.on('response', response => {
      const url    = response.url();
      const status = response.status();
      if (url.includes('portal-cct20-dev') && url.match(/\.js(\?|$)/)) {
        jsRequests.push({ url: url.split('/').pop(), status });
      }
      if (status === 404 && url.match(/\.(js|css|woff2?|png|svg|ico)(\?|$)/)) {
        assets404.push(url);
      }
    });

    const response = await page.goto(URL_BASE_DEV20, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    await page.screenshot({
      path: 'screenshots/TC_MIG_001_carga_inicial_dev20.png',
      fullPage: true,
    });

    // 1. El servidor responde
    expect(response, 'DEV20 debe responder').not.toBeNull();
    expect(response.status(), 'HTTP status debe ser < 400').toBeLessThan(400);

    // 2. El body no está vacío (White Screen = body sin contenido)
    const bodyText = await page.locator('body').textContent();
    expect(
      bodyText.trim().length,
      'FALLO: White Screen of Death detectado — body vacío'
    ).toBeGreaterThan(10);

    // 3. Ningún asset con 404
    if (assets404.length > 0) {
      console.error('❌ Assets con 404 en DEV20:', assets404);
    }
    expect(assets404, `Assets 404: ${assets404.join('\n')}`).toHaveLength(0);

    // 4. Sin errores críticos en consola
    const erroresCriticos = errores.filter(e =>
      e.includes('404') || e.includes('Failed to load') || e.includes('chunk')
    );
    expect(erroresCriticos, `Errores críticos: ${erroresCriticos.join('\n')}`).toHaveLength(0);

    console.log(`✅ TC_MIG_001 — DEV20 carga OK. JS cargados: ${jsRequests.length}, Assets 404: ${assets404.length}`);
    jsRequests.forEach(r => console.log(`   ${r.status} → ${r.url}`));
  });

  test('TC_MIG_002 — Archivos JS de DEV20 responden 200 (no 404)', async ({ page }) => {
    const jsRequests = [];

    page.on('response', response => {
      const url = response.url();
      if (url.includes('portal-cct20-dev') && url.match(/\.js(\?|$)/)) {
        jsRequests.push({ url: url.split('/').pop(), status: response.status() });
      }
    });

    await page.goto(URL_BASE_DEV20, { waitUntil: 'networkidle', timeout: 60000 });
    await page.screenshot({ path: 'screenshots/TC_MIG_002_js_dev20.png', fullPage: false });

    // Debe haber al menos 1 JS (Nuxt genera varios chunks)
    expect(jsRequests.length, 'Deben cargarse archivos JS de Nuxt en DEV20').toBeGreaterThan(0);

    // Ningún JS con 404
    const js404 = jsRequests.filter(r => r.status === 404);
    if (js404.length > 0) {
      console.error('❌ Archivos JS con 404 en DEV20:', js404.map(r => r.url));
    }
    expect(js404, `JS con 404: ${js404.map(r => r.url).join(', ')}`).toHaveLength(0);

    console.log(`✅ TC_MIG_002 — ${jsRequests.length} archivos JS cargados en DEV20, todos OK`);
    jsRequests.forEach(r => console.log(`   ${r.status} → ${r.url}`));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FOCO 2: LAZY LOADING / CHUNKS DE NUXT
  // ═══════════════════════════════════════════════════════════════════════════

  test('TC_MIG_003 — Lazy Loading: cada módulo del menú carga su chunk sin errores', async ({ page }) => {
    const { portalPage, errores, assets404 } = await loginDev20ConMonitor(page);

    const modulos = [
      { nombre: 'Cuenta Corriente', selector: 'text=Cuenta Corriente' },
      { nombre: 'Operaciones',      selector: 'text=Operaciones' },
      { nombre: 'DFE',              selector: 'text=DFE' },
      { nombre: 'Comprobantes',     selector: 'text=Comprobantes' },
      { nombre: 'Historial VEP',    selector: 'text=Historial VEP' },
      { nombre: 'Agenda de Venc.',  selector: 'text=Agenda de Venc.' },
    ];

    const erroresPorModulo = {};

    for (const modulo of modulos) {
      const erroresAntes   = errores.length;
      const assets404Antes = assets404.length;

      try {
        await portalPage.locator(modulo.selector).first().click();
        await portalPage.waitForLoadState('networkidle', { timeout: 30000 });
        await portalPage.waitForTimeout(1000);

        await portalPage.screenshot({
          path: `screenshots/TC_MIG_003_${modulo.nombre.replace(/\s|\./g, '_')}_dev20.png`,
          fullPage: true,
        });

        const nuevosErrores = errores.slice(erroresAntes);
        const nuevos404     = assets404.slice(assets404Antes);

        if (nuevosErrores.length > 0 || nuevos404.length > 0) {
          erroresPorModulo[modulo.nombre] = { errores: nuevosErrores, assets404: nuevos404 };
          console.error(`❌ "${modulo.nombre}" — Errores: ${nuevosErrores.length}, 404: ${nuevos404.length}`);
        } else {
          console.log(`✅ "${modulo.nombre}" — chunk OK`);
        }
      } catch (e) {
        erroresPorModulo[modulo.nombre] = { error: e.message };
        console.error(`❌ Error al navegar a "${modulo.nombre}": ${e.message}`);
      }
    }

    const modulosConError = Object.keys(erroresPorModulo);
    expect(
      modulosConError,
      `Módulos con error de lazy loading: ${JSON.stringify(erroresPorModulo, null, 2)}`
    ).toHaveLength(0);

    console.log(`✅ TC_MIG_003 — ${modulos.length} módulos navegados sin errores de chunks`);
  });

  test('TC_MIG_004 — Lazy Loading: submenú Operaciones carga todos sus chunks', async ({ page }) => {
    const { portalPage, errores } = await loginDev20ConMonitor(page);

    const submodulos = [
      'Planes / Moratoria',
      'Compensar Saldo',
      'Reimputar Pago',
      // 'Devolución SAF' — requiere CUIT con SAF habilitado, se testea por separado
    ];

    await portalPage.getByText('Operaciones').first().click();
    await portalPage.waitForLoadState('networkidle');

    const erroresPorSubmenu = {};

for (const submenu of submodulos) {
      const erroresAntes = errores.length;

      try {
        const visible = await portalPage.getByText(submenu).first().isVisible({ timeout: 3000 }).catch(() => false);
        if (!visible) {
          await portalPage.getByText('Operaciones').first().click();
          await portalPage.waitForTimeout(500);
        }

        // Si el submenú no existe en este ambiente, lo salteamos con advertencia
        const existeSubmenu = await portalPage.getByText(submenu).first().isVisible({ timeout: 3000 }).catch(() => false);
        if (!existeSubmenu) {
          console.warn(`⚠️ "${submenu}" no encontrado en DEV20 — puede no estar habilitado en este ambiente`);
          continue;
        }

        await portalPage.getByText(submenu).first().click();
        await portalPage.waitForLoadState('networkidle', { timeout: 30000 });
        await portalPage.waitForTimeout(1000);

        await portalPage.screenshot({
          path: `screenshots/TC_MIG_004_${submenu.replace(/\s|\/|\./g, '_')}_dev20.png`,
          fullPage: true,
        });

        const nuevosErrores = errores.slice(erroresAntes).filter(e => e && e.length > 0);
        if (nuevosErrores.length > 0) {
          erroresPorSubmenu[submenu] = nuevosErrores;
          console.error(`❌ "${submenu}" — Errores: ${nuevosErrores}`);
        } else {
          console.log(`✅ "${submenu}" — chunk OK`);
        }
      } catch (e) {
        erroresPorSubmenu[submenu] = [e.message];
      }
    }

    const submenusConError = Object.keys(erroresPorSubmenu);
    expect(submenusConError, `Submenús con error: ${submenusConError.join(', ')}`).toHaveLength(0);
    console.log(`✅ TC_MIG_004 — Todos los submenús de Operaciones OK en DEV20`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FOCO 3: IMÁGENES, ÍCONOS VUETIFY Y FUENTES
  // ═══════════════════════════════════════════════════════════════════════════

  test('TC_MIG_005 — Logo AGIP visible y no roto en DEV20', async ({ page }) => {
    const { portalPage } = await loginDev20ConMonitor(page);

    const logo = portalPage.locator('img[alt="logo"], img[alt="AGIP"], header img').first();
    await expect(logo, 'Logo AGIP debe ser visible en DEV20').toBeVisible({ timeout: 10000 });

    const logoOk = await logo.evaluate(img => img.naturalWidth > 0);
    expect(logoOk, 'Logo AGIP no debe estar roto (naturalWidth = 0 indica 404)').toBe(true);

    await portalPage.screenshot({ path: 'screenshots/TC_MIG_005_logo_dev20.png', fullPage: false });
    console.log('✅ TC_MIG_005 — Logo AGIP OK en DEV20');
  });

  test('TC_MIG_006 — Íconos Vuetify/MDI cargan correctamente en DEV20', async ({ page }) => {
    const { portalPage, assets404 } = await loginDev20ConMonitor(page);

    // Fuentes MDI no deben tener 404
    const fuentes404 = assets404.filter(url =>
      url.includes('materialdesignicons') || url.includes('.woff') || url.includes('.ttf')
    );

    // Al menos un ícono del menú debe ser visible
    const iconoVisible = await portalPage.locator('.v-icon, .mdi').first().isVisible().catch(() => false);

    await portalPage.screenshot({ path: 'screenshots/TC_MIG_006_iconos_dev20.png', fullPage: false });

    expect(fuentes404, `Fuentes MDI con 404: ${fuentes404.join(', ')}`).toHaveLength(0);
    expect(iconoVisible, 'Al menos un ícono Vuetify debe ser visible en DEV20').toBe(true);

    console.log('✅ TC_MIG_006 — Íconos Vuetify OK en DEV20');
  });

  test('TC_MIG_007 — CSS globales y fuentes tipográficas sin 404 en DEV20', async ({ page }) => {
    const css404     = [];
    const fuentes404 = [];

    page.on('response', response => {
      const url    = response.url();
      const status = response.status();
      if (status === 404) {
        if (url.endsWith('.css'))                          css404.push(url);
        if (url.match(/\.(woff2?|ttf|eot|otf)/))          fuentes404.push(url);
      }
    });

    const { portalPage } = await loginDev20ConMonitor(page);
    await portalPage.screenshot({ path: 'screenshots/TC_MIG_007_css_fuentes_dev20.png', fullPage: false });

    expect(css404,     `CSS con 404: ${css404.join(', ')}`).toHaveLength(0);
    expect(fuentes404, `Fuentes con 404: ${fuentes404.join(', ')}`).toHaveLength(0);

    console.log('✅ TC_MIG_007 — CSS y fuentes OK en DEV20');
  });

  test('TC_MIG_008 — Todas las imágenes de la pantalla principal no están rotas', async ({ page }) => {
    const { portalPage } = await loginDev20ConMonitor(page);

    const imagenes      = await portalPage.locator('img').all();
    const imagenesRotas = [];

    for (const img of imagenes) {
      const naturalWidth = await img.evaluate(el => el.naturalWidth).catch(() => -1);
      const src          = await img.getAttribute('src').catch(() => 'unknown');
      if (naturalWidth === 0) imagenesRotas.push(src);
    }

    await portalPage.screenshot({ path: 'screenshots/TC_MIG_008_imagenes_dev20.png', fullPage: true });

    if (imagenesRotas.length > 0) {
      console.error('❌ Imágenes rotas en DEV20:', imagenesRotas);
    }
    expect(imagenesRotas, `Imágenes rotas: ${imagenesRotas.join(', ')}`).toHaveLength(0);

    console.log(`✅ TC_MIG_008 — ${imagenes.length} imágenes verificadas en DEV20, todas OK`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FOCO 4: HARD REFRESH (F5) — COMPORTAMIENTO DE CACHÉ
  // ═══════════════════════════════════════════════════════════════════════════

  test('TC_MIG_009 — Hard Refresh en inicio no genera errores en DEV20', async ({ page }) => {
    const { portalPage } = await loginDev20ConMonitor(page);
    await portalPage.waitForLoadState('networkidle');

    const erroresRefresh  = [];
    const assets404Refresh = [];

    portalPage.on('response', response => {
      if (response.status() === 404 && response.url().match(/\.(js|css|woff2?|png|svg)(\?|$)/)) {
        assets404Refresh.push(response.url());
      }
    });
    portalPage.on('console', msg => {
      if (msg.type() === 'error') erroresRefresh.push(msg.text());
    });

    // Simular F5 forzado
    await portalPage.reload({ waitUntil: 'networkidle' });
    await portalPage.waitForTimeout(2000);

    await portalPage.screenshot({ path: 'screenshots/TC_MIG_009_refresh_dev20.png', fullPage: true });

    const bodyText = await portalPage.locator('body').textContent();
    expect(bodyText.trim().length, 'White Screen después de F5 en DEV20').toBeGreaterThan(10);
    expect(assets404Refresh, `Assets 404 post-F5: ${assets404Refresh.join(', ')}`).toHaveLength(0);

    const erroresCriticos = erroresRefresh.filter(e =>
      e.includes('404') || e.includes('chunk') || e.includes('Failed to load')
    );
    expect(erroresCriticos, `Errores críticos post-F5: ${erroresCriticos.join('\n')}`).toHaveLength(0);

    console.log(`✅ TC_MIG_009 — Hard refresh OK en DEV20`);
  });

  test('TC_MIG_010 — Hard Refresh en ruta interna Planes/Moratoria no genera 404', async ({ page }) => {
    const { portalPage } = await loginDev20ConMonitor(page);

    await portalPage.getByText('Operaciones').first().click();
    await portalPage.waitForLoadState('networkidle');
    await portalPage.getByText('Planes / Moratoria').first().click();
    await portalPage.waitForLoadState('networkidle');

    const urlAntes        = portalPage.url();
    const assets404Refresh = [];

    portalPage.on('response', response => {
      if (response.status() === 404 && response.url().match(/\.(js|css)(\?|$)/)) {
        assets404Refresh.push(response.url());
      }
    });

    await portalPage.reload({ waitUntil: 'networkidle' });
    await portalPage.waitForTimeout(2000);

    await portalPage.screenshot({ path: 'screenshots/TC_MIG_010_refresh_planes_dev20.png', fullPage: true });

    const bodyText = await portalPage.locator('body').textContent();
    expect(bodyText.trim().length, 'White Screen en ruta interna después de F5').toBeGreaterThan(10);
    expect(assets404Refresh, `Assets 404 post-F5 en ruta interna: ${assets404Refresh.join(', ')}`).toHaveLength(0);

    console.log(`✅ TC_MIG_010 — F5 en ruta interna OK. URL: ${portalPage.url()}`);
  });

  test('TC_MIG_011 — 3 refreshes consecutivos no degradan DEV20', async ({ page }) => {
    const { portalPage } = await loginDev20ConMonitor(page);
    const totalAssets404  = [];

    for (let i = 1; i <= 3; i++) {
      portalPage.on('response', response => {
        if (response.status() === 404 && response.url().match(/\.(js|css|woff2?)/)) {
          totalAssets404.push({ refresh: i, url: response.url() });
        }
      });

      await portalPage.reload({ waitUntil: 'networkidle' });
      await portalPage.waitForTimeout(1500);

      const bodyText = await portalPage.locator('body').textContent();
      expect(bodyText.trim().length, `White Screen en refresh #${i} de DEV20`).toBeGreaterThan(10);

      await portalPage.screenshot({
        path: `screenshots/TC_MIG_011_refresh_${i}_dev20.png`,
        fullPage: false,
      });

      console.log(`✅ Refresh #${i} en DEV20 completado`);
    }

    expect(totalAssets404, `Assets 404 en refreshes: ${JSON.stringify(totalAssets404)}`).toHaveLength(0);
    console.log('✅ TC_MIG_011 — 3 refreshes consecutivos OK en DEV20');
  });

});