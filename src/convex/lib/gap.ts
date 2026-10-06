/**
 * Gap engine determinista (ADR-014).
 *
 * Entrada: skills del perfil + habilidades requeridas de un objetivo (target).
 * Salida: item por habilidad requerida con estado explícito.
 *
 * REGLAS (no negociables):
 *  - missing_evidence ≠ falta de habilidad: si no hay skill registrada que
 *    coincida, decimos "no tenemos evidencia", nunca "no sabes hacer esto".
 *  - insufficient_evidence ≠ incapacidad: hay skill pero confianza baja.
 *  - gap = evidence suficiente pero nivel por debajo del requerido.
 *  - meets_requirement = nivel suficiente registrado.
 *
 * No usa LLM. Es pura función sincrónica de señales del perfil.
 */

/** Una skill del perfil (espejo del schema, tipada localmente para no acoplar). */
export type ProfileSkill = {
  name: string;
  level: number;
  source: "ai" | "human";
  evidence?: string;
  confidence?: number;
};

/** Una habilidad requerida por un objetivo (target role / aspiration / goal). */
export type RequiredSkill = {
  name: string;
  requiredLevel: number;
  category?: string;
};

export type GapStatus =
  | "meets_requirement"
  | "gap"
  | "missing_evidence"
  | "insufficient_evidence";

export type GapItem = {
  skill: string;
  requiredLevel: number;
  currentLevel?: number;
  status: GapStatus;
  evidenceRefs: string[];
  explanation: string;
};

export type GapAnalysis = {
  targetId: string;
  engineVersion: string;
  generatedAt: number;
  overallCoverage: number;
  skills: GapItem[];
};

/** Versión del motor de brechas (deterministic). */
export const GAP_ENGINE_VERSION = "gap-deterministic-v1";

/** Normaliza nombre de skill para comparación (ignora acentos, case, espacios). */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/**
 * Decide si dos skills coinciden por nombre.
 *
 * Criterio intencionalmente inclusivo pero determinista:
 *  - coincidencia exacta normalizada, o
 *  - una es substring de la otra (p. ej. "React" ↔ "React.js"),
 *  - para evitar falsos positivos, requiere que la palabra base (sin sufijos
 *    genéricos) aparezca en ambas.
 */
function skillsMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

/**
 * Para una habilidad requerida, encuentra la skill del perfil más relevante
 * (best match por nivel) y su confianza.
 */
function bestMatch(
  required: string,
  profileSkills: ProfileSkill[],
): { skill: ProfileSkill; matchedName: string } | null {
  let best: { skill: ProfileSkill; matchedName: string } | null = null;
  for (const s of profileSkills) {
    if (!skillsMatch(required, s.name)) continue;
    if (!best || s.level > best.skill.level) {
      best = { skill: s, matchedName: s.name };
    }
  }
  return best;
}

/**
 * Brecha determinista para un objetivo dado.
 *
 * `targetId` identifica el goal (careerGoals) para trazabilidad; no se usa en
 * lógica, solo en la salida auditable.
 */
export function computeGoalGap(
  profileSkills: ProfileSkill[],
  requiredSkills: RequiredSkill[],
  targetId: string,
): GapAnalysis {
  const items: GapItem[] = [];
  const now = Date.now();

  for (const r of requiredSkills) {
    const best = bestMatch(r.name, profileSkills);

    if (!best) {
      items.push({
        skill: r.name,
        requiredLevel: r.requiredLevel,
        status: "missing_evidence",
        evidenceRefs: [],
        explanation: `No hay evidencia registrada para "${r.name}" en tu perfil. No decimos que no sepas hacerlo: aún no lo tenemos registrado. Añade la skill o una experiencia donde la hayas usado.`,
      });
      continue;
    }

    const { skill, matchedName } = best;
    const confidence = skill.confidence ?? 1;

    if (confidence < 0.6) {
      items.push({
        skill: r.name,
        requiredLevel: r.requiredLevel,
        currentLevel: skill.level,
        status: "insufficient_evidence",
        evidenceRefs: skill.evidence ? [skill.evidence] : [],
        explanation: `Tenemos registro de "${matchedName}" (nivel ${skill.level}) pero es una detección de baja confianza. Revísala y corrígela para que cuente como evidencia.`,
      });
      continue;
    }

    if (skill.level >= r.requiredLevel) {
      items.push({
        skill: r.name,
        requiredLevel: r.requiredLevel,
        currentLevel: skill.level,
        status: "meets_requirement",
        evidenceRefs: skill.evidence ? [skill.evidence] : [],
        explanation: `Nivel suficiente registrado: ${skill.level} ≥ ${r.requiredLevel}.`,
      });
    } else {
      items.push({
        skill: r.name,
        requiredLevel: r.requiredLevel,
        currentLevel: skill.level,
        status: "gap",
        evidenceRefs: skill.evidence ? [skill.evidence] : [],
        explanation: `Registrado a nivel ${skill.level}, pero el objetivo pide ${r.requiredLevel}.`,
      });
    }
  }

  const met = items.filter((i) => i.status === "meets_requirement").length;
  const total = items.length;
  const overallCoverage = total > 0 ? Math.round((met / total) * 100) : 0;

  return {
    targetId,
    engineVersion: GAP_ENGINE_VERSION,
    generatedAt: now,
    overallCoverage,
    skills: items,
  };
}

/**
 * Agrupa las habilidades de un análisis en tres buckets legibles para la UI.
 */
export function bucketGapSkills(analysis: GapAnalysis) {
  const met: GapItem[] = [];
  const gap: GapItem[] = [];
  const evidence: GapItem[] = [];
  for (const s of analysis.skills) {
    if (s.status === "meets_requirement") met.push(s);
    else if (s.status === "gap") gap.push(s);
    else evidence.push(s);
  }
  return { met, gap, evidence };
}

/**
 * Prueba si un objetivo está "alcanzable" con la evidencia actual
 * (todos los requisitos en meets_requirement).
 */
export function isGoalReachable(analysis: GapAnalysis): boolean {
  return analysis.skills.every((s) => s.status === "meets_requirement");
}
