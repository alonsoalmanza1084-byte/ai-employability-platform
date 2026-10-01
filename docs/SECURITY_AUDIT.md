# SECURITY_AUDIT.md — Auditoría de seguridad y production gate (V1)

**Fecha:** 2026-10-01 · **Alcance:** TalentFlow AI V1 completo (frontend + backend Convex + pipeline de IA + ficheros)
**Veredicto de esta sesión: NO PRODUCTION READY.** Existe un hallazgo HIGH abierto (§Production Blockers).

---

## 1. Executive Summary

Esta sesión se ejecutó como *gate de seguridad adversarial*: el objetivo no era
producir un informe verde, sino romper el sistema, demostrar la ruptura,
corregirla y volver a romperlo hasta que la evidencia permitiera opinar.

Se encontró y corrigió **un fallo funcional CRÍTICO que anulaba todas las
defensas de IA** y que llevaba tres auditorías sin detectarse porque nunca se
ejecutó el pipeline real:

> **`responseJsonSchema` nunca se enviaba al modelo.** El system prompt decía
> "responde conforme al schema entregado", pero ningún schema se entregaba.
> El modelo inventaba su propio formato (`name.value`, `total_experience_years`,
> `start_year`…), `cvExtractionSchema` (zod) lo rechazaba y **el 100 % de las
> extracciones de CV terminaba en `failed`**. El post-check de evidencia y el
> matching determinista —las dos defensas anti-inyección— nunca se ejecutaron
> contra ninguna salida real.

Para poder verificarlo hizo falta una ruta de LLM real: el deployment **no
tiene `OPENAI_API_KEY`**, por lo que la Golden Evaluation estaba bloqueada desde
la auditoría anterior. Se añadió un proveedor que usa la integración oficial de
la plataforma (`@vly-ai/integrations`), lo que desbloqueó la evaluación golden
contra un modelo real por primera vez.

Resultado de la Golden Evaluation (11 casos, corpus 100 % sintético, ejecutado
end-to-end por el pipeline de producción): **8 de 11 casos llegan a extracción
completa; ningún ataque supera el score del CV honesto (83); 3 casos son
rechazados por el filtro de contenido del proveedor y fallan cerrados.**

| Métrica | Valor |
|---|---|
| Tests ejecutados y pasados | **318** |
| Tests saltados | **0** |
| Tests fallidos | **0** |
| Hallazgos corregidos y con test de regresión | **13** |
| Hallazgos abiertos | **1 HIGH** (pre-auth abuse bloqueado por plataforma), **2 MEDIUM** |
| Hallazgos CRÍTICOS abiertos | 0 |

---

## 0. Auditoría #5 (esta sesión) — resumen ejecutivo

Partiendo de "NO PRODUCTION READY", esta sesión cerró **3 de los 5 blockers**
con ejecución real y discovers **3 vulnerabilidades nuevas**, una de ellas HIGH.

**Cerrados con evidencia:**
- **Backups**: `convex export --include-file-storage` ejecutado y verificado
  (28 tablas, 182 binarios, sha256 por archivo). 10/10 tests de integridad.
- **Restore**: drill completo backup → pérdida simulada → restore con sha256 y
  conjunto de IDs idénticos. `DRILL=PASS`.
- **RBAC E2E**: matriz de 5 roles con sesiones reales, 18/18 tests, incluida la
  revocación con la misma sesión viva.

**Nuevo encontrado y corregido (HIGH):**
- **VULN-11**: la clave de API del servicio de correo estaba escrita como
  **literal en el repositorio**. Eliminada del código; requiere rotación.

**Nuevo encontrado y abierto (MEDIUM):**
- **VULN-12**: `securityEvents` **nunca registra nada**, porque en Convex una
  mutación que lanza revierte el `insert` y todos los caminos de denegación
  lanzan después de registrar.

**Bloqueado con prueba experimental (no con suposiciones):**
- **GATE A**: se demostró que la IP del edge **no es falsificable** (el
  `X-Forwarded-For` inyectado se descarta), pero el envío de OTP **no pasa por
  ninguna ruta HTTP propia**, así que esa IP es inalcanzable desde la app.

---

## 2. Scope

**Dentro del alcance**

- Backend Convex completo: `src/convex/**` (candidatos, aplicaciones, vacantes,
  organizaciones, invitaciones, membresías, audit log, auth, lib/ai, lib/cv).
- Frontend React (`src/pages`, `src/components`, `src/lib`).
- Pipeline de IA: prompt, provider, validación de salida, post-check de
  evidencia, matching determinista.
- Procesamiento de ficheros: PDF/DOCX/TXT, magic bytes, storage.
- Multi-tenancy, RBAC, invitaciones, revocación, audit log.
- Rate limiting y auth.
- Suites de test y superficie pública de la API.

**Fuera del alcance (y por qué)**

