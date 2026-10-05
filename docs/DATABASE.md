# DATABASE.md — Modelo de datos V1

Convex: tablas de documento + índices explícitos. `authTables` (users, authSessions, authAccounts, …) proviene de Convex Auth y no se modifica.

## 1. Entidades y relaciones

```
users ─┬─ candidateProfiles (1:1)          organizations ─┬─ organizationMembers
       ├─ resumes (1:N) ─ resumeVersions ─┘               ├─ jobs ─ jobRequirements
       ├─ invitations (por email)                         ├─ applications ─┬─ candidateJobMatches
       ├─ orgProfiles (persona RH, 1:N orgs)              │                ├─ recruiterNotes
       └─ notifications                                   │                └─ aiExtractions
                                                          └─ auditLog (org scope)
coachConversations ─ coachMessages, aiCoachCalls (Career Coach, incremento 1), usageEvents, aiUsage, subscriptions/plans/invoices, securityEvents (fases 3+)
```

## 2. Tablas

### users (extends authTables)
| Campo | Tipo | Notas |
|---|---|---|
| name / image / email / emailVerificationTime / isAnonymous | (template) | no modificar |
| role | `"candidate" \| "recruiter" \| "org_admin" \| "platform_admin"` | rol primario del usuario; guest → candidate |

Índice: `email`. Constraint: un email verificado = una cuenta (lo maneja Convex Auth).

### candidateProfiles
| Campo | Tipo |
|---|---|
| userId | Id<"users"> (unique — índice) |
| headline, location, summary | string |
| yearsExperience | number |
| skills | `{name, level 1-5, source: "ai"\|"human", evidence?, confidence?}[]` |
| experience | `{company, title, start, end?, current?, description, achievements[], source, evidence?, confidence?}[]` |
| education | `{institution, degree, field, startYear?, endYear?, source}[]` |
| certifications | `{name, issuer, year?, source}[]` |
| completeness | `{score 0-100, missing[]}` (cache del diagnóstico) |
| updatedAt | number |

Índices: `by_user (userId unique)`.

### resumes
| Campo | Tipo |
|---|---|
| userId | Id<"users"> |
| activeVersionId | Id<"resumeVersions">? |
| createdAt | number |

Índices: `by_user (userId)`.

### resumeVersions
| Campo | Tipo |
|---|---|
| resumeId, userId | ids |
| version | number (incremento por resume) |
| fileName, fileSize, mimeType | string/number |
| storageId | Id<"_storage"> (privado) |
| extractedText | string (truncado a 24k chars) |
| status | `"uploaded" \| "processing" \| "ready" \| "failed"` |
| failureReason? | string |
| isActive | boolean |

Índices: `by_resume (resumeId, version desc)`, `by_user (userId)`.
Soft-delete: `deletedAt?`. Nunca borramos el binario al fallar un parseo (auditabilidad), solo al eliminar cuenta.

### organizations
| Campo | Tipo |
|---|---|
| name, slug (unique) | string |
| createdByUserId | Id<"users"> |

Índice unique: `slug`.

### organizationMembers
| Campo | Tipo |
|---|---|
| organizationId, userId | ids (unique juntos) |
| role | `"org_admin" \| "recruiter" \| "hiring_manager"` |
| invitedByEmail? | string |
| status | `"active"` |

Índice unique: `(organizationId, userId)`; índice `by_user (userId)`.

### invitations
| Campo | Tipo |
|---|---|
| organizationId, email, role, tokenHash, invitedByUserId, expiresAt, acceptedAt? | |
| status | `"pending" \| "accepted" \| "revoked"` |

Índices: `by_org_status`, `by_token (tokenHash)`.

### jobs
| Campo | Tipo |
|---|---|
| organizationId, createdByUserId | ids |
| title, description, location, seniority | string |
| status | `"draft" \| "open" \| "closed"` |

Índices: `by_org (organizationId, status)`.

### jobRequirements
| Campo | Tipo |
|---|---|
| jobId | Id<"jobs"> |
| type | `"skill" \| "experience_years" \| "education" \| "certification"` |
| label | string (ej. "React") |
| minLevel? | 1–5 (para skills) |
| minYears? | number |
| weight | number 0–1 (normalizado por job) |
| isMustHave | boolean |

Índice: `by_job (jobId)`.

### applications
| Campo | Tipo |
|---|---|
| jobId, organizationId | ids |
| candidateProfileId | Id<"candidateProfiles">? |
| source | `"recruiter_upload" \| "candidate_application"` |
| status | `"pending" \| "shortlisted" \| "rejected"` — **solo cambio humano** |
| decidedByUserId?, decidedAt?, decisionNote? | |
| fileName, fileSize, mimeType, storageId, extractedText | (CV del aplicante) |
| headline, fullName | string |
| createdAt | number |

