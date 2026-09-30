/**
 * Diagnóstico de empleabilidad — motor determinista (ADR-002/007).
 * Solo señales del perfil del candidato. Sin promesas de resultados:
 * oportunidades y rangos solo cuando hay datos suficientes.
 */
import type { CvExtraction } from "./ai/schemas";

export interface ProfileData {
  fullName?: string;
  headline?: string;
  location?: string;
  summary?: string;
  yearsExperience?: number;
  skills: { name: string; level: number; source: "ai" | "human"; evidence?: string; confidence?: number }[];
  experience: {
    company: string;
    title: string;
    start: string;
    end?: string;
    current?: boolean;
    description: string;
    achievements: string[];
    source: "ai" | "human";
    evidence?: string;
    confidence?: number;
  }[];
  education: { institution: string; degree: string; field?: string; source: "ai" | "human" }[];
  certifications: { name: string; source: "ai" | "human" }[];
}

export interface Diagnosis {
  completeness: number;
  impact: number;
  skills: number;
  narrative: number;
  opportunities: { dimension: string; reason: string }[];
  hasSufficientData: boolean;
  computedAt: number;
}

const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

/** Longitud media de logros cuantificados (% con números/porcentajes). */
function quantifiedAchievementRatio(achievements: string[]): number {
  if (achievements.length === 0) return 0;
  const quantified = achievements.filter((a) => /\d/.test(a)).length;
  return quantified / achievements.length;
}

export function computeDiagnosis(profile: ProfileData): Diagnosis {
  const opportunities: { dimension: string; reason: string }[] = [];

  // ── Completitud ──────────────────────────────────────────────────────
  const fields = [
    profile.fullName,
    profile.headline,
    profile.location,
    profile.summary,
  ];
  const filledFields = fields.filter(Boolean).length / fields.length;
  const hasExperience = profile.experience.length > 0;
  const hasEducation = profile.education.length > 0;
  const hasSkills = profile.skills.length >= 5;
  const hasCerts = profile.certifications.length > 0;
  const completeness = clamp(
    filledFields * 40 +
      (hasExperience ? 25 : 0) +
      (hasEducation ? 10 : 0) +
      (hasSkills ? 20 : 0) +
      (hasCerts ? 5 : 0),
  );
  if (!profile.headline) {
    opportunities.push({
      dimension: "completitud",
      reason: "Añade un titular profesional (p. ej. \"Ingeniera de datos con 4 años en BI\"): es lo primero que lee un reclutador.",
    });
  }
  if (!profile.summary) {
    opportunities.push({
      dimension: "completitud",
      reason: "Escribe un resumen breve (2–3 líneas) que conecte tu experiencia con el tipo de puesto que buscas.",
    });
  }
  if (!hasEducation) {
    opportunities.push({
      dimension: "completitud",
      reason: "Falta educación o formación. Si no tienes estudios formales relevantes, considera certificaciones.",
    });
  }
  if (!hasCerts) {
    opportunities.push({
      dimension: "completitud",
      reason: "Sin certificaciones registradas: si tienes alguna, agrégala; refuerza skills técnicos.",
    });
  }

  // ── Impacto / logros cuantificados ────────────────────────────────────
  const allAchievements = profile.experience.flatMap((e) => e.achievements);
  const ratio = quantifiedAchievementRatio(allAchievements);
  const achievementsPerRole = hasExperience
    ? allAchievements.length / profile.experience.length
    : 0;
  const impact = clamp(
    ratio * 60 + Math.min(achievementsPerRole / 3, 1) * 40,
  );
  if (hasExperience && ratio < 0.4) {
    opportunities.push({
      dimension: "impacto",
      reason: "Pocos logros cuantificados. Donde puedas respaldarlo con datos reales, añade cifras: tamaño de equipo, usuarios, % de mejora, ahorro.",
    });
  }
  if (hasExperience && achievementsPerRole < 2) {
    opportunities.push({
      dimension: "impacto",
      reason: "Cada experiencia se lee más fuerte con 2–3 logros concretos, no solo responsabilidades.",
    });
  }

  // ── Skills ────────────────────────────────────────────────────────────
  const skillCount = profile.skills.length;
  const avgLevel =
    skillCount > 0
      ? profile.skills.reduce((s, k) => s + k.level, 0) / skillCount
      : 0;
  const aiLowConfidence = profile.skills.filter(
    (k) => k.source === "ai" && (k.confidence ?? 1) < 0.6,
  ).length;
  const skillsScore = clamp(
    Math.min(skillCount / 12, 1) * 55 + (avgLevel / 5) * 45 - aiLowConfidence * 2,
  );
  if (skillCount < 6) {
    opportunities.push({
      dimension: "skills",
      reason: "Con menos de 6 skills el perfil es difícil de matchear. Revisa tu CV: quizá hay habilidades que no nombraste explícitamente.",
    });
  }
  if (aiLowConfidence > 2) {
    opportunities.push({
      dimension: "skills",
      reason: "Varias skills fueron detectadas con baja confianza: revisa y corrige niveles a mano.",
    });
  }

  // ── Narrativa ─────────────────────────────────────────────────────────
  const summaryLen = profile.summary?.length ?? 0;
  const descLens = profile.experience.map((e) => e.description.length);
  const avgDesc =
    descLens.length > 0
      ? descLens.reduce((a, b) => a + b, 0) / descLens.length
      : 0;
  const narrative = clamp(
    (Math.min(summaryLen / 200, 1) * 40) + (Math.min(avgDesc / 300, 1) * 60),
  );
  if (hasExperience && avgDesc < 120) {
    opportunities.push({
      dimension: "narrativa",
      reason: "Las descripciones de experiencia son cortas: explica contexto, qué hiciste y con qué herramientas.",
    });
  }

  const hasSufficientData =
    hasExperience && hasSkills && profile.summary !== undefined;

  return {
    completeness,
    impact,
    skills: skillsScore,
    narrative,
    opportunities,
    hasSufficientData,
    computedAt: Date.now(),
  };
}
