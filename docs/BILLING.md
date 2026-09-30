# BILLING.md — Diseño de billing (fuera de implementación V1)

> Decisión del prompt: no implementar precios sin analizar costos reales. V1 = free con límites de uso (`convex/lib/limits.ts`).

## 1. Planes propuestos (a validar con costos reales)

| Plan | Quién | Qué incluye (borrador) | Monetización |
|---|---|---|---|
| Free | candidato | 2 CVs/mes, diagnóstico completo | adquisición |
| Pro Candidate | candidato | CVs ilimitados razonables, coach IA, adaptación a vacante | suscripción mensual |
| Recruiter | orgs pequeñas | 1 org, 3 vacantes, 100 CVs/mes | por asiento |
| Business | orgs | vacantes y CVs ampliados, multi-miembro, reportes | por asiento |

No se implementan precios hasta medir: costo IA por CV (tokens reales), costo storage, costo de matching. Los límites V1 ya simulan los topes del plan Free.

## 2. Diseño futuro (cuando se active)

- Proveedor de pagos con **checkout hosteado** + webhooks firmados.
- `subscriptions` (estado, período), `invoices` (histórico), `usage` (agregación por período).
- **Webhook security:** firma HMAC verificada server-side, timestamp ±5 min (anti-replay), idempotencia por event id (dedupeKey), respuestas 2xx solo tras persistir.
- **Failed payments:** estado `past_due` con gracia de 7 días → `canceled`. Downgrade no borra datos, restringe límites.
- **Upgrade/downgrade prorrateado** según proveedor de pagos.
- **Nunca** confiar en el frontend: el estado de pago solo se escribe vía webhook verificado.
- Trials: 14 días Pro Candidate; recordatorio antes del fin (email).

## 3. Metering (ya implementado en V1 como base)

- `usageEvents` con `dedupeKey` único → idempotencia (no doble cobro futuro).
- Kinds actuales: `cv.upload`, `cv.extract`. Futuros: `match.create`, `coach.message`, etc.
- Agregación por usuario/org/día para límites y (después) facturación.
