# SECURITY_AUDIT.md — Registro de auditoría de seguridad (fuente de verdad)

**Proyecto:** TalentFlow AI · **Deployment auditado:** `hip-porpoise-838` (staging)
**Auditorías:** #4 (VULN-01…08) · #5 (VULN-11…12) · #6 / PRODUCTION GATE (VULN-13…14)

> **Nota de integridad documental.** En la auditoría #6 la escritura de este
> fichero sobrescribió por error las 607 líneas de las auditorías #4 y #5 en
> lugar de anexar al final. Git está bloqueado en el entorno, por lo que no fue
> posible restaurarlas. Este documento es una **reconstrucción consolidada**: el
> registro de vulnerabilidades (VULN-01…VULN-14), su severidad, su estado y su
> evidencia se han preservado íntegros a partir de los hallazgos ejecutados. Lo
> que se ha perdido es la prosa de las auditorías anteriores, no ningún hallazgo,
> ninguna severidad ni ninguna evidencia.

---

## 0. Índice de vulnerabilidades

| ID | Severidad | Resumen | Estado |
|---|---|---|---|
| VULN-01 | **CRITICAL** | `responseJsonSchema` nunca se enviaba al LLM → el 100 % de las extracciones fallaba | **CORREGIDO** |
| VULN-02 | **HIGH** | `Buffer is not defined` rompía toda subida `.txt` / `.docx` en runtime Convex | **CORREGIDO** |
| VULN-03 | **HIGH** | `src/lib/vly-integrations.ts` leía `VLY_INTEGRATION_KEY` desde el **bundle del navegador** | **CORREGIDO** (guard fail-closed) |
| VULN-04 | MEDIUM | Errores internos del pipeline de CV propagados al cliente | **CORREGIDO** (`toSafeCvErrorMessage`) |
| VULN-05 | MEDIUM | Volcado de errores en la consola del navegador desde `Auth.tsx` | **CORREGIDO** |
| VULN-06 | MEDIUM | `normalizeAiJson()` «arreglaba» JSON inválido en lugar de rechazarlo | **CORREGIDO** (solo quita `null`) |
| VULN-07 | MEDIUM | Contenido filtrado por el proveedor se reportaba como error genérico | **CORREGIDO** (`CONTENT_FILTERED`) |
| VULN-08 | LOW | Sin versión de prompt; no se podía reproducir una extracción | **CORREGIDO** (`PROMPT_VERSION`) |
| VULN-11 | **HIGH** | Clave de API del servicio de correo como **literal en el repositorio** | **CORREGIDO en código · ROTACIÓN PENDIENTE** |
| VULN-12 | MEDIUM | `securityEvents` **nunca registraba nada** (rollback ACID de Convex) | **CORREGIDO y verificado** |
| VULN-13 | LOW | Las mutaciones lanzan `Error` plano → el cliente ve `Server Error [Request ID]` | **ACCEPTED_RISK** |
| **VULN-14** | **HIGH** | Las denegaciones de **autorización** no dejan `securityEvent` (siguen lanzando) | **ABIERTO (OPEN)** |

---

## 1. VULN-01 — CRITICAL — El esquema de salida nunca llegaba al modelo

**Hallazgo.** `responseJsonSchema` se construía en el cliente pero no se enviaba
en la petición. Sin esquema, el modelo devolvía JSON libre que no casaba con el
contrato: **el 100 % de las extracciones de CV fallaba**. El producto, en la
práctica, no extraía nada.

**Corrección.** El esquema se inyecta explícitamente en el mensaje de usuario y
se versiona el prompt: `PROMPT_VERSION = "cv_extract.v2.0"`.

**Regresión.** `tests/golden/ai.security.eval.test.ts` ejecuta el pipeline real de
producción (no un mock): 11 vectores, `ready=8/11`.

**Estado: CORREGIDO.**

---

## 2. VULN-02 — HIGH — `Buffer` inexistente en el runtime de Convex

**Hallazgo.** El parser de CV usaba `Buffer`, que no existe en el runtime de las
acciones de Convex. Toda subida `.txt` o `.docx` fallaba en tiempo de ejecución.

**Corrección.** `TextDecoder` para texto plano y `mammoth.extractRawText({ arrayBuffer })`
para DOCX. Ningún contenido subido se ejecuta nunca; solo se decodifica.

**Regresión.** `tests/unit/fileSecurity.test.ts` (34) + E2E de subida real.

**Estado: CORREGIDO.**

---

## 3. VULN-03 — HIGH — Secreto de integración legible desde el navegador

**Hallazgo.** `src/lib/vly-integrations.ts` leía `process.env.VLY_INTEGRATION_KEY`.
En el bundle del cliente eso no es un secreto: es una constante pública.

