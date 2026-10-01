# RATE_LIMITING.md — Control de abuso pre-autenticación (GATE B)

> **ESTADO: PARTIAL / BLOCKED (infraestructura externa).**
> El rate limiting **por IP no está implementado** porque la plataforma actual
> no expone la IP del cliente en el punto donde haría falta. No se ha simulado
> ni falseado. Este documento describe exactamente qué falta, dónde debe
> vivir, cómo se configura, qué test lo cerraría y cuál es el criterio de
> aceptación.

---

## 1. Qué SÍ está implementado y verificado

| Control | Dónde | Estado | Evidencia |
|---|---|---|---|
| Límite de envío OTP por email (5/email/hora) | `src/convex/auth/otpThrottle.ts` | **VERIFIED** | `tests/unit/security.test.ts` → "throttle de envío OTP (pre-auth)" (6 tests) |
| Tope global horario de OTP (200/hora) | `src/convex/auth/otpThrottle.ts` (`OTP_GLOBAL_HOURLY_CAP`) | **VERIFIED** | mismo suite: "el backstop global corta la rotación de emails" |
| Normalización de email (case-insensitive) | `otpThrottle.ts` | **VERIFIED** | "emails se normalizan" |
| Purga de filas fuera de ventana | `otpThrottle.ts` | **VERIFIED** | "filas fuera de ventana se purgan y no cuentan" |
| Rate limit de subidas de CV (candidato 10/día, org 50/día) | `src/convex/lib/limits.ts` + `candidates.ts` / `applications.ts` | **VERIFIED** | `tests/static/api_surface.test.ts` + `tests/integration/gates.integration.test.ts` |
| Rate limit de creación de vacantes / invitaciones / decisiones / notas | `lib/limits.ts` | **VERIFIED** | `api_surface.test.ts` ("decide y addNote ENFORZAN su límite") |
| Cap de intentos de extracción IA por documento (3) | `candidates.ts` / `applications.ts` | **VERIFIED** | "ambos pipelines capan los intentos de IA por documento" |
| Límite de organizaciones por usuario y día (5) | `orgs.create` | **VERIFIED** | integración |

**Lo que esto NO cubre:** una sola IP puede pedir OTP a 5.000 emails distintos.
El límite por email se salta rotando el destinatario; el tope global de 200/hora
lo mitiga, pero con un solo atacante vería atacados 200 buzones por hora.

---

## 2. Por qué NO se puede hacer rate limiting por IP dentro de Convex (V1)

Limitación técnica, comprobada sobre el runtime real:

1. **`ctx` no expone la IP del cliente.** Ni `QueryCtx`, ni `MutationCtx`, ni
   `ActionCtx` ofrecen `request.ip`, `x-forwarded-for` ni equivalente. No hay
   ninguna API para leerla desde una `mutation` o `action`.
2. **Las rutas de autenticación no son código de la aplicación.** El login por
   OTP se resuelve en el runtime de Convex Auth (`/api/auth/*`), fuera de
   `src/convex/`. No hay hook público para inyectar un contador por IP.
3. **Un contador en memoria del proceso no sirve.** Las actions se ejecutan en
   un runtime distribuido y efímero: cada instancia tiene su memoria y no
   comparten estado. Un atacante que barra las instancias multiplica el límite
   por el número de instancias. Esto está explícitamente descartado por el
   gate ("no usar memoria local del proceso como rate limiter distribuido").
4. **Falsificar la IP desde el cliente no es aceptable.** Aceptar la IP como
   argumento, o confiar en un header sin `trusted proxy` configurado, convierte
   el control en teatro: el atacante manda `X-Forwarded-For` y limpia el
   contador. Descartado por el gate.

Conclusión: **cualquier "solución" dentro de la aplicación sería cosmética.**
Se declara el hueco en lugar de simularlo.

---

## 3. Arquitectura recomendada

