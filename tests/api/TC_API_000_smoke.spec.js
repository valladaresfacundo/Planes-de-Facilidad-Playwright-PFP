// tests/api/TC_API_000_smoke.spec.js
// Reconocimiento en vivo del cliente API de Fase 2 (lib/pfpApiClient.js) —
// confirma conectividad + auth + forma real de las respuestas antes de
// construir tests de negocio para F3002/F3008/F3009/F3010/F3012/F3014. No
// llama ningún endpoint mutante (RegistrarFormulario, GenerarPagoCuotas,
// GenerarDebitoCuotaPorSolicitud, GenerarCancelaciones, etc.) — solo lectura.
//
// Hosts confirmados en vivo el 2026-08-13 (ver fixtures/test-data.js
// AMBIENTES_API): todos "*.apps.ocp-test-hc.agip.gob.ar" sobre HTTP (no
// HTTPS — HTTPS pega contra el vhost por defecto del router de OpenShift y
// da un 503 engañoso). Fuente: herramienta HTML de trabajo del usuario.
const { test, expect } = require('@playwright/test');
const { PfpApiClient } = require('../../lib/pfpApiClient');
const { SIGN_CCT, CUIT_AUTENTICADO, PLANES_CONOCIDOS } = require('../../fixtures/test-data');

test.describe('Fase 2 — reconocimiento del cliente API PFP', () => {

  test('TC_API_000 — autenticar() obtiene un JWT contra api-cct QA', async ({ request }) => {
    const cliente = new PfpApiClient(request, 'qa');
    const token = await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    console.log(`TC_API_000 — token obtenido (${token.length} caracteres)`);
  });

  test('TC_API_001 — buscarPlanPorSolicitud() trae resumen + detalle (cuotas) del plan VIGENTE conocido', async ({ request }) => {
    test.skip(!PLANES_CONOCIDOS.vigente, 'Requiere PLANES_CONOCIDOS.vigente en fixtures/test-data.js');

    const cliente = new PfpApiClient(request, 'qa');
    await cliente.autenticar(CUIT_AUTENTICADO, SIGN_CCT);

    const { resumen, detalle } = await cliente.buscarPlanPorSolicitud({
      cuit: CUIT_AUTENTICADO,
      anio: new Date().getFullYear(),
      solicitud: PLANES_CONOCIDOS.vigente,
    });

    expect(resumen).toBeTruthy();
    expect(resumen.content?.IDSolicitud).toBe(String(PLANES_CONOCIDOS.vigente));
    console.log(`TC_API_001 — resumen: idAcogimiento=${resumen.content?.ID_Acogimiento} estado=${resumen.states?.[0]?.state} period=${resumen.period} tax=${resumen.tax}`);

    const cuotas = detalle?.cuotas ?? [];
    console.log(`TC_API_001 — cuotas encontradas: ${cuotas.length}`);
    if (cuotas.length > 0) {
      const c1 = cuotas[0];
      console.log(`TC_API_001 — cuota 1: estado=${c1.estadoCuota} venc1=${c1.vencimientoCuota1} nominal=${c1.importeNominal} idTracerCuota=${c1.idTracerCuota}`);

      // Validamos que se pueda armar el payload F3010 sin llamarlo de verdad —
      // solo chequea que construirPayloadF3010 no explote y que los campos
      // clave queden completos (no en 0/undefined) con datos reales del plan.
      const payload = cliente.construirPayloadF3010({
        cuit: CUIT_AUTENTICADO,
        cuota: {
          numeroCuota: c1.numeroCuota,
          importeNominal: c1.importeNominal,
          importeActualizado: c1.importeActualizado,
          vencimientoCuota1: c1.vencimientoCuota1?.includes('/')
            ? c1.vencimientoCuota1.split('/').reverse().join('-')
            : c1.vencimientoCuota1,
          idTracerCuota: c1.idTracerCuota,
        },
        resumenPlan: resumen,
        correcto: true,
      });
      console.log(`TC_API_001 — payload F3010 armado: ${JSON.stringify(payload)}`);
      expect(payload.header.idPerson).toBe(Number(CUIT_AUTENTICADO));
      expect(payload.Datos.Numero_Solicitud).toBe(Number(PLANES_CONOCIDOS.vigente));
      expect(payload.Datos.ID_Tracer_Plan).toBeTruthy();
    }

    expect(Array.isArray(cuotas)).toBe(true);
  });

  test('TC_API_002 — buscarEmitirDRG() resuelve la fecha de emisión para hoy', async () => {
    const { PfpApiClient: Cliente } = require('../../lib/pfpApiClient');
    // No hace falta auth ni request — es una función pura sobre la tabla local.
    const cliente = new Cliente({}, 'qa');
    const hoy = new Date().toISOString().slice(0, 10);
    const emitir = cliente.buscarEmitirDRG(hoy);
    console.log(`TC_API_002 — EmitirDRG para ${hoy}: ${emitir}`);
    expect(emitir).toBeTruthy();
  });

});
