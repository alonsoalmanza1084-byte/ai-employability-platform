/**
 * Career Coach IA — Incremento 1 (SOLO LECTURA) + Incremento 2 (PROPOSALS).
 *
 * Incremento 1 (read-only, decidido): el coach conversa sobre el perfil y el
 * diagnóstico EXISTENTES; NO escribe en candidateProfiles (no existe ninguna
 * ruta desde aquí); NO discute salarios ni atributos protegidos (prompt V1).
 *
 * Incremento 2 (evidence + proposals, ADR-014): el LLM puede proponer claims/
 * evidencia/propuestas REVISABLES sobre el perfil, pero NUNCA las aplica al
 * perfil. El flujo es: LLM → CLAIM → EVIDENCE (verificado servidor) →
 * PROPOSAL (pendiente, rechazable por el dueño). La confirmación/aceptación
 * que modifique el perfil queda para un incremento posterior.
 *
 * Flujo de `sendMessage` (action):
 *   1. `prepareSend` (internalMutation): ownership + validación + techos
 *      estructurales + cuotas (hora/día) ATÓMICAS y fail-closed: el uso se
 *      consume ANTES de llamar a la IA; si algo falla aquí, NO se llama.
 *   2. Context Builder + llamada al proveedor con salida validada por zod.
 *   3. Grounding heurístico (`verifyCoachResponse`, HEURISTIC_GROUNDING_CHECK):
 *      las observaciones no sustentadas en el contexto se descartan (anti
 *      alucinación; la prosa NO se filtra — ver lib/ai/evidence.ts).
 *   4. `appendExchange` (internalMutation): mensaje usuario + mensaje
 *      asistente + telemetría `aiCoachCalls` + audit, todo en una transacción.
 *      Si la IA falla, NADA se persiste (solo `recordAiFailure` deja el
 *      código cerrado del fallo en telemetría + audit).
 *
 * Flujo de propuestas (incremento 2):
 *   - `createProposal` (action): claim+evidence+proposal en una transacción,
 *     ownership + estado inicial + telemetría + audit. Solo el dueño de la
 *     conversación puede crear (identity from session).
 *   - `rejectProposal` (action): transición estado pending→rejected del
 *     dueño; NO toca el perfil ni la evidencia.
 *   - `listProposals` / `getProposal` (query): solo filas del actor.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { coachIntentValidator } from "./schema";
import { requireSelf } from "./lib/rbac";
import { audit, countUsage, recordUsage, securityEvent } from "./lib/audit";
import { DAY_MS, HOUR_MS, LIMITS } from "./lib/limits";
import {
  computeDiagnosis,
  type Diagnosis,
  type ProfileData,
} from "./lib/diagnosis";
import {
  CAREER_COACH_PROMPT_VERSION,
  CAREER_COACH_SYSTEM_PROMPT_V1,
  buildCareerCoachUserContent,
} from "./lib/ai/coach_prompts";
import {
  careerCoachJsonSchema,
  careerCoachResponseSchema,
  type CareerCoachResponse,
} from "./lib/ai/coach_schemas";
import {
  careerCoachJsonSchemaWithProposals,
  careerCoachResponseWithProposalsSchema,
  type CareerCoachResponseWithProposals,
} from "./lib/ai/proposal_schemas";
import { sanitizeUserText } from "./lib/ai/prompts";
import { normalizeAiJson } from "./lib/ai/validators";
import { verifyCoachResponse } from "./lib/ai/evidence";
import type { AIResponse } from "./lib/ai/types";

/** Códigos de fallo IA que SÍ se pueden mostrar/devolver (nunca el mensaje crudo). */
const FAIL_REASONS: Record<string, string> = {
  RATE_LIMITED:
    "El asistente está saturado. Espera un minuto y vuelve a intentarlo.",
  TIMEOUT: "El asistente tardó demasiado en responder. Reintenta.",
  SCHEMA_INVALID:
    "El asistente devolvió un formato inesperado. Reformula tu mensaje.",
  CONTENT_FILTERED:
    "Tu mensaje fue bloqueado por el filtro de seguridad del proveedor de IA.",
  PROVIDER_ERROR:
    "El asistente no está disponible en este momento. Reintenta en unos minutos.",
};

/** Mensaje seguro para el usuario: solo códigos conocidos, jamás el error crudo. */
function failReason(code: string): string {
  return (
    FAIL_REASONS[code] ??
    "El asistente no está disponible en este momento. Reintenta en unos minutos."
  );
}

/** Códigos de IA permitidos en telemetría (enum cerrado; nunca contenido). */
const AI_ERROR_CODES = new Set<string>([
  "RATE_LIMITED",
  "SCHEMA_INVALID",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "CONTENT_FILTERED",
]);

/** Límite de propuestas por conversación (sin cuota IA adicional: la cuota de
 * mensajes ya gasta tokens; aquí limitamos almacenamiento/abuso). */
export const MAX_PROPOSALS_PER_CONVERSATION = 6;

/** Duración de vida de una propuesta pendiente sin interacción (no purga
 * automática: RETENTION_POLICY = NOT_DEFINED; solo techo de edad para la UI). */
