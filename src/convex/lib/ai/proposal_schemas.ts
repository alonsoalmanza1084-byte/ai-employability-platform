/**
 * Esquema estricto de la salida del Coach para claims/evidence/proposals
 * (Incremento 2; ADR-012). Espejo de `coach_schemas.ts` (solo lectura) pero
 * con la estructura nueva. Nada de esto llega a la BD sin pasar por aquí y por
 * la validación interna de ownership/estado.
 *
 * REGLA: el LLM NO puede autodeclarar verified/accepted/applied; el backend
 * asigna estado. El LLM propone y da confidence; el sistema verifica y
 * decide. Ver `src/convex/lib/ai/evidence.ts` y `src/convex/coach.ts`.
 */
import { z } from "zod";

export const coachProposalStatusSchema = z.enum([
  "pending",
  "rejected",
]);
export type CoachProposalStatus = z.infer<typeof coachProposalStatusSchema>;

export const coachClaimStatusSchema = z.enum(["verified", "rejected"]);
export type CoachClaimStatus = z.infer<typeof coachClaimStatusSchema>;

/** Claim del LLM: afirmación estructurada atribuida a una fuente. */
export const coachClaimSchema = z.object({
  statement: z.string().min(1).max(600),
  /** Tipo cerrado de claim (qué clase de afirmación es). */
  type: z.enum([
    "skill",
    "experience",
    "achievement",
    "education",
    "certification",
    "profile_summary",
    "gap",
    "opportunity",
  ]),
  /** En qué fuente lo apoya el modelo (solo nominativo; el backend verifica). */
  sourceRef: z.enum(["profile", "diagnosis", "conversation"]),
  /** Opción de evidencias que el modelo cita (backend verifica existencia). */
  evidenceRefs: z.array(z.string().max(300)).max(6),
  /** Confianza del modelo en la afirmación (NO = verificación del sistema). */
  confidence: z.number().min(0).max(1),
});

/** Referencia de evidencia verificada por el backend. */
export const coachEvidenceRefSchema = z.object({
  /** Tipo de documento fuente real. */
  sourceType: z.enum(["profile", "diagnosis", "conversation"]),
  /** ID del documento fuente (solo lectura; validado server-side). */
  sourceId: z.string().max(80),
  /** Excerpto/campo relevante, acotado, sin contenido sensible. */
  excerpt: z.string().min(1).max(400),
  confidence: z.number().min(0).max(1),
});

/** Proposal: sugerencia estructurada revisable. */
export const coachProposalSchema = z.object({
  /** Texto original que motivó la propuesta (para trazabilidad). */
  originalText: z.string().min(1).max(600).optional(),
  /** Redacción sugerida por el sistema (NO ha cambiado el perfil). */
  proposedText: z.string().min(1).max(600),
  /** Evidencia verificada por el backend que respalda la propuesta. */
  evidence: z.array(coachEvidenceRefSchema).min(1).max(6),
  /** Confianza del sistema después de verificación (puede ser menor que la del LLM). */
  confidence: z.number().min(0).max(1),
});

/** Todo el payload que el LLM puede devolver para una respuesta con proposals. */
export const careerCoachResponseWithProposalsSchema = z
  .object({
    message: z.string().min(1).max(4000),
    intent: z.enum([
      "explain_diagnosis",
      "ask_question",
      "discover_gap",
      "general",
    ]),
    questions: z.array(z.string().min(1).max(300)).max(5),
    observations: z.array(z.string().min(1).max(400)).max(8),
    confidence: z.number().min(0).max(1),
    /** PROPOSALS (incremento 2): sugerencias NO aplicadas al perfil. */
    proposals: z
      .array(coachProposalSchema)
      .max(6)
      .optional()
      .default([]),
  })
  .strict();

export type CareerCoachResponseWithProposals = z.infer<
  typeof careerCoachResponseWithProposalsSchema
>;

/** JSON Schema (draft) para structured outputs del proveedor. */
export const careerCoachJsonSchemaWithProposals: Record<string, unknown> = {
  type: "object",
  properties: {
    message: { type: "string" },
    intent: {
      type: "string",
      enum: ["explain_diagnosis", "ask_question", "discover_gap", "general"],
    },
    questions: { type: "array", items: { type: "string" } },
    observations: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalText: { type: "string" },
          proposedText: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sourceType: {
                  type: "string",
                  enum: ["profile", "diagnosis", "conversation"],
                },
                sourceId: { type: "string" },
                excerpt: { type: "string" },
                confidence: { type: "number" },
              },
              required: ["sourceType", "sourceId", "excerpt", "confidence"],
            },
          },
          confidence: { type: "number" },
        },
        required: ["proposedText", "evidence", "confidence"],
      },
    },
  },
  required: ["message", "intent", "questions", "observations", "confidence"],
};
