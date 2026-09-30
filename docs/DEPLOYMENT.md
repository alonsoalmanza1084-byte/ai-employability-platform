# DEPLOYMENT.md — Entornos y despliegue V1

## 1. Entornos

| Entorno | Frontend | Backend | Datos |
|---|---|---|---|
| development | Vite dev (HMR gestionado por la plataforma) | Convex dev deployment | datos de prueba generados, nunca reales |
| staging | preview de la plataforma | deployment Convex staging | semillas anónimas |
| production | build de la plataforma | deployment Convex prod | datos reales |

Regla: **ningún dato real de producción en dev/staging**.

## 2. Pipeline (por PR y por push a main)

```
lint → typecheck → unit tests → security scan (deps) → build →
migration validation (schema push a staging + smoke) → deploy (manual a prod)
```

- Staging se despliega automático al merge; **producción requiere aprobación humana** (controles para "cambios peligrosos").
- Validación de migraciones: `convex dev --once` contra staging; si el push pide borrado de tablas/campos → revisión manual obligatoria.
- Feature flags (tabla `featureFlags` futuro) para desacoplar deploy de release.

## 3. Plataforma actual (Freebuff/Vly + Convex)

- El hosting del frontend y el proceso Convex son gestionados por la plataforma; el pipeline arriba se aplica con los comandos disponibles (`bun convex dev --once`, typecheck, lint).
- Secrets se gestionan en el panel de la plataforma (nunca en el repo). `VITE_CONVEX_URL` es el único valor público.