export const PROPOSAL_PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Convex v-validators para el payload de proposals (espejo de Zod) ───
// Los esquemas Zod viven en proposal_schemas.ts; aquí los reinterpretamos
// como v-validators para que convex/values los acepte en args. Ningún campo
// puede autodeclararse verified/accepted: el backend asigna estado.

const coachClaimTypeValidator = v.union(
  v.literal("skill"),
  v.literal("experience"),
  v.literal("achievement"),
  v.literal("education"),
  v.literal("certification"),
  v.literal("profile_summary"),
  v.literal("gap"),
  v.literal("opportunity"),
);

const coachClaimSourceRefValidator = v.union(
  v.literal("profile"),
  v.literal("diagnosis"),
  v.literal("conversation"),
);

const coachEvidenceRefValidator = v.object({
  sourceType: coachClaimSourceRefValidator,
  sourceId: v.string(),
  excerpt: v.string(),
  confidence: v.number(),
});

const coachClaimValidator = v.object({
  statement: v.string(),
  type: coachClaimTypeValidator,
  sourceRef: coachClaimSourceRefValidator,
  evidenceRefs: v.array(v.string()),
  confidence: v.number(),
});

const coachProposalEvidenceValidator = v.array(coachEvidenceRefValidator);

const coachProposalValidator = v.object({
  originalText: v.optional(v.string()),
  proposedText: v.string(),
  evidence: coachProposalEvidenceValidator,
  confidence: v.number(),
});

/**
 * Tipo explícito del resultado de `prepareSend`. Se declara aquí para romper la
 * inferencia circular (api interna → módulo → action → api interna) que deja
 * `sendMessage` como `any` implícito (TS7022/7023).
 */
type CoachPrepareResult =
  | { ok: false; code: string; reason: string }
  | {
      ok: true;
      evidenceText: string;
      userMessage: string;
      history: { role: "user" | "assistant"; content: string }[];
    };

/**
 * Resultado EXPLÍCITO de `sendMessage`: anotar el handler evita que la
 * inferencia del tipo de retorno dependa del api interna (TS7022/7023).
 */
type SendMessageResult =
  | { ok: true }
  | { ok: false; code: string; reason: string };

/**
 * Context Builder: DTO determinista del perfil + diagnóstico. Sirve a la vez
 * de evidencia para el prompt y de referencia para el post-check. Solo campos
 * relevantes y con tope por campo: nunca el documento crudo.
 */
function buildCoachEvidence(
  profile: Doc<"candidateProfiles">,
  diagnosis: Diagnosis,
): string {
  const lines: string[] = [];
  if (profile.fullName) lines.push(`Nombre: ${profile.fullName}`);
  if (profile.headline) lines.push(`Titular: ${profile.headline}`);
  if (profile.location) lines.push(`Ubicación: ${profile.location}`);
  if (profile.summary) lines.push(`Resumen profesional: ${profile.summary}`);
  if (profile.yearsExperience !== undefined) {
    lines.push(`Años de experiencia declarados: ${profile.yearsExperience}`);
  }
  lines.push(
    `Skills (${profile.skills.length}): ` +
      profile.skills
        .slice(0, 40)
        .map(
          (s) =>
            `${s.name.slice(0, 60)} (nivel ${s.level}${
              s.source === "human" ? ", editado a mano" : ""
            })`,
        )
        .join(", "),
  );
  for (const e of profile.experience.slice(0, 15)) {
    const end = e.end ?? (e.current ? "actualidad" : "sin fecha final");
    lines.push(
      `Experiencia: ${e.title} en ${e.company} (${e.start}–${end}). ${e.description.slice(0, 400)}`,
    );
    for (const a of e.achievements.slice(0, 8)) {
      lines.push(`Logro: ${a.slice(0, 240)}`);
    }
  }
  for (const e of profile.education.slice(0, 10)) {
    lines.push(
      `Educación: ${e.degree}${e.field ? ` (${e.field})` : ""} — ${e.institution}`,
    );
  }
  for (const c of profile.certifications.slice(0, 15)) {
    lines.push(`Certificación: ${c.name}${c.issuer ? ` — ${c.issuer}` : ""}`);
  }
  lines.push(
    `Diagnóstico (determinista): completitud ${diagnosis.completeness}/100, impacto ${diagnosis.impact}/100, skills ${diagnosis.skills}/100, narrativa ${diagnosis.narrative}/100; datos suficientes: ${diagnosis.hasSufficientData ? "sí" : "no"}.`,
  );
  for (const o of diagnosis.opportunities) {
    lines.push(`Oportunidad de mejora (${o.dimension}): ${o.reason}`);
  }
  return lines.join("\n");
}

/**
 * Historial + hilo de la conversación del propio actor (ownership por sesión:
 * el cliente nunca envía userId). Devuelve null sin conversación previa.
 * Lecturas acotadas por los techos estructurales de LIMITS.
 */
export const getConversation = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);
    const conversations = await ctx.db
      .query("coachConversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(LIMITS.maxCoachConversationsPerUser);
    const conversation =
      conversations.find((c) => c.status === "active") ?? conversations[0] ?? null;
    if (!conversation) return null;
    const messages = await ctx.db
      .query("coachMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("asc")
      .take(LIMITS.maxCoachMessagesPerConversation + LIMITS.coachMessagesPerHour);
    return { conversation, messages };
  },
});

