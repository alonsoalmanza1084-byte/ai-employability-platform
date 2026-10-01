# OPERATIONS.md — Retención, observabilidad y configuración de producción

> Todos los estados de este documento son **derivados de evidencia**. Donde el
> requisito es del negocio o depende de infraestructura externa, se declara
> `NOT_DEFINED` / `NOT_VERIFIED`, nunca se estima.

---

## 1. Retención de datos — `RETENTION_POLICY = NOT_DEFINED`

No existe requisito de negocio/legal documentado en el repositorio. Lo que sí
se puede afirmar es **dónde vive cada dato y cómo se elimina hoy**.

| Activo | Tabla / almacenamiento | Eliminación hoy | Al borrar la cuenta |
|---|---|---|---|
| CV binario | `_storage` (privado) | Con la `resumeVersion` | Sí (`account.deleteAccount` borra binarios) |
| Texto extraído del CV | `resumeVersions.extractedText` | Con la versión | Sí |
| Perfil estructurado | `candidateProfiles` | Con la versión activa | Sí |
| Versiones de CV | `resumeVersions` | Soft-delete `deletedAt`; hard-delete al borrar cuenta | Sí |
| Extracciones IA | `aiExtractions` | **Nunca se purga automáticamente** | No verificado |
| Texto de CV en applications | `applications.extractedText` | Con la application | No verificado |
| Matching | `candidateJobMatches` | Con la application | No verificado |
| Notas de recruiter | `recruiterNotes` | Con la application | No verificado |
| Audit log | `auditLog` | **Crecce sin purga** | No |
| Eventos de seguridad | `securityEvents` | **Crecce sin purga** | No |
| Contadores de cuota | `usageEvents` | Solo por ventana en la consulta | No |
| Sesiones de auth | `authSessions`, `authRefreshTokens` | Con `deleteAccount` | Sí |
| Envíos OTP | `otpSendLog` | Purga >1 h en cada envío | N/A |
| Backups (ZIP) | Disco / almacenamiento externo | **Sin política** | N/A |

### Riesgos abiertos

- **AUDIT-RETENTION**: `auditLog` y `securityEvents` no tienen purga. Crecen
  indefinidamente y contienen `organizationId` y `actorUserId` ( pseudónimos de
  usuario, no PII directa, pero enlazables).
- **AI-RETENTION**: `aiExtractions` guarda modelo/prompt/versión/tokens, no el
  contenido del CV. Riesgo bajo.
- **BACKUP-RETENTION**: los backups contienen **todo**, incluidos CVs y datos de
  auth. Su retención y su cifrado están sin definir (§2 de
  `BACKUP_AND_RECOVERY.md`).
- **ORPHAN-STORAGE**: un binario subido cuyo `finalizeUpload` falla queda
  huérfano en `_storage`. El flujo actual borra el storage en la mayoría de los
  rechazos de `finalizeUpload`, pero un fallo de red entre la subida y el
  `finalize` deja basura. **NOT_VERIFIED**: no hay job de limpieza.

**Requisito de negocio necesario:** plazos de retención por categoría y
obligaciones de borrado (derecho al olvido / GDPR / locality).

---

## 2. Observabilidad — `OBSERVABILITY = NOT_VERIFIED`

No hay métricas, alertas ni agregador de logs en el repositorio. Lo verificado
es que **los eventos se emiten**; lo que falta es **recogerlos y alertar**.

