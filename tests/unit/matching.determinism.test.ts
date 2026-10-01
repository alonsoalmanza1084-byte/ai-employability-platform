/**
 * GATE G — Matching determinista: LLM ≠ score.
 *
 * Invariantes exigidos por el gate:
 *  - el score lo calcula `computeMatch` (función pura), NUNCA el LLM;
 *  - misma entrada → mismo resultado, N ejecuciones, sin estado oculto;
 *  - la entrada no se muta (el matcher no "aprende" ni arrastra estado);
 *  - los pesos se clampean server-side (el cliente no puede desbalanciar);
 *  - la entrada no contiene ni produce características protegidas;
 *  - la fórmula del overall está documentada y es estable.
 */
import { describe, expect, it } from "vitest";
import {
  computeMatch,
  MATCHING_ENGINE_VERSION,
  type MatchRequirementInput,
} from "../../src/convex/lib/matching";
import type { CvExtraction } from "../../src/convex/lib/ai/schemas";

const REQS: MatchRequirementInput[] = [
  { id: "r1", type: "skill", label: "Python", minLevel: 3, weight: 0.4, isMustHave: false },
  { id: "r2", type: "skill", label: "SQL", minLevel: 3, weight: 0.3, isMustHave: false },
  { id: "r3", type: "experience_years", label: "Exp", minYears: 4, weight: 0.2, isMustHave: false },
  { id: "r4", type: "education", label: "Sistemas", weight: 0.1, isMustHave: false },
  { id: "r5", type: "certification", label: "AWS Solutions Architect", weight: 0.2, isMustHave: false },
];

const CAND: CvExtraction = {
  fullName: "Ana Prueba",
  headline: "Analista de Datos",
  yearsExperience: 5,
  skills: [
    { name: "Python", level: 4, evidence: "reporting con Python", confidence: 0.9 },
    { name: "SQL", level: 3, evidence: "reporting con SQL", confidence: 0.9 },
  ],
  experience: [
    {
      company: "Empresa Delta",
      title: "Analista de Datos",
      start: "2021",
      end: "2024",
      description: "Reporting",
      achievements: ["reduje el tiempo de reporting un 40%"],
    },
  ],
  education: [{ institution: "Universidad Central", degree: "Ingeniería en Sistemas" }],
  certifications: [],
};

describe("GATE G — determinismo del matching", () => {
  it("100 ejecuciones producen un resultado idéntico (deep equal)", () => {
    const ref = JSON.stringify(computeMatch(CAND, REQS));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(computeMatch(CAND, REQS))).toBe(ref);
    }
  });

  it("el matcher NO muta su entrada (sin estado oculto entre llamadas)", () => {
    const snapshot = JSON.stringify({ CAND, REQS });
    for (let i = 0; i < 10; i++) computeMatch(CAND, REQS);
    expect(JSON.stringify({ CAND, REQS })).toBe(snapshot);
  });

  it("el resultado es independiente del ORDEN de los requisitos", () => {
    const a = computeMatch(CAND, REQS);
    const b = computeMatch(CAND, [...REQS].reverse());
    expect(b.overall).toBe(a.overall);
    expect(b.skills).toBe(a.skills);
    expect(b.experience).toBe(a.experience);
    expect(b.education).toBe(a.education);
  });

  it("la fórmula del overall es la media ponderada por weight (documentada y estable)", () => {
    const r = computeMatch(CAND, REQS);
    const manual = Math.round(
      (100 * 0.4 + // Python 4 >= 3
        100 * 0.3 + // SQL 3 >= 3
        100 * 0.2 + // 5 años >= 4
        100 * 0.1 + // educación coincide
        0 * 0.2) / // sin certificación AWS
      1.2,
    );
    expect(r.overall).toBe(manual);
    expect(r.overall).toBeGreaterThanOrEqual(0);
    expect(r.overall).toBeLessThanOrEqual(100);
  });

  it("pesos hostiles se clampean: nunca desbalancian ni restan puntos", () => {
    const hostile: MatchRequirementInput[] = [
      { id: "a", type: "skill", label: "Python", minLevel: 3, weight: 999, isMustHave: false },
      { id: "b", type: "skill", label: "SQL", minLevel: 3, weight: -999, isMustHave: false },
    ];
    const r = computeMatch(CAND, hostile);
    // weight -999 se clampa a 0 → SQL no resta; Python queda al 100.
    expect(r.overall).toBe(100);
    expect(r.overall).toBeGreaterThanOrEqual(computeMatch(CAND, REQS).overall - 100);
  });

  it("una skill sin confianza (<0.6) no aporta puntos", () => {
    const degradada: CvExtraction = {
      ...CAND,
      skills: [{ name: "Python", level: 5, confidence: 0.2 }],
    };
    const r = computeMatch(degradada, REQS);
    const py = r.requirements.find((x) => x.requirementId === "r1");
    expect(py?.score).toBe(0);
  });

  it("no usa ni expone características protegidas", () => {
    const conDatosSensible: CvExtraction & Record<string, unknown> = {
      ...CAND,
      // Campos que el matcher NO debe leer aunque estén presentes.
      age: 34,
      gender: "mujer",
      nationality: "mexicana",
      maritalStatus: "soltera",
      photo: "data:image/png;base64,AAAA",
    };
    const r = computeMatch(conDatosSensible, REQS);
    const blob = JSON.stringify(r);
    for (const prohibido of ["34", "mujer", "mexicana", "soltera", "data:image"]) {
      expect(blob.includes(prohibido), `el match filtró "${prohibido}"`).toBe(false);
    }
  });

  it("el motor está versionado (toda mudança de fórmula es detectable)", () => {
    expect(MATCHING_ENGINE_VERSION).toBe("deterministic-v1");
    expect(computeMatch(CAND, REQS).engineVersion).toBe(MATCHING_ENGINE_VERSION);
  });

  it("sin requisitos el score es 0 y no lanza (fail-closed)", () => {
    const r = computeMatch(CAND, []);
    expect(r.overall).toBe(0);
    expect(r.requirements).toEqual([]);
  });

  it("el LLM no participa: el score sale de la función pura, sin ninguna referencia a IA", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const code = readFileSync(
      join(__dirname, "..", "..", "src", "convex", "lib", "matching.ts"),
      "utf8",
    );
    for (const prohibido of ["provider", "openai", "completion", "fetch(", "process.env"]) {
      expect(code, "matching.ts referencia al proveedor IA").not.toContain(prohibido);
    }
  });
});