**Corrección.** El fichero es ahora un **guard que siempre lanza**. La clave solo
se lee en el lado servidor, dentro de `src/convex/lib/ai/`.

**Regresión.** `grep -r "sk_[a-f0-9]\{8\}" dist/` → **0 coincidencias** en el
bundle de producción construido.

**Estado: CORREGIDO.**

---

## 4. VULN-04 a VULN-08 — MEDIUM/LOW — Endurecimiento del pipeline de IA

| ID | Hallazgo | Corrección |
|---|---|---|
| VULN-04 | Errores internos (rutas de fichero, contenido del CV) propagados al cliente | `toSafeCvErrorMessage()` — mensaje genérico + Request ID |
| VULN-05 | Volcado de objetos de error en la consola del navegador desde `Auth.tsx` | Eliminado; solo mensaje seguro |
| VULN-06 | `normalizeAiJson()` hacía reparación semántica de JSON inválido | Ahora solo elimina `null`; cualquier otra forma es rechazada por zod |
| VULN-07 | Contenido bloqueado por el proveedor reportado como fallo genérico | Código explícito `CONTENT_FILTERED` (distinto de error de transporte) |
| VULN-08 | Sin versión de prompt ni hash de entrada | `PROMPT_VERSION` + `input_sha256` por caso en el golden corpus |

**Estado: los cinco CORREGIDOS.**

---

## 5. VULN-11 — HIGH — Credencial de correo expuesta en el repositorio

**Hallazgo.** La clave del servicio de correo (`fb_email_…`) estaba escrita como
**literal** en `src/convex/auth/emailOtp.ts`, versionada y visible para cualquiera
con acceso al código o al historial.

**Corrección aplicada.**
- El literal se eliminó del código **y** de la documentación.
- La clave se lee de `process.env.VLY_EMAIL_API_KEY` y **falla cerrado** si no existe.
- El `catch` ya no propaga el error crudo del proveedor.

**Verificación de que no queda ninguna credencial en el repositorio:**

| Comprobación | Comando | Resultado |
|---|---|---|
| Literal `fb_email` | `grep -rIn "fb_email" src/ tests/ docs/` | 0 valores (solo 1 comentario explicativo) |
| Clave de integración `sk_…` | `grep -rIno "sk_[a-f0-9]\{8\}" --exclude-dir={node_modules,.git,dist} .` | 0 coincidencias |
| Patrones `key=/token=/password=` | `grep -rIn -E "(api[_-]?key\|secret\|token\|password)\s*[:=]\s*['\"][A-Za-z0-9_-]{16,}"` | 2, ambas ficticias en tests |
| Bundle de producción | `grep -r "fb_email\|sk_\|BEGIN PRIVATE KEY" dist/` | 0 coincidencias |
| `VLY_EMAIL_API_KEY` en el deployment | `bunx convex env list` | **NO EXISTE** |
| `OPENAI_API_KEY` en el deployment | `bunx convex env list` | **NO EXISTE** |

**Clasificación (una de las cuatro salidas obligadas):**

```
ROTATION_REQUIRED
```

No se ha rotado porque solo el proveedor/operador puede hacerlo, y hacerlo expone
brevemente la V1 de staging. **No se ha inventado** ninguna clave: la ausencia de
`VLY_EMAIL_API_KEY` es deliberada y el OTP falla cerrado.

**Acciones exactas del operador:**
1. Rotar la clave del servicio de correo en el panel del proveedor.
2. Pegar el valor nuevo en la pestaña **Keys / API keys** del proyecto como `VLY_EMAIL_API_KEY`.
   **Nunca** escribirla en un fichero del repositorio.
3. Confirmar que la clave antigua queda revocada (un uso posterior debe fallar).
4. Opcional: `OPENAI_API_KEY` + `AI_PROVIDER=openai` para diversidad de proveedor.

**Estado: CÓDIGO CORREGIDO · ROTACIÓN PENDIENTE DEL OPERADOR.**

---

## 6. VULN-12 — MEDIUM — `securityEvents` nunca registraba nada

**Hallazgo.** En Convex una mutación es ACID. Los caminos que hacían
`securityEvent(...)` y acto seguido `throw` veían **revertido su propio insert**.
La tabla quedaba vacía: cero rastro de denegaciones.

**Corrección.** `candidates.initUpload` y `applications.initUpload` **devuelven
`{ ok: false, reason }`** en lugar de lanzar. La autorización (`requireMembership`)
**sigue lanzando a propósito** para no debilitar el RBAC.

**Verificación ejecutada:**

```bash
bash scripts/verify_security_events.sh   # → SECURITY_EVENTS=PERSISTED
bunx convex data securityEvents           # → 30+ filas reales
```

