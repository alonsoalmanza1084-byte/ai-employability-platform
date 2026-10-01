# RATE_LIMITING.md — Control de abuso pre-autenticación (GATE A)

> **ESTADO: BLOCKED BY PLATFORM — con evidencia experimental, no con suposiciones.**
> Verificado en esta sesión que la IP **sí es confiable** en el edge de Convex
> (el `X-Forwarded-For` inyectado por el cliente es **descartado**), pero que
> **el camino del OTP no pasa por ninguna ruta HTTP propia**, por lo que esa IP
> no es alcanzable desde el código de la aplicación.

---

## 1. Investigación ejecutada (no asumida)

### 1.1 ¿De dónde sale la IP?

Se implantó temporalmente una `httpAction` que devuelve los headers de IP y se
llamó dos veces: una limpia y otra con cabeceras inyectadas por el cliente.

```
Llamada limpia:   xff=170.9.60.163   cf-connecting-ip=170.9.60.163
                  x-real-ip=null  forwarded=null  x-client-ip=null

Llamada con cabeceras inyectadas por el cliente:
                  x-forwarded-for: 9.9.9.9, 8.8.8.8
                  x-real-ip:       7.7.7.7
                  x-client-ip:     6.6.6.6
                  forwarded:       for=5.5.5.5

IP_REPORT {"headersPresentes":{"xff":true,"cfConnectingIp":true,"xRealIp":false,"forwarded":false,"xClientIp":false},
           "spoofAceptado":false,
           "xffCambiaConHeaderInyectado":false,
           "veredicto":"NOT_SPOOFABLE"}
```

**Conclusión 1: la IP del edge es REAL y NO falsificable.** El edge de Convex
sobrescribe `x-forwarded-for` y `cf-connecting-ip` con la IP del cliente; el
valor inyectado no llega al origen. Un rate limiter por IP **sería fiable** en
este entorno, siempre que lea esos headers y no confíe en `x-real-ip`/`forwarded`
(no presentes).

### 1.2 ¿Por qué no se puede aplicar aquí?

Las rutas HTTP registradas por Convex Auth en el deployment son:

```
/.well-known/openid-configuration   GET
/.well-known/jwks.json              GET
/oauth/authorize                    GET
/api/auth/signin/*                   GET   (OAuth)
/api/auth/callback/*                GET/POST (OAuth)
```

**No hay ruta HTTP de envío de OTP.** El login por email-OTP es la **action**
`auth.signIn`, invocada por el cliente a través del endpoint de sincronía de
Convex (`POST /api/query` en `*.convex.cloud`). Esa request **no atraviesa
nuestro `httpRouter`** y su action context **no expone la IP**.

### 1.3 Las tres razones por las que no se puede cerrar aquí

| # | Razón | Evidencia |
|---|---|---|
| 1 | `QueryCtx` / `MutationCtx` / `ActionCtx` no exponen IP ni headers | `otpThrottle.ts` lo documenta; ninguna API del SDK lo ofrece |
| 2 | El envío de OTP ocurre en una action sobre `/api/query`, fuera de nuestro router | `grep` de las rutas de Convex Auth (arriba) |
| 3 | Una `httpAction` solo puede proteger rutas **que registremos nosotros**; no puede interponerse delante de `/api/query` | Convex no ofrece proxy inverso a nivel de deployment |

**Descartado explícitamente por ser falsa seguridad:**

- ❌ `X-Forwarded-For` en la app: aunque aquí sea confiable, **no llega** a la
  action del OTP. Y en otro entorno sin trusted proxy sería falsificable.
- ❌ `userId` como identificador pre-auth: el atacante aún no está autenticado.
- ❌ email como único identificador: se evade rotando el destinatario (por eso ya
  existe un tope global).
- ❌ `Map`/memoria del proceso: no es un rate limiter distribuido.
- ❌ Una action "guard" a la que el frontend llame antes de enviar: el atacante la
  ignora; sería teatro.

---

## 2. Lo que SÍ está implementado y verificado

| Control | Dónde | Evidencia |
|---|---|---|
| 5 envíos OTP/email/hora | `auth/otpThrottle.ts` | `tests/unit/security.test.ts` (6 tests del throttle) |
| Tope global 200 OTP/hora (corta la rotación de emails) | `OTP_GLOBAL_HOURLY_CAP` | "el backstop global corta la rotación de emails" |
| Normalización de email | `otpThrottle.ts` | "emails se normalizan (case-insensitive)" |
| Purga de filas fuera de ventana | `otpThrottle.ts` | "filas fuera de ventana se purgan y no cuentan" |
| Verificación OTP: 10 intentos fallidos/hora | Convex Auth (`authRateLimits`) | configuración del provider |
| 10 CVs/día por candidato, 50/día por organización | `lib/limits.ts` | `gates.integration.test.ts` |
| 20 vacantes/día, 20 invitaciones/día, 100 decisiones/día, 100 notas/día | `lib/limits.ts` | `api_surface.test.ts` |
| Cap de 3 intentos de extracción IA por CV | `candidates.ts`, `applications.ts` | "ambos pipelines capan los intentos de IA" |
| 5 organizaciones/día por usuario | `orgs.create` | integración |

