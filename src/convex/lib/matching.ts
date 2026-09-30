/**
 * Motor de matching determinista y explicable (ADR-002).
 * SOLO señales relevantes al puesto. Sin LLM en el scoring.
 * Cada requisito produce score + evidencia citada + gap legible.
 * Prohibido usar características protegidas: el input solo contiene
 * skills/experiencia/educación/certificaciones extraídas del CV.
 */
import type { CvExtraction } from "./ai/schemas";

export const MATCHING_ENGINE_VERSION = "deterministic-v1";

export interface MatchRequirementInput {
  id: string;
  type: "skill" | "experience_years" | "education" | "certification";
  label: string;
  minLevel?: number;
  minYears?: number;
  weight: number; // 0..1
  isMustHave: boolean;
}

export interface MatchRequirementResult {
  requirementId: string;
  label: string;
  met: boolean;
  score: number; // 0..100
  evidence: string;
  gap?: string;
}

export interface MatchResult {
  overall: number;
  skills: number;
  experience: number;
  education: number;
  requirements: MatchRequirementResult[];
  engineVersion: string;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/** Búsqueda de skill por nombre normalizado (exacta o por inclusión de palabra). */
function findSkill(text: string, skills: CvExtraction["skills"]) {
  const needle = norm(text);
  return skills.find((s) => {
    const hay = norm(s.name);
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

function skillScore(required: number, actual: number | null): number {
  if (actual === null) return 0;
  if (actual >= required) return 100;
  // parcial proporcional, mínimo 20 si la skill existe
  return Math.max(20, Math.round((actual / required) * 100));
}

export function computeMatch(
  candidate: CvExtraction,
  requirements: MatchRequirementInput[],
): MatchResult {
  const results: MatchRequirementResult[] = [];

  for (const req of requirements) {
    if (req.type === "skill") {
      const found = findSkill(req.label, candidate.skills);
      const actual = found?.level ?? null;
      const score = skillScore(req.minLevel ?? 3, actual);
      const met = score >= 70;
      results.push({
        requirementId: req.id,
        label: req.label,
        met,
        score,
        evidence: found
          ? `CV menciona "${found.name}" (nivel detectado ${actual}/5).`
          : `No se encontró "${req.label}" en las habilidades del CV.`,
        gap: met ? undefined : found ? `Nivel detectado ${actual} < requerido ${req.minLevel ?? 3}.` : `Falta la habilidad "${req.label}".`,
      });
    } else if (req.type === "experience_years") {
      const years = candidate.yearsExperience ?? 0;
      const need = req.minYears ?? 1;
      const score = years >= need ? 100 : Math.round((years / need) * 100);
      const met = years >= need;
      results.push({
        requirementId: req.id,
        label: req.label,
        met,
        score,
        evidence: `Experiencia total detectada: ${years} año(s); requerido: ${need}.`,
        gap: met ? undefined : `Faltan ${need - years} año(s) de experiencia.`,
      });
    } else if (req.type === "education") {
      const needle = norm(req.label);
      const edu = candidate.education.find((e) => {
        const hay = norm(`${e.degree} ${e.field ?? ""}`);
        return hay.includes(needle) || needle.includes(hay);
      });
      const met = !!edu;
      results.push({
        requirementId: req.id,
        label: req.label,
        met,
        score: met ? 100 : 0,
        evidence: edu
          ? `Educación detectada: ${edu.degree}${edu.field ? ` en ${edu.field}` : ""} (${edu.institution}).`
          : `No se encontró educación que coincida con "${req.label}".`,
        gap: met ? undefined : `Sin coincidencia de educación para "${req.label}".`,
      });
    } else {
      // certification
      const needle = norm(req.label);
      const cert = candidate.certifications.find((c) => {
        const hay = norm(c.name);
        return hay.includes(needle) || needle.includes(hay);
      });
      const met = !!cert;
      results.push({
        requirementId: req.id,
        label: req.label,
        met,
        score: met ? 100 : 0,
        evidence: cert
          ? `Certificación detectada: "${cert.name}".`
          : `No se encontró la certificación "${req.label}".`,
        gap: met ? undefined : `Falta la certificación "${req.label}".`,
      });
    }
  }

  // scores por dimensión (promedios simples dentro de cada dimensión)
  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;

  const skillScores = results.filter((r) =>
    requirements.find((q) => q.id === r.requirementId)?.type === "skill",
  );
  const expScores = results.filter((r) =>
    requirements.find((q) => q.id === r.requirementId)?.type === "experience_years",
  );
  const eduScores = results.filter((r) =>
    requirements.find((q) => q.id === r.requirementId)?.type === "education",
  );

  const skills = avg(skillScores.map((r) => r.score));
  const experience = avg(expScores.map((r) => r.score));
  const education = avg(eduScores.map((r) => r.score));

  // overall = promedio ponderado por weight de cada requisito
  const totalWeight = requirements.reduce((s, r) => s + Math.max(r.weight, 0), 0);
  let weighted = 0;
  if (totalWeight > 0) {
    for (const r of results) {
      const req = requirements.find((q) => q.id === r.requirementId);
      if (req) weighted += r.score * req.weight;
    }
    weighted = Math.round(weighted / totalWeight);
  } else {
    weighted = avg(results.map((r) => r.score));
  }

  return {
    overall: Math.max(0, Math.min(100, weighted)),
    skills,
    experience,
    education,
    requirements: results,
    engineVersion: MATCHING_ENGINE_VERSION,
  };
}
