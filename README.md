# agip-automation

Suite de automatización (Playwright) para el ciclo de vida completo del **Plan de Facilidades de Pago (PFP)** de AGIP — formularios F3001 a F3018 — sobre Portal Contribuyente y Portal Agente, más un cliente API propio (`lib/pfpApiClient.js`) para los formularios sin pantalla dedicada.

Este documento es la guía para que cualquiera (no solo quien escribió los tests) pueda instalar, configurar y correr la regresión.

## 1. Requisitos previos

- **Node.js** 18+ (probado con Node 24).
- **VPN de AGIP activa** — todos los ambientes (`portal-cct-qa-av`, `api-cct-qa-av`, `mongodb-cct-*`, etc.) solo son alcanzables por la red interna de AGIP. Sin VPN, los tests fallan por timeout/DNS, no por un bug real.
- **Acceso a un cluster MongoDB de QA** (`Tracers.TracerInstance`) — algunos tests (los de `tests/regression/pfp-api/`) leen/escriben directo en Mongo para verificar estados o fabricar escenarios que la API no permite armar de otra forma (backdatear fechas, etc.). Sin esto, esos tests se saltean solos (no fallan) con un mensaje claro.
- Un CUIT con permiso de instalar dependencias npm (sin restricciones raras de proxy corporativo).

## 2. Instalación

```bash
git clone <url-del-repo>
cd agip-automation
git checkout feature/fase2-api-client   # rama de trabajo actual, ver sección 8
npm install
npx playwright install chromium
```

## 3. Configuración (`.env`)

```bash
cp .env.example .env
```

Completar `.env` con:

```
MONGO_URI=mongodb://usuario:password@host1:27017,host2:27017,host3:27017/admin?replicaSet=rs0&authSource=admin&authMechanism=SCRAM-SHA-1
MONGO_DB=Tracers
```

**Pedile la connection string real al dueño del repo por un canal seguro (no la pegues en un chat/ticket que quede público) — nunca se commitea, `.env` está en `.gitignore`.**

Si por ahora no tenés la connection string, podés correr igual toda la suite: los tests que la necesitan (mayormente los de `pfp-api/`) se saltean automáticamente con `test.skip(!process.env.MONGO_URI, ...)`.

## 4. Cómo correr los tests

### Toda la regresión (contra QA_AV, el ambiente vigente)

```bash
npx playwright test --config=playwright.config.qa-av.js
```

o el script equivalente:

```bash
npm run test:regresion:qa-av
```

### Una carpeta puntual

```bash
npx playwright test tests/regression/pfp --config=playwright.config.qa-av.js
npx playwright test tests/regression/pfp-api --config=playwright.config.qa-av.js
npx playwright test tests/regression/portal-agente --config=playwright.config.qa-av.js
```

### Un archivo puntual

```bash
npx playwright test tests/regression/pfp/F3001_acogimiento.spec.js --config=playwright.config.qa-av.js
```

### Ver el último reporte HTML

```bash
npx playwright show-report reports/qa-av
```

Ojo: el reporte se pisa en cada corrida — si necesitás guardar la evidencia de una corrida puntual, copiá la carpeta `reports/qa-av` a otro lado antes de volver a correr.

> **Nota sobre `playwright.config.js` (sin `qa-av`):** es un config más viejo, apuntado a `portal-cct-qa` (QA_HOMO). **Ese ambiente tiene una caída de backend permanente y conocida** (ver sección 7) — no correr la regresión ahí, usar siempre `playwright.config.qa-av.js`.

## 5. Estructura del repo