| Señal | Fuente (evento) | Severidad | Retención requerida | Umbral de alerta | Dueño | Respuesta |
|---|---|---|---|---|---|---|
| Fallos de autenticación OTP | `securityEvents` (`otp_throttled`) | HIGH | 90 d | >50/hora por IP/email | SRE | Bloquear, revisar abused |
| Abuso de OTP | `securityEvents` (`rate_limited`) | HIGH | 90 d | >200/hora global | SRE | Escalar a plataforma |
| Uploads rechazados | `securityEvents` (`upload_rejected`) | MEDIUM | 30 d | >100/hora | Backend | Revisar firmas/patrón |
| Denegaciones de autorización | `auditLog` + logs de Convex (`FORBIDDEN`) | HIGH | 90 d | >20/hora | Security | Investigar cross-tenant |
| Intentos cross-tenant | `requireMembership` (deniegue) | CRITICAL | 365 d | **cualquiera** | Security | Respuesta a incidente |
| Fallos de IA | `aiExtractions.ok = false` | HIGH | 30 d | >5% en 15 min | Backend | Degradar a revisión humana |
| Latencia de IA | `aiExtractions.durationMs` | MEDIUM | 30 d | p95 > 20 s | Backend | Ajustar modelo |
| Coste de IA | `usageEvents` + tokens | HIGH | 365 d | > presupuesto diario | Plataforma | Cortar / avisar |
| Fallos de parser | `resumeVersions.failureReason` | MEDIUM | 30 d | >10% | Backend | Revisar parser |
| Fallos de storage | errores de `ctx.storage` | HIGH | 30 d | cualquiera | SRE | Restaurar servicio |
| Fallos de backup | salida de `scripts/backup_verify.sh` | CRITICAL | 365 d | cualquiera | SRE | Reintentar y escalar |
| Fallos de restore | salida de `backup_restore_drill.sh` | CRITICAL | 365 d | cualquiera | SRE | Escalada inmediata |
| Volumen inusual de peticiones | WAF (externo) | HIGH | 90 d | por política de WAF | SRE | Bloqueo |

**Estado de cada señal: NOT_VERIFIED** (el evento existe en el código; la
recolección y la alerta no están construidas).

---

## 3. Configuración de producción — checklist

| Elemento | Estado | Evidencia / Observación |
|---|---|---|
| `PRODUCTION_ENVIRONMENT` | **NOT_VERIFIED** | Solo existe un deployment de staging/desarrollo (`hip-porpoise-838`) |
| `DOMAIN` | **NOT_VERIFIED** | No hay dominio productivo configurado |
| `AUTH` | **BLOCKED** | `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` presentes en staging; falta despliegue productivo |
| `EMAIL` | **BLOCKED** | `VLY_EMAIL_API_KEY` **ausente** → el OTP falla cerrado |
| `AI_PROVIDER` | **PARTIAL** | `VLY_INTEGRATION_KEY` presente y funcionando; `OPENAI_API_KEY` ausente |
| `SECRET_STORE` | **NOT_VERIFIED** | Sin gestor de secretos ni rotación configurada |
| `BACKUPS` | **PARTIAL** | Mecanismo verificado; sin automatización, frecuencia ni retención |
| `WAF` | **BLOCKED_BY_PLATFORM** | No existe; es el bloqueo de pre-auth abuse |
| `RATE_LIMITING` | **PARTIAL** | Por identidad verificado; por IP bloqueado |
| `LOGGING` | **NOT_VERIFIED** | Sin agregador ni retención configurada |
| `MONITORING` | **NOT_VERIFIED** | Ver §2 |
| `ALERTING` | **NOT_VERIFIED** | No hay alertas |
| `CORS` | **NOT_VERIFIED** | No hay configuración de CORS explícita en el proyecto |
| `CSP` | **NOT_VERIFIED** | Sin cabeceras de Content-Security-Policy |
| `COOKIE_SECURITY` | **PARTIAL** | Convex Auth gestiona cookies httpOnly/secure/sameSite; no verificado en producción |
| `STORAGE` | **VERIFIED** | Storage privado verificado (magic bytes, sin URLs públicas) |
| `DATABASE` | **VERIFIED** | Esquema + validación en runtime activos (`schemaValidation` sin desactivar) |
| `RETENTION` | **NOT_DEFINED** | Ver §1 |
| `ROLLBACK` | **NOT_VERIFIED** | No hay procedimiento automatizado de rollback de código ni de datos |
| `PROD_HOSTING` | **BLOCKED_BY_PLATFORM** | `convex deployment create` no permitido con deploy key |

---

## 4. CI/CD — `CI/CD = PARTIAL`

No existe pipeline en el repositorio (sin `.github/`, sin YAML, sin Dockerfile,
sin `vercel.json`/`fly.toml`).

Se ha creado un gate **ejecutable y reproducible**: `scripts/ci_gate.sh`.

