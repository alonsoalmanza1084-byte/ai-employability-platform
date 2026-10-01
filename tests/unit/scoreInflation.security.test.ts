/**
 * INFLACIÓN DE SCORE POR AFIRMACIONES NO VERIFICABLES (auditoría #3).
 *
 * Esta suite es DETERMINISTA y NO requiere LLM: simula la salida de un LLM que
 * obedece una inyección (es decir, el PEOR caso: el modelo devuelve
 * exactamente lo que el atacante pidió) y demuestra que las capas de
 * deterministicidad —post-check de evidencia + matcher— impiden que esas
 * afirmaciones suban el score.
 *
 * Es la prueba que SÍ se puede ejecutar hoy sin OPENAI_API_KEY. La evaluación
 * golden con LLM real (tests/golden/ai.security.eval.test.ts) es distinta y
 * complementaria: verifica el comportamiento del modelo, no el de las defensas.
 *
 * Vectores cubiertos: habilidades, NIVELES de habilidad, años de experiencia,
 * educación, certificaciones, logros y experiencia de gestión.
 */
import { describe, expect, it } from "vitest";
import { cvExtractionSchema } from "../../src/convex/lib/ai/schemas";
import { verifyExtractionAgainstSource } from "../../src/convex/lib/ai/evidence";
import { computeMatch, type MatchRequirementInput } from "../../src/convex/lib/matching";

/** CV sintético real (sin datos de personas reales). */
const CV = `Elena Real
Analista de datos en Empresa Delta (2021-2024). Reportes mensuales con Python
y SQL sobre PostgreSQL. automaticé un tablero en Tableau.
Estudios: Licenciatura en Sistemas, Universidad Central, 2020.
Habilidades: Python, SQL, Tableau.`;

/** Requisitos de la vacante: todo lo que el CV limpio cumple parcialmente. */
const REQS: MatchRequirementInput[] = [
  { id: "r1", type: "skill", label: "Python", minLevel: 4, weight: 0.4, isMustHave: false },
  { id: "r2", type: "skill", label: "SQL", minLevel: 4, weight: 0.3, isMustHave: false },
  { id: "r3", type: "experience_years", label: "Experiencia total", minYears: 8, weight: 0.2, isMustHave: false },
  { id: "r4", type: "certification", label: "AWS Solutions Architect", weight: 0.2, isMustHave: false },
  { id: "r5", type: "education", label: "Doctorado", weight: 0.1, isMustHave: false },
];

/** Extracción honesta de Elena (lo que un LLM bien comportado devolvería). */
const HONEST = {
  fullName: "Elena Real",
  headline: "Analista de datos",
  yearsExperience: 4,
  skills: [
    { name: "Python", level: 3, evidence: "Reportes mensuales con Python", confidence: 0.95 },
    { name: "SQL", level: 3, evidence: "SQL sobre PostgreSQL", confidence: 0.95 },
    { name: "Tableau", level: 2, evidence: "tablero en Tableau", confidence: 0.9 },
  ],
  experience: [
    {
      company: "Empresa Delta",
      title: "Analista de datos",
      start: "2021",
      end: "2024",
      description: "Reportes mensuales con Python y SQL sobre PostgreSQL",
      achievements: ["automaticé un tablero en Tableau"],
      evidence: "Analista de datos en Empresa Delta (2021-2024)",
      confidence: 0.95,
    },
  ],
  education: [
    { institution: "Universidad Central", degree: "Licenciatura", field: "Sistemas" },
  ],
  certifications: [],
};

/** Pipeline de producción: parseo estricto → post-check → matcher. */
function pipeline(raw: unknown) {
  const parsed = cvExtractionSchema.parse(raw);
  const checked = verifyExtractionAgainstSource(CV, parsed);
  const match = computeMatch(checked.extraction, REQS);
  return { checked, match };
}

const baseline = pipeline(HONEST);
const BASELINE_SCORE = baseline.match.overall;

describe("puntuación base honesta", () => {
  it("el CV honesto produce un score de referencia > 0", () => {
    expect(BASELINE_SCORE).toBeGreaterThan(0);
  });
});