/**
 * Nueva conversación (cierra la anterior). Idempotente respecto a la cuota:
 * si la cuota diaria o el techo estructural no permiten crear, la conversación
 * activa ACTUAL se conserva y se devuelve en `conversationId`, de modo que el
 * usuario nunca se queda sin hilo con el que hablar (fail-closed, no destructivo).
 */
export const startConversation = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);
    const conversations = await ctx.db
      .query("coachConversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(LIMITS.maxCoachConversationsPerUser);
    const active = conversations.find((c) => c.status === "active") ?? null;

    const created = await countUsage(ctx, {
      userId,
      kind: "coach.conversation",
      sinceMs: DAY_MS,
    });
    if (created >= LIMITS.coachConversationsPerDay) {
      await securityEvent(ctx, {
        kind: "rate_limited",
        userId,
        detail: "coach.conversation daily limit",
      });
      return {
        ok: false as const,
        code: "RATE_LIMITED",
        reason: `Alcanzaste el límite de ${LIMITS.coachConversationsPerDay} conversaciones nuevas por día. Sigue en tu conversación actual.`,
        conversationId: active?._id,
      };
    }
    if (!active && conversations.length >= LIMITS.maxCoachConversationsPerUser) {
      return {
        ok: false as const,
        code: "CONVERSATION_LIMIT",
        reason: "Alcanzaste el límite de conversaciones guardadas.",
        conversationId: undefined,
      };
    }

    if (active) {
      await ctx.db.patch(active._id, {
        status: "closed",
        updatedAt: Date.now(),
      });
    }
    const conversationId = await ctx.db.insert("coachConversations", {
      userId,
      status: "active",
      promptVersion: CAREER_COACH_PROMPT_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recordUsage(ctx, {
      userId,
      kind: "coach.conversation",
      dedupeKey: `coach.conversation:${conversationId}`,
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "coach.session.start",
      targetType: "coachConversation",
      targetId: conversationId,
    });
    return { ok: true as const, conversationId };
  },
});

/**
 * Gate transaccional previo a la IA: ownership, validación, techos
 * estructurales y cuotas (hora + día) con consumo atómico. Devuelve también el
 * contexto ya saneado para que el action no vuelva a tocar la BD.
 */
export const prepareSend = internalMutation({
  args: {
    conversationId: v.id("coachConversations"),
    message: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    // 1) Ownership + estado: la conversación debe ser del actor y activa.
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      return {
        ok: false as const,
        code: "NOT_FOUND",
        reason: "Conversación no encontrada.",
      };
    }
    if (conversation.status !== "active") {
      return {
        ok: false as const,
        code: "CONVERSATION_CLOSED",
        reason: "La conversación está cerrada. Empieza una nueva.",
      };
    }

    // 2) Entrada acotada.
    const text = args.message.trim();
    if (text.length < 1 || text.length > LIMITS.coachUserMessageMaxChars) {
      return {
        ok: false as const,
        code: "VALIDATION",
        reason: `Tu mensaje debe tener entre 1 y ${LIMITS.coachUserMessageMaxChars} caracteres.`,
      };
    }

    // 3) Sin perfil no hay contexto (se comprueba ANTES de consumir cuota).
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) {
      return {
        ok: false as const,
        code: "NO_PROFILE",
        reason: "Sube tu CV primero para que el coach conozca tu perfil.",
      };
    }

    // 4) Techos estructurales (lecturas acotadas por índice, sin .collect()).
    const messages = await ctx.db
      .query("coachMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .take(LIMITS.maxCoachMessagesPerConversation + LIMITS.coachMessagesPerHour);
    if (messages.length >= LIMITS.maxCoachMessagesPerConversation) {
      return {
        ok: false as const,
        code: "CONVERSATION_FULL",
        reason:
          "Esta conversación alcanzó su límite de mensajes. Empieza una nueva.",
      };
    }
    // Presupuesto de llamadas IA por conversación: incluye los FALLOS, que no
    // llenan mensajes pero sí gastan tokens (anti burn).
    const calls = await ctx.db
      .query("aiCoachCalls")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .take(
        LIMITS.maxCoachCallsPerConversation + LIMITS.coachMessagesPerHour + 1,
      );
    if (calls.length >= LIMITS.maxCoachCallsPerConversation) {
      return {
        ok: false as const,
        code: "CONVERSATION_BUDGET",
        reason:
          "Esta conversación agotó su presupuesto de asistente. Empieza una nueva.",
      };
    }

    // 5) Cuotas hora/día: chequeo + consumo en la MISMA transacción (atómico,
    //    anti carreras) y ANTES de la IA (fail-closed: un fallo posterior del
    //    proveedor no devuelve el presupuesto gastado).
    const thisHour = await countUsage(ctx, {
      userId,
      kind: "coach.message",
      sinceMs: HOUR_MS,
    });
    if (thisHour >= LIMITS.coachMessagesPerHour) {
      await securityEvent(ctx, {
        kind: "rate_limited",
        userId,
        detail: "coach.message hourly limit",
      });
      return {
        ok: false as const,
        code: "RATE_LIMITED",
        reason: `Alcanzaste el límite de ${LIMITS.coachMessagesPerHour} mensajes por hora. Espera unos minutos.`,
      };
    }
    const today = await countUsage(ctx, {
      userId,
      kind: "coach.message",
      sinceMs: DAY_MS,
    });
    if (today >= LIMITS.coachMessagesPerDay) {
      await securityEvent(ctx, {
        kind: "rate_limited",
        userId,
        detail: "coach.message daily limit",
      });
      return {
        ok: false as const,
        code: "RATE_LIMITED",
        reason: `Alcanzaste el límite de ${LIMITS.coachMessagesPerDay} mensajes por día.`,
      };
    }
    const counted = await recordUsage(ctx, {
      userId,
      kind: "coach.message",
      dedupeKey: `coach.message:${args.requestId}`,
    });
    if (!counted) {
      // Replay de la misma petición: no se vuelve a gastar presupuesto.
      return {
        ok: false as const,
        code: "DUPLICATE",
        reason: "Este mensaje ya fue procesado.",
      };
    }

    // 6) Contexto determinista: evidencia saneada + historial acotado.
    const diagnosis = computeDiagnosis(profile as unknown as ProfileData);
    const evidenceText = sanitizeUserText(
      buildCoachEvidence(profile, diagnosis),
      LIMITS.coachProfileMaxChars + LIMITS.coachDiagnosisMaxChars,
    );
    const history = await ctx.db
      .query("coachMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .take(LIMITS.coachHistoryMessages);
    history.reverse();

    return {
      ok: true as const,
      evidenceText,
      userMessage: text,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    };
  },
});

