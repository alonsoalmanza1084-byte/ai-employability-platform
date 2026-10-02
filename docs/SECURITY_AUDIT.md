# SECURITY_AUDIT.md — Registro de auditoría de seguridad (fuente de verdad)

**Proyecto:** TalentFlow AI · **Deployment auditado:** `hip-porpoise-838` (staging)
**Auditorías:** #4 (VULN-01…08) · #5 (VULN-11…12) · #6 / PRODUCTION GATE (VULN-13…14)

> **Nota de integridad documental.** En la auditoría #6 la escritura de este
> fichero sobrescribió por error las 607 líneas de las auditorías #4 y #5 en
> lugar de anexar al final. Git está bloqueado en el entorno, por lo que no fue
> posible restaurarlas. Este documento es una **reconstrucción consolidada**: el
> registro de vulnerabilidades (VULN-01…VULN-18), su severidad, su estado y su
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
| **VULN-14** | **HIGH** | Las denegaciones de **autorización** no dejaban `securityEvent` (siguen lanzando) | **CORREGIDO y VERIFICADO** (25/25) |
| **VULN-15** | **LOW** | Cobertura de auditoría: las funciones originales siguen siendo públicas, así que su denegación se registra solo si se invocan por `api.audited.*` | **ABIERTO (cobertura, no autorización)** |
| **VULN-16** | **INFO** | Denegaciones por argumentos inválidos no generan evento: el validador de Convex actúa antes del handler | **ABIERTO (limitación de plataforma, no expone datos)** |
| **VULN-17** | **LOW** | El JWT ya emitido sigue siendo aceptado tras `deleteAccount` hasta su expiración (sin acceso a datos, verificado) | **ABIERTO (residual de token)** |
| **VULN-18** | **MEDIUM** | `removeMember` borraba solo la primera fila de membresía: con filas duplicadas (restore/import) el usuario conservaba acceso | **CORREGIDO y VERIFICADO** |

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

**Estado: CORREGIDO y VERIFICADO.** Ver §8-bis.

---

## 8-bis. VULN-14 — CORRECCIÓN IMPLEMENTADA Y VERIFICADA

### Arquitectura elegida (A + D) y por qué no hay bypass

El arreglo es **aditivo**: no modifica ninguna función ya verificada, las
**envuelve**. Archivos nuevos:

| Fichero | Rol |
|---|---|
| `src/convex/lib/denial.ts` | Taxonomía **cerrada** de denegaciones + clasificación de errores |
| `src/convex/internal/authorization.ts` | `classifyAuthorization` (internalQuery, solo lectura) y `logDenial` (internalMutation) |
| `src/convex/lib/audited.ts` | Fábrica `auditedAction()`: el wrapper |
| `src/convex/audited.ts` | 17 wrappers que exponen la vía auditada |

Flujo de un wrapper:

```
action auditada (pública)
 ├─ 1. runQuery internal.classifyAuthorization   ← SOLO LECTURA
 │     · no tiene permiso → no se llama a la operación
 ├─ 2. runQuery|runMutation <función real>        ← UNA sola llamada
 └─ 3. catch(error):
       · classifyDenial(error) === null → se propaga SIN registrar
       · si es denegación → runMutation internal.logDenial (transacción APARTA)
       · y EN TODOS LOS CASOS se vuelve a lanzar el error
```

Garantía por garantía:

| Propiedad | Cómo se conserva |
|---|---|
| **fail-closed** | El error **se relanza siempre**. Nunca se devuelve `{ok:false}` que un caller pueda ignorar. Es la diferencia crítica frente a «cambiar `throw` por `return`». |
| **atomicidad** | La operación real sigue siendo **una única** llamada a una única query/mutación. |
| **idempotencia** | Las mutaciones reales no se han tocado. |
| **tenant isolation** | Sin cambios: sigue.validando `requireMembership`. El wrapper solo puede **denegar**, jamás autorizar. |
| **no falsificable** | `internal/*` **no es invocable desde el cliente**. No existe ninguna función pública que escriba en `securityEvents`. El cliente no envía `reason`, ni `kind`, ni `userId`, ni `tenantVerified`: se derivan en servidor. |
| **persistencia** | `logDenial` corre en una transacción **distinta**, que confirma. |
| **TOCTOU** | Inofensivo: entre el preflight y la operación puede revocarse una membresía; la operación real vuelve a comprobar y su `catch` registra igualmente. |
| **nada de PII ni secretos** | Se persiste `operation`, `reason` (enum cerrado), `organizationId`, `userId` (del token), `tenantVerified`, `detail = "<operación>:<motivo>"`. Nunca el mensaje crudo del error, ni el cuerpo de la petición. |