---

## 3. Arquitectura requerida (reproducible)

```
Internet
   │
   ▼
┌───────────────────────────────────────────────────────────────┐
│ EDGE / WAF / CDN   ← el ÚNICO sitio válido para el límite IP  │
│  · IP real: cf-connecting-ip (probado no falsificable)         │
│  · estado compartido (Redis/KV), NO memoria de instancia      │
│  · 429 + Retry-After uniforme (sin enumeración de emails)      │
└───────────────┬───────────────────────────────────────────────┘
                │  proteja specifically:
                │  · *.convex.cloud/api/*   (sync: signIn, queries, mutations)
                │  · *.convex.site/api/auth/*
                │  · *.convex.site/storage/*
                ▼
        Aplicación Convex
                │  rate limit por IDENTIDAD (ya implementado y verificado)
                ▼
        Proveedor de email (OTP)
```

### 3.1 Puntos exactos a proteger

| Superficie | Regla propuesta |
|---|---|
| `POST *.convex.cloud/api/mutation`, `/api/action`, `/api/query` | 600 req/min/IP · 60 req/min por sesión autenticada |
| `*.convex.site/api/auth/*` | 20 req/min/IP · 200 req/día/IP |
| `*.convex.site/storage/*` | 300 req/min/IP |
| Sincronización WebSocket | 10 conexiones/IP · 200 mensajes/min |

### 3.2 Configuración necesaria

1. **CDN/WAF delante del deployment** (Cloudflare, Vercel Edge, AWS WAF, Fastly).
2. Política de rate limiting **por IP**, con estado compartido.
3. Respuesta **429 uniforme** con `Retry-After`; nunca distingue "email no existe"
   de "email limitado" (anti enumeración).
4. Allowlist para rangos corporativos legítimos.
5. Logs de 429 retenidos para auditoría.

### 3.3 Tests de contrato (ejecutables en cuanto exista el edge)

Implementados como especificación en `tests/edge/rateLimit.contract.test.ts`
(saltan con `NOT EXECUTED` mientras no haya edge):

| # | Ataque | Resultado esperado |
|---|---|---|
| E-1 | 5 IPs distintas × 5 OTP al mismo email | 429 a partir de la 6.ª (control por email) |
| E-2 | 1 IP × 201 OTP a emails distintos | 429 en la 201.ª (tope global) |
| E-3 | 1 IP × 25 POST `/api/auth/*` en 1 min | 429 a partir de la 21.ª |
| E-4 | `X-Forwarded-For: 1.2.3.4` falsificado | **NO** evade el límite |
| E-5 | Legítimo: 1 IP × 10 OTP | 200 en todos, sin falsos positivos |
| E-6 | Rotación de `Authorization` con el mismo token | 429/401, sin bypass |
| E-7 | Dos regiones detrás de la misma IP (NAT corporativo) | comportamiento documentado y aceptable |

### 3.4 Checklist de despliegue

- [ ] CDN/WAF creado y apuntando al deployment
- [ ] Reglas de rate limiting por IP aplicadas a las 4 superficies
- [ ] Estado compartido configurado (no in-memory)
- [ ] 429 con `Retry-After` verificado
- [ ] E-1…E-7 ejecutados y en verde
- [ ] Log de 429 habilitado y retenido
- [ ] `tests/edge/rateLimit.contract.test.ts` sin `skip`
- [ ] `docs/SECURITY_AUDIT.md` actualizado a VERIFIED

### 3.5 Mecanismo de verificación

```bash
EDGE_BASE_URL=https://<tu-waf>/  bunx vitest run tests/edge/rateLimit.contract.test.ts
```

Si `EDGE_BASE_URL` no está definido, el archivo reporta
`PRE-AUTH ABUSE = NOT EXECUTED (no edge)` y **falla**, de modo que no se pueda
declarar cerrado por descuido.

---

## 4. Veredicto

**PRE-AUTH ABUSE = BLOCKED BY PLATFORM.**

- La IP confiable **existe** y está probada.
- El punto donde hace falta **no es código de la aplicación**.
- La mitigación vive en el edge y requiere una decisión de infraestructura
  (Cloudflare/Vercel/AWS WAF) que no puede ejecutarse desde este repositorio.

Mientras tanto, la exposición real está acotada por los límites por identidad
ya verificados y por el tope global de 200 OTP/hora.