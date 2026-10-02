# PRODUCTION_CHECKLIST.md — Configuración de producción

> **Regla:** staging **no** es evidencia de producción. Cada elemento está marcado
> con lo que se ha verificado realmente y con lo que falta.
> **Nunca se copia un secreto a este documento.**

Fecha de verificación: 2026-10-01 · Deployment auditado: `hip-porpoise-838` (staging)

---

## 1. Elementos

| # | Elemento | Estado | Evidencia / qué falta |
|---|---|---|---|
| 1 | **PRODUCTION_ENVIRONMENT** | **BLOCKED** | Solo existe staging. `bunx convex deployment create` falla: `isn't supported with a deploy key (CONVEX_DEPLOY_KEY)`. Se necesita una **project key**. |
| 2 | **DOMAIN** | **NOT_VERIFIED** | `SITE_URL=https://hip-porpoise-838.convex.site` (staging). No hay dominio de producción, ni DNS, ni certificado. |
| 3 | **AUTH** | **VERIFIED (mecanismo)** | Convex Auth: OIDC/JWKS publicados, sesiones, revocación. `gates.integration.test.ts` GATE K (3/3). En producción falta validar issuer y redirect URIs reales. |
| 4 | **EMAIL** | **BLOCKED** | `VLY_EMAIL_API_KEY` **NO EXISTE** en el deployment. El OTP falla cerrado por diseño. Hay que crearla en el panel del proveedor. |
| 5 | **AI_PROVIDER** | **VERIFIED (1 proveedor)** | `VLY_INTEGRATION_KEY` presente. `AI_PROVIDER` resuelve a `vly`. **Diversidad = NOT_VERIFIED** (sin `OPENAI_API_KEY`). |
| 6 | **SECRET CONFIGURATION** | **PARTIAL** | `JWT_PRIVATE_KEY`, `JWKS`, `VLY_INTEGRATION_*`, `SITE_URL` configuradas. Falta `VLY_EMAIL_API_KEY` y la rotación de la credencial expuesta (VULN-11). Sin gestor de secretos: viven en el panel de Convex. |
| 7 | **WAF / CDN** | **NOT_VERIFIED — BLOQUEANTE** | No existe. El abuso pre-auth por IP no tiene control. Contrato E-1…E-7 en `tests/edge/rateLimit.contract.test.ts` (rojo a propósito). |
| 8 | **RATE_LIMITING** | **PARTIAL** | Identidad / organización / acción / documento: VERIFIED (GATE I). OTP por email: VERIFIED. **Por IP: BLOCKED_BY_PLATFORM.** |
| 9 | **CORS** | **NOT_VERIFIED** | No hay configuración de CORS explícita en el repo. Convex sirve el cliente desde el mismo origen del deployment; en producción con dominio propio hay que verificarlo. |
| 10 | **CSP** | **NOT_VERIFIED** | `index.html` sin CSP. Hay que definirla (y comprobarla con los recursos que sirve Convex). |
| 11 | **COOKIES / SESSION** | **PARTIAL** | La sesión la emite Convex Auth con HttpOnly. En producción hay que verificar `Secure`, `SameSite`, dominio y duración de sesión. |
| 12 | **STORAGE** | **VERIFIED (mecanismo)** | Binarios en `_storage` privado, nunca servidos como estáticos. `fileSecurity.test.ts` 34/34. Falta definir la política de borrado de huérfanos. |
| 13 | **DATABASE** | **VERIFIED (esquema)** | 26 tablas, `schemaValidation` activo, índices por tenant. Sin migraciones versionadas: no hay historial de cambios de esquema. |
| 14 | **BACKUP** | **PARTIAL** | Mecanismo VERIFIED (`BACKUP_VERIFY=PASS`, 26 tablas, 452 binarios, 11/11). **Política operativa: NOT_DEFINED** (frecuencia, retención, offsite, cifrado). |
| 15 | **MONITORING** | **NOT_VERIFIED** | No hay métricas ni APM. `securityEvents` **no tiene ninguna query pública**: solo se lee por CLI. |
| 16 | **ALERTING** | **NOT_VERIFIED** | No hay alertas. Definidas en `docs/OPERATIONS.md` §2 como requisitos, no como implementación. |
| 17 | **RETENTION** | **NOT_DEFINED** | Falta el requisito legal. Ver `docs/OPERATIONS.md` §1. No se inventa política. |
| 18 | **ROLLBACK** | **NOT_VERIFIED** | No hay procedimiento de rollback probado: no existe despliegue de producción al que volver. |
| 19 | **ENVIRONMENT VARIABLES** | **PARTIAL** | Inventario conocido y verificado con `bunx convex env list`. Falta un control que detecte variables declaradas pero ausentes en el CI. |
| 20 | **CI/CD** | **PARTIAL** | `scripts/ci_gate.sh` ejecutable y reproducible (`CI_GATE=PASS`, con blockers declarados). **No existe pipeline**: sin `.github/`, sin YAML, sin Dockerfile, sin `vercel.json`. |

---

## 2. Variables de entorno — inventario verificado

Presentes en el deployment auditado:

`JWT_PRIVATE_KEY` · `JWKS` · `SITE_URL` · `VLY_APP_NAME` ·
`VLY_CONVEX_AUTH_ISSUER` · `VLY_INTEGRATION_BASE_URL` · `VLY_INTEGRATION_KEY`

**Ausentes (no se inventan):**

| Variable | Por qué falta | Consecuencia |
|---|---|---|
| `VLY_EMAIL_API_KEY` | Hay que crearla/rotarla en el panel del proveedor | El login por email no funciona (**fail-closed** deliberado) |
| `OPENAI_API_KEY` | Requiere una cuenta de OpenAI | `PROVIDER_DIVERSITY = NOT_VERIFIED` |
| `AI_PROVIDER` | No es obligatoria: el router cae a `vly` si falta | Sin efecto en el comportamiento |

Los **valores** de estas variables no se documentan aquí bajo ninguna circunstancia.

---

## 3. Lo que hay que hacer para poder marcar este checklist

1. Crear el deployment de producción (requiere **project key**, no deploy key).
2. Configurar dominio, DNS, TLS y `SITE_URL` de producción.
3. Rotar la credencial expuesta y crear `VLY_EMAIL_API_KEY`.
4. Desplegar el WAF/CDN y ejecutar el contrato E-1…E-7 con `EDGE_BASE_URL`.
5. Definir y ejecutar el plan de backup automático con retención y copia offsite.
6. Instrumentar las métricas y alertas de `docs/OPERATIONS.md` §2.
7. Definir la política de retención con legal.
8. Montar el pipeline que ejecute `scripts/ci_gate.sh` en cada PR.
9. Fijar CSP y verificar CORS/cookies en el dominio de producción.
10. Ensayar un rollback.

Hasta que 1–10 estén ejecutados y verificados, este checklist tiene
**8 elementos bloqueantes** y la configuración de producción es `NOT_VERIFIED`.