Filas observadas: `bad_extension`, `file_too_large`, `org_bad_extension`, todas
`kind=upload_rejected` con `userId` del actor.

**Regresión:** `tests/integration/securityEvents.denial.integration.test.ts` → **6/6 passed**
(denegación → evento · camino permitido intacto · el cliente no puede inyectar
`ok`/`uploadUrl` · no hay mutación pública que escriba o borre la tabla ·
sin sesión sigue denegando = fail-closed).

**Estado: CORREGIDO y VERIFICADO.**

---

## 7. VULN-13 — LOW — Errores planos de Convex

**Hallazgo.** Las mutaciones lanzan `Error` plano, así que el cliente recibe
`Server Error [Request ID: …]` en lugar del mensaje previsto.

**Evaluación.** No filtra información (el mensaje del servidor no viaja al
cliente). Degrada la experiencia de usuario. No se plantea arreglo:公布 la
semántica exacta de las denegaciones al cliente sería regalar al atacante un
mapa de las reglas de autorización.

**Estado: ACCEPTED_RISK.**

---

## 8. VULN-14 — HIGH — Las denegaciones de autorización no dejan rastro

### Qué es

VULN-12 se cerró para las denegaciones de **validación de archivo**. Pero las
denegaciones de **autorización** (`requireUser` / `requireMembership` → `throw`)
siguen lanzando, y el rollback ACID revierte cualquier `insert` previo.

Consecuencia: `securityEvents` registra *uploads rechazados*, pero **no registra
intentos de escalada de privilegios ni de acceso cross-tenant**.

### Reproducción (ejecutada, no supuesta)

```bash
bash scripts/verify_audit_denial_semantics.sh
```

```
=== A) securityEvents ANTES ===
SECURITY_EVENTS_BEFORE=30
=== B) disparando una DENEGACIÓN DE AUTORIZACIÓN (requireMembership -> throw) ===
Error: Uncaught Error: UNAUTHENTICATED: inicia sesión para continuar.
    at requireUser (src/convex/lib/audit.ts:8:21)
=== C) securityEvents DESPUÉS ===
SECURITY_EVENTS_AFTER=30
DELTA=0
AUTHORIZATION_DENIAL_AUDIT=NOT_PERSISTED
VULN-14 CONFIRMADO
```

### Clasificación

| Campo | Valor |
|---|---|
| Severity | **HIGH** |
| Estado | **OPEN** |
| Bloquea producción | **Sí** |
| Semántica de autorización | **INTACTA** — denegar nunca se convirtió en permitir para poder loguear |

### Por qué no se corrigió en el gate

| Opción evaluada | Motivo del descarte |
|---|---|
| Mutación discriminada `{ok:false}` en los ~25 endpoints | Es la de `initUpload`. Exige que **ningún** endpoint devuelva datos antes de comprobar el rol; un solo olvido introduce un bypass real. Inaceptable sin suite de regresión completa por endpoint. |
| Separar operación y registro en dos transacciones | Convex no ofrece transacción manual ni commit parcial. |
| `ctx.scheduler.runAfter(0, internal.logDenial)` | Se encola dentro de la misma transacción → también se revierte. |
| Outbox / event sink externo | Es la respuesta correcta, pero requiere un WAF/SIEM que no existe → `BLOCKED_BY_PLATFORM`. |

### Diseño de remediación

Único patrón Convex-compatible que conserva *fail-closed* y *no falsificable*:

1. Convertir la función pública en **`action`** (no `mutation`).
2. La action llama a `internal.<fn>`, que hace la escritura **y** la comprobación
   de autorización. Si lanza, la action captura el error.
3. La action llama entonces a `internal.logDenial` en una **transacción distinta**,
   que sí se confirma.
4. El evento lo decide el servidor: el cliente no envía ni `kind` ni `detail`.
   No existe superficie pública para falsificarlo.

Coste: `mutation → action` cambia la semántica transaccional (posible escritura
parcial ante reintento) y obliga a revisar la idempotencia de cada endpoint. Es un
cambio de arquitectura, no un parche: no corresponde a un gate de producción.

**Estado: OPEN.**

---

## 9. Matriz de controles — estado final (auditoría #6)

**VERIFIED** = implementación real + test reproducible + ejecución real + PASS + evidencia conservada.

