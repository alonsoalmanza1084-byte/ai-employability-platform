# RUNBOOK.md — Operación

## 1. Comandos

```bash
bun tsc -b --noEmit          # typecheck
bun convex dev --once        # push de schema/functions + codegen (no interactivo)
bun lint                     # eslint
```

El dev server y Convex corren gestionados por la plataforma; no se arrancan/paran manualmente.

## 2. Procedimientos

### Extracciones IA fallando
1. Revisar `aiExtractions` (últimas filas): `ok=false` con `error.code`.
2. `PROVIDER_ERROR`/`TIMEOUT` masivo → verificar status del proveedor; si es prolongado, cambiar `AI_PROVIDER`/`AI_MODEL`.
3. `SCHEMA_INVALID` aislado → revisar caso en logs (sin contenido); el usuario puede reintentar (estado `failed` con botón).

### Límites alcanzados (soporte)
- `usageEvents` por usuario/org del día; límites en `convex/lib/limits.ts`. Para subir límite a un cliente: ajustar config (fase billing: por plan).

### Revocar sesión de un usuario
- Convex dashboard → tabla `authSessions` → eliminar sesión del usuario (roadmap: UI admin).

### Invitación no llega / no puede entrar
- Verificar `invitations` (status/expira); regenerar token desde org_admin; verificar email exacto.

### Rotación de secret IA
- Generar nueva key en el proveedor → actualizar env var en panel → invalidar la vieja. Sin deploy (lectura por env en runtime).

## 3. Alertas y a quién escalar

| Síntoma | Primera acción |
|---|---|
| Error IA > 10% en 1h | Ver aiExtractions, cambiar proveedor si aplica |
| Pico de uploads | Revisar usageEvents para abuso; ajustar límites |
| Denegaciones masivas (securityEvents) | Posible incidente de acceso → revisar actor, rotar sesiones si aplica |
| Preview en blanco | Typecheck/errores de runtime → ver console; `tsc -b --noEmit` |
