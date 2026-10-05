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
import type { CareerCoachResponse } from "./coach_schemas";

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
  /** Niveles de habilidad recortados por no estar sustentados en el texto. */
  inflatedSkillLevels: number;
}

const capAt = (current: number | undefined, cap: number): number =>
  current === undefined ? cap : Math.min(current, cap);

/**
 * Suma de años supported por las experiencias DECLARADAS y verificables.
 *
 * Solo cuenta entradas cuya empresa o puesto aparece en el texto, y cuyo rango
 * de fechas se puede leer como años. Es el techo que puede justificar la cifra
 * de `yearsExperience`: un rango 2021-2024 son 3 años, no 30.
 */
function sumVerifiableExperienceYears(
  experience: readonly {
    company?: string;
    title?: string;
    start?: string;
    end?: string;
  }[],
  textTokens: Set<string>,
  normalizedText: string,
): number {
  const YEAR = /\b(19|20)\d{2}\b/g;
  let total = 0;
  for (const x of experience) {
    const verifiable =
      (x.company !== undefined && appearsIn(x.company, textTokens, normalizedText)) ||
      (x.title !== undefined && appearsIn(x.title, textTokens, normalizedText));
    if (!verifiable) continue;
    const from = x.start?.match(YEAR);
    const to = x.end?.match(YEAR);
    if (!from || !to) continue;
    const y0 = Number(from[0]);
    const y1 = Number(to[0]);
    if (Number.isNaN(y0) || Number.isNaN(y1) || y1 < y0) continue;
    // Techo por entrada (40 años) contra rangos absurdos.
    total += Math.min(y1 - y0, 40);
  }
  return total;
}

/**
 * Techo de NIVEL de habilidad que el documento puede sostener.
 *
 * Bug real (auditoría #3): la evidencia solo comprobaba que el NOMBRE de la
 * habilidad apareciera en el texto, así que un LLM obediente podía subir
 * "Python nivel 3" a "nivel 5" conservando la evidencia real y subiendo el
 * score. Ahora el nivel se acota a lo que el texto sustenta:
 *   - 5 (experto): solo con marcadores explícitos de maestría.
 *   - 4 (avanzado): con marcadores de seniority.
 *   - 3: por defecto (no se inventa proficiency superior).
 *
 * Decisión fail-closed: preferimos recortar un nivel de más a aceptar un nivel
 * inventado.
 */
