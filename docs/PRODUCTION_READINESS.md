# PRODUCTION_READINESS.md — Veredicto final de production readiness

**Fecha:** 2026-10-01 · **Deployment auditado:** `hip-porpoise-838` (**staging**)
**Veredicto: `PRODUCTION READY = NO`**

Este documento se deriva **solo de evidencia ejecutada**. Nada se declara
`VERIFIED` sin implementación + test + ejecución + PASS + evidencia conservada.
Un `SKIPPED`, `BLOCKED`, `NOT_VERIFIED`, `NOT_MEASURED` o `UPSTREAM_BLOCK`
**nunca** se convierte en `PASS`.

---

## 1. Resumen ejecutivo

TalentFlow AI supera con nota alta todo lo que es **código**: autenticación,
autorización, aislamiento multi-tenant, IDOR, seguridad de ficheros, RBAC
end-to-end con seis identidades reales, determinismo del matching y defensa
contra prompt injection en 8 de 11 vectores. 280 tests verdes, typecheck limpio,
build correcto.

Sin embargo, **cinco condiciones anteriores son de infraestructura y de
gobierno, y ninguna depende del código**:

1. **No existe WAF/CDN** → el abuso pre-auth por IP no tiene control real.
2. **La credencial de correo no está rotada** y `VLY_EMAIL_API_KEY` no existe.
3. **Las denegaciones de autorización no son auditables** (VULN-14, abierto).
4. **No hay política operativa de backups** (frecuencia, retención, offsite,
   cifrado) ni RPO/RTO de negocio definido.
5. **No hay observabilidad** ni pipeline de CI/CD real.

Además, el restore completo en un deployment limpio está **bloqueado por la
plataforma** (no se puede crear un deployment con una deploy key) y el RPO/RTO a
escala completa **no se ha medido**.

Pasar 280 tests no es production ready. Es no tener regresiones.

---

## 2. Matriz de production readiness (§21 del prompt)

| Control | Estado | Evidencia | Blocker |
|---|---|---|---|
| **Authentication** | VERIFIED | `gates.integration.test.ts` GATE K — 3/3: sin sesión denegado, token ajeno inservible, logout corta el acceso | No |
| **Authorization** | VERIFIED | `rbac.matrix.integration.test.ts` — 18/18 | No |
| **RBAC** | VERIFIED | 18/18 con sesiones reales. `org_admin` 10/10 ALLOW · `recruiter` 8/10 · `hiring_manager` 5/10 · `candidate` 0/10 · `outsider` 0/10 · `anonymous` **0/15 (15/15 DENY)** | No |
| **Tenant isolation** | VERIFIED | GATE F + `dataLeakage.test.ts` 12/12 | No |
| **IDOR** | VERIFIED | `dataLeakage.test.ts` + IDs malformados en 8 funciones | No |
| **File security** | VERIFIED | `fileSecurity.test.ts` 34/34 + E2E: extensión falsa, MIME falso, magic bytes, traversal, ZIP bomb, PDF malformado, Unicode, duplicados | No |
| **AI security** | PARTIAL | 8/11 vectores `APPLICATION_PROTECTION_VERIFIED`; 3 `UPSTREAM_BLOCK`. **Específico del modelo `gpt-4o-mini` vía el proveedor VLY** — no universal | Sí (cobertura) |
| **Prompt injection** | PARTIAL | 8/11 verificados; `score_delta ≤ 0` en todos los casos comparables | Sí (cobertura) |
| **Matching** | VERIFIED | `matching.determinism.test.ts` 10/10, 100 repeticiones | No |
| **Audit** | VERIFIED | `gates.integration.test.ts` GATE H (5/5) | No |
| **Security events** | **PARTIAL** | Validación de fichero: VERIFIED (`PERSISTED`, 30+ filas). **Autorización: OPEN (VULN-14)**, `DELTA=0` medido | **Sí** |
| **Rate limiting** | VERIFIED (parcial) | Identidad / organización / acción / documento: GATE I (5/5) | No |
| **Pre-auth abuse** | **BLOCKED_BY_PLATFORM** | IP no falsificable pero **inalcanzable** desde la app (el OTP no pasa por ruta HTTP propia). `tests/edge/rateLimit.contract.test.ts` **falla a propósito** sin `EDGE_BASE_URL` | **Sí** |
| **Secrets** | **PARTIAL** | En el código: VERIFIED (0 coincidencias en `src/`, `tests/`, `docs/`, `dist/`). **Rotación: PENDIENTE** | **Sí** |
| **Backups** | VERIFIED (mecanismo) | `BACKUP_VERIFY=PASS` · 26 tablas · 362 binarios · 11/11 tests de integridad. **Política operativa (frecuencia, retención, offsite, cifrado): NOT_DEFINED** | **Sí** |
| **Restore** | PARTIAL | Mecanismo VERIFIED (`DRILL=PASS`, 1.101 filas, sha256 e IDs idénticos). **Deployment limpio: BLOCKED_BY_PLATFORM** | **Sí** |
| **RPO** | **NOT_DEFINED** | No existe objetivo de negocio. **No se inventa.** | **Sí** |
| **RTO** | **NOT_MEASURED** (parcial) | Medido **17.071 ms** a nivel de tabla (backup 2.668 + pérdida simulada 9.255 + restore 5.148). **Escala completa: no medible sin deploy key** | **Sí** |
| **Observability** | **NOT_VERIFIED** | `securityEvents` no tiene ninguna query pública (solo lectura por CLI). Sin métricas, alertas, ni logs centralizados | **Sí** |
| **CI/CD** | **PARTIAL** | `scripts/ci_gate.sh` → `CI_GATE=PASS`, pero **no existe pipeline** (sin `.github/`, sin YAML, sin Dockerfile, sin `vercel.json`) | **Sí** |
| **Production config** | **NOT_VERIFIED** | Staging no es evidencia de producción. Checklist en `docs/OPERATIONS.md` | **Sí** |

