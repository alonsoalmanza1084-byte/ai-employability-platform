# OBSERVABILITY.md — Observabilidad V1

> **ESTADO GLOBAL: `NOT_VERIFIED` como capacidad operativa.**
> Lo que existe y está probado: los **streams** (tablas `auditLog` y
> `securityEvents`, logs de consola), su escritura y su contenido acotado.
> Lo que **no** existe: métricas, alertas, dashboards, retención programada,
> centralización de logs, on-call y respuesta. Nada de eso se declara aquí como
> verificado; cada fila del §3 lo dice explícitamente en su columna *Estado*.
> El catálogo siguiente es el **diseño exigido** (evento → severidad → umbral →
> owner → respuesta), listo para cablearse en el sistema de observabilidad que
> se elija; los umbrales son propuestas operativas, no medidas.

---

## 1. Streams separados (implementados)

| Stream | Dónde | Contenido | Inmutable |
|---|---|---|---|
| **Audit log** | tabla `auditLog` | acciones sensibles con actor, org, target y metadata mínima | Sí (sin updates) |
| **Security events** | tabla `securityEvents` | denegaciones de autorización, límites alcanzados, OTP fallidos, uploads rechazados, accesos cross-tenant | Sí (solo inserción) |
| **Application logs** | consola JSON (dashboard de Convex) | errores de runtime y warnings. Sin PII ni contenido de documentos | N/A |

Regla de escritura ya verificada por test estático (`tests/static/dataLeakage.test.ts`):
el servidor **no** usa `console.*` para datos de usuario, y `securityEvents` se
escribe con campos derivados en servidor (nunca desde los argumentos del cliente).

---

## 2. Campos de un security event (autorización)

Desde VULN-14, cada denegación de autorización por la vía `api.audited.*` registra:

| Campo | Derivación | Valor |
|---|---|---|
| `kind` | fijo por tipo de decisión | `authz_denied_unauthenticated` · `authz_denied_authorized_user` · `authz_denied_cross_tenant` |
| `reason` | taxonomía CERRADA (`lib/denial.ts`) | `unauthenticated`, `not_a_member`, `insufficient_role`, `corrupt_membership`, `resource_not_found`, `cross_tenant`, `malformed_id`, `rate_limited`, `validation_failed`, `unknown` |
| `operation` | nombre de la operación del wrapper | p. ej. `orgs.removeMember` |
| `organizationId` | verificado en servidor | id de org o `undefined` |
| `tenantVerified` | resultado de la verificación | `true` solo si la org se comprobó en servidor |
| `correlationId` | nonce del servidor | único por petición (permite deduplicar sin perder eventos) |
| `userId` | del token, nunca del cliente | id del actor o `undefined` |
| `detail` | `operación:motivo` | sin PII |

---

## 3. Catálogo de eventos, severidad, umbral y respuesta

Leyenda de *Estado*: `IMPLEMENTADO` = el evento se escribe y hay test que lo
prueba. `NOT_VERIFIED` = no existe detección/alertado/canal de respuesta.