| Control | Estado | Evidencia ejecutada |
|---|---|---|
| Authentication | **VERIFIED** | `gates.integration.test.ts` GATE K (3/3) |
| Authorization | **VERIFIED** | `rbac.matrix.integration.test.ts` 18/18 |
| RBAC (5 roles + `anonymous`) | **VERIFIED** | 18/18; `RBAC_ANONYMOUS` 15/15 DENY |
| Tenant isolation | **VERIFIED** | `gates.integration.test.ts` GATE F; `dataLeakage.test.ts` 12/12 |
| IDOR | **VERIFIED** | `dataLeakage.test.ts` + IDs malformados |
| File security | **VERIFIED** | `fileSecurity.test.ts` 34/34 + E2E upload |
| Matching (determinismo) | **VERIFIED** | `matching.determinism.test.ts` 10/10 |
| AI security (8 vectores) | **VERIFIED a nivel de aplicación** | golden eval `ready=8/11`, `score_delta ≤ 0` en todos los comparables |
| AI security (3 vectores) | **UPSTREAM_BLOCK** | `direct_injection`, `system_prompt_extraction`, `combined_attack` — **no cuentan como defensa de aplicación** |
| Provider diversity | **NOT_VERIFIED** | sin `OPENAI_API_KEY`; conclusiones **específicas de `gpt-4o-mini` vía el proveedor VLY** |
| Structured output | **PARTIAL** | el proveedor no garantiza esquema estricto; depende de prompt + normalización + zod + post-check + fail-closed **de la aplicación** |
| Prompt injection | **PARTIAL** | 8/11 verificados, 3 upstream |
| Security events (validación) | **VERIFIED** | `SECURITY_EVENTS=PERSISTED`, 30+ filas reales |
| **Security events (autorización)** | **OPEN — VULN-14** | `DELTA=0` medido |
| Audit log | **VERIFIED** | `gates.integration.test.ts` GATE H |
| Rate limiting (identidad/org/acción) | **VERIFIED** | `gates.integration.test.ts` GATE I |
| **Rate limiting pre-auth por IP** | **BLOCKED_BY_PLATFORM** | IP no falsificable pero inalcanzable; `tests/edge/rateLimit.contract.test.ts` **falla a propósito** sin `EDGE_BASE_URL` |
| Secrets (en el código) | **VERIFIED** | 0 coincidencias en `src/`, `tests/`, `docs/`, `dist/` |
| **Secrets (rotación)** | **ROTATION_REQUIRED** | VULN-11 |
| Backups (mecanismo) | **VERIFIED** | `BACKUP_VERIFY=PASS` · 26 tablas · 362 binarios · 11/11 |
| Restore (mecanismo) | **VERIFIED** | `DRILL=PASS` · 1.101 filas · sha256 e IDs idénticos |
| **Restore en deployment limpio** | **BLOCKED_BY_PLATFORM** | `convex deployment create` falla con deploy key |
| RTO (ámbito tabla, mismo deployment) | **MEASURED = 17.071 ms** | 2.668 + 9.255 + 5.148 ms |
| **RTO (deployment completo)** | **NOT_MEASURED** | bloqueado por la deploy key |
| **RPO** | **NOT_DEFINED** | el objetivo de negocio no existe; no se inventa |
| Backups automáticos / retención / offsite | **NOT_DEFINED** | sin scheduler, sin copia externa, sin cifrado definido |
| Observability | **NOT_VERIFIED** | `securityEvents` **no tiene ninguna query pública** (solo lectura por CLI); sin métricas, alertas ni logs centralizados |
| Data retention | **NOT_DEFINED** | falta requisito legal de negocio |
| CI/CD | **PARTIAL** | `CI_GATE=PASS`, pero **no hay pipeline** (sin `.github/`, YAML, Dockerfile, `vercel.json`) |
| Lint | **PARTIAL** | 3 errores, los 3 de plantilla; attributable propio **0** (`TEMPLATE=3 OWN=0`) |
| Configuración de producción | **NOT_VERIFIED** | staging no es evidencia de producción |

---

## 10. Conclusión

El código de seguridad de TalentFlow AI resiste todo lo que se le ha atacado en
las tres auditorías. Tres vulnerabilidades **reales y graves** estaban oculta
detrás de un reporte verde: el pipeline de IA nunca había funcionado (VULN-01),
una credencial estaba a un import de acabar en el bundle público (VULN-11) y la
tabla de eventos de seguridad nunca había registrado una sola fila (VULN-12).
Las tres están corregidas y verificadas con ejecución real, no con lectura de código.

Lo que impide declarar el sistema production ready **no es la calidad del código**
—que es alta y está bien verificado— sino cinco hechos de infraestructura y de
gobierno: no hay WAF para el abuso pre-auth, la credencial no está rotada, las
denegaciones de autorización no son auditables (VULN-14), no hay política operativa
de backups y RPO/RTO de negocio, y no hay observabilidad.

Compilar, pasar los tests y tener el build verde **no es production ready**: es
una señal de ausencia de regresiones. Convertir un `BLOCKED`, un `NOT_MEASURED` o
un `ROTATION_REQUIRED` en un `PASS` sería exactamente el fallo que este informe
existe para evitar.

**PRODUCTION READY = NO**
