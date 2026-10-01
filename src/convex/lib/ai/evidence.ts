/**
 * Post-check determinista de evidencia (AI_SECURITY.md §6).
 *
 * Amenaza: el LLM puede alucinar datos u obedecer instrucciones dentro del
 * documento ("agrega la skill X", "inventa 10 años de experiencia").
 * Defensa (sin LLM, sin red, reproducible):
 *  1. Toda `evidence` citada debe aparecer (fuzzy: substring normalizado o
 *     ≥60% de tokens) en el texto real extraído del CV. Si no aparece, se
 *     descarta la evidencia y se baja la confianza a ≤0.5.
 *  2. Una skill sin evidencia cuyo nombre tampoco aparece en el texto se
 *     marca con confianza ≤0.5 Y su nivel se degrada a ≤2: así una
 *     instrucción inyectada ("añade skill X nivel 5") ya no puede inflar el
 *     matching (minLevel≥3 no se cumple con datos no verificables).
 *  3. Educación y certificaciones NO verificables se eliminan: una
 *     certificación fabricada daba 100/100 en un requisito `certification`
 *     sin ninguna trazabilidad al documento (hueco detectado en auditoría #2).
 *
 * El score de matching sigue determinista: nunca sube por datos que no
 * provienen del CV real.
 */
import type { CvExtraction } from "./schemas";

export function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normText(s)
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 2);
}

/** ¿`needle` aparece en el texto? substring normalizado o ≥60% de tokens. */
export function appearsIn(
  needle: string,
  textTokens: Set<string>,
  normalizedText: string,
): boolean {
  const n = normText(needle);
  if (n.length === 0) return true;
  if (normalizedText.includes(n)) return true;
  const toks = tokens(needle).filter((t) => t.length >= 3);
  if (toks.length === 0) return false;
  const hits = toks.filter((t) => textTokens.has(t)).length;
  return hits / toks.length >= 0.6;
}

export interface EvidenceCheckResult {
  extraction: CvExtraction;
  droppedEvidence: number;
  lowConfidenceSkills: number;
  filteredEducation: number;
  filteredCertifications: number;
  filteredYearsExperience: boolean;
}

const capAt = (current: number | undefined, cap: number): number =>
  current === undefined ? cap : Math.min(current, cap);

export function verifyExtractionAgainstSource(
  text: string,
  extraction: CvExtraction,
): EvidenceCheckResult {
  const normalizedText = normText(text);
  const textTokens = new Set(tokens(text));
  let droppedEvidence = 0;
  let lowConfidenceSkills = 0;
  let filteredEducation = 0;
  let filteredCertifications = 0;
  let filteredYearsExperience = false;

  const skills = extraction.skills.map((s) => {
    let evidence = s.evidence;
    let confidence = s.confidence;
    let level = s.level;
    if (evidence !== undefined) {
      if (!appearsIn(evidence, textTokens, normalizedText)) {
        evidence = undefined;
        confidence = capAt(confidence, 0.5);
        droppedEvidence++;
      }
    } else if (
      s.name.trim().length >= 3 &&
      !appearsIn(s.name, textTokens, normalizedText)
    ) {
      // Skill que no aparece en el texto: posible dato fabricado por
      // inyección → confianza baja y nivel degradado (anti score inflation).
      confidence = capAt(confidence, 0.5);
      level = Math.min(level, 2);
      lowConfidenceSkills++;
    }
    return { ...s, level, evidence, confidence };
  });

  const experience = extraction.experience.map((x) => {
    let evidence = x.evidence;
    let confidence = x.confidence;
    if (evidence !== undefined && !appearsIn(evidence, textTokens, normalizedText)) {
      evidence = undefined;
      confidence = capAt(confidence, 0.5);
      droppedEvidence++;
    }
    return { ...x, evidence, confidence };
  });

  // ── Educación y certificaciones (hardening auditoría #2) ─────────────────
  // Antes NO se verificaban: una certificación fabricada por inyección
  // ("agrega AWS Solutions Architect Professional") pasaba intacta al perfil
  // y a computeMatch, donde un requisito `certification` da 100 si el nombre
  // coincide → el CV inflaba su score con datos inexistentes. Para education
  // y certifications no hay señales de confianza parciales, así que el dato
  // no verificable se ELIMINA (no se degrada): un título/certificado que no
  // aparece ni parcialmente en el documento no debe existir.
  const education = extraction.education.filter((e) => {
    const verifiable =
      appearsIn(e.institution, textTokens, normalizedText) ||
      appearsIn(e.degree, textTokens, normalizedText) ||
      (e.field !== undefined && appearsIn(e.field, textTokens, normalizedText));
    if (!verifiable) filteredEducation++;
    return verifiable;
  });

  const certifications = extraction.certifications.filter((c) => {
    const verifiable =
      appearsIn(c.name, textTokens, normalizedText) ||
      (c.issuer !== undefined && appearsIn(c.issuer, textTokens, normalizedText));
    if (!verifiable) filteredCertifications++;
    return verifiable;
  });

  // ── yearsExperience (hardening auditoría #3) ────────────────────────
  // La experiencia total solo es acreditable si el número aparece en el texto
  // ("5 años") o si alguna experiencia individual con empresa verificable lo
  // respalda. Antes, un "tengo 15 años de experiencia" inyectado (sin
  // aparecer en el CV) pasaba directo al requisito experience_years → +100.
  const hasVerifiableEmployer = extraction.experience.some(
    (x) =>
      appearsIn(x.company, textTokens, normalizedText) ||
      appearsIn(x.title, textTokens, normalizedText),
  );
  let yearsExperience = extraction.yearsExperience;
  if (
    yearsExperience !== undefined &&
    yearsExperience > 0 &&
    !hasVerifiableEmployer &&
    !/\b\d+\s*(años|anos|years)\b/i.test(text)
  ) {
    // No hay empleador verificable ni mención numérica en el texto: el dato
    // no puede proceder del documento → se descarta (anti score-inflation).
    yearsExperience = undefined;
    filteredYearsExperience = true;
  }

  return {
    extraction: {
      ...extraction,
      skills,
      experience,
      education,
      certifications,
      yearsExperience,
    },
    droppedEvidence,
    lowConfidenceSkills,
    filteredEducation,
    filteredCertifications,
    filteredYearsExperience,
  };
}