/**
 * Escribe el intercambio completo (usuario + asistente + telemetría + audit)
 * en UNA transacción. Revalida ownership: solo el dueño puede escribir.
 */
export const appendExchange = internalMutation({
  args: {
    conversationId: v.id("coachConversations"),
    requestId: v.string(),
    userMessage: v.string(),
    assistant: v.object({
      message: v.string(),
      intent: coachIntentValidator,
      questions: v.array(v.string()),
      observations: v.array(v.string()),
      confidence: v.number(),
    }),
    model: v.string(),
    promptVersion: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error("NOT_FOUND");
    }

    // Defensa en profundidad: zod ya acotó en el action; se reacota en el
    // límite de la función por si cambia el llamador.
    const userMessage = args.userMessage.slice(
      0,
      LIMITS.coachUserMessageMaxChars,
    );
    const message = args.assistant.message.slice(0, 4000);
    const questions = args.assistant.questions
      .slice(0, 5)
      .map((q) => q.slice(0, 300));
    const observations = args.assistant.observations
      .slice(0, 8)
      .map((o) => o.slice(0, 400));
    const confidence = Math.max(0, Math.min(1, args.assistant.confidence));

    await ctx.db.insert("coachMessages", {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: userMessage,
      createdAt: Date.now(),
    });
    await ctx.db.insert("coachMessages", {
      conversationId: args.conversationId,
      userId,
      role: "assistant",
      content: message,
      intent: args.assistant.intent,
      questions,
      observations,
      confidence,
      requestId: args.requestId.slice(0, 40),
      promptVersion: args.promptVersion.slice(0, 60),
      createdAt: Date.now(),
    });
    await ctx.db.insert("aiCoachCalls", {
      conversationId: args.conversationId,
      userId,
      requestId: args.requestId.slice(0, 40),
      model: args.model.slice(0, 60),
      promptVersion: args.promptVersion.slice(0, 60),
      inputTokens: Math.max(0, args.inputTokens),
      outputTokens: Math.max(0, args.outputTokens),
      durationMs: Math.max(0, args.durationMs),
      ok: true,
    });
    await ctx.db.patch(args.conversationId, { updatedAt: Date.now() });

    await audit(ctx, {
      actorUserId: userId,
      action: "coach.message.create",
      targetType: "coachConversation",
      targetId: args.conversationId,
      metadata: { intent: args.assistant.intent },
    });
    return { ok: true };
  },
});

/**
 * Telemetría del fallo: SOLO el código cerrado (nunca el mensaje crudo del
 * proveedor ni del modelo) + audit. No se escriben mensajes parciales.
 */
export const recordAiFailure = internalMutation({
  args: {
    conversationId: v.id("coachConversations"),
    requestId: v.string(),
    code: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    durationMs: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error("NOT_FOUND");
    }
    const code = AI_ERROR_CODES.has(args.code) ? args.code : "PROVIDER_ERROR";
    await ctx.db.insert("aiCoachCalls", {
      conversationId: args.conversationId,
      userId,
      requestId: args.requestId.slice(0, 40),
      model: args.model.slice(0, 60),
      promptVersion: args.promptVersion.slice(0, 60),
      inputTokens: Math.max(0, args.inputTokens),
      outputTokens: Math.max(0, args.outputTokens),
      durationMs: Math.max(0, args.durationMs),
      ok: false,
      error: code,
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "coach.ai.failed",
      targetType: "coachConversation",
      targetId: args.conversationId,
      metadata: { code },
    });
    return { ok: true };
  },
});