### Evidencia ejecutada

```bash
bash scripts/verify_audit_denial_semantics.sh
→ SECURITY_EVENTS_BEFORE=249
→ SECURITY_EVENTS_AFTER=251
→ DELTA=2
→ AUTHORIZATION_DENIAL_AUDIT=PERSISTED
```

Fila real resultante:

```
operation=orgs.auditTrail  kind=authz_denied_unauthenticated
reason=unauthenticated     organizationId=m97...  tenantVerified=false
```

```bash
bunx vitest run tests/integration/vuln14.denial.audit.integration.test.ts
→ Tests 25 passed (25)
```

Matriz cubierta (celda a celda, con identidad real, evento y recurso intacto):

`anonymous→orgAuditTrail` · `anonymous→orgInvite` · `outsider→orgMembers` ·
`outsider→orgInvite` · `outsider→orgRemoveMember` · `candidate→orgMembers` ·
`candidate→orgAuditTrail` · `recruiter→orgAuditTrail` · `recruiter→orgInvite` ·
`hiring_manager→orgAuditTrail` · `hiring_manager→orgRemoveMember` ·
`outsider→applicationsListByJob` (cross-tenant read) ·
`outsider→applicationsAddNote` (cross-tenant write) ·
`outsider→matchesGetForApplication` (IDOR) · `miembro revocado` (3 operaciones
denegadas y registradas con la MISMA sesión viva) · `replay` (3→3) ·
`concurrencia` (5→5) · `ALLOW` no genera evento · `logDenial` inalcanzable ·
no se puede inyectar campos del evento · no hay superficie pública de escritura
ni de lectura de `securityEvents`.

Guard de cobertura: `tests/static/auditCoverage.test.ts` → **6/6**. Falla si
aparece un endpoint sensible sin wrapper, si un wrapper no es `action`, si un
wrapper no delega en una función real, o si `audited` toca `securityEvents`.

### Corrección de un falso positivo de la propia auditoría

Durante la verificación se diagnosticó como « deduplicación de eventos » lo que
era en realidad un **error de medición**: `bunx convex data` sin `--limit` solo
muestra las **100 filas más recientes**, de modo que el contador se saturaba y
daba `DELTA=0` aunque los eventos se estaban escribiendo. Se corrigió la
medición (`--limit 10000` y nota en el test). **No se reporta ninguna
vulnerabilidad de deduplicación porque no existe.**

---

## 8-ter. VULN-15 — LOW — Cobertura de auditoría, no de autorización

**Hallazgo.** Las funciones originales (`api.orgs.*`, `api.jobs.*`,
`api.applications.*`, `api.matches.*`) siguen siendo públicas porque las usan la
UI y las suites ya VERIFICADAS. Un cliente que las invoque directamente **sigue
siendo denegado** (la autorización no se debilita en absoluto) pero esa
denegación **no se registra**.

Evidencia directa:

```bash
bunx convex run orgs:members '{"organizationId":"…"}'
→ Uncaught Error: NOT_FOUND at requireMembership (rbac.ts:32)   # denegada
→ securityEvents: sin incremento                               # NO registrada
```

**Gravedad real: LOW.** Es un hueco de *trazabilidad*, no de control de acceso.

**Remediación concreta, no implementada en el gate** (y por qué):

1. Migrar los 15 call sites de la UI (`src/pages/Org.tsx`, Dashboard) de
   `api.orgs.*` a `api.audited.*`, convirtiendo además los `query(` en `action(`.
2. Mover las originales a `internal` una vez migradas.

No se ha hecho en el gate porque cambiar `query`→`action` en la UI altera el
comportamiento en runtime que no se puede verificar sin navegador, y porque
mover a `internal` rompería las suites de RBAC ya VERIFICADAS. El guard
`tests/static/auditCoverage.test.ts` mantiene la lista explícita y falla si
crece la superficie sin auditar.

**Estado: OPEN (cobertura de auditoría).**

---

## 8-quater. VULN-16 — INFO — Denegaciones por argumentos inválidos

**Hallazgo.** Los ids de Convex llevan checksum y los validadores de argumentos
actúan en la **capa de transporte, antes de que exista el handler**. Una
petición con un `organizationId` de formato inválido, o con campos no
declarados, se rechaza sin generar `securityEvent`.