Índices: `by_job (jobId, status)`, `by_org (organizationId)`.

### candidateJobMatches
| Campo | Tipo |
|---|---|
| applicationId, jobId, organizationId | ids (unique por applicationId) |
| overall, skills, experience, education | number 0–100 |
| requirements | `{requirementId, met: boolean, score 0-100, evidence, gap?}[]` |
| engineVersion | string |
| createdAt | number |

Índices: `by_application (applicationId)`, `by_job (jobId, overall)`.

### recruiterNotes
| Campo | Tipo |
|---|---|
| applicationId, organizationId, authorUserId | ids |
| body | string |

Índice: `by_application (applicationId, _creationTime)`.

### aiExtractions
| Campo | Tipo |
|---|---|
| resumeVersionId? / applicationId? | origen |
| model, promptVersion | string |
| inputTokens, outputTokens | number |
| durationMs | number |
| ok | boolean |
| error? | string |

Índice: `by_version (resumeVersionId)`.

### coachConversations / coachMessages / aiCoachCalls (Career Coach, incremento 1)

#### coachConversations
| Campo | Tipo |
|---|---|
| userId | Id<"users"> |
| status | `"active" \| "closed"` (solo el `active` acepta mensajes) |
| promptVersion | string (`career_coach.v1.0`) |
| createdAt / updatedAt | number |

Índices: `by_user (userId)`, `by_user_status (userId, status)`.

#### coachMessages
| Campo | Tipo |
|---|---|
| conversationId, userId | ids |
| role | `"user" \| "assistant"` |
| content | string (acotado en servidor: 1500 user / 4000 assistant) |
| intent? | `explain_diagnosis \| ask_question \| discover_gap \| general` |
| questions? / observations? | `string[]` (0..5 / 0..8, acotados) |
| confidence? | number 0..1 |
| requestId? / promptVersion? | string (correlación y trazabilidad, SIN contenido) |
| createdAt | number |

Índice: `by_conversation (conversationId)`. **El coach SOLO inserta aquí**: nunca escribe en `candidateProfiles` (incremento 1 read-only).

#### aiCoachCalls (telemetría, SIN contenido)
| Campo | Tipo |
|---|---|
| conversationId, userId | ids |
| requestId | string (correlación con el mensaje del asistente) |
| model / promptVersion | string |
| inputTokens / outputTokens / durationMs | number |
| ok | boolean |
| error? | string = **código cerrado** (`RATE_LIMITED`/`SCHEMA_INVALID`/`PROVIDER_ERROR`/`TIMEOUT`/`CONTENT_FILTERED`); nunca el mensaje crudo |

Índices: `by_conversation (conversationId)`, `by_user (userId)`.
**Techo estructural:** `LIMITS.maxCoachCallsPerConversation` (100) se hace cumplir en `prepareSend`, de modo que el borrado en cascada de `deleteAccount` es acotado y exhaustivo.

### auditLog
| Campo | Tipo |
|---|---|
| organizationId? | tenant scope cuando aplica |
| actorUserId? | quién |
| action | string (`"cv.upload"`, `"cv.extract"`, `"match.create"`, `"application.decide"`, `"org.invite"`, …) |
| targetType / targetId | string |
| metadata | objeto pequeño (sin contenido sensible) |
| createdAt | number |

Índices: `by_org (organizationId, createdAt)`, `by_actor (actorUserId, createdAt)`.
**Regla:** nunca loguear contenido de CV, texto extraído, emails completos en metadata libre.

### notifications
| Campo | Tipo |
|---|---|
| userId, type, payload, readAt? | |

Índice: `by_user (userId, readAt)`.

### usageEvents
| Campo | Tipo |
|---|---|
| userId, organizationId?, kind, quantity, dedupeKey? (unique) | |
| metadata | |

Índice unique: `dedupeKey` (idempotencia — ver BILLING.md).

### securityEvents
| Campo | Tipo |
|---|---|
| kind, userId?, ip?, userAgent, detail, createdAt | |

Índice: `by_kind (kind, createdAt)`.

## 3. Multi-tenancy y aislamiento

- Toda tabla con datos de org lleva `organizationId` **y** todos sus índices de lectura lo incluyen como prefijo. Nadie puede "buscar" datos de otra org porque la query obliga a filtrar por org (ver MULTI_TENANCY.md).
- `userId` en tablas personales (`resumes`, `resumeVersions`, `candidateProfiles`) es siempre el del actor autenticado; ninguna query acepta `userId` del cliente.
- Soft-delete en `resumeVersions`, `applications` y `candidateProfiles` (campo `deletedAt`); el hard-delete ocurre en "eliminar cuenta" (ver PRIVACY.md).
- Timestamps: `_creationTime` (Convex) + `updatedAt` explícito donde hay ediciones.