| # | Evento | Stream / `kind` | Severidad | Umbral propuesto (detección) | Owner | Respuesta esperada | Estado |
|---|---|---|---|---|---|---|---|
| 1 | Denegación de autorización | `securityEvents` `authz_denied_*` | Media (Alta si `cross_tenant`) | > 20/min por `userId`, o > 100/min global | SRE + Backend | Revisar identidad y recurso; si `cross_tenant`, escalar a incidente | **NOT_VERIFIED** (evento IMPLEMENTADO, alerta no) |
| 2 | Cross-tenant / IDOR | `securityEvents` `authz_denied_cross_tenant` | Alta | **cualquier** ocurrencia | Seguridad | Incidente P1: contener actor (`userId`), auditar accesos previos | **NOT_VERIFIED** |
| 3 | Intento de acceso sin sesión a endpoint protegido | `authz_denied_unauthenticated` | Baja | > 60/min por IP (requiere edge) | SRE | Rate limit en edge; si sostenido, bloqueo temporal | **NOT_VERIFIED** (la IP no es alcanzable desde la app — ver RATE_LIMITING.md) |
| 4 | Throttle de OTP alcanzado | `securityEvents` `otp_send_throttled` | Media | > 10/h por email | Seguridad | Anti email-bombing; vigilar rotación de destinatarios | `IMPLEMENTADO` (evento + tests del throttle) · alerta **NOT_VERIFIED** |
| 5 | Tope global de OTP (rotación de emails) | `securityEvents` (global) | Alta | **cualquier** disparo | Seguridad | Posible campaña de abuso: revisar `usageEvents`/`otpSendLog` | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 6 | Upload rechazado (tamaño/formato/magic bytes) | `securityEvents` `upload_rejected` | Baja | > 10/10min por `userId` | Seguridad | Vigilar intentos de evasión de filtros | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 7 | Límite de cuota alcanzado (CV/vacante/invitación/decisión/nota) | `securityEvents` `rate_limited` + `usageEvents` | Baja | > 5/h del mismo actor y cuota | Producto | Contactar al cliente si es un cliente real | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 8 | Cambio de rol o expulsión de miembro | `auditLog` `org.member.remove` | Media | cualquier ocurrencia de `org_admin` | Backend | Revisar si no fue solicitado | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 9 | Invitación creada/revocada | `auditLog` `org.invite` | Baja | picos > 20/h por org | Backend | Revisar | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 10 | Decisión humana (shortlist/reject) | `auditLog` `application.decide` | Baja | picos anómalos por usuario | Producto | Revisar sesgo/abuso | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 11 | Extracción IA fallida | `aiExtractions` `ok=false` | Media | tasa de error > 10% en 1 h | Backend / IA | Revisar proveedor; si es contenido filtrado, es esperado (fail-closed) | `IMPLEMENTADO` · alerta **NOT_VERIFIED** |
| 12 | Error de runtime | logs de consola | Media | > 5/min | Backend | Triage | **NOT_VERIFIED** (sin centralización ni alertas) |
| 13 | Backup fallido / verificación sha256 roja | (no existe stream propio) | Crítica | cualquier fallo | SRE | **Nada se pierde dos veces**: restaurar y re-verificar; la mecánica está probada (`backup_verify.sh`, `backup_restore_drill.sh`) | **NOT_VERIFIED** (no hay ejecución programada ni alerta) |
| 14 | Restore drill fuera de RTO | (no existe stream propio) | Alta | total > objetivo acordado | SRE | Revisar capacidad; el RTO aún **NOT_MEASURED** | **NOT_VERIFIED** |
| 15 | Rotación de token / reutilización | (no existe stream propio) | Media | ≥ 3 `sub` distintos desde la misma IP (requiere edge) | Seguridad | Revisar robo de token; revocar sesiones | **NOT_VERIFIED** |
| 16 | Subscription/uso de IA anómalo (coste) | `aiUsage` / `usageEvents` | Media | +50% del pico diario por org | Producto | Revisar abuso de coste | **NOT_VERIFIED** |

**Ninguna de las filas NOT_VERIFIED puede declararse verificada.** En particular,
el veredicto de observabilidad del production gate es `NOT_VERIFIED`: hay eventos
y hay streams, pero **no hay capacidad operativa de detección ni respuesta**.

---

## 4. Retención y acceso

| Aspecto | Estado | Nota |
|---|---|---|
| Retención de `securityEvents` | **NOT_DEFINED** | Sin política legal acordada (ver `PRIVACY.md` §5) |
| Retención de `auditLog` | **NOT_DEFINED** | Inmutable por diseño; sin política de purga |
| Acceso a los streams | solo CLI/dashboard | **No existe** query pública de `securityEvents` (verificado: ninguna función los expone) — evita convertir el log en canal de lectura cross-tenant |

---

## 5. Reglas de logging (obligatorias, ya aplicadas)

Nunca registrar: contraseñas, tokens, cookies, contenido completo de documentos,
emails en metadata libre (solo hash o prefijo), claves API.

Siempre registrar (metadata mínima): actor id, org id, tipo de acción, target id,
tamaño de fichero (nunca contenido) y código de resultado.