---

## 3. Comandos ejecutados y resultados exactos (esta sesión)

| Comando | Resultado exacto |
|---|---|
| `bunx convex dev --once` | OK — funciones desplegadas |
| `bunx tsc -b --noEmit` | `TSC_EXIT=0`, sin salida |
| `bunx vitest run --exclude "tests/edge/**"` | `Test Files 15 passed \| 2 skipped (17)` · `Tests 280 passed \| 29 skipped (309)` |
| `bunx vitest run tests/edge/rateLimit.contract.test.ts` | **`1 failed \| 3 skipped` — ROJO DELIBERADO** (`BLOQUEO: no hay EDGE_BASE_URL`) |
| `bunx vitest run tests/golden/ai.security.eval.test.ts` | `10 passed` · `GOLDEN_COVERAGE ready=8/11 blocked_upstream=["direct_injection","system_prompt_extraction","combined_attack"]` |
| `bash scripts/rbac_seed_memberships.sh` | `MEMBERSHIPS_SEEDED=2` |
| `bunx vitest run tests/integration/rbac.matrix.integration.test.ts` | `Tests 18 passed (18)` · `RBAC_ANONYMOUS` 15/15 DENY |
| `bash scripts/backup_verify.sh` | **`BACKUP_VERIFY=PASS`** · 26 tablas · 362 binarios · 11/11 tests |
| `bash scripts/backup_restore_drill.sh` | **`DRILL=PASS`** · 1.101 filas · `TOTAL_RECOVERY_TIME_MS=17071` |
| `bash scripts/verify_security_events.sh` | `SECURITY_EVENTS=PERSISTED` (30+ filas reales) |
| `bash scripts/verify_audit_denial_semantics.sh` | **`AUTHORIZATION_DENIAL_AUDIT=NOT_PERSISTED`** · `DELTA=0` → VULN-14 |
| `bun run lint` | `22 problems (3 errors, 19 warnings)`; `scripts/lint_gate.mjs` → `TEMPLATE=3 OWN=0` |
| `bun run build` | `✓ built in 8.02s` |
| `bash scripts/ci_gate.sh` | `CI_GATE=PASS (con BLOCKERS declarados)` — lista explícitamente `BLOCKER pre-auth abuse por IP [Tests 1 failed \| 3 skipped (4)]` y `BLOCKER VULN-14 [AUTHORIZATION_DENIAL_AUDIT=NOT_PERSISTED]`; `securityEvents rows → 36` |
| `bunx convex env list` | Presentes: `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `VLY_APP_NAME`, `VLY_CONVEX_AUTH_ISSUER`, `VLY_INTEGRATION_BASE_URL`, `VLY_INTEGRATION_KEY`. **Ausentes: `VLY_EMAIL_API_KEY`, `OPENAI_API_KEY`** |
| `bunx convex deployment create` | FALLA: `isn't supported with a deploy key (CONVEX_DEPLOY_KEY)` |

**Ningún test deliberadamente rojo se ha relajado, saltado ni puesto en verde.**
El rojo de `tests/edge/` es la prueba viva de que el abuso pre-auth por IP
sigue sin verificar.

---

## 4. Blockers que impiden un `YES`

| # | Condición | Categoría | Responsable |
|---|---|---|---|
| **1** | CDN/WAF delante de Convex con control de IP, reputation, burst, bot y enumeración de email. Contrato E-1…E-7 en `tests/edge/rateLimit.contract.test.ts` | Infraestructura | Plataforma / Seguridad |
| **2** | Rotar la clave expuesta (VULN-11) y configurar `VLY_EMAIL_API_KEY` en el deployment | Operador | Plataforma |
| **3** | Corregir VULN-14: fuente de auditoría para denegaciones de autorización | Código (cambio de arquitectura) | Backend |
| **4** | Backup **automático** con frecuencia, **retención**, copia **offsite** y **cifrado**, y verificación periódica de los sha256 | Operativa | SRE / Operaciones |
| **5** | **RPO y RTO acordados con negocio** y medidos en un restore completo | Gobierno + Plataforma | Producto / Operaciones |
| **6** | Observabilidad mínima operativa: eventos, severidad, umbral, owner, respuesta | Observabilidad | SRE |
| **7** | Pipeline de CI/CD real que ejecute typecheck, lint, unit, integration, security, golden y build, con el test rojo de edge **visible** | CI/CD | Plataforma |
| **8** | Configuración de producción verificada (dominio, cookies, CSP, CORS, storage, alerting) | Configuración | Plataforma |
| **9** | Restore completo probado en un deployment limpio (requiere project key) | Plataforma | Plataforma |
| **10** | Diversidad de proveedor de IA (`OPENAI_API_KEY`) o aceptación formal de que la seguridad de IA solo está verificada para un modelo concreto | Decisión | CTO |
| **11** | Política de retención de datos definida con requisitos legales | Legal / Producto | Legal |

---

## 5. Condición para convertir este `NO` en `YES`

Bastaría con que **los 11 puntos de la sección 4** estén implementados **y
verificados con ejecución real y evidencia conservada**. No hay atajos: ninguno
puede cerrarse leyendo código, y ninguno se cierra declarándolo.

En particular, el orden natural es: (2) y (7) primero porque son baratos;
(1), (4), (6) y (8) porque son la mayor parte del riesgo residual; (3), (5), (9),
(10) y (11) porque dependen de decisiones o de plataformas externas.

---

**PRODUCTION READY = NO**
