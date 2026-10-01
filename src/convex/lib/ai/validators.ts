/**
 * Validadores Convex para la salida estructurada de la IA (auditoría #2).
 *
 * Antes, applyExtraction recibía `extraction: v.any()` — cualquier mutación
 * interna futura (o un error de refactor) podría escribir datos sin forma
 * en la BD. Ahora los args se validan contra esta forma estricta, espejo de
 * cvExtractionSchema (zod, lib/ai/schemas.ts) pero en validadores de Convex:
 * la validación ocurre en el límite de la función, no solo en el action.
 *
 * Mantener sincronizado con lib/ai/schemas.ts (sin el campo `source`, que se
 * agrega server-side al aplicar la extracción).
 */
import { v } from "convex/values";

/**
 * Normaliza la salida cruda del LLM antes de validarla con zod (auditoría #4).
 *
 * El error observado contra un LLM real: los modelos expresan "sin dato" como
 * `null` (`"end": null`, `"headline": null`), y los esquemas con `.optional()`
 * rechazan `null`. Resultado: `SCHEMA_INVALID` y, con temperatura 0 en el
 * reintento, un fallo determinista que dejaba TODA extracción en `failed`.
 *
 * Esta función SOLO elimina claves cuyo valor es `null` (semánticamente
 * "ausente" = `undefined`). No coerce, no rellena, no suaviza ninguna
 * restricción: la validación zod posterior sigue siendo estricta y fail-closed.
 */
export function normalizeAiJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAiJson);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null) continue;
    out[k] = normalizeAiJson(v);
  }
  return out;
}

export const aiSkillValidator = v.object({
  name: v.string(),
  level: v.number(),
  evidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
});

export const aiExperienceValidator = v.object({
  company: v.string(),
  title: v.string(),
  start: v.string(),
  end: v.optional(v.string()),
  current: v.optional(v.boolean()),
  description: v.string(),
  achievements: v.array(v.string()),
  evidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
});

export const aiEducationValidator = v.object({
  institution: v.string(),
  degree: v.string(),
  field: v.optional(v.string()),
  startYear: v.optional(v.number()),
  endYear: v.optional(v.number()),
});

export const aiCertificationValidator = v.object({
  name: v.string(),
  issuer: v.optional(v.string()),
  year: v.optional(v.number()),
});

/** Espejo de CvExtraction (zod) como validador Convex estricto. */
export const aiExtractionValidator = v.object({
  fullName: v.optional(v.string()),
  headline: v.optional(v.string()),
  location: v.optional(v.string()),
  summary: v.optional(v.string()),
  yearsExperience: v.optional(v.number()),
  skills: v.array(aiSkillValidator),
  experience: v.array(aiExperienceValidator),
  education: v.array(aiEducationValidator),
  certifications: v.array(aiCertificationValidator),
});

/** Espejo de Diagnosis (lib/diagnosis.ts) como validador Convex estricto. */
export const diagnosisValidator = v.object({
  completeness: v.number(),
  impact: v.number(),
  skills: v.number(),
  narrative: v.number(),
  opportunities: v.array(
    v.object({ dimension: v.string(), reason: v.string() }),
  ),
  hasSufficientData: v.boolean(),
  computedAt: v.number(),
});
