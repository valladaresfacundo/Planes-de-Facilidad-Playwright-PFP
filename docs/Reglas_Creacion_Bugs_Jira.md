# Reglas para crear bugs en Jira (proyecto AG)

Guía de cómo cargamos los errores encontrados al probar historias de AGIP, para que todos los tickets salgan con el mismo formato y el dev los pueda reproducir sin tener que preguntar.

---

## 1. Antes de crear el bug

- **Reproducilo al menos dos veces.** Si pasa una sola vez y no vuelve, anotalo como hallazgo intermitente (con fecha, hora y ambiente) pero no abras un error hasta poder repetirlo.
- **Descartá el ambiente.** Un 502, un timeout o un "Actualmente no podemos efectuar esta consulta" aislado suele ser del ambiente. Reintentá; si persiste, recién ahí es error.
- **Descartá los datos.** Verificá en la base (Mongo) que el dato de prueba esté bien. Si el problema es un dato mal armado en QA, no es un bug del sistema.
- **Buscá si ya existe.** Revisá los errores vinculados a la historia antes de abrir uno nuevo. Si es la misma causa con otro escenario, agregalo como "otro escenario" en el error existente en lugar de duplicar.
- **Un error = un problema.** Si encontrás tres defectos distintos, son tres errores. Si dos síntomas tienen la misma causa, es un solo error.

---

## 2. Campos del ticket

| Campo | Valor |
|---|---|
| **Proyecto** | AG |
| **Tipo** | Error |
| **Prioridad** | Medium por defecto. Subirla sólo si bloquea el flujo principal o afecta importes/datos contables. |
| **Asignado** | El dev de la historia (el que figura como responsable de la historia que estás probando). |
| **Vínculo** | El error **bloquea** la historia (`Blocks` → AG-xxx). Si se relaciona con otro error ya cargado, agregar además `Relates`. |
| **Labels** | Las mismas de la historia (ej.: `PFP`, `QA`). |

---

## 3. Título

Formato:

```
<Módulo>- <Funcionalidad>- <Perfil>- <Qué falla>
```

Ejemplos reales:

- `PFP- Reporte de planes de facilidad- AgentePFP- Error 500 al descargar Excel con gran volumen`
- `PFP- Reporte de planes de facilidad- AgentePFP- El filtro Instrumento Legal muestra nuevo/2025`

Reglas:
- Tiene que entenderse **qué falla** sin abrir el ticket.
- Nada de títulos genéricos tipo "Error en el reporte" o "No funciona el filtro".
- Si el perfil no es relevante, se omite.

---

## 4. Descripción

Usar siempre esta estructura:

```markdown
**Historia:** AG-xxx – <nombre de la historia>
**Criterio de aceptación afectado:** CAxx (si aplica)
**Ambiente:** QA_AV / QA_HOMO / QA (indicar cuál)
**Perfil / usuario:** AgentePFP / AgenteRec / Contribuyente CUIT xx-xxxxxxxx-x
**Fecha de la prueba:** dd/mm/aaaa

**Datos de prueba**
- CUIT, número de plan, instrumento legal, año, impuesto, etc.
- Todo lo necesario para que el dev repita exactamente el mismo caso.

**Pasos para reproducir**
1. Ingresar al Portal Agente con perfil X.
2. Ir a Reportes → Planes de Facilidades.
3. Seleccionar Instrumento Legal 461/AGIP/25, Año 2026, Impuesto Convenio Multilateral.
4. Presionar "Consultar".
5. ...

**Resultado obtenido**
Lo que pasa realmente, con el texto exacto del mensaje de error si lo hay.

**Resultado esperado**
Lo que debería pasar según la historia. Citar el CA textual cuando corresponda.

**Caso de control** (opcional, pero muy útil)
Un escenario parecido que SÍ funciona. Ej.: "con 890/2026 (21 planes) descarga OK; con 461/2026 (72.296 planes) da 500".

**Información técnica**
- Request / Response del servicio (endpoint, payload, código HTTP).
- Log completo del backend si lo tenés.
- Consulta a la base que muestra el dato correcto.
```

### Reglas de la descripción

- **Texto exacto de los mensajes.** Copiar el mensaje tal cual aparece en pantalla, entre comillas. No parafrasear.
- **Logs completos, no recortes.** Pegar el log entero del request que falla (con el stack trace). Cortarlo hace perder la línea que le sirve al dev.
- **Datos concretos.** Nunca "un plan cualquiera"; siempre el número de plan / CUIT puntual.
- **Separar hecho de hipótesis.** Si sospechás la causa pero no está confirmada, escribila como "Posible causa:" y no como un hecho. Si la confirmaste (log, código, base), decí cómo.
- **Distinguir front y back.** Si la Response del servicio es correcta y la pantalla muestra otra cosa, aclararlo: le ahorra al equipo buscar en el lugar equivocado.

---

## 5. Evidencia (adjuntos)

- **Capturas propias**, sacadas en la prueba que estás reportando. Nombrarlas en orden (01, 02, 03…) siguiendo los pasos.
- Mínimo: una captura del **paso previo** (filtros cargados) y una del **resultado erróneo**.
- Si aplica: captura de la **base** (Mongo) o del **archivo descargado** (Excel) que muestra la diferencia.
- Las capturas tienen que mostrar los datos que se ven en la descripción (plan, CUIT, filtros). Si no se ve, no sirve como evidencia.
- No adjuntar documentos armados (Word/PDF) salvo que los pidan: el dev quiere las imágenes directo en el ticket.

---

## 6. Después de crear el bug

- Verificar que quedó **vinculado a la historia** como bloqueante.
- Dejar registrado el número de error (AG-xxx) en el caso de prueba / subtarea de QA que falló.
- **Re-test:** cuando el dev lo pasa a resuelto, volver a probar **con los mismos datos y pasos** del ticket. Si queda OK, comentar "Verificado OK en <ambiente> el dd/mm" con una captura. Si falla, comentar qué sigue pasando y devolverlo.
- Si en el re-test aparece un problema distinto, **es un error nuevo**, no se reabre el anterior.

---

## 7. Checklist rápido

- [ ] Lo reproduje al menos 2 veces y no es del ambiente ni de los datos
- [ ] No existe ya un error con la misma causa
- [ ] Tipo Error, prioridad, asignado al dev de la historia
- [ ] Vinculado: **bloquea** la historia
- [ ] Título: `Módulo- Funcionalidad- Perfil- Qué falla`
- [ ] Ambiente, perfil, datos de prueba y fecha
- [ ] Pasos numerados, resultado obtenido vs. esperado (con el CA)
- [ ] Mensajes de error textuales y logs completos
- [ ] Capturas propias adjuntas y en orden
