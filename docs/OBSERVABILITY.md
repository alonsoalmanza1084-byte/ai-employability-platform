# OBSERVABILITY.md — Observabilidad V1

## 1. Streams separados

| Stream | Dónde | Contenido |
|---|---|---|
| **Audit log** | tabla `auditLog` | acciones sensibles con actor, target, metadata mínima. Inmutable (sin updates) |
| **Security events** | tabla `securityEvents` | denegaciones, límites alcanzados, OTP fallidos, uploads rechazados |
| **Application logs** | console JSON (Convex dashboard) | errores de runtime, warnings. Sin PII ni contenido de documentos |

## 2. Métricas mínimas (derivadas de tablas)

- Extracciones IA: tasa de éxito, tokens, duración (`aiExtractions`).
- Uso: uploads/día por usuario y org (`usageEvents`).
- Matching: matches creados, score medio por vacante.
- Negocio: diagnósticos vistos, ediciones post-diagnóstico.

## 3. Alertas (manual en V1)

- Tasa de error IA > 10% en 1h.
- Pico de uploads anómalo (posible abuso).
- `securityEvents` con kind `rate_limited` repetido por el mismo actor.

## 4. Reglas de logging

Nunca registrar: contraseñas/tokens/cookies, contenido completo de documentos, emails en metadata libre (solo hash/prefijo), claves API.

Siempre registrar (metadata mínima): actor id, org id, tipo de acción, target id, tamaño de archivo (no contenido), código de resultado.