function maxJustifiedSkillLevel(text: string): 1 | 2 | 3 | 4 | 5 {
  if (
    /\b(expert[oa]s?|especialista\s+(sr\.?|senior)|arquitect[oa]s?|architect|principal)\b/i.test(
      text,
    )
  ) {
    return 5;
  }
  if (/\b(senior|sr\.?|semi\s*sr|lead|avanzad[oa]|advanced)\b/i.test(text)) {
    return 4;
  }
  return 3;
}

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
  let inflatedSkillLevels = 0;

  const justifiedLevel = maxJustifiedSkillLevel(text);
  const skills = extraction.skills.map((s) => {
    let evidence = s.evidence;
    let confidence = s.confidence;
    let level = s.level;
    // Anti score-inflation: el nivel declarado por el LLM se acota a lo que el
    // TEXTO sustenta. Sin marcadores de seniority/experiencia, 5 y 4 no son
    // justificables aunque la evidencia de la habilidad sea real.
    if (level > justifiedLevel) {
      level = justifiedLevel;
      inflatedSkillLevels++;
    }
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
  if (yearsExperience !== undefined && yearsExperience > 0) {
    // AÑO POR AÑO: un empleador verificable NO acredita el NÚMERO de años.
    // Bug real (auditoría #3): "hay un empleador en el CV" se usaba como
    // coartada para aceptar "30 años" inyectados. Ahora el número se acota a
    // lo que el propio documento soporta:
    //  1. Si el CV menciona literalmente "N años" → ese N es el dato.
    //  2. Si no, se acota a la suma de los rangos de fechas declarados.
    //  3. Si no hay ninguna de las dos cosas → se descarta.
    const literalYears = text.match(/\b(\d{1,2})\s*(?:años|anos|years)\b/i);
    if (literalYears) {
      const stated = Number(literalYears[1]);
      if (Number.isFinite(stated) && stated < yearsExperience) {
        yearsExperience = stated;
        filteredYearsExperience = true;
      }
    } else {
      const span = sumVerifiableExperienceYears(
        extraction.experience,
        textTokens,
        normalizedText,
      );
      if (span > 0) {
        if (yearsExperience > span) {
          yearsExperience = span;
          filteredYearsExperience = true;
        }
      } else if (!hasVerifiableEmployer) {
        yearsExperience = undefined;
        filteredYearsExperience = true;
      } else {
        // Hay empleador verificable pero ninguna fecha utilizable: no podemos
        // sostener una cifra, así que no se inventa ninguna.
        yearsExperience = undefined;
        filteredYearsExperience = true;
      }
    }
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
    inflatedSkillLevels,
  };
}

/**
 * Solapamiento mínimo de tokens para que una observación del coach se
 * considere sustentada por la evidencia (substring literal → siempre).
 * 0.4 es deliberadamente laxo respecto al 0.6 de la extracción (la prosa del
 * coach parafrasea) pero todavía descarta afirmaciones fabricadas: un dato
 * inventado comparte ~0 tokens con el perfil real.
 */
export const COACH_EVIDENCE_MIN_OVERLAP = 0.4;

/**
 * HEURISTIC_GROUNDING_CHECK (Career Coach; AI_SECURITY.md §6 adaptado).
 *
 * ADVERTENCIA DE GARANTÍA — esto NO es «evidencia verificada» al nivel del
 * post-check de extracción (`verifyExtractionAgainstSource`): aquí no existe
 * un documento fuente contra el que probar verdad; solo hay un CONTEXTO
 * (perfil + diagnóstico) que el propio servidor construyó. Lo que este check
 * demuestra es únicamente: «la afirmación está GROUNDADA en el contexto
 * entregado» (substring literal o ≥40% de tokens presentes). Una afirmación
 * que pasa el check NO es por eso verdadera; una que falla se DESCARTA
 * (fail-closed). No exagerar esta garantía en docs ni en copy de producto.
 *
 *  1. `observations` son AFIRMACIONES sobre el perfil → solo se conservan si
 *     aparecen en la evidencia real (substring normalizado o ≥40% de sus
 *     tokens presentes). Una observación descartada baja la confianza a ≤0.5
 *     (fail-closed: preferimos recortar a afirmar algo no verificable).
 *  1b. Regla numérica: toda CIFRA de la afirmación debe existir en el
 *     contexto. Sin ella, una invención como «15 años» sobrevivía al overlap
 *     porque tokens genéricos («años», «profesional») sí aparecen en el perfil
 *     (auditado: 2/5 = umbral exacto). Las cifras son el caso de invención
 *     más común (§13) y se comparan como literales completos («15» no
 *     coincide con «2015»).
 *  2. `message` (prosa) y `questions` NO se filtran: son explicaciones y
 *     preguntas, no hechos verificables de forma determinista. Esa limitación
 *     está documentada en docs/CAREER_COACH_SECURITY.md.
 *
 * El modelo puede devolver observaciones vacías: eso es válido (0 afirmaciones).
 */
export function verifyCoachResponse(
  response: CareerCoachResponse,
  evidenceText: string,
): CareerCoachResponse {
  const normalized = normText(evidenceText);
  const evidenceTokens = new Set(tokens(evidenceText));

  const NUMBER = /\b\d+(?:[.,]\d+)?\b/g;
  const evidenceNumbers = new Set(normalized.match(NUMBER) ?? []);

  const observations = response.observations.filter((o) => {
    // Toda cifra afirmada debe estar en el contexto (literales completos).
    for (const n of o.match(NUMBER) ?? []) {
      if (!evidenceNumbers.has(n)) return false;
    }
    const target = normText(o);
    if (target.length > 0 && normalized.includes(target)) return true;
    const toks = tokens(o).filter((t) => t.length >= 3);
    if (toks.length === 0) return false;
    const hits = toks.filter((t) => evidenceTokens.has(t)).length;
    return hits / toks.length >= COACH_EVIDENCE_MIN_OVERLAP;
  });

  const dropped = response.observations.length - observations.length;
  return {
    ...response,
    observations,
    confidence: dropped > 0
      ? Math.min(response.confidence, 0.5)
      : response.confidence,
  };
}