```
$ bash scripts/ci_gate.sh
PASS  convex push
PASS  typecheck
PASS  build
PASS  lint (solo errores preexistentes de plantilla)
PASS  unit+static+integration   (268 passed / 0 failed)
INFO  backup recovery  → bash scripts/backup_verify.sh
INFO  rbac e2e         → seed + scripts/rbac_seed_memberships.sh + matriz
INFO  golden eval      → bunx vitest run tests/golden/ai.security.eval.test.ts
CI_GATE=PASS
```

Reglas del gate: falla con 0 tests fallidos, 0 hallazgos de secretos, 0 fallos
de aislamiento de tenant, 0 bypasses de auth, build/typecheck verdes.
**Los tests deliberadamente rojos no se ocultan**: `tests/edge/` se ejecuta por
separado y falla a propósito mientras el WAF no exista.

Pendiente para que sea `VERIFIED`: integrarlo en un runner real (GitHub Actions,
CI de Vercel, etc.) y ejecutarlo en cada PR.

---

## 5. Requisitos de entrada que faltan (del negocio / de la plataforma)

Para poder pasar de `NOT_DEFINED` / `NOT_VERIFIED` a algo verificable:

| # | Input | Tipo | Sin esto |
|---|---|---|---|
| 1 | Objetivo de **RPO** (minutos) | Negocio | RPO = NOT_DEFINED |
| 2 | Objetivo de **RTO** (minutos) | Negocio | RTO = NOT DEFINED |
| 3 | Plazos de **retención** por categoría de dato | Legal/Negocio | Retención sin política |
| 4 | Decisión de **WAF/CDN** y presupuesto | Plataforma | Pre-auth abuse bloqueado |
| 5 | **Project key** de Convex (no deploy key) | Plataforma | No se puede crear deployment de restore ni staging productivo |
| 6 | Rotación de la **clave de correo** expuesta | Seguridad | VULN-11 abierto |
| 7 | `VLY_EMAIL_API_KEY` en el deployment | Seguridad | Login por email roto |
| 8 | Segunda **credencial de proveedor IA** | Plataforma | Provider diversity no verificable |
| 9 | Budget y umbrales de **coste de IA** | Negocio | Alerta de coste imposible de definir |
| 10 | Aceptación formal del **RTO medido a nivel de tabla (17.071 ms)** frente al RTO de deployment completo, aún sin medir | Negocio + SRE | El único dato medido no es utilizable como objetivo |

---

## 6. Auditoría de denegaciones de autorización — `VULN-14 OPEN`

Añadido en la auditoría #6 (production gate).

### Lo que sí se registra

`scripts/verify_security_events.sh` → `SECURITY_EVENTS=PERSISTED`.
`securityEvents` contiene **30+ filas reales** de denegaciones de **validación de
fichero** (`bad_extension`, `file_too_large`, `org_bad_extension`) con el
`userId` del actor. Los uploads válidos siguen funcionando: no se ha roto el camino bueno.

### Lo que NO se registra

`scripts/verify_audit_denial_semantics.sh` → `AUTHORIZATION_DENIAL_AUDIT=NOT_PERSISTED`,
`DELTA=0`. Los intentos de **escalada de privilegios** y de **acceso cross-tenant**
no dejan rastro, porque `requireMembership` lanza y el rollback ACID de Convex
revierte cualquier `insert` de esa misma transacción.

**Esto no se convierte en PASS.** Es un hallazgo abierto de severidad **ALTA**
que bloquea producción. Detalle completo y diseño de remediación en
`docs/SECURITY_AUDIT.md` §8.

### Consecuencia operativa

`securityEvents` **no tiene ninguna query pública**: solo se lee por CLI
(`bunx convex data securityEvents`). Ningún `org_admin` puede revisar los
eventos de seguridad de su organización desde el producto, y ningún equipo de
seguridad los consume automáticamente. Mientras VULN-14 siga abierto, la
observabilidad de seguridad depende de acceso directo a la consola de Convex.

### Comprobaciones para el pipeline

```bash
bash scripts/verify_security_events.sh          # debe imprimir PERSISTED
bash scripts/verify_audit_denial_semantics.sh   # debe imprimir PERSISTED
```

El segundo **falla hoy a propósito**, igual que el contrato de edge. Ambos rojos
deben permanecer visibles en el reporte del pipeline hasta que se cierren.