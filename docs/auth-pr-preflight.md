# Auth PR v2 — pre-flight

Fecha: 2026-10-23  
Repositorio: `alonsoalmanza1084-byte/ai-employability-platform`  
Rama base: `main` (`origin/HEAD` → `origin/main`)  
Commit base: `e7c9ccf5015b72eb6af3e4c4f4636c057a239492`

## Cambios locales excluidos

Los siguientes cambios preexistentes se preservaron en `stash@{0}` y no forman
parte de la rama/PR:

- `docs/TESTING.md`
- `src/convex/career.ts`
- `src/convex/lib/gap.ts`
- `src/convex/schema.ts`
- `tests/unit/career_gap.test.ts`

Hash del stash: `1024fc32607ba3806452aa4ac2a8cd9bc17619e4`.

## Herramientas y deployment

- Node: `v24.21.0`
- npm: `11.19.0`
- Convex CLI: `1.42.1`
- `convex`: `1.42.1`
- `@convex-dev/auth`: `0.0.90`
- Vitest: `5.0.3`
- Deployment activo clasificado: development; no es producción.
- Nombres dev observados con `npx --no-install convex env list --names-only`:
  `JWKS`, `JWT_PRIVATE_KEY`, `VLY_CONVEX_AUTH_ISSUER`.
- `VLY_EMAIL_API_KEY` y `AUTH_RESEND_KEY` no aparecen en esa lista. No se
  consultaron valores de variables.

## Verificación de Auth

- `signIn("anonymous")` tiene un `try/catch` comprometido en `Auth.tsx`; lo
  introdujo el commit `7279a44` (`Freebuff: ALENTFLOW AI — MASTER ELITE
  ENTERPRISE SECURITY GATE`). Este PR añade diagnóstico técnico al catch
  existente, sin cambiar el mensaje genérico mostrado al usuario.
- `auth.config.ts` usa `CONVEX_SITE_URL`; `docs/OPERATIONS.md` decía `SITE_URL`.
  Se documenta `CONVEX_SITE_URL` como variable de sistema de Convex, que puede no
  figurar en `env list --names-only`; no se cambiará el nombre del código.
- Convex Auth `0.0.90` expone `Anonymous.profile` y el provider Email expone
  `sendVerificationRequest`. T3 usará esos callbacks, con log sin PII bajo
  `AUTH_DEBUG === "1"`; no se interceptará `auth.addHttpRoutes` ni su body.

## Estado de verificación

El comando de nombres de entorno se ejecutó sobre el deployment de desarrollo.
No se desplegaron funciones ni se migró schema. La prueba manual de guest en
preview requiere intervención humana y no se declara ejecutada por este PR.