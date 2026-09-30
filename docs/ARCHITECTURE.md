# ARCHITECTURE.md

## 1. Comparación de arquitecturas

| Criterio | Monolito clásico | **Modular Monolith** | Microservicios |
|---|---|---|---|
| Velocidad de MVP | Alta | Alta | Baja |
| Límites de módulo | Ninguno (acoplamiento) | Explícitos por carpeta/módulo | Explícitos por red |
| Escalado | Todo o nada | Vertical + serverless | Independiente por servicio |
| Costo operacional | Bajo | Bajo | Alto (orquestación, observabilidad distribuida) |
| Complejidad transaccional | Simple | Simple (una BD) | Difícil (sagas, consistencia eventual) |
| Riesgo para un equipo pequeño | Deuda temprana | **Bajo** | Alto: sobrediseño prematuro |
| Camino a escala | Refactor doloroso | Extraer módulos a servicios cuando haya causa real | Ya está |

**Decisión: Modular Monolith sobre Convex (serverless).**

Razones:
1. Un solo deploy, una sola BD transaccional, sin orquestación de contenedores: el equipo itera features, no infraestructura.
2. Convex ya da las piezas "de microservicio" que sí valen la pena desde día 1: functions atómicas (query/mutation/action), scheduler (queue), almacenamiento de archivos, auth integrada, y escalado automático.
3. La modularidad se impone por convención de carpetas (`convex/candidates/*`, `convex/orgs/*`, …) y por reglas de dependencia (un módulo no toca tablas de otro módulo directamente; pasa por sus funciones). Esto hace trivial extraer un módulo a un servicio propio si algún día hay causa real (p.ej. parsing masivo).
4. No agregamos microservicios "por escalabilidad": Convex escala las functions horizontalmente; el cuello de botella real (IA externa) ya es un servicio aparte.

## 2. Mapa de componentes

```
┌─────────────────────────── Browser (React SPA) ───────────────────────────┐
│  Landing · Auth (OTP) · Candidate Dashboard (Mi CV + Diagnóstico)          │
│  Org workspace (vacantes, candidatos, matching)                            │
└──────────────┬────────────────────────────────────────────┬───────────────┘
               │ ConvexReactClient (WebSocket, auth token)  │
┌──────────────▼──────────── Convex Backend ─────────────────▼───────────────┐
│ queries/mutations (transaccionales, tenant-checked)                        │
│ actions ("use node"): parser, AI provider, ingest, invitations             │
│ scheduler: reintentos / jobs                                                │
│ fileStorage: CVs (privados, acceso por storageId server-side)              │
│ schema: users, organizations, members, candidates, resumes, jobs, matches… │
│ auditLog / usageEvents (observabilidad, metering)                          │
└──────────────┬────────────────────────────────────────────┬───────────────┘
               │ AI Provider Interface (abstracción)         │
┌──────────────▼────────────┐              ┌────────────────▼───────────────┐
│ LLM provider (OpenAI first,│              │ Email (OTP del template)       │
│ intercambiable via env)    │              │                                │
└────────────────────────────┘              └────────────────────────────────┘
```

## 3. Componentes y elección V1

| Capa | V1 | Alternativa considerada | Nota |
|---|---|---|---|
| Frontend | React 19 + Vite + Tailwind v4 + shadcn/ui + react-router | Next.js SSR | El producto es un app privado tras login; SSR no aporta SEO interno. Landing estática es suficiente |
| Backend/API | Convex functions (queries, mutations, actions, httpRouter) | Express/Fastify + Postgres | Convex da transacciones, reactividad y auth integradas; la "API" es tipada de punta a punta |
| Base de datos | Convex (documento + índices, transaccional) | Postgres + Prisma | Menos operación; índices explícitos por query (ver DATABASE.md) |
| Cache | La reactividad de Convex + client cache; sin Redis en V1 | Redis | No hay lectura computada caliente que lo justifique aún |
| Queue | Convex `ctx.scheduler` | BullMQ | Jobs actuales: reintentos de parsing. Suficiente |
| Object storage | Convex fileStorage (privado, URLs firmadas de corta vida) | S3 + CloudFront | Aislado por diseño; ver SECURITY.md |
| Search | Índices Convex + filtros | Elasticsearch/Typesense | V1 no necesita búsqueda de texto completo |
| AI services | AIProvider interface → OpenAI structured outputs | Anthropic, Gemini, self-host | Ver AI_PROVIDER.md; swap por env var |
| Authentication | Convex Auth (email OTP + guest) | Supabase Auth, Clerk | Ya integrado; OTP evita el problema de contraseñas (no hay hashing que gestionar en V1) |
| Authorization | RBAC server-side + tenant checks en cada función | Policies en BD | Ver RBAC.md; nunca confiar en el cliente |
| Billing | Fuera de V1 (diseño en BILLING.md) | Stripe ahora | El prompt pide no implementar precios sin análisis de costos |
| Email | Proveedor del template (OTP) | Resend/SES | Custom en fase posterior |
| Notifications | In-app (tabla `notifications`) V1 | + email/push después | |
| Logging | `auditLog` estructurado + console JSON en actions | Sentry/Loki | Los 3 streams separados: app / seguridad / auditoría |
| Monitoring | Logs + health endpoint básico | Sentry, APM | Formalizar en OBSERVABILITY.md |
| Analytics | Eventos de uso (`usageEvents`) | PostHog | La base ya sirve de metering |
| Background jobs | Convex scheduler | Cron worker | Reintentos de extracción |
| File processing | Parser (pdf/docx/txt) en action "use node" | Microservicio de parsing | Módulo aislado y extraíble |
| Document generation | Fuera de V1 | pdfkit/react-pdf | Fase posterior |

## 4. Flujo de datos clave (subida de CV)

1. `POST` (mutation) `resumes.initUpload` → valida sesión/rol → genera `fileStorageId` para subida directa.
2. El browser sube el binario a storage (privado).
3. `ingestCv` (action, "use node"): descarga el archivo → valida magic bytes + tamaño → extrae texto (parser) → corta a límite de caracteres → llama AIProvider con prompt versionado y JSON schema → valida salida con zod → calcula diagnóstico determinista → escribe todo en una transacción (resumeVersion + candidateProfile + auditLog + usageEvent).
4. Si la IA falla → estado `failed` con razón accionable y reintento manual/scheduler.

El matching de empresa reusa pasos 1–3 y añade: 5) match determinista → `CandidateJobMatch` con evidencia → 6) el reclutador decide (estado manual).

## 5. Reglas de dependencia entre módulos

- `convex/candidates/*` no importa de `convex/orgs/*` y viceversa; comparten `convex/lib/*`.
- Toda escritura pasa por mutation con checks de auth+tenant+RBAC (sin excepciones).
- Toda acción IA pasa por `lib/ai` (nunca SDK directo en handlers de negocio).
- Todo job de background es idempotente por clave (`dedupeKey`).