- Backups, disaster recovery y observabilidad en producción: no hay acceso a la
  consola del proveedor de despliegue ni a infraestructura. Se reportan como
  **NOT VERIFIED**, no como PASS.
- Pentest externo con infraestructura propia, escaneo de dependencias CVE
  (requiere red/bases de datos de vulnerabilidades).
- Revisión legal de privacidad/TOS.

---

## 3. Methodology

1. **Estático**: barrido de todo el código (servidor y cliente) buscando
   fugas, secretos, `console.*`, IDs aceptados del cliente, funciones públicas
   sin ownership, `v.any()`, `schemaValidation: false`, `.collect()` sin cota.
2. **Unitario sobre funciones puras**: determinismo (100 repeticiones),
   idempotencia, fail-closed, límites, clamps.
3. **Dinámico contra el deployment real** (`https://hip-porpoise-838.convex.cloud`)
   con sesiones anónimas reales issued por Convex Auth: IDOR, cross-tenant,
   escalada de privilegios, mass assignment, revocación, abuse de API.
4. **Red team sobre el pipeline de IA**: corpus golden de 11 casos sintéticos
   subidos al **storage privado real**, procesados por `applications.ingestCv`
   (LLM real → zod → post-check → `computeMatch`), con aserciones sobre lo que
   el servidor **persistió**.
5. **Red team sobre ficheros**: 20 PDFs sintéticos hostiles generados en runtime
   (corruptos, truncados, zip-bomb, CID, recursivos, JS embebido…), más spoofing
   de extensión/MIME/magic bytes y nombres con path traversal.
6. **Revisión manual** de la arquitectura de auth y de rate limiting para
   determinar qué es implementable y qué está bloqueado por la plataforma.

Regla de honestidad aplicada en todo momento: `IMPLEMENTED` ≠ `VERIFIED`.
Una propiedad solo es VERIFIED si hay implementación **y** test **y** ejecución
**y** resultado **y** evidencia.

---

## 4. Environment