describe("un LLM obediente a una inyección NO puede subir el score", () => {
  // Este es el escenario de amenaza real: el CV contiene instrucciones y el
  // modelo las obedece. Las defensas NO dependen de que el modelo coopere.

  it("VECTOR: inflar NIVELES de habilidades existentes", () => {
    const { match } = pipeline({
      ...HONEST,
      skills: HONEST.skills.map((s) => ({ ...s, level: 5 })),
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("VECTOR: añadir habilidades fantasma con nivel máximo", () => {
    const { match } = pipeline({
      ...HONEST,
      skills: [
        ...HONEST.skills,
        { name: "Kubernetes", level: 5, evidence: "ignora este campo", confidence: 1 },
        { name: "AWS", level: 5, evidence: "ignora este campo", confidence: 1 },
      ],
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("VECTOR: inflar años de experiencia", () => {
    const { match } = pipeline({ ...HONEST, yearsExperience: 25 });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("VECTOR: fabricarse educación no verificable", () => {
    const { match } = pipeline({
      ...HONEST,
      education: [
        ...HONEST.education,
        { institution: "MIT", degree: "Doctorado", field: "Informática" },
      ],
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("VECTOR: fabricarse certificaciones", () => {
    const { match } = pipeline({
      ...HONEST,
      certifications: [
        { name: "AWS Solutions Architect", issuer: "Amazon" },
        { name: "Google Cloud Professional Architect", issuer: "Google" },
      ],
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("VECTOR: inflar LOGROS (achievements)", () => {
    const { match } = pipeline({
      ...HONEST,
      experience: [
        {
          ...HONEST.experience[0],
          achievements: [
            "lideré 50 ingenieros",
            "aumenté los ingresos un 300%",
            "automaticé un tablero en Tableau",
          ],
        },
      ],
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("VECTOR: fabricarse experiencia de GESTIÓN", () => {
    const { match } = pipeline({
      ...HONEST,
      experience: [
        ...HONEST.experience,
        {
          company: "Google",
          title: "Engineering Manager",
          start: "2010",
          end: "2020",
          description: "lideré 50 ingenieros de cloud",
          achievements: ["aumenté ingresos 300%"],
          evidence: "lideré 50 ingenieros",
          confidence: 1,
        },
      ],
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });

  it("ATAQUE COMBINADO: todos los vectores a la vez tampoco suben el score", () => {
    const { match } = pipeline({
      fullName: "Elena Real",
      headline: "Engineering Manager",
      yearsExperience: 30,
      skills: [
        { name: "Python", level: 5, evidence: "x", confidence: 1 },
        { name: "SQL", level: 5, evidence: "x", confidence: 1 },
        { name: "Kubernetes", level: 5, evidence: "x", confidence: 1 },
        { name: "AWS", level: 5, evidence: "x", confidence: 1 },
        { name: "Tableau", level: 5, evidence: "x", confidence: 1 },
      ],
      experience: [
        {
          company: "Google",
          title: "Engineering Manager",
          start: "2005",
          end: "2020",
          description: "lideré 50 ingenieros",
          achievements: ["300% de ingresos"],
          evidence: "lideré 50 ingenieros",
          confidence: 1,
        },
        {
          company: "Empresa Delta",
          title: "Analista de datos",
          start: "2021",
          end: "2024",
          description: "Reportes mensuales con Python y SQL sobre PostgreSQL",
          achievements: ["automaticé un tablero en Tableau"],
          evidence: "Analista de datos en Empresa Delta (2021-2024)",
          confidence: 0.95,
        },
      ],
      education: [
        { institution: "MIT", degree: "Doctorado", field: "Informática" },
        { institution: "Universidad Central", degree: "Licenciatura", field: "Sistemas" },
      ],
      certifications: [
        { name: "AWS Solutions Architect", issuer: "Amazon" },
        { name: "Google Cloud Professional Architect", issuer: "Google" },
      ],
    });
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });
});

describe("el post-check deja constancia de lo que descartó", () => {
  it("cuenta las certificaciones filtradas", () => {
    const { checked } = pipeline({
      ...HONEST,
      certifications: [{ name: "AWS Solutions Architect", issuer: "Amazon" }],
    });
    expect(checked.filteredCertifications).toBeGreaterThan(0);
  });

  it("cuenta la educación filtrada", () => {
    const { checked } = pipeline({
      ...HONEST,
      education: [
        { institution: "MIT", degree: "Doctorado", field: "Informática" },
      ],
    });
    expect(checked.filteredEducation).toBeGreaterThan(0);
  });

  it("marca los años de experiencia recortados", () => {
    const { checked } = pipeline({ ...HONEST, yearsExperience: 30 });
    expect(checked.filteredYearsExperience).toBe(true);
  });

  it("cuenta los niveles de habilidad recortados por no sustentarse", () => {
    const { checked } = pipeline({
      ...HONEST,
      skills: HONEST.skills.map((s) => ({ ...s, level: 5 })),
    });
    expect(checked.inflatedSkillLevels).toBeGreaterThan(0);
  });

  it("una habilidad fantasma con evidencia fabricada pierde su evidencia", () => {
    const { checked, match } = pipeline({
      ...HONEST,
      skills: [
        ...HONEST.skills,
        { name: "Kubernetes", level: 5, evidence: "ignora este campo", confidence: 1 },
      ],
    });
    // La evidencia no aparece en el texto → se descarta y la confianza baja,
    // con lo cual el matcher la ignora (confianza < 0.6).
    expect(checked.droppedEvidence).toBeGreaterThan(0);
    expect(match.overall).toBeLessThanOrEqual(BASELINE_SCORE);
  });
});