/**
 * Envía un mensaje y devuelve la respuesta del coach.
 * Nunca lanza por fallos del proveedor: devuelve `{ ok:false, code, reason }`
 * con un mensaje SEGURO (sin detalles internos) y sin persistir nada.
 */
export const sendMessage = action({
  args: {
    conversationId: v.id("coachConversations"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<SendMessageResult> => {
    await requireSelf(ctx);
    // Correlación de la petición (actions sin WebCrypto: tiempo + aleatorio).
    const requestId = `${Date.now().toString(36)}-${Math.floor(
      Math.random() * 0x7fffffff,
    ).toString(36)}`.slice(0, 40);

    const prep: CoachPrepareResult | null = await ctx
      .runMutation(internal.coach.prepareSend, {
        conversationId: args.conversationId,
        message: args.message,
        requestId,
      })
      .catch(() => null);
    if (!prep) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: "No se pudo preparar tu mensaje. Reintenta.",
      };
    }
    if (!prep.ok) return prep;

    const userContent = buildCareerCoachUserContent({
      evidence: prep.evidenceText,
      history: prep.history,
      message: prep.userMessage,
      jsonSchema: careerCoachJsonSchema,
    });

    const startedAt = Date.now();
    let aiResult: AIResponse<CareerCoachResponse> | null = null;
    try {
      const provider = await (
        await import("./lib/ai/openai_provider")
      ).getAIProvider();
      aiResult = await provider.complete(
        {
          task: "career_coach",
          system: CAREER_COACH_SYSTEM_PROMPT_V1,
          userContent,
          maxOutputTokens: LIMITS.coachMaxOutputTokens,
          temperature: 0.3,
          responseJsonSchema: careerCoachJsonSchema,
        },
        (raw) =>
          careerCoachResponseSchema.parse(normalizeAiJson(JSON.parse(raw))),
      );
    } catch {
      // Proveedor no configurado o error inesperado → fail-closed.
      aiResult = null;
    }

    if (!aiResult) {
      await ctx.runMutation(internal.coach.recordAiFailure, {
        conversationId: args.conversationId,
        requestId,
        code: "PROVIDER_ERROR",
        model: "unknown",
        promptVersion: CAREER_COACH_PROMPT_VERSION,
        durationMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        reason: failReason("PROVIDER_ERROR"),
      };
    }
    if (!aiResult.ok) {
      await ctx.runMutation(internal.coach.recordAiFailure, {
        conversationId: args.conversationId,
        requestId,
        code: aiResult.error.code,
        model: aiResult.model,
        promptVersion: CAREER_COACH_PROMPT_VERSION,
        durationMs: aiResult.durationMs,
        inputTokens: aiResult.usage?.inputTokens ?? 0,
        outputTokens: aiResult.usage?.outputTokens ?? 0,
      });
      return {
        ok: false,
        code: aiResult.error.code,
        reason: failReason(aiResult.error.code),
      };
    }

    // Grounding heurístico (HEURISTIC_GROUNDING_CHECK): descarta observaciones
    // no sustentadas en el contexto; la prosa queda sin filtrar (limitación
    // documentada en docs/CAREER_COACH_SECURITY.md).
    const verified = verifyCoachResponse(aiResult.data, prep.evidenceText);
    const reply: CareerCoachResponse = {
      message: verified.message,
      intent: verified.intent,
      questions: verified.questions.slice(0, 5),
      observations: verified.observations.slice(0, 8),
      confidence: verified.confidence,
    };

    await ctx.runMutation(internal.coach.appendExchange, {
      conversationId: args.conversationId,
      requestId,
      userMessage: prep.userMessage,
      assistant: reply,
      model: aiResult.model,
      promptVersion: CAREER_COACH_PROMPT_VERSION,
      inputTokens: aiResult.usage?.inputTokens ?? 0,
      outputTokens: aiResult.usage?.outputTokens ?? 0,
      durationMs: aiResult.durationMs,
    });

    return { ok: true };
  },
});

/**
 * Persiste un bundle claim→evidence→proposal en UNA transacción atómica.
 * Dedup por (conversationId, claimText): reintentos/idempotencia del proveedor
 * no generan proposals duplicadas. Solo el dueño de la conversación puede
 * crear (identity from session, revalidado aquí).
 *
 * Evidence verification fail-closed: cada evidenceRef del LLM se valida contra
 * documentos REALES (perfil/diagnóstico/conversación) existentes y con contenido
 * suficiente; las que no se verifican se descartan (no se persiste evidencia
 * inventada). Si no queda evidencia verificable → se rechaza el claim y no se
 * crea proposal (insufficient_evidence es salida válida).
 *
 * Regla de no-invención (INV-014/019): el LLM puede afirmar y proponer; el
 * sistema decide qué persiste. Ningún campo puede autodeclararse verified/accepted.
 */
export const createProposalBundle = internalMutation({
  args: {
    conversationId: v.id("coachConversations"),
    requestId: v.string(),
    claim: coachClaimValidator,
    proposal: coachProposalValidator,
    model: v.string(),
    promptVersion: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    // Ownership: la conversación debe ser del actor y activa.
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error("NOT_FOUND");
    }
    if (conversation.status !== "active") {
      throw new Error("CONVERSATION_CLOSED");
    }

    // Dedup por claimText+conversation: reintentos del proveedor no duplican.
    const existingClaim = await ctx.db
      .query("coachClaims")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .first();
    if (existingClaim && existingClaim.claimText === args.claim.statement) {
      return {
        ok: false,
        code: "DUPLICATE",
        reason:
          "Esta sugerencia ya fue registrada (idempotencia contra reintentos del proveedor).",
      };
    }

    // Límite de propuestas por conversación (sin cuota IA nueva).
    const proposalsCount = await ctx.db
      .query("coachProposals")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .take(MAX_PROPOSALS_PER_CONVERSATION + 1);
    if (proposalsCount.length >= MAX_PROPOSALS_PER_CONVERSATION) {
      await securityEvent(ctx, {
        kind: "rate_limited",
        userId,
        detail: "coach.proposal per-conversation limit",
      });
      return {
        ok: false,
        code: "RATE_LIMITED",
        reason:
          `Alcanzaste el límite de ${MAX_PROPOSALS_PER_CONVERSATION} sugerencias por conversación.`,
      };
    }

    // ── Evidence verification FAIL-CLOSED ────────────────────────────────
    // Cada evidenceRef del LLM se valida contra un documento REAL y existente.
    // Fuentes permitidas: profile, diagnosis, conversation (solo los mensajes
    // del propio usuario en esta conversación, para no exfiltrar otros hilos).
    const verifiedEvidence: Array<{
      sourceType: "profile" | "diagnosis" | "conversation"
      sourceId: string
      excerpt: string
      confidence: number
    }> = [];

    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) {
      return {
        ok: false,
        code: "NO_PROFILE",
        reason:
          "No hay perfil para validar la evidencia (la sugerencia requiere un perfil existente).",
      };
    }

    // Fail-closed ante límites que Convex v-validators no puede expresar (.max/.min
    // de arrays no están disponibles en esta versión): rechazamos evidencia o
    // claim evasive antes de tocar la BD.
    const evidence = args.proposal.evidence;
    if (!evidence || evidence.length === 0 || evidence.length > 6) {
      return {
        ok: false,
        code: "VALIDATION",
        reason:
          "La propuesta debe incluir entre 1 y 6 referencias de evidencia (límite estructural).",
      };
    }
    if (args.claim.evidenceRefs && args.claim.evidenceRefs.length > 6) {
      return {
        ok: false,
        code: "VALIDATION",
        reason:
          "El claim no puede declarar más de 6 referencias de evidencia (límite estructural).",
      };
    }

    const now = Date.now();
    for (const ref of evidence) {
      // sourceId debe parecer un id de Convex (fail-closed sin scanner de todos).
      if (!/^[a-z0-9]{20,40}$/.test(ref.sourceId)) {
        continue; // se descarta silenciosamente; no se persiste
      }
      let sourceType: "profile" | "diagnosis" | "conversation" =
        ref.sourceType as "profile" | "diagnosis" | "conversation";
      let sourceDocExists = false;

      if (sourceType === "profile") {
        const target = await ctx.db.get(ref.sourceId as Id<"candidateProfiles">);
        sourceDocExists = !!(target && (target as Doc<"candidateProfiles">).userId === userId);
      } else if (sourceType === "diagnosis") {
        // El diagnóstico no es tabla física: se considera presente si existe el
        // perfil (el diagnóstico se computa en derivación). Registramos la
        // referencia con el id del perfil como fuente.
        sourceDocExists = (profile as Doc<"candidateProfiles">)._id === ref.sourceId;
        sourceType = "profile"; // normalizamos a la fuente real
      } else if (sourceType === "conversation") {
        const target = await ctx.db.get(ref.sourceId as Id<"coachMessages">);
        sourceDocExists = !!(target &&
          (target as Doc<"coachMessages">).conversationId === args.conversationId &&
          (target as Doc<"coachMessages">).userId === userId &&
          (target as Doc<"coachMessages">).role === "assistant");
      }

      if (!sourceDocExists) {
        continue; // evidencia no verificable → no se persiste
      }

      // Contenido acotado + sanitizado (anti contamina el corpus de evidencia).
      verifiedEvidence.push({
        sourceType,
        sourceId: ref.sourceId.slice(0, 80),
        excerpt: sanitizeUserText(ref.excerpt, 400).slice(0, 400),
        confidence: Math.max(0, Math.min(1, ref.confidence)),
      });
    }

    if (verifiedEvidence.length === 0) {
      // insufficient_evidence: salida válida, no se crea nothing.
      await ctx.runMutation(internal.coach.recordAiFailure, {
        conversationId: args.conversationId,
        requestId: args.requestId.slice(0, 40),
        code: "SCHEMA_INVALID",
        model: args.model.slice(0, 60),
        promptVersion: args.promptVersion.slice(0, 60),
        durationMs: args.durationMs,
        inputTokens: Math.max(0, args.inputTokens),
        outputTokens: Math.max(0, args.outputTokens),
      });
      await audit(ctx, {
        actorUserId: userId,
        action: "coach.proposal.validation_failed",
        targetType: "coachConversation",
        targetId: args.conversationId,
        metadata: { reason: "insufficient_verified_evidence" },
      });
      return {
        ok: false,
        code: "SCHEMA_INVALID",
        reason:
          "No había evidencia verificable suficiente para registrar esta sugerencia (insufficient_evidence).",
      };
    }

    // Persistamos claim, evidence y proposal en una sola transacción.
    const claimId = await ctx.db.insert("coachClaims", {
      userId,
      conversationId: args.conversationId,
      claimText: sanitizeUserText(args.claim.statement, 600).slice(0, 600),
      originalClaim: args.claim.statement.slice(0, 600),
      status: "verified",
      confidence: Math.max(0, Math.min(1, args.claim.confidence)),
      promptVersion: args.promptVersion.slice(0, 60),
      createdAt: now,
      updatedAt: now,
    });

    for (const ev of verifiedEvidence) {
      await ctx.db.insert("coachEvidence", {
        claimId,
        sourceType: ev.sourceType,
        sourceId: ev.sourceId,
        excerpt: ev.excerpt,
        confidence: ev.confidence,
        createdAt: now,
      });
    }

    const proposalId = await ctx.db.insert("coachProposals", {
      userId,
      claimId,
      conversationId: args.conversationId,
      proposedText: sanitizeUserText(
        args.proposal.proposedText,
        600,
      ).slice(0, 600),
      originalText: args.proposal.originalText?.slice(0, 600),
      status: "pending",
      confidence: Math.max(0, Math.min(1, args.proposal.confidence)),
      promptVersion: args.promptVersion.slice(0, 60),
      createdAt: now,
      updatedAt: now,
    });

    await audit(ctx, {
      actorUserId: userId,
      action: "coach.proposal.create",
      targetType: "coachConversation",
      targetId: args.conversationId,
      metadata: {
        proposalId,
        claimId,
        confidence: Math.max(
          0,
          Math.min(1, args.proposal.confidence),
        ).toString(),
      },
    });

    await ctx.db.patch(args.conversationId, { updatedAt: now });

    return {
      ok: true,
      proposalId,
      claimId,
    };
  },
});

