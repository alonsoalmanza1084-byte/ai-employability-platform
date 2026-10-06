# CAREER_COACH.md — Career Coach IA

> **Incremento 1 (implementado): SOLO LECTURA.** Decisiones de producto del usuario:
> alcance = solo incremento 1 (leer perfil, explicar diagnóstico, hacer preguntas,
> descubrir gaps); `RETENTION_POLICY = NOT_DEFINED`; cuotas conservadoras y
> fail-closed. **No** modifica el perfil, **no** persiste propuestas, **no**
> incluye Mode C/D.
>
> **PRODUCTION READY = NO** (el Production Gate de `docs/PRODUCTION_READINESS.md`
> sigue vigente con sus 13 blockers; este incremento no lo altera).

---

## 1. Qué hace (y qué no)

| Sí hace | No hace (incrementos posteriores) |
|---|---|
| Lee `candidateProfiles` + `computeDiagnosis` (determinista) | Escribir en el perfil (ADR-011) |
| Explica el diagnóstico y sus dimensiones | Modo C (matching) / Modo D |
| Hace preguntas para descubrir gaps | Hablar de salarios (§26) ni atributos protegidos (§25) |
| Devuelve observaciones verificadas contra la evidencia | Retención de datos (NOT_DEFINED por decisión) |
| **Incremento 2: propone sugerencias PENDING revisables** (`coachClaims → coachEvidence → coachProposals`, `pending|rejected`, sin aplicar al perfil) | Aplicar propuestas automáticamente (aún no existe `accepted`) |

## 2. Arquitectura del flujo `sendMessage`

```
UI (tab «Coach», Dashboard.tsx)
  └─ action coach.sendMessage {conversationId, message}
       1. internalMutation coach.prepareSend   ← gate ATÓMICO y fail-closed
          · requireSelf (ownership por sesión; jamás userId del cliente)
          · conversación existe + status "active"
          · validación 1..1500 chars
          · perfil existe (NO_PROFILE ANTES de consumir cuota)
          · techo de mensajes y de llamadas por conversación
          · cuotas hora (6) y día (30): chequeo + consumo en la MISMA
            transacción (anti carreras) y ANTES de la IA
          · devuelve el contexto: evidencia saneada + historial acotado
       2. buildCareerCoachUserContent → bloques <cv_evidence>, <conversacion>,
          <candidate_message> (sanitizeUserText: delimitadores eliminados,
          escapado de < >, control/zero-width fuera, tope de longitud)
       3. AIProvider.complete(task: "career_coach") con
          CAREER_COACH_SYSTEM_PROMPT_V1 + zod `careerCoachResponseSchema`
       4. verifyCoachResponse (post-check): descarta `observations` no
          sustentadas en la evidencia real y acota confidence ≤0.5
       5. internalMutation coach.appendExchange → UNA transacción:
          mensaje usuario + mensaje asistente + fila aiCoachCalls + audit
       · Si la IA falla: NADA de lo anterior; recordAiFailure deja SOLO el
         código cerrado en aiCoachCalls + audit coach.ai.failed.
```

Módulos:

| Archivo | Papel |
|---|---|
| `src/convex/coach.ts` | `getConversation` (query), `startConversation` (mutation), `sendMessage` (action) + internals `prepareSend`/`appendExchange`/`recordAiFailure` |
| `src/convex/lib/ai/coach_prompts.ts` | `CAREER_COACH_PROMPT_VERSION`, `CAREER_COACH_SYSTEM_PROMPT_V1`, `buildCareerCoachUserContent` |
| `src/convex/lib/ai/coach_schemas.ts` | zod `careerCoachResponseSchema` + JSON schema (structured outputs) |
| `src/convex/lib/ai/evidence.ts` | `verifyCoachResponse` + `COACH_EVIDENCE_MIN_OVERLAP` (0.4) + regla numérica (toda cifra de la afirmación, literal completo, debe estar en el contexto) |
| `src/convex/lib/ai/prompts.ts` | `sanitizeUserText` (compartido con la extracción de CV, ADR-008) |
| `src/convex/lib/limits.ts` | cuotas y techos estructurales del coach |
| `src/pages/Dashboard.tsx` | tab «Coach» (componente `Coach`) |

## 3. Modelo de datos (ver `docs/DATABASE.md` §2 y §6)

- `coachConversations` — `by_user`, `by_user_status`; `status active|closed`.
- `coachMessages` — `by_conversation`; contenido acotado en servidor; `intent`
  es un enum cerrado; solo el asistente lleva `questions/observations/confidence`.
- `aiCoachCalls` — telemetría SIN contenido: requestId, model, promptVersion,
  tokens, duración, `ok`, `error` = código cerrado.
- `coachClaims` (Incremento 2) — `by_user`, `by_conversation`; `claimText`
  (1..600), `status verified|rejected` (lo asigna el BACKEND, nunca el LLM),
  `confidence` 0..1, `promptVersion`.
- `coachEvidence` (Incremento 2) — `by_claim`; `sourceType`
  `profile|diagnosis|conversation`, `sourceId` resuelto contra documentos
  REALES del dueño (fail-closed: lo no verificable no se persiste), `excerpt`
  (1..400), `confidence`. Relación: claim 1 → N evidence → 1 proposal.
- `coachProposals` (Incremento 2) — `by_user`, `by_conversation`, `by_claim`;
  `proposedText` (1..600), `status pending|rejected` (**no existe `accepted`**),
  `confidence`, `promptVersion`. Máx. 6 por conversación. La propuesta NUNCA
  escribe en `candidateProfiles` (INV-013/018).

