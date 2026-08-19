// tests/api/TC_API_015_reintentar_cierre_ca.spec.js
// Reintento de F3008 (GenerarCancelaciones) sobre el plan que quedó en
// CA_PAGADA la sesión anterior (2026-08-13) — ver TC_API_014, que dio 504
// Gateway Timeout en el cierre final. El usuario confirmó que debería andar
// bien ahora.
const { test } = require('@playwright/test');
const { PfpApiClient } = require('../../lib/pfpApiClient');
const { SIGN_CCT, CUIT_AUTENTICADO } = require('../../fixtures/test-data');

const PLAN_CA_PAGADA = '1783000149';

test('TC_API_015 — reintentar GenerarCancelaciones (F3008) sobre el plan CA_PAGADA', async ({ request }) => {
  const cliente = new PfpApiClient(request, 'qa');
  await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

  let planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: PLAN_CA_PAGADA, estado: 'Todos',
  });
  console.log(`TC_API_015 — estado antes: ${planes[0]?.states?.[0]?.state}`);

  const resultado = await cliente.generarCancelaciones();
  console.log(`TC_API_015 — GenerarCancelaciones: ${JSON.stringify(resultado).slice(0, 500)}`);

  await new Promise(r => setTimeout(r, 1500));
  planes = await cliente.obtenerPlanesDePago({
    cuit: CUIT_AUTENTICADO, anio: new Date().getFullYear(), solicitud: PLAN_CA_PAGADA, estado: 'Todos',
  });
  console.log(`TC_API_015 — estado después: ${planes[0]?.states?.[0]?.state}`);
});