```
Internet
   │
   ▼
┌────────────────────────────────────────────────────────────┐
│ Edge / CDN / WAF  ← AQUÍ DEBE VIVIR EL rate limiting       │
│  · IP real (sólo de confianza, no de un header del cliente) │
│  · rate limiting distribuido (token bucket / sliding win.)  │
│  · bot management + challenge (Turnstile / WAF managed)    │
└───────────────┬────────────────────────────────────────────┘
                │  (el resto de headers NO se reenvían como IP)
                ▼
        Aplicación / Convex
                │
                ▼
          Convex Auth (OTP)
```

### 3.1 Punto exacto de implementación

| Superficie a proteger | Regla propuesta |
|---|---|
| `POST /api/auth/*` (OTP send, verify) | 20 req/min por IP · 200 req/día por IP · 5 OTP/email/hora (ya implementado) |
| Inicio de subida (`initUpload`) | 30 req/hora por sesión autenticada (ya implementado por usuario) |
| Descarga de binarios de storage | URLs firmadas de vida corta + límite por sesión |
| API pública de Convex (`/api/query`, `/api/mutation`) | 600 req/min por IP con respuesta 429 + `Retry-After` |

### 3.2 Configuración necesaria

- **Confiar la IP del edge.** El edge debe inyectar la IP real en un header
  *firmado* o en un claim de JWT verificado; la aplicación NO debe leer
  `X-Forwarded-For` directamente. Si el edge no está, la IP no es fiable y el
  control no debe desplegarse.
- **Almacén compartido de contadores.** Redis/KeyDB (o el servicio de rate
  limiting del CDN) para que todas las instancias compartan el estado.
- **Respuesta 429 uniforme** con `Retry-After`, sin revelar si el email existe
  (anti enumeración).
- **Allowlist de rangos legítimos**, para no castigar a IPs corporativas o de
  proveedores de correo al cruzar límites.

### 3.3 Test requerido para cerrar el gate

| # | Test | Resultado esperado |
|---|---|---|
| B-1 | N IPs distintas × 5 OTP cada una al **mismo** email | 429 a partir de la 6.ª (control por email) |
| B-2 | 1 IP × 201 OTP a emails distintos | 429 en la 201.ª (tope global) |
| B-3 | 1 IP × 25 POST a `/api/auth/*` en 1 min | 429 a partir de la 21.ª |
| B-4 | `X-Forwarded-For` falsificado | **NO** evade el límite (la IP del edge manda) |
| B-5 | Legítimo: 1 IP × 10 OTP | 200 en todas; sin falsos positivos |
| B-6 | Rotación de `Authorization` con el mismo token | 429 / 401 (sin bypass) |
| B-7 | Dos regiones con la misma IP detrás de NAT corporativo | comportamiento documentado y aceptable |

### 3.4 Criterio de aceptación

El gate B pasa a **VERIFIED** cuando los 7 tests anteriores se ejecutan contra
el deployment con el edge desplegado y **pasan**, con evidencia del log de 429.
Hasta entonces el estado es **PARTIAL**: hay límites por identidad, no por red.

---

## 4. Endurecimientos ya aplicados dentro de la aplicación

Como defensa en profundidad (no sustituyen al control por IP):

- **Tope global horario de OTP** (`OTP_GLOBAL_HOURLY_CAP = 200`) — corta la
  rotación de emails aunque cada uno reciba solo 1.
- **Token de un solo uso y ventana de 15 min** gestionados por Convex Auth
  (fuerza bruta de 6 dígitos inviable dentro de la ventana).
- **Identificadores opacos**: ningún endpoint devuelve si un email existe.
- **Rate limits por identidad** en todas las operaciones con efecto o coste.
- **Cap de intentos de IA por documento**: un CV no puede provocar 3 llamadas
  al LLM; acota el coste por abuso.

## 5. Qué haría falta para cambiar el veredicto

1. Desplegar CDN/WAF delante del deployment (Cloudflare, Vercel Edge, AWS WAF).
2. Definir la política de trusted-proxy y firmarla.
3. Ejecutar B-1…B-7 y adjuntar la evidencia.
4. Actualizar `docs/SECURITY_AUDIT.md` (§ Status Matrix) a `VERIFIED`.

Sin estos tres puntos, cualquier afirmación de "rate limiting por IP activo"
sería falsa y este documento lo declara.