`deleteAccount` (PRIVACY) borra en cascada conversaciones + mensajes +
telemetría, y claims → evidence + proposals (más proposals huérfanas por
`userId`) con lecturas acotadas por los techos de `LIMITS`.

## 4. Seguridad (mapeo a controles existentes)

| Control | Implementación |
|---|---|
| Prompt injection (ADR-008) | bloques delimitados + `sanitizeUserText` (el usuario NO puede cerrar un bloque) + regla explícita 6 en el system prompt |
| Alucinación (AI_SECURITY §6) | `verifyCoachResponse` = **HEURISTIC_GROUNDING_CHECK** (no «evidencia verificada»): substring normalizado o ≥40% de tokens **+ toda cifra afirmada debe existir literalmente en el contexto** (regla numérica anti-invención: «15 años» no pasa si el perfil solo dice «3 años»); confidence ≤0.5 si se descarta algo |
| Salida no confiable | zod estricto (longitudes, enums, arrays acotados) + re-acotado en `appendExchange` |
| Atributos protegidos (§25) / salario (§26) | reglas 3 y 4 del system prompt; sin datos de contacto ni credenciales (regla 5) |
| Autorización | `requireSelf` en las 3 públicas; ownership revalidado en cada internal; sin `userId` en args |
| Cuotas (decisión: conservadoras) | 6/hora, 30/día, 3 conversaciones/día; consumo atómico antes de la IA; techo 100 llamadas/conversación |
| Fallos del proveedor | `{ok:false, code, reason}` con mensaje seguro; enum cerrado de códigos; cero escrituras parciales |
| Auditoría | `coach.session.start`, `coach.message.create`, `coach.ai.failed` (auditLog) + `rate_limited` (securityEvents, convención de `cv.upload`) |
| Read-only real | sin ninguna ruta de escritura a `candidateProfiles` (guard estático + test de integración que compara el perfil antes/después) |
| Data leakage | sin `console.*`; telemetría sin contenido; prompts jamás persistidos (guards `dataLeakage`/`api_surface`) |

## 5. Evaluación (evidencia de ejecución)

| Suite | Resultado |
|---|---|
| `tests/unit/coach.security.test.ts` | **20/20** (guardrails del prompt, sanitizado/anti-inyección, zod, post-check, cuotas) |
| `tests/static/api_surface.test.ts` | **39/39** (inventario del módulo, requireSelf, cuotas ANTES del proveedor, sin escritura de perfil, eventos de auditoría cerrados, sin `.collect()`/`v.any()`) |
| `tests/static/dataLeakage` + `auditCoverage` | 12/12 + 6/6 |
| `tests/integration/coach.authorization.integration.test.ts` | **4/4** con BD real: aislamiento A→B (NOT_FOUND), NO_PROFILE y VALIDATION antes de la IA, y envío real con perfil intacto en ambos caminos (IA ok → 2 mensajes + intent del enum; fallo → 0 escrituras) |
| `tests/golden/ai.security.eval.test.ts` (regresión del pipeline CV) | **8/10**; los 2 fallos son del PROVEEDOR (`Rate limit exceeded: the gateway-wide daily LLM spend budget is exhausted`, `inputTokens 0`, promptVersion `cv_extract.v2.0` sin cambios) — medido en `aiExtractions`; re-ejecutar cuando el presupuesto diario del gateway se resetee (~7 h). `cv_ingest` (IA real) sí pasó 2/2 con el mismo prompt refactorizado. |

Cuota de esfuerzo de este incremento: ~4 llamadas IA de prueba (usuarios anónimos
nuevos, no agotan cuotas de usuarios reales).

> Nota: la tabla anterior refleja la ejecución del **Incremento 1**. El
> Incremento 2 (evidence + proposals + UI) amplió los recuentos (p. ej.
> `api_surface` 53, `coach.security` 33, autorización del coach 9) y añadió
> `coach.proposalReject.integration` (flujo real de rechazo) y
> `coachProposalUi` (invariantes INV-UI de la UI); los resultados de cada
> cierre se reportan en el propio cierre del incremento.

## 6. Plan de incrementos

- **Incremento 2 — propuestas (IMPLEMENTADO: backend + UI):** cadena estricta
  `LLM → CLAIM → EVIDENCE (fail-closed en servidor) → PROPOSAL (pending)` con
  estados `pending|rejected` (sin `accepted`), rechazo del dueño vía la
  mutation pública `rejectProposalByOwner` (wrapper R3 con las mismas
  garantías que la interna `rejectProposal`: requireSelf, ownership,
  pending→rejected, audit) y UI en `Coach()` (`src/pages/Dashboard.tsx`):
  envío con `sendMessageWithProposals`, lista por `listProposals`, badges
  «Pendiente de confirmación»/«Rechazada», confirmación en AlertDialog y sin
  optimistic update. ADR-012; la **aplicación** de la propuesta al perfil
  (Mode B con confirmación humana) sigue pendiente en un incremento posterior.
- **Incremento 3 — versionado de perfil:** `candidateProfileVersions` para
  undo/auditoría de cambios aplicados.
- **Incremento 4 — Mode C/D:** matching e insights de vacante sobre el coach.
- **Evaluación golden del coach** por versión de prompt (ADR-013) cuando el
  presupuesto del gateway vuelva a estar disponible.

## 7. Decisiones registradas

ADR-011 (sin herramientas / read-only), ADR-012 (propuesta + confirmación),
ADR-013 (versionado de prompts) en `docs/DECISIONS.md`.
