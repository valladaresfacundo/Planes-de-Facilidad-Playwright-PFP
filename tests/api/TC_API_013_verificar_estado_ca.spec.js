// tests/api/TC_API_013_verificar_estado_ca.spec.js
// Verificación de solo lectura: ¿la confirmación de F3005 (TC_API_012) llegó a
// procesarse en el backend antes de que se cerrara la página, o quedó en un
// estado intermedio? No muta nada — solo consulta.
const { test } = require('@playwright/test');
const { PfpApiClient } = require('../../lib/pfpApiClient');
const { SIGN_CCT, CUIT_AUTENTICADO, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test('TC_API_013 — estado real del plan tras confirmar F3005', async ({ request }) => {
  const cliente = new PfpApiClient(request, 'qa');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  const planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO,
    anio: new Date().getFullYear(),
    solicitud: PLANES_CONOCIDOS.vigente,
    estado: 'Todos',
  });

  console.log(`TC_API_013 — cantidad de items para solicitud ${PLANES_CONOCIDOS.vigente}: ${planes.length}`);
  planes.forEach((p, i) => {
    console.log(`TC_API_013 — item ${i}: pfpForm=${p.pfpForm} estado=${p.states?.[0]?.state} content=${JSON.stringify(p.content)}`);
  });
});
