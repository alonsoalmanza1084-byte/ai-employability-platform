import { z } from "zod";

/**
 * Validación estricta de la salida del Career Coach (AI_SECURITY.md §1.3).
 * Campos acotados en longitud y en número; nada entra a la BD sin pasar por
 * aquí ni por el post-check de evidencia (lib/ai/evidence.ts).
 *
 * Incremento 1 (solo lectura): NO hay campo de propuestas/ediciones; esas
 * llegan en el incremento 2 (ADR-012) junto con confirmación explícita.
 * Espejo Convex: `coachIntentValidator` en schema.ts.
 */
export const careerCoachResponseSchema = z.object({
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
});

export type CareerCoachResponse = z.infer<typeof careerCoachResponseSchema>;

/** JSON Schema (draft) para structured outputs del proveedor. */
export const careerCoachJsonSchema: Record<string, unknown> = {
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
  },
  required: ["message", "intent", "questions", "observations", "confidence"],
};