```
fixtures/test-data.js        — CUITs, ambientes, y PLANES_CONOCIDOS (ver sección 6)
lib/pfpApiClient.js          — cliente API propio para formularios sin pantalla (F3002/3003/3008/3009/3010/3011/3012/3013/3014)
lib/mongoAdmin.js            — acceso directo a Mongo (verificación de estados, backdateo de fechas)
pages/                       — Page Objects (LoginPage, PFPPage, LoginAgentePage)
tests/regression/pfp/        — tests de UI, Portal Contribuyente (F3001, F3005, F3006, F3007, F3013, reformulación, y bugs de UI)
tests/regression/pfp-api/    — tests de API pura, sin pantalla propia (F3002/3003/3006/3008/3009/3010/3011/3012/3013/3014, y bugs de backend)
tests/regression/portal-agente/ — permisos por perfil (AgentePFP/Consultor/AgenteRec)
tests/smoke/                 — smoke tests (login, migración Node 20)
tests/api/                   — reconocimiento histórico de la API (Fase 2 inicial)
```

## 6. Fixtures — `fixtures/test-data.js` (leer esto antes de correr nada)

`CONTRIBUYENTES` y `PLANES_CONOCIDOS` son **datos reales de un ambiente QA compartido**, no datos sintéticos. Varios tests **mutan estado real** (pagan cuotas, caducan planes, generan acogimientos) y **consumen** el plan que usan — un plan `VIGENTE` puede terminar `CADUCO`/`PAGADA`/`REFORMULADO` después de correr un test.

Cuando un fixture se agota, el test correspondiente **no falla** — se saltea solo con `test.skip(...)` y un mensaje que dice exactamente qué hace falta (ej. *"Requiere un plan CADUCO nuevo con la cuota 1 sin tocar"*). Si ves muchos tests en amarillo (`skipped`) en vez de verde, es casi siempre por esto — no es un bug de la suite.

**Qué hacer cuando un fixture se agota:**
1. Leer el mensaje del `test.skip` — dice qué característica necesita el plan de reemplazo (estado, cantidad de cuotas, cuál cuota debe estar sin tocar, etc.).
2. Conseguir un plan real que cumpla esa condición (generarlo a mano por el Portal, o pedírselo a alguien que tenga acceso a producción/QA con datos reales) — algunos también se pueden fabricar con los propios tests de la suite (ver los comentarios de cada archivo).
3. Actualizar el valor correspondiente en `PLANES_CONOCIDOS` (`fixtures/test-data.js`) y dejar un comentario explicando de dónde salió y en qué estado quedó el anterior — es la convención que se usó en todo el archivo, seguirla ayuda a quien venga después.

### Fábrica de planes (`lib/fabricaPlanes.js`)

F3005, F3007, F3008, F3012, F3014 y F3013 (UI) ya no dependen de `PLANES_CONOCIDOS`: cada uno pide un plan por **receta** (`planSinTocar`, `planCuota1Paga`, `planParaCA`, `planNulo`, `planParaCuotas`). La fábrica:

1. Revisa los repuestos de esa receta en `fixtures/planes-runtime.json` (gitignored) y usa el primero que, **según Mongo**, siga en el estado que la receta pide. Los que ya no sirven se descartan solos.
2. Si no queda ninguno, **genera un plan nuevo por el Portal** (461/AGIP/25, CUIT `CONTRIBUYENTES.conPlan`) y lo lleva al estado pedido vía api-publicador (débito + pago/rechazo, igual que el simulador del banco).

- Los tests de solo lectura (F3005, F3007, F3013 UI) reusan su plan entre corridas. F3012/F3014 usan **la siguiente cuota libre** del mismo plan (12 cuotas ≈ 5 corridas). F3008 consume un plan por corrida.
- **Generar un plan gasta un período de deuda real del CUIT.** Si el CUIT se queda sin deuda, la fábrica falla con el mensaje "hay que cargar deuda nueva".
- Para no gastar deuda podés agregar a mano en `planes-runtime.json` planes existentes que ya cumplan la receta: `{ "sinTocar": ["1523073110"], ... }`.
- `NO_FABRICAR=1` desactiva la generación: si no hay plan válido, el test se saltea con un mensaje claro.
- Si el CUIT se queda sin períodos con deuda, la fábrica **carga deuda sola** (DJ 5866, $5.000.000 en el próximo período libre) y reintenta.

### Carga de deuda y saldo a favor (`scripts/cargar-formulario.js`)

