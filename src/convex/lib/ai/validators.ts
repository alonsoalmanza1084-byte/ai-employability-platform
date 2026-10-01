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
