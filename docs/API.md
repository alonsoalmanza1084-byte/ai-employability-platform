# API.md — Contrato de API V1

Convex expone funciones tipadas (no REST). Este documento es el contrato equivalente y sirve como base para generar OpenAPI si se necesita un gateway público en el futuro. Todo endpoint = una función Convex con validación de args por schema (equivalente a request validation), chequeos server-side de AUTH/ROLE/OWNERSHIP/TENANT, y error handling estándar.

Convenciones:
- **Errores:** `Error` con mensaje seguro para usuario (nunca stack/SQL). Códigos internos documentados por función.
- **Paginación:** cursores Convex (`paginate`) donde hay listas potentially grandes (applications por job).
- **Idempotencia:** claves `dedupeKey` en eventos de uso; uploads generan ids server-side.
- **Rate limit:** ver sección 3.
- **Auditoría:** funciones marcadas 🔍 escriben a `auditLog`.

## 1. Auth (Convex Auth — email OTP + guest)
| METHOD | PATH | AUTH | ROLE | REQUEST | RESPONSE | ERRORS |
|---|---|---|---|---|---|---|
| POST | /api/auth/signIn/email-otp | pública | — | email | envía código OTP | rate limit |
| POST | /api/auth/verify | pública | — | email+code | sesión httpOnly | código inválido |
| POST | /api/auth/signOut | sesión | — | — | — | — |

## 2. Funciones de producto

### users
| FUNC | AUTH | ROLE | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|---|
| `users.currentUser` | sesión | — | — | user \| null | — | — |
| `users.ensureProfile` | sesión | auto | `{role?}` | user | — | — |

### candidates (módulo candidato)
| FUNC | AUTH | ROLE | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|---|
| `candidates.myProfile` | sesión | candidate | — | perfil \| null | — | — |
| `candidates.initUpload` 🔍 | sesión | candidate | `{fileName, fileSize, mimeType}` | `{uploadUrl, resumeId, resumeVersionId}` | 10/día | cv.upload |
| `candidates.ingestCv` 🔍 (action) | sesión | candidate | `{resumeVersionId}` | `{status}` | cola interna | cv.extract |
| `candidates.updateProfile` 🔍 | sesión | candidate | edición estructurada | perfil actualizado | 30/h | profile.update |
| `candidates.setActiveVersion` 🔍 | sesión | candidate | `{resumeVersionId}` | ok | 10/h | cv.activate |
| `candidates.diagnosis` | sesión | candidate | — | `{scores, reasons, opportunities}` | — | — |

### orgs (módulo empresa)
| FUNC | AUTH | ROLE | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|---|
| `orgs.myOrgs` | sesión | — | — | orgs del usuario | — | — |
| `orgs.create` 🔍 | sesión | — | `{name}` | org + owner member | 3/día | org.create |
| `orgs.invite` 🔍 | org_admin | — | `{orgId, email, role}` | invitación | 20/día | org.invite |
| `orgs.acceptInvite` 🔍 | sesión | — | `{token}` | member | — | org.join |

### jobs
| FUNC | AUTH | ROLE | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|---|
| `jobs.listByOrg` | member | recruiter+ | `{orgId}` | vacantes | — | — |
| `jobs.get` | member | recruiter+ | `{jobId}` | vacante + requisitos | — | — |
| `jobs.create` 🔍 | member | org_admin/recruiter | `{orgId, title, description, location, seniority, requirements[]}` | jobId | 20/día | job.create |
| `jobs.close` 🔍 | member | org_admin | `{jobId}` | ok | — | job.close |

### applications
| FUNC | AUTH | ROLE | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|---|
| `applications.initUpload` 🔍 | member | recruiter+ | `{jobId, fileName, fileSize, mimeType}` | `{uploadUrl, applicationId}` | 50/día/org | cv.upload (org) |
| `applications.ingestCv` 🔍 (action) | member | recruiter+ | `{applicationId}` | `{status}` | cola interna | cv.extract (org) |
| `applications.listByJob` | member | recruiter+ | `{jobId}` | aplicantes + match resumido | — | — |
| `applications.decide` 🔍 | member | recruiter+ | `{applicationId, status, note?}` | ok (nota obligatoria si reject) | 100/día | application.decide |
| `applications.addNote` 🔍 | member | recruiter+ | `{applicationId, body}` | note | 100/día | note.create |

### matches
| FUNC | AUTH | ROLE | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|---|
| `matches.getForApplication` | member | recruiter+ | `{applicationId}` | match completo con evidencia | — | — |

### coach (Career Coach IA — incremento 1: SOLO LECTURA)
| FUNC | AUTH | REQUEST | RESPONSE | RATE | AUDIT |
|---|---|---|---|---|---|
| `coach.getConversation` | self | `{}` | `{conversation, messages}` o `null` | — | — |
| `coach.startConversation` | self | `{}` | `{ok:true, conversationId}` o `{ok:false, code, reason, conversationId?}` | 3 nuevas/día | `coach.session.start` |
| `coach.sendMessage` 🔍 | self | `{conversationId, message ≤1500}` | `{ok:true}` o `{ok:false, code, reason}` | 6/hora y 30/día | `coach.message.create` · `coach.ai.failed` · `rate_limited` (securityEvents) |

🔍 `sendMessage` es una **action**: el gate de ownership + cuotas corre en `prepareSend` (internalMutation, transaccional) ANTES de llamar a la IA — si el gate falla, no hay llamada al proveedor ni escrituras parciales. El cliente nunca envía `userId`; el hilo activo se resuelve server-side. Los fallos devuelven `{ok:false, code, reason}` con un mensaje SEGURO (códigos cerrados: `RATE_LIMITED`, `TIMEOUT`, `SCHEMA_INVALID`, `PROVIDER_ERROR`, `CONTENT_FILTERED`, `INTERNAL`, `NO_PROFILE`, `NOT_FOUND`, `VALIDATION`, …). Ver `docs/CAREER_COACH.md`.

## 3. Rate limits V1

Implementados server-side contando eventos por ventana (tabla `usageEvents` con `dedupeKey` compuesto por usuario+ventana):

| Acción | Límite |
|---|---|
| Subida CV candidato | 10/día |
| Subida CV empresa (por org) | 50/día |
| Llamadas IA (extracción) | por CV (1 re-proceso gratis por error) |
| Decisions/notes | 100/día |
| Invitaciones | 20/día |
| Coach: mensajes | 6/hora y 30/día (consumo atómico ANTES de la IA) |
| Coach: conversaciones nuevas | 3/día |

El excedente responde con error `RATE_LIMITED` y mensaje claro. Los límites son configurables en un único archivo (`convex/lib/limits.ts`).

## 4. Validación

Todos los args se validan con `v.object(...)` de Convex + refinamientos zod en actions (tamaño de archivo, MIME, longitud de texto). Nunca se acepta `userId`/`organizationId` "confiado" del cliente sin verificar membresía/ownership server-side.

## 5. Errores estándar

| Código | HTTP equivalente | Cuándo |
|---|---|---|
| `UNAUTHENTICATED` | 401 | sin sesión |
| `FORBIDDEN` | 403 | sesión válida pero sin rol/ownership/tenant |
| `NOT_FOUND` | 404 | recurso inexistente o de otro tenant (se responde igual para no filtrar existencia) |
| `RATE_LIMITED` | 429 | excede límites |
| `INVALID_INPUT` | 400 | args inválidos |
| `AI_FAILED` | 502 | proveedor IA falló (con reintento) |