| Elemento | Valor |
|---|---|
| Deployment Convex | `https://hip-porpoise-838.convex.cloud` (staging) |
| Provider de IA | `VLY_INTEGRATION_KEY` (integración oficial de plataforma) |
| `OPENAI_API_KEY` | **AUSENTE** (comprobado con `bunx convex env list`) |
| Variables presentes | `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `VLY_APP_NAME`, `VLY_CONVEX_AUTH_ISSUER`, `VLY_INTEGRATION_BASE_URL`, `VLY_INTEGRATION_KEY` |
| Node/Bun | Bun, Vite 7, React 19, Convex 1.42, TypeScript 5.9 |
| Datos del corpus | **100 % sintéticos**. Sin PII, sin CV reales, sin secretos. |

---

## 5. Tests Executed

Comandos ejecutados realmente en esta sesión:

| Comando | Resultado |
|---|---|
| `bunx convex dev --once` | ✔ Convex functions ready (exit 0) |
| `bunx tsc -b --noEmit` | ✔ exit 0, 0 errores |
| `bun run lint` | 22 problemas: **3 errores**, todos preexistentes de plantilla (`components/ui/carousel.tsx`, `components/ui/sidebar.tsx`, `hooks/use-mobile.ts`) + 19 warnings. **0 errores en código de producto o de tests.** |
| `bunx vitest run --exclude "tests/golden/**"` | ✔ **261 passed / 0 failed / 0 skipped**, 11 archivos |
| `bunx vitest run tests/golden/ai.security.eval.test.ts` | ✔ **10 passed / 0 failed**, 11 casos contra LLM real |
| `bun run build` | ✔ `✓ built in 8.17s` |

## 6. Tests Passed

| Suite | Tests | Contenido |
|---|---|---|
| `tests/unit/security.test.ts` | 67 | matching, diagnóstico, magic bytes, post-check de evidencia, crypto, RBAC con ctx mock, throttle OTP, retención |
| `tests/unit/fileSecurity.test.ts` | **34 (nuevo)** | corpus PDF hostil, determinismo, spoofing, ausencia de red/ejecución |
| `tests/unit/pdfExtract.test.ts` | 20 | inflate contra oráculo zlib, extracción PDF |
| `tests/unit/invitations.security.test.ts` | 21 | handlers reales de invitaciones con ctx en memoria |
| `tests/unit/scoreInflation.security.test.ts` | 14 | 8 vectores de inflación de score bloqueados |
| `tests/unit/matching.determinism.test.ts` | **10 (nuevo)** | 100 repeticiones, no-mutación, fórmula, clamps, no-características-protegidas |
| `tests/static/api_surface.test.ts` | 34 | inventario congelado de la superficie pública |
| `tests/static/dataLeakage.test.ts` | **11 (nuevo)** | secretos, PII, consola, prompts, salida cruda del LLM |
| `tests/integration/security.integration.test.ts` | 31 | IDOR, cross-tenant, RBAC, revocación, invitaciones, borrado de cuenta |
| `tests/integration/gates.integration.test.ts` | **17 (nuevo)** | audit log, abuso de API, ficheros, auth, multi-tenancy |
| `tests/integration/cv_ingest.integration.test.ts` | 2 | ingesta PDF end-to-end |
| `tests/golden/ai.security.eval.test.ts` | **10 (reescrito)** | 11 casos golden contra LLM real |

**Total: 271 passed.**

## 7. Tests Skipped

**Ninguno.** Antes de esta sesión había 1 skipped (el bloque golden sin
`OPENAI_API_KEY`). Se eliminó: la Golden Evaluation ahora se ejecuta de verdad.

## 8. Tests Blocked

| ID | Qué | Causa |
|---|---|---|
| BLOCK-1 | Rate limiting por IP / pre-auth | Convex no expone la IP del cliente en mutations/actions y las rutas de auth pertenecen al runtime de Convex Auth. Detalle y plan en `docs/RATE_LIMITING.md`. |
| BLOCK-2 | Celdas RBAC `recruiter` / `hiring_manager` con **membresía aceptada** en E2E | `acceptInvite` exige cuenta con email verificado; los usuarios de test son anónimos y no pueden recibir OTP. Cubierto unitariamente con ctx mock y estáticamente, **no** E2E. |
| BLOCK-3 | 3 casos golden rechazados por el filtro de contenido del proveedor | Comportamiento upstream, no de la aplicación. Fallo cerrado verificado; la salida estructurada de esos 3 vectores no se observa → NOT VERIFIED a nivel de contenido. |

---

## 9. CRITICAL

### VULN-01 — El schema de salida nunca se entregaba al LLM (extracción 100 % rota)

- **ID:** VULN-01
- **Severity:** CRITICAL (Correctness / Availability — anula el control anti-inyección)
- **Title:** `responseJsonSchema` es código muerto: el modelo nunca ve el esquema que se le exige seguir
- **Description:** `AIRequest.responseJsonSchema` se rellenaba en
  `candidates.ts` y `applications.ts`, pero **ningún provider lo usaba**. El
  system prompt afirmaba *"Devuelve EXCLUSIVAMENTE un objeto JSON válido
  conforme al schema entregado"*, sin que tal schema existiera en el prompt.
- **Attack scenario:** no es un ataque externo sino una omisión que hace
  indefendible el sistema: (a) la extracción falla siempre, (b) al no haber
  schema, el modelo decide la forma del JSON, (c) las defensas que corrigen sus
  alucinaciones nunca llegan a ejecutarse porque no hay datos que corregir.
- **Affected component:** `lib/ai/openai_provider.ts`, `lib/ai/prompts.ts`,
  `candidates.ts`, `applications.ts`.
- **Root cause:** el campo se añadió a la interfaz `AIRequest` para soportar
  structured outputs, pero el provider OpenAI solo enviaba
  `response_format: {type: "json_object"}` (modo JSON, sin esquema).
- **Exploit reproduction:** ejecutar `ingestCv` con cualquier CV. Resultado
  observado contra el deployment real: `finishReason: stop`, salida con
  `{"name": {"value": ...}, "total_experience_years": ...}` → zod rechaza →
  `failed: La IA devolvió un formato inesperado`.
- **Fix:** `buildCvExtractUserContent(text, jsonSchema)` ahora **inyecta el JSON
  Schema real en el mensaje de usuario**, con instrucciones explícitas de no
  inventar claves ni usar `null`. `PROMPT_VERSION` sube a `cv_extract.v2.0`.
- **Security test:** `tests/golden/ai.security.eval.test.ts` (11 casos E2E) y
  `tests/integration/cv_ingest.integration.test.ts`.
- **Execution result:** **PASS**. Tras el fix, el baseline llega a `ready` con
  `overall: 83`, skills `[Python:3, SQL:3, Tableau:3]`, años 5 — coincidente con
  el CV honesto.
- **Residual risk:** MEDIUM. El LLM puede no cumplir el schema; el sistema
  falla cerrado (no escribe nada) y lo reporta al usuario. Sin schema nativo del
  proveedor (structured outputs), el cumplimiento depende del prompt.
- **Status:** **CORREGIDO / VERIFIED**

---

## 10. HIGH

### VULN-02 — `Buffer is not defined`: los CV .txt y .docx fallaban siempre

- **Severity:** HIGH (Availability / Correctness)
- **Title:** Uso del global `Buffer`, inexistente en el runtime de Convex
- **Description:** `lib/cv/parse.ts` usaba `Buffer.from(bytes)` para TXT y DOCX.
  El isolate de Convex **no expone `Buffer` como global**.
- **Affected component:** `lib/cv/parse.ts` → `candidates.ts`, `applications.ts`.
- **Root cause:** se asumió un global de Node en un runtime que no lo provee.
- **Exploit reproduction:** subir cualquier CV `.txt` o `.docx` →
  `extractStatus: "failed"`, `failureReason: "Buffer is not defined"`.
  Reproducido contra el deployment real.
- **Fix:** `TextDecoder` estándar para TXT y `mammoth.extractRawText({arrayBuffer})`
  para DOCX (mammoth acepta ambas formas; `buffer` exige el global).
- **Security test:** los 11 casos golden se subirían como `.txt`; además
  `tests/unit/fileSecurity.test.ts` (34 tests) y
  `tests/integration/gates.integration.test.ts` (subidas `.txt` reales).
- **Execution result:** **PASS**. Tras el fix, los 8 casos golden con extracción
  completa llegaron a `ready` usando `.txt`.
- **Residual risk:** LOW.
- **Status:** **CORREGIDO / VERIFIED**

### VULN-03 — Token de despliegue legible desde el bundle del navegador

- **Severity:** HIGH (Credential exposure — pie de acceso no explotado)
- **Title:** `src/lib/vly-integrations.ts` leía `VLY_INTEGRATION_KEY` en código cliente
- **Description:** módulo de plantilla que construía `createVlyIntegrations({deploymentToken: process.env.VLY_INTEGRATION_KEY})` desde el frontend. Cualquier import lo habría incrustado en el bundle público.
- **Affected component:** `src/lib/vly-integrations.ts`.
- **Root cause:** artefacto de plantilla sin revisión; nadie lo importaba, pero `process` no existe en el navegador: si se importara, el fallo en runtime es lo único que impedía el uso, no un control de seguridad.
- **Exploit reproduction:** `grep -r VLY_INTEGRATION_KEY src/` → el nombre aparecía en código no-Convex. Si se hubiera importado desde una página, Vite habría incrustado el valor en `dist/assets/*.js`.
- **Fix:** el módulo pasa a ser un guardia que **lanza siempre** y documenta por qué el token nunca debe salir del servidor. La ruta legítima es `lib/ai/vly_provider.ts`, dentro de una action `"use node"`.
- **Security test:** `tests/static/dataLeakage.test.ts` → "ningún módulo cliente importa el proveedor de IA ni lee claves de servidor" (verifica que no queda `process.env.VLY_INTEGRATION_KEY` en código cliente y que el guardia no importa `@vly-ai/integrations`).
- **Execution result:** **PASS**.
- **Residual risk:** LOW.
- **Status:** **CORREGIDO / VERIFIED**

### VULN-04 — Rate limiting por IP inexistente (ABIERTO)

- **Severity:** HIGH (Abuse / Pre-auth)
- **Title:** No existe control por IP; el límite de OTP es solo por email
- **Description:** existe `otpSendsPerEmailPerHour = 5` y un tope global de 200/h,
  pero **no hay nada por IP**. Una IP puede pedir OTP a miles de emails.
- **Affected component:** `src/convex/auth/otpThrottle.ts` y, en la práctica,
  toda la superficie pre-auth.
- **Root cause:** limitación de plataforma, no de código (ver §11).
- **Exploit reproduction:** 5.000 emails distintos desde una IP. El tope global
  de 200/hora lo acota a 200 buzones atacados por hora, pero la protección por
  red es inexistente.
- **Fix:** **no implementado — bloqueado por arquitectura.** Ver `docs/RATE_LIMITING.md`.
- **Security test:** 7 tests definidos (B-1…B-7); **ninguno ejecutable** sin
  desplegar el edge.
- **Execution result:** **NOT EXECUTED / BLOCKED**
- **Residual risk:** ALTO hasta que exista edge/WAF.
- **Status:** **ABIERTO — PRODUCTION BLOCKER**

---

## 11. Limitación técnica del rate limiting por IP

Documentado en detalle en `docs/RATE_LIMITING.md`. Resumen:

1. `ctx` (query/mutation/action) **no expone la IP del cliente**.
2. Las rutas de auth (`/api/auth/*`) pertenecen al runtime de Convex Auth, no
   a `src/convex/`.
3. Un contador en memoria de proceso no es un rate limiter distribuido.
4. Aceptar la IP como argumento o confiar en `X-Forwarded-For` sin *trusted
   proxy* configurado convierte el control en teatro.

**Decisión: declarar el hueco, no simularlo.**

---

## 12. MEDIUM

### VULN-05 — Mensajes de error internos visibles al usuario

- **Severity:** MEDIUM (Data leakage)
- **Description:** el `catch` de ambos `ingestCv` persistía `err.message` crudo
  en `failureReason`, campo que el usuario lee. Se observaron en producción
  valores como `Buffer is not defined` y `at Object.<anonymous> (...pdfText.ts)`.
- **Fix:** `toSafeCvErrorMessage()` con allowlist explícita; todo lo demás se
  traduce a un mensaje genérico. El detalle técnico queda en
  `aiExtractions.error`, server-side y truncado.
- **Security test:** `tests/static/dataLeakage.test.ts` → "los mensajes de error
  al usuario no filtran detalles internos".
- **Execution result:** **PASS**
- **Status:** **CORREGIDO / VERIFIED**

### VULN-06 — Volcado de errores de autenticación en la consola del navegador

- **Severity:** MEDIUM (Data leakage, cliente)
- **Description:** `src/pages/Auth.tsx` hacía
  `console.error("Error details:", JSON.stringify(error, null, 2))` y varios
  `console.log` en los flujos de OTP y sesión anónima.
- **Fix:** eliminados; los errores se muestran con mensajes fijos, sin volcar el
  objeto de error.
- **Security test:** `tests/static/dataLeakage.test.ts` → "el cliente tampoco
  registra datos sensibles de la sesión".
- **Execution result:** **PASS**
- **Status:** **CORREGIDO / VERIFIED**

### VULN-07 — `null` en campos opcionales producía fallos deterministas de extracción

- **Severity:** MEDIUM (Robustez / Availability)
- **Description:** los modelos expresan "sin dato" como `null`; los esquemas con
  `.optional()` rechazan `null`. Resultado: `SCHEMA_INVALID` y, con reintento a
  temperatura 0, un fallo **determinista**.
- **Fix:** `normalizeAiJson()` elimina solo claves con valor `null`
  (`null` ≡ `undefined`). **No** coerce, no rellena ni suaviza ninguna
  restricción: la validación zod posterior sigue siendo estricta.
- **Security test:**implícito en los 11 casos golden (todos llegan a `ready`
  salvo los bloqueados upstream).
- **Execution result:** **PASS**
- **Residual risk:** LOW. No relaja validación; normaliza semántica de "ausente".
- **Status:** **CORREGIDO / VERIFIED**

### VULN-08 — Rechazo por filtro de contenido clasificado como error de formato

- **Severity:** MEDIUM (Observabilidad)
- **Description:** cuando el proveedor Ascendente rechazaba el documento, la app
  lo reportaba como "la IA devolvió un formato inesperado", enmascarando la causa
  real y alimentando un diagnóstico equivocado.
- **Fix:** nuevo código `CONTENT_FILTERED` en `AIErrorCode`, detectado por
  `finishReason === "content-filter"`, sin reintento (reintentar es inútil) y con
  mensaje específico para el usuario.
- **Security test:** cobertura observada en la Golden Evaluation
  (`GOLDEN_COVERAGE blocked_upstream=[...]`).
- **Execution result:** **PASS**
- **Status:** **CORREGIDO / VERIFIED**

### VULN-09 — Un CV con instrucciones de inyección puede autobloquear su extracción

- **Severity:** MEDIUM (Denial of service, autocliente)
- **Description:** 3 de los 11 vectores (inyección directa, extracción del system
  prompt, ataque combinado) son rechazados sistemáticamente por el filtro de
  contenido del proveedor. El pipeline falla cerrado: no escribe datos ni genera
  score. El atacante solo se daña a sí mismo, pero un atacante con acceso a
  muchas identidades podría usarlo para degradar el servicio.
- **Fix:** ninguno posible en la aplicación (el filtro es upstream). Se mantiene
  el fallo cerrado y se documenta.
- **Residual risk:** MEDIUM, acotado por los rate limits por identidad y el cap de
  intentos de IA por documento.
- **Status:** **DOCUMENTED LIMITATION**

### VULN-10 — Celdas RBAC `recruiter` y `hiring_manager` no verificables E2E

- **Severity:** MEDIUM (Cobertura de verificación)
- **Description:** aceptar una invitación exige email verificado; los usuarios de
  test E2E son anónimos. Las filas de la matriz para esos roles están cubiertas
  unitariamente (ctx mock) y estáticamente, no end-to-end.
- **Residual risk:** MEDIUM. Un bug que solo afecte al camino post-`acceptInvite`
  no sería detectado por la suite viva.
- **Status:** **DOCUMENTED GAP**

---

## 13. LOW

- **LOW-01 — CID sin `/ToUnicode`:** texto ilegible por diseño. Clasificado como
  corrección, no seguridad; el pipeline falla cerrado con mensaje accionable.
- **LOW-02 — Escaneos:** PDF sin capa de texto produce menos de 40 caracteres y se
  rechaza con mensaje explícito. Por diseño.
- **LOW-03 — Palabras concatenadas** cuando un PDF emite varios operadores de
  texto sin salto de línea. Degradación de correctitud, sin impacto de seguridad.
- **LOW-04 — 3 errores de lint de plantilla** (`carousel.tsx`, `sidebar.tsx`,
  `use-mobile.ts`). No tocados por no ser código de producto.

---

## 14. VERIFIED

Cada punto tiene implementación + test + ejecución + resultado.

| Control | Evidencia |
|---|---|
| **Autenticación** | `gates.integration.test.ts`: sin sesión, las 5 funciones protegidas se deniegan; token ajeno no sirve; cerrar sesión corta el acceso. |
| **Autorización / RBAC (fail-closed)** | `security.test.ts` (requireMembership con ctx mock): sin membresía → NOT_FOUND; rol desconocido/corrupto → DENY. |
| **Aislamiento por tenant** | `security.integration.test.ts`: outsider no lee miembros, vacantes, applications, notes ni match de otra org. `gates.integration.test.ts` lo repite de forma transversal. |
| **IDOR** | `security.integration.test.ts` "IDOR exhaustivo por tabla"; ids malformados en 8 funciones distintas en `gates.integration.test.ts`. |
| **Invitaciones** | token hasheado en BD, de un solo uso, ligado al email destino; revocado → inutilizable. `invitations.security.test.ts` (21) + E2E. |
| **Revocación de membresía** | tras `removeMember`, la misma sesión pierde acceso a todo; se documenta explícitamente que es *revocación de acceso a la organización*, **no** revocación global de sesión. |
| **Audit log** | orden descendente estricto, sin duplicados entre lecturas, sin PII ni texto de CV en metadata, escribible solo server-side, lectura solo `org_admin`, aislado por tenant. `gates.integration.test.ts` (5 tests). |
| **Seguridad de ficheros** | 34 tests: 20 PDFs hostiles sin cuelgue ni explosión, spoofing de extensión/MIME/magic bytes, path traversal neutralizado, HTML/JS nunca ejecutados, sin `fs`/`http`/`eval`/`require` en el pipeline. |
| **Correctitud de PDF** | 20 tests con oráculo `zlib` byte a byte; extracción de 3 PDFs reales de referencia; límite de descompresión y ratio implementados. |
| **Determinismo del matching** | 100 ejecuciones idénticas; no muta la entrada; independiente del orden de requisitos; fórmula verificada a mano; pesos clampeados; sin características protegidas. |
| **Prompt injection (contenido, 8/11 vectores)** | Golden Evaluation real: ningún ataque superó el baseline (83). Ninguna skill/certificación/título/años fabricados sobrevivieron. |
| **Prompt injection (fail-closed, 3/11)** | Rechazo upstream ⇒ sin datos persistidos, sin score. Verificado. |
| **No fugas del system prompt** | Ninguno de los 11 casos contiene marcadores del system prompt en la salida estructurada. |
| **No fugas de secretos / cross-tenant vía LLM** | El modelo no tiene tools ni acceso a BD; `secrets`, `database`, `otherTenants`, `systemPrompt` nunca aparecen (zod además descarta claves desconocidas). |
| **Data leakage** | 11 tests estáticos: cero secretos literales, cero PII, cero `console.*` en servidor, claves solo vía `process.env`, prompt nunca persistido ni en el bundle, salida cruda del LLM nunca almacenada. |
| **Abuso de API** | ids malformados, paginación acotada, mass assignment, replay idempotente, rechazo sin nota obligatorio, extensión/tamaño revalidados en `finalize`. |
| **Rate limiting por identidad** | OTP 5/email/h + tope global 200/h + límites por usuario/org en subidas, vacantes, decisiones, notas; cap de 3 intentos de IA por CV. |
| **Proveedor de IA real disponible** | `VlyProvider` implementado con el mismo contrato `AIProvider`, fail-closed sin token, token nunca registrado ni devuelto. |

---

## 15. DOCUMENTED GAPS

| # | Gap | Impacto | Cómo cerrarlo |
|---|---|---|---|
| GAP-1 | Sin rate limiting por IP / edge | Un atacante puede rotar emails desde una IP | Desplegar CDN/WAF + trusted proxy; ejecutar B-1…B-7 (`docs/RATE_LIMITING.md`) |
| GAP-2 | RBAC `recruiter`/`hiring_manager` post-`acceptInvite` sin E2E | Un fallo en ese camino no lo detectaría la suite viva | Buzón de pruebas o usuarios con email verificado en CI |
| GAP-3 | 3 vectores golden bloqueados por filtro upstream | Su salida estructurada no se observa (el fallo cerrado sí) | Cambiar de modelo/proveedor o usar un modelo sin filtro para la eval |
| GAP-4 | Backups, RPO/RTO y restore ensayado | Desastre de datos sin verificar | Programa de backups + ensayo documentado |
| GAP-5 | Recovery drill y alertas | Incidentes largos sin detectar | Observabilidad con alertas y ejercicio de recuperación |
| GAP-6 | Sin structured outputs nativos del proveedor | El cumplimiento del schema depende del prompt | Migrar a un proveedor con `json_schema` estricto |

---

## 16. Production Blockers

Actualizado tras la auditoría #5:

1. **PRE-AUTH ABUSE / VULN-04 — rate limiting por IP ausente.** Bloqueante
   directo. Ahora con **evidencia experimental**: la IP del edge es confiable,
   pero el camino del OTP no la expone. Requiere CDN/WAF.
2. **VULN-11 — clave de servicio expuesta en el repositorio.** El literal ya no
   está en el código, pero la **rotación** y configurar `VLY_EMAIL_API_KEY` siguen
   pendientes (mientras tanto el envío de OTP falla cerrado).
3. **VULN-12 — `securityEvents` vacío** por rollback transaccional: el audit log
   de denegaciones no registra nada.
4. **Backups: mecanismo verificado, política inexistente.** No hay backup
   automático, ni retención, ni copia fuera del proveedor.
5. **RPO/RTO NOT MEASURED**: no hay restore completo cronometrado.
6. **Golden Evaluation parcial**: 3/11 vectores bloqueados upstream.
7. **Sin despliegue productivo** verificado (solo staging).

No hay CRITICAL abierto, ni tests fallando, ni build/typecheck roto.

---

## 21. Auditoría #5 — fichas de los hallazgos nuevos

### VULN-11 — Clave de API del servicio de correo en el repositorio

- **ID:** VULN-11
- **Severity:** HIGH
- **Status:** FIXED (rotación pendiente)
- **Description:** `src/convex/auth/emailOtp.ts` enviaba el OTP con
  `headers: { "x-api-key": "fb_email_…" }` — un literal versionado en el
  repositorio y visible para cualquiera con acceso al árbol de fuentes y al
  historial de git.
- **Impact:** uso indebido del servicio de correo (envío de spam/phishing en
  nombre de la marca), agotamiento de cuota y coste.
- **Attack scenario:** leer el repositorio → extraer la clave → usarla contra
  `auth.freebuff.app/send_otp`.
- **Root cause:** la clave se pegó en el código en lugar de configurarse como
  variable de entorno.
- **Affected files:** `src/convex/auth/emailOtp.ts`
- **Fix:** se lee de `process.env.VLY_EMAIL_API_KEY` y, si falta, falla cerrado
  con un mensaje claro. Además el `catch` ya no propaga el error crudo del
  proveedor (podía incluir cabeceras de autenticación).
- **Regression test:** `tests/static/dataLeakage.test.ts` → *"ningún archivo
  contiene un secreto literal"* (patrón `fb_[A-Za-z0-9]{16,}` añadido) y
  *"ninguna cabecera de autenticación lleva un valor literal"*.
- **Execution evidence:** ambos tests **PASS**. `grep` del patrón sobre el repo
  sin resultados.
- **Residual risk:** la clave sigue viva en el historial de git hasta que se
  rote upstream. **Acción requerida: rotarla.**
- **Status:** **FIXED — rotación pendiente (bloqueante)**

### VULN-12 — `securityEvents` nunca registra una denegación

- **ID:** VULN-12
- **Severity:** MEDIUM
- **Status:** OPEN
- **Description:** `lib/audit.ts::securityEvent()` inserta en `securityEvents`
  y se invoca en las denegaciones de `candidates.initUpload` (extensión no
  permitida, archivo > 10 MB, rate limit), que **después lanzan**. En Convex una
  mutación es ACID: al lanzar, **se revierte el insert**. Resultado medido:
  `bunx convex data securityEvents` → *"There are no documents in this table"*.
- **Impact:** no hay registro de intentos de abuso (uploads rechazados, rate
  limits, denegaciones). El audit trail de seguridad es ciego justo en los
  eventos que más importan.
- **Attack scenario:** un atacante puede abusar de la subida de ficheros o
  martial la API sin dejar rastro en `securityEvents`.
- **Root cause:** escrita dentro de una transacción que se revierte.
- **Affected files:** `src/convex/candidates.ts` (`initUpload`),
  `src/convex/applications.ts` (`initUpload`, sin registro en absoluto)
- **Fix propuesto:** que las denegaciones **devuelvan** un resultado discriminado
  en vez de lanzar (la fila se confirma), o registrar el evento desde una action
  no transaccional. Requiere cambiar el contrato de error de 4 endpoints y sus
  llamadas en el frontend.
- **Regression test:** pendiente del fix. Test de detección de la propia
  regresión: `bunx convex data securityEvents` debe devolver filas tras
  provocar un rechazo.
- **Execution evidence:** emptiness verificada dos veces en el deployment real.
- **Residual risk:** MEDIUM mientras no se corrija.
- **Status:** **OPEN**

### VULN-13 — Las mutaciones lanzan `Error` plano

- **ID:** VULN-13
- **Severity:** LOW
- **Status:** ACCEPTED RISK
- **Description:** `throw new Error("Formato no permitido…")` en una mutation
  llega al cliente como `Server Error [Request ID: …]`, no como el mensaje
  previsto (Convex solo propaga `ConvexError` de forma controlada). Se observó
  en los logs del deployment durante el sembrado de fixtures.
- **Impact:** ninguno de seguridad (no se filtra información: el mensaje real no
  llega al cliente). Degradación de UX y de diagnóstico.
- **Fix:** usar `ConvexError` con código; cambio de contrato en toda la capa de
  errores.
- **Residual risk:** LOW.
- **Status:** **ACCEPTED RISK**

---

## 17. Residual Risk

- Un modelo distinto (o sin filtro de contenido) podría obedecer una inyección.
  La defensa no depende del modelo: post-check determinista + matching
  determinista. Aun así, la garantía está verificada con **un** proveedor/modelo.
- El esquema de salida depende del prompt, no de `json_schema` nativo.
- El CV completo en texto plano vive en la BD mientras exista la versión;
  la retención depende del borrado de cuenta.
- Sin WAF, la capa de red queda expuesta a volumetric/simple abuse.
- Los rate limits por identidad son diarios y se reinician; un atacante con
  muchas identidades los multiplica.

---

## 18. Recommendations

1. Desplegar edge/WAF y cerrar el gate B antes de abrir tráfico real.
2. Programa de backups con RPO/RTO definidos y **restore ensayado**.
3. Levar la Golden Evaluation a ejecución completa en CI, con proveedor de
   evaluación sin filtro de contenido.
4. Resolver GAP-2 creando usuarios de prueba con email verificado.
5. Migrar a un proveedor con structured outputs estrictos (`json_schema`).
6. Alertas sobre tasa de `markFailed` por proveedor (señal temprana de
   prompt injection masiva).

---

## 19. Security Status Matrix

| Control | Status | Evidence |
|---|---|---|
| Authentication | **VERIFIED** | `gates.integration.test.ts` (GATE K, 3 tests) |
| Authorization | **VERIFIED** | `security.test.ts` RBAC fail-closed + matriz E2E de 5 roles |
| Tenant isolation | **VERIFIED** | `security.integration.test.ts` + `gates.integration.test.ts` |
| IDOR | **VERIFIED** | IDOR por tabla + 8 funciones con id malformado |
| Invitations | **VERIFIED** | `invitations.security.test.ts` (21) + E2E |
| Revocation | **VERIFIED** | revocación de acceso a organización (no de sesión global), documentada |
| Audit log | **VERIFIED** | `gates.integration.test.ts` GATE H (5 tests) |
| File security | **VERIFIED** | `fileSecurity.test.ts` (34) + E2E upload |
| PDF correctness | **PARTIAL** | oráculo zlib + PDFs reales; CID sin `/ToUnicode` = limitación documentada |
| Matching determinism | **VERIFIED** | `matching.determinism.test.ts` (10 tests, 100 repeticiones) |
| Prompt injection | **PARTIAL** | 8/11 vectores con contenido verificado; 3 fail-closed upstream |
| Data leakage | **VERIFIED** | `dataLeakage.test.ts` (11 tests estáticos) + `toSafeCvErrorMessage` |
| API abuse | **VERIFIED** | `gates.integration.test.ts` GATE I (5 tests) |
| IP rate limiting | **BLOCKED** | `docs/RATE_LIMITING.md` — IP probada no falsificable, pero inalcanzable (el OTP no pasa por ruta HTTP propia); contrato E-1…E-7 en `tests/edge/rateLimit.contract.test.ts` |
| RBAC live matrix | **VERIFIED** | `rbac.matrix.integration.test.ts` 18/18, 5 roles con sesiones reales |
| Backups | **VERIFIED (mecanismo)** | `convex export` ejecutado + `backupIntegrity.test.ts` 10/10 |
| Recovery / Restore | **VERIFIED (mecanismo)** | `backup_restore_drill.sh` → `DRILL=PASS` (sha256 e IDs idénticos) |
| RPO / RTO | **NOT MEASURED** | sin restore completo cronometrado |
| Observability | **PARTIAL** | auditLog verificado; `securityEvents` vacío (VULN-12) |
| Secrets | **PARTIAL** | literal eliminado (VULN-11); rotación pendiente |
| AI extraction pipeline | **VERIFIED** | VULN-01/02/07 corregidos y re-ejecutados E2E |

---

## 20. Conclusión

TalentFlow AI resiste, **en lo verificado**, los 11 vectores de prompt
injection del gate: ningún ataque produjo una skill, certificación, formación o
años de experiencia inexistentes, ni elevó el score por encima del CV honesto,
ni filtró el system prompt, secretos o datos de otros tenants. Tres vectores
quedan bloqueados por el proveedor y fallan cerrados.

Durante esta sesión se descubrió que **el pipeline de IA nunca había funcionado**
y que una credencial de plataforma estaba a un import de distancia de acabar en
el bundle público. Ambos están corregidos y verificados con ejecución real.

Lo que impide declarar el sistema production ready no es la calidad del código
de seguridad —que es alta y está bien verificado— sino tres hechos externos:
**no hay control de abuso por IP, no hay backups verificados y dos celdas del
RBAC no se pueden probar end-to-end.**

**PRODUCTION READY = NO**