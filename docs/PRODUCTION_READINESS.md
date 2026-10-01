# PRODUCTION_READINESS.md — Veredicto final de production readiness

**Fecha:** 2026-10-01 · **Deployment:** `https://hip-porpoise-838.convex.cloud` (staging)
**Veredicto: `PRODUCTION READY = NO`**

Este documento resume el estado DERIVADO DE EVIDENCIA. Nada aquí se declara
`VERIFIED` sin ejecución real registrada.

---

## 1. Cierre de los 5 blockers de la sesión anterior

| Blocker | Estado anterior | Estado actual | Evidencia |
|---|---|---|---|
| **A. Rate limiting pre-auth / IP** | BLOCKED sin evidencia | **BLOCKED BY PLATFORM — con prueba experimental** | `httpAction` sonda: XFF falsificado es **descartado** por el edge (`NOT_SPOOFABLE`), pero el OTP **no pasa por ruta HTTP propia** → la IP es inalcanzable desde la app. `docs/RATE_LIMITING.md` |
| **B. Backups** | NOT VERIFIED | **VERIFIED (mecanismo)** | `convex export --include-file-storage` ejecutado; 28 tablas + 182 binarios; `tests/recovery/backupIntegrity.test.ts` 10/10 |
| **C. Recovery / RPO / RTO** | NOT VERIFIED | **RESTORE VERIFIED · RPO/RTO NOT MEASURED** | `scripts/backup_restore_drill.sh` → `DRILL=PASS` (490 filas, sha256 idéntico, IDs preservados tras pérdida simulada) |
| **D. RBAC E2E** | PARTIAL (mocks) | **VERIFIED (E2E, 5 roles reales)** | `tests/integration/rbac.matrix.integration.test.ts` 18/18 + revocación con la misma sesión |
| **E. Golden evaluation** | PARTIAL 8/11 | **PARTIAL 8/11 (clasificación explícita)** | `docs/GOLDEN_EVALUATION.md`; 8 vectores `APPLICATION_PROTECTION_VERIFIED`, 3 `UPSTREAM_BLOCK` con fail-closed verificado |

---

## 2. Vulnerabilidades nuevas encontradas y corregidas en esta sesión

| ID | Severity | Hallazgo | Estado |
|---|---|---|---|
| VULN-11 | **HIGH** | Clave de API del servicio de correo escrita como **literal en el repositorio** (`auth/emailOtp.ts`), versionada y visible para cualquiera con acceso al código y al historial | **FIXED** (leída de `VLY_EMAIL_API_KEY`) — requiere **rotación + configurar la variable** |
| VULN-12 | MEDIUM | `securityEvents` **nunca registra nada**: en Convex una mutación que lanza revierte el `insert`, y todos los caminos que registran un evento de seguridad lanzan después | **OPEN** (limitación de transacción) |
| VULN-13 | LOW | Las mutaciones lanzan `Error` plano → el cliente recibe `Server Error [Request ID]` en vez del mensaje previsto | **ACCEPTED RISK** (no filtra información; degrada la UX) |

---

## 3. Production Readiness Matrix