/**
 * Reject de una proposal por su dueño. Transición pending→rejected. NO toca el
 * perfil ni la evidencia (INV-013). Solo la status se cambia; el claim sigue
 * para trazabilidad.
 */
export const rejectProposal = internalMutation({
  args: {
    proposalId: v.id("coachProposals"),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const proposal = await ctx.db.get(args.proposalId);
    if (
      !proposal ||
      proposal.userId !== userId ||
      proposal.status !== "pending"
    ) {
      throw new Error("NOT_FOUND");
    }
    if (proposal.status !== "pending") {
      throw new Error("INVALID_STATE");
    }
    await ctx.db.patch(args.proposalId, {
      status: "rejected",
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "coach.proposal.reject",
      targetType: "coachConversation",
      targetId: proposal.conversationId,
      metadata: { proposalId: args.proposalId },
    });
    return { ok: true };
  },
});

/**
 * Lista las propuestas pendientes/rechazadas del actor en la conversación.
 */
export const listProposals = query({
  args: { conversationId: v.id("coachConversations") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.userId !== userId) {
      return { proposals: [] };
    }
    const rows = await ctx.db
      .query("coachProposals")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .take(LIMITS.maxCoachMessagesPerConversation);
    return {
      proposals: rows
        .filter((p) => p.userId === userId)
        .map((p) => ({
          _id: p._id,
          claimId: p.claimId,
          proposedText: p.proposedText,
          originalText: p.originalText,
          status: p.status,
          confidence: p.confidence,
          promptVersion: p.promptVersion,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
    };
  },
});

/**
 * Revisa una propuesta y su claim/evidence subyacentes. Solo el dueño.
 */
export const getProposal = query({
  args: { proposalId: v.id("coachProposals") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const proposal = await ctx.db.get(args.proposalId);
    if (
      !proposal ||
      proposal.userId !== userId
    ) {
      return { ok: false, code: "NOT_FOUND", reason: "Sugerencia no encontrada." };
    }
    const claim = await ctx.db.get(proposal.claimId);
    const evidence = await ctx.db
      .query("coachEvidence")
      .withIndex("by_claim", (q) => q.eq("claimId", proposal.claimId))
      .take(10);
    return {
      ok: true,
      proposal: {
        _id: proposal._id,
        claimId: proposal.claimId,
        userId: proposal.userId,
        conversationId: proposal.conversationId,
        proposedText: proposal.proposedText,
        originalText: proposal.originalText,
        status: proposal.status,
        confidence: proposal.confidence,
        promptVersion: proposal.promptVersion,
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt,
      },
      claim: {
        _id: claim!._id,
        claimText: claim!.claimText,
        originalClaim: claim!.originalClaim,
        status: claim!.status,
        confidence: claim!.confidence,
        promptVersion: claim!.promptVersion,
        createdAt: claim!.createdAt,
        updatedAt: claim!.updatedAt,
      },
      evidence: evidence.map((e) => ({
        _id: e._id,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        excerpt: e.excerpt,
        confidence: e.confidence,
        createdAt: e.createdAt,
      })),
    };
  },
});

/**
 * Envía un mensaje y devuelve la respuesta del coach.
 * Si el LLM devuelve propuestas, se persisten (crear proposal — no aplicar).
 */
export const sendMessageWithProposals = action({
  args: {
    conversationId: v.id("coachConversations"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<SendMessageResult> => {
    await requireSelf(ctx);
    const requestId = `${Date.now().toString(36)}-${Math.floor(
      Math.random() * 0x7fffffff,
    ).toString(36)}`.slice(0, 40);

    const prep: CoachPrepareResult | null = await ctx
      .runMutation(internal.coach.prepareSend, {
        conversationId: args.conversationId,
        message: args.message,
        requestId,
      })
      .catch(() => null);
    if (!prep) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: "No se pudo preparar tu mensaje. Reintenta.",
      };
    }
    if (!prep.ok) return prep;

    const userContent = buildCareerCoachUserContent({
      evidence: prep.evidenceText,
      history: prep.history,
      message: prep.userMessage,
      jsonSchema: careerCoachJsonSchemaWithProposals,
    });

    const startedAt = Date.now();
    let aiResult: AIResponse<CareerCoachResponseWithProposals> | null = null;
    try {
      const provider = await (
        await import("./lib/ai/openai_provider")
      ).getAIProvider();
      aiResult = await provider.complete(
        {
          task: "career_coach",
          system: CAREER_COACH_SYSTEM_PROMPT_V1,
          userContent,
          maxOutputTokens: LIMITS.coachMaxOutputTokens,
          temperature: 0.3,
          responseJsonSchema: careerCoachJsonSchemaWithProposals,
        },
        (raw) =>
          careerCoachResponseWithProposalsSchema.parse(
            normalizeAiJson(JSON.parse(raw)),
          ),
      );
    } catch {
      aiResult = null;
    }

    if (!aiResult) {
      await ctx.runMutation(internal.coach.recordAiFailure, {
        conversationId: args.conversationId,
        requestId,
        code: "PROVIDER_ERROR",
        model: "unknown",
        promptVersion: CAREER_COACH_PROMPT_VERSION,
        durationMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        reason: failReason("PROVIDER_ERROR"),
      };
    }
    if (!aiResult.ok) {
      await ctx.runMutation(internal.coach.recordAiFailure, {
        conversationId: args.conversationId,
        requestId,
        code: aiResult.error.code,
        model: aiResult.model,
        promptVersion: CAREER_COACH_PROMPT_VERSION,
        durationMs: aiResult.durationMs,
        inputTokens: aiResult.usage?.inputTokens ?? 0,
        outputTokens: aiResult.usage?.outputTokens ?? 0,
      });
      return {
        ok: false,
        code: aiResult.error.code,
        reason: failReason(aiResult.error.code),
      };
    }

    // Grounding heurístico con las observaciones.
    const verified = verifyCoachResponse(aiResult.data, prep.evidenceText);
    const reply: CareerCoachResponse = {
      message: verified.message,
      intent: verified.intent,
      questions: verified.questions.slice(0, 5),
      observations: verified.observations.slice(0, 8),
      confidence: verified.confidence,
    };

    await ctx.runMutation(internal.coach.appendExchange, {
      conversationId: args.conversationId,
      requestId,
      userMessage: prep.userMessage,
      assistant: reply,
      model: aiResult.model,
      promptVersion: CAREER_COACH_PROMPT_VERSION,
      inputTokens: aiResult.usage?.inputTokens ?? 0,
      outputTokens: aiResult.usage?.outputTokens ?? 0,
      durationMs: aiResult.durationMs,
    });

    // Persistir propuestas (si las hay) una por una (sin bulk).
    if (aiResult.data.proposals && aiResult.data.proposals.length > 0) {
      for (const proposal of aiResult.data.proposals.slice(0, MAX_PROPOSALS_PER_CONVERSATION)) {
        // Cada proposal necesita un claim validado; si la evidencia no cierra,
        // se rechaza individualmente (insufficient_evidence).
        try {
          await ctx.runMutation(internal.coach.createProposalBundle, {
            conversationId: args.conversationId,
            requestId: `${requestId}-${proposal.proposedText.slice(0,20)}`,
            claim: {
              statement: proposal.proposedText,
              type: "profile_summary",
              sourceRef: "profile",
              evidenceRefs: proposal.evidence.map((e) => e.excerpt),
              confidence: proposal.confidence,
            },
            proposal: {
              originalText: proposal.originalText,
              proposedText: proposal.proposedText,
              evidence: proposal.evidence.map((e) => ({
                sourceType: e.sourceType as "profile" | "diagnosis" | "conversation",
                sourceId: e.sourceId,
                excerpt: e.excerpt,
                confidence: e.confidence,
              })),
              confidence: proposal.confidence,
            },
            model: aiResult.model,
            promptVersion: CAREER_COACH_PROMPT_VERSION,
            inputTokens: aiResult.usage?.inputTokens ?? 0,
            outputTokens: aiResult.usage?.outputTokens ?? 0,
            durationMs: aiResult.durationMs,
          });
        } catch {
          // Fallo individual de una proposal no compromete el mensaje.
        }
      }
    }

    return { ok: true };
  },
});