Reemplazo por línea de comandos de la herramienta interna `carga_unificada_formularios` (HTML): mismos endpoints y mismos bodies, en `lib/cargaFormularios.js`.

| Formulario | Qué carga |
|---|---|
| 1234 | Saldo a favor en la cuenta corriente (pago ACREDITADO) |
| 5220 | DJ Contribuyentes Locales (impuesto 4) |
| 5225 | DJ Agentes de Recaudación (impuesto 20) |
| 5556 | DJ Sellos (impuesto = cada tasa) |
| 5866 | DJ Convenio Multilateral (impuesto 2) — **la deuda que usan los planes 461 de la suite** |

```bash
npm run cargar -- --help
npm run cargar -- 5866 --cuits 27236036044 --proximo --deuda 5000000      # próximo período libre
npm run cargar -- 5866 --cuits 27236036044 --anio 2020 --meses 1-6 --deuda 5000000
npm run cargar -- 1234 --cuits 27236036044 --tasas 2 --anio 2026 --meses 9 --deuda 10000
npm run cargar -- 5556 --cuits 20123456789 --tasas 281,282 --anio 2025 --meses 3 --deuda 5000 --dry-run
```

⚠ **5866 sólo acepta períodos anteriores a 2022/08**: la regla activa de validación (`F5866_V1.0.1_FORM_VALIDATION_DEFAULT_V1.0.4`) tiene la condición invertida y rechaza con "Error 5066-01" todo período desde 2022/08, para cualquier CUIT. Por eso `--proximo` busca hacia atrás desde 2022/07.

## 7. Cosas que hay que saber antes de tocar esto

- **QA_HOMO (`portal-cct-qa`) tiene una caída de backend permanente** (`ObtenerPlanesDePago`/`ObtenerPlanes` devuelven 500 real, error de inyección de dependencias .NET) — no es un problema de la suite, no reintentar ahí. Todo corre contra **QA_AV** (`portal-cct-qa-av`).
- **Si los tests fallan todos con timeout/DNS**, lo primero es chequear la VPN:
  ```bash
  nslookup portal-cct-qa-av.apps.ocp-test-hc.agip.gob.ar
  ```
  Si el servidor que responde es `DC01.agip.gov.ar` (o similar), la VPN está bien. Si dice `UnKnown` con una IP tipo `172.23.x.x`, la VPN está caída — reconectar antes de reintentar.
- **Hay tests que documentan bugs reales de producción/backend a propósito** (usan `test.fail()` de Playwright): `BUG_52821_pago_sobre_plan_caduco.spec.js` y `BUG_redondeo_simulacion_cuotas.spec.js`. Para estos, **"pasar" en el reporte significa que fallaron como se espera** (el bug sigue ahí) — si alguna vez aparecen como **fallidos** en el reporte, es una alerta real: significa que el comportamiento cambió (probablemente lo arreglaron) y hay que sacarles el `test.fail()` y dejarlos como test normal.
- **No usar nunca** `lib/pfpApiClient.js::generarCaducidades()` / `generarCancelaciones()` sin confirmar antes con el equipo — son los únicos 2 métodos marcados ⚠⚠⚠ en el código porque impactan **TODOS los planes elegibles del ambiente**, no uno puntual.
- Los tests corren con `headless: false` por default (se abre un Chrome visible) — es intencional, ayuda a diagnosticar fallos en vivo. Para correr en CI/sin pantalla, agregar `--headed=false` o cambiar `headless: true` en el config usado.

## 8. Estado del repo / rama

- Rama de trabajo: **`feature/fase2-api-client`** (sobre `feature/fase1-pfp-formularios`, que ya tiene un PR abierto contra `main`).
- Cobertura actual: 13 de 18 formularios del catálogo PFP con al menos un PASS real automatizado (F3001-F3003, F3005-F3014), más el ciclo completo de Cancelación Anticipada y la reformulación 890→461. F3004 y F3015-F3018 quedaron fuera de alcance (bloqueos reales de datos/ambiente, no de la suite).