| Control | Status | Evidence | Blocker |
|---|---|---|---|
| Authentication | **VERIFIED** | `gates.integration.test.ts` GATE K (3) + `security.integration.test.ts` | No |
| Authorization | **VERIFIED** | `requireMembership` fail-closed + matriz E2E | No |
| RBAC E2E | **VERIFIED** | 18/18 con 5 roles y sesiones reales | No |
| Tenant isolation | **VERIFIED** | `security.integration.test.ts`, `gates.integration.test.ts` | No |
| IDOR | **VERIFIED** | IDOR por tabla + 8 funciones con id malformado | No |
| File security | **VERIFIED** | `fileSecurity.test.ts` 34 tests, 20 PDFs hostiles | No |
| AI security (trust boundary) | **VERIFIED** | Golden 8/11 + post-check determinista | No |
| Prompt injection | **PARTIAL** | 8/11 observados; 3 `UPSTREAM_BLOCK` | **Sí** (parcial) |
| Matching determinism | **VERIFIED** | `matching.determinism.test.ts` 10 tests, 100 repeticiones | No |
| Audit logging | **PARTIAL** | auditLog verificado (orden, tenant, sin PII); `securityEvents` **vacío por rollback transaccional** | **Sí** |
| Rate limiting (identidad) | **VERIFIED** | OTP, org, IA, decisiones | No |
| **Pre-auth abuse (IP)** | **BLOCKED** | `docs/RATE_LIMITING.md`, `tests/edge/rateLimit.contract.test.ts` | **Sí** |
| Secrets | **PARTIAL** | literal eliminado del código; **rotación y variable pendientes** | **Sí** |
| Data leakage | **VERIFIED** | `dataLeakage.test.ts` 12 tests | No |
| Backups | **VERIFIED (mecanismo)** | export ejecutado + 10 tests de integridad | Frecuencia/retention **NO DEFINIDAS** |
| Restore | **VERIFIED (mecanismo)** | drill con pérdida simulada y sha256 | **Sí** (restore completo en deployment limpio bloqueado por deploy key) |
| RPO | **NOT MEASURED** | sin histórico de incidentes | **Sí** |
| RTO | **NOT MEASURED** | sin restore completo cronometrado | **Sí** |
| Observability | **NOT VERIFIED** | sin acceso a métricas/alertas | No (no bloqueante único, pero suma) |
| Error handling | **PARTIAL** | `toSafeCvErrorMessage` OK; `securityEvents` vacío | **Sí** |
| Build | **PASS** | `bun run build` ✔ | No |
| Typecheck | **PASS** | `bunx tsc -b --noEmit` ✔ | No |
| Tests | **PASS** | 318 passed / 0 failed / 0 skipped | No |
| Lint | **PARTIAL** | 0 errores en producto y tests; 3 errores preexistentes de plantilla | No |
| CI/CD | **NOT VERIFIED** | no hay pipeline en el repo | No |
| Production configuration | **PARTIAL** | sin despliegue productive; staging con credenciales de dev | **Sí** |

---

## 4. RPO / RTO

| Métrica | TARGET | ASSUMPTION | MEASURED | Status |
|---|---|---|---|---|
| RPO | por definir con negocio | "el proveedor toma snapshots diarios" — **no verificado** (sin acceso al panel) | no medido | **NOT MEASURED** |
| RTO | por definir con negocio | "un restore son minutos" — **no verificado** | no medido | **NOT MEASURED** |

No se presenta ninguna estimación como garantía. Véase `docs/BACKUP_AND_RECOVERY.md`.

---

## 5. Veredicto según la regla del gate

```
CRITICAL abiertos ............ 0        ✅
HIGH abiertos ................. 0        ✅  (VULN-11 corregido; queda la ACCIÓN de rotación)
MEDIUM bloqueantes ............ 2        ❌  (securityEvents vacío; secretos por rotar)
RBAC ........................ VERIFIED  ✅
TENANT ISOLATION ............. VERIFIED  ✅
AUTH ......................... VERIFIED  ✅
FILE SECURITY ................ VERIFIED  ✅
AI SECURITY .................. VERIFIED  ✅
MATCHING ..................... VERIFIED  ✅
AUDIT ....................... PARTIAL   ❌
PRE-AUTH ABUSE ............... BLOCKED   ❌
BACKUPS ...................... PARCIAL   ❌  (frecuencia/retention no definidas)
RESTORE ...................... PARCIAL   ❌
RPO / RTO .................... NOT MEASURED ❌
BUILD / TYPECHECK / TESTS / E2E / SECURITY ... PASS  ✅
```

---

## 6. Plan de cierre (con dueño)

| # | Acción | Dueño | Bloquea |
|---|---|---|---|
| 1 | Desplegar CDN/WAF y ejecutar el contrato E-1…E-7 | Plataforma / SRE | Pre-auth abuse |
| 2 | Rotar la clave del servicio de correo expuesta y configurar `VLY_EMAIL_API_KEY` | Seguridad | Envío de OTP |
| 3 | Corregir el rollback de `securityEvents` (registrar tras la transacción, o no lanzar) | Backend | Auditabilidad |
| 4 | Automatizar el backup con frecuencia y retención definidas, fuera del proveedor | SRE | Backups |
| 5 | Restaurar una base completa en un deployment limpio y cronometrarlo (requiere project key) | Plataforma | RPO/RTO |
| 6 | Acordar RPO/RTO con negocio | Producto | RPO/RTO |
| 7 | Ejecutar la Golden Evaluation contra un segundo proveedor/modelo | QA + Plataforma | Prompt injection parcial |
| 8 | Desplegar a producción y repetir la cadena completa | Release | Producción |

---

# PRODUCTION READY = NO