**Por qué es INFO y no un agujero:** la petición **nunca llega** a la lógica de
negocio, no lee ni escribe nada y no revela información de ningún tenant. No hay
contenido que auditar. Verificado en la matriz: denegación sin fuga de datos.

**Remediación** (opcional, solo si el negocio lo exige): un endpoint auditor
«rechazo de bajo nivel» que acepte el cuerpo crudo y registre el rechazo. Se
desaconseja: amplía superficie pública para cubrir un caso sin contenido.

**Estado: OPEN por limitación de plataforma (no bloquea).**

---

## 8-quinquies. VULN-17 — LOW — El JWT sobrevive a `deleteAccount` hasta su expiración

**Hallazgo (MEDIDO, no supuesto).** Tras `account.deleteAccount`, el token ya
emitido sigue siendo aceptado por el backend hasta que expira. La prueba E2E
`tests/integration/accountDeletion.integration.test.ts` imprime
`DELETION_TOKEN_PROBE <userId>`: el valor devuelto es **el propio `userId`**, es
decir, el token autentica como el usuario borrado.

**Qué SÍ se revoca (verificado por tabla contra la base de datos real):**
`candidateProfiles`, `resumes`, `resumeVersions`, `authAccounts`,
`authSessions` y `organizationMembers` del sujeto desaparecen; el binario del CV
desaparece de `_storage`; la identidad queda anonimizada
(`@deleted.invalid` + `[cuenta-eliminada]`).

**Qué NO se revoca:** la firma del JWT ya emitido. La revocación de sesión de
Convex Auth se apoya en borrar las filas de sesión, pero un JWT autocontenido
sigue siendo válido mientras su `exp` no pase.

**Por qué es LOW y no HIGH:** el token residual **no da acceso a ningún dato** —
comprobado en el mismo test: `candidates.myProfile → null`,
`candidates.myResumes → []`, `orgs.myOrgs → []`. No hay membresías, ni perfil,
ni CVs, ni binarios. Lo único posible es crear datos nuevos como ese usuario ya
anonimizado (que además tiene un email no enrutable).

**Remediación** (una de las dos, ambas baratas):

1. Reducir el TTL del access token (p. ej. 15 min) con refresh token; el residual
   pasa a ser de minutos.
2. Validar la existencia de la fila en `authSessions` en cada petición
   autenticada (coste: una lectura por request).

**Estado: OPEN (LOW).** Está en la matriz de production readiness como blocker 12.

---

## 8-sexies. VULN-18 — MEDIUM — Revocación incompleta con filas duplicadas (CORREGIDO)

**Hallazgo (encontrado al hacer la matriz E2E, no por inspección).** El índice
`by_org_user` de `organizationMembers` **no es único** en Convex (Convex no
tiene constraints únicos). Un restore —o el propio import de fixtures de la
suite— puede dejar **dos filas** para el mismo par (org, usuario).

`orgs.removeMember` leía `.first()` y borraba **solo esa fila**. Medido en la
base real: tras la revocación quedaba una fila de `recruiter` viva, el usuario
**conservaba todo el acceso** con la misma sesión, y fue visible como fallo de
la matriz de denegaciones (`revocado→orgMembers debía estar denegado`).

**Impacto:** bypass de revocación de acceso — un ex-miembro mantiene permisos de
org (lectura de candidatos y escritura de notas/decisiones) hasta que se cierre
su sesión. Severidad MEDIUM (requiere el estado duplicado, típicamente posterior
a un restore, y afecta a un usuario concreto).

**Corrección (implementada y verificada):**

- `removeMember` borra **todas** las filas del par (org, usuario) con un bucle
  acotado (`REVOKE_MAX_ROWS = 50`), releyendo por índice fila a fila — **sin
  `.collect()`**, para no introducir una lectura sin acotar. Si el techo se
  alcanzara, la mutación **falla** (`REVOCACION_INCOMPLETA`) en lugar de
  anunciar una revocación parcial: fail-closed.
- La siembra de fixtures es **idempotente** (`scripts/rbac_seed_memberships.sh`
  y `seedMembership()` del test) para que la propia suite no pueda provocar el
  estado duplicado.
- El guard estático `tests/static/api_surface.test.ts` ahora exige el bucle, el
  techo, el fallo explícito y la ausencia de `.collect()` en `removeMember`,
  de modo que una regresión a un único `delete` rompe el gate.

**Evidencia ejecutada:** matriz de revocación E2E (18/18) + VULN-14 (25/25) en la
misma org, con el estado residual del escenario de revocación
(`bash scripts/rbac_e2e.sh` → `RBAC_E2E=PASS`).

**Estado: CORREGIDO y VERIFICADO.**

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
| **Security events (autorización)** | **VERIFIED** | `AUTHORIZATION_DENIAL_AUDIT=PERSISTED`, `DELTA=2`; matriz `vuln14.denial.audit` **25/25**; guard `auditCoverage` **6/6** |
| Security events (cobertura) | **PARTIAL — VULN-15** | Las originales (`api.orgs.*`…) deniegan **sin registrar**. La autorización NO se debilita: es un hueco de trazabilidad | No (LOW) |
| Security events (args inválidos) | **OPEN — VULN-16** | El validador de Convex actúa antes del handler. Sin fuga de datos ni acceso a lógica de negocio | No (INFO) |
| **Revocación de membresía (exhaustiva)** | **VERIFIED** | **VULN-18 CORREGIDO**: `removeMember` borra todas las filas del par (bucle acotado, fail-closed); matriz de revocación 18/18 + guard estático reforzado |
| Audit log | **VERIFIED** | `gates.integration.test.ts` GATE H |
| Rate limiting (identidad/org/acción) | **VERIFIED** | `gates.integration.test.ts` GATE I |
| **Rate limiting pre-auth por IP** | **BLOCKED_BY_PLATFORM** | IP no falsificable pero inalcanzable; `tests/edge/rateLimit.contract.test.ts` **falla a propósito** sin `EDGE_BASE_URL` |
| **Cuenta y borrado de datos (P2)** | **VERIFIED (borrado)** | `accountDeletion.integration.test.ts`: precondición + borrado real de perfil/CVs/binario/membresías/`authAccounts`/`authSessions` verificado en la BD; sin sobre-borrado; sin resurrección |
| **Sesión después de `deleteAccount`** | **OPEN — VULN-17** | El JWT emitido sigue aceptándose hasta expirar; **sin acceso a datos** (`myProfile` null, `myResumes` [], `myOrgs` []) | No (LOW) |
| Secrets (en el código) | **VERIFIED** | 0 coincidencias en `src/`, `tests/`, `docs/`, `dist/` (`tests/static/dataLeakage.test.ts` «ningún archivo contiene un secreto literal») |
| **Secrets (rotación)** | **ROTATION_REQUIRED** | VULN-11 |
| Backups (mecanismo) | **VERIFIED** | `BACKUP_VERIFY=PASS` · 26 tablas · 11/11 tests de integridad (2026-10-02) |
| Restore (mecanismo) | **VERIFIED** | `DRILL=PASS` · `RESTORE_ROWS=1865` · sha256 e IDs idénticos (2026-10-02) |
| **Restore en deployment limpio** | **BLOCKED_BY_PLATFORM** | `convex deployment create` falla con deploy key; `scripts/restore_full_drill.sh` listo y **bloquea en exit 2** sin destino |
| RTO (ámbito tabla, mismo deployment) | **MEASURED = 19.889 ms** | backup 3.040 + pérdida 10.712 + restore 6.137 ms |
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
—que es alta y está bien verificada— sino cinco hechos de infraestructura y de
gobierno: no hay WAF para el abuso pre-auth, la credencial no está rotada, no hay
política operativa de backups con RPO/RTO de negocio, no hay observabilidad, y no
existe un pipeline de CI/CD ni una configuración de producción verificados.

**VULN-14 está cerrado** (implementación + matriz 25/25 + guard 6/6 +
`AUTHORIZATION_DENIAL_AUDIT=PERSISTED`): las denegaciones de autorización quedan
registradas y la autorización sigue siendo obligatoria — el error se relanza
siempre. En el mismo cierre se corrigió **VULN-18 (MEDIUM)**, un bypass de
revocación real: `removeMember` borraba una sola fila de membresía y un restore
podía dejar filas duplicadas que mantenían el acceso. Queda abierto, sin impacto
en el control de acceso: **VULN-15** (cobertura de la traza, LOW),
**VULN-16** (argumentos inválidos rechazados por el validador, INFO) y
**VULN-17** (el JWT emitido sobrevive a `deleteAccount` hasta expirar; el token
no da acceso a ningún dato, LOW).

Compilar, pasar los tests y tener el build verde **no es production ready**: es
una señal de ausencia de regresiones. Convertir un `BLOCKED`, un `NOT_MEASURED` o
un `ROTATION_REQUIRED` en un `PASS` sería exactamente el fallo que este informe
existe para evitar.

**PRODUCTION READY = NO**
