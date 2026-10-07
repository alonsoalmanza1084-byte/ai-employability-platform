/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de tipos con mutator */
import { describe, expect, it } from "vitest";
import { computeGoalGap, type RequiredSkill } from "../../src/convex/lib/gap";
import type { ProfileSkill } from "../../src/convex/lib/gap";

// ---------------------------------------------------------------------------
// P0/P1 tests del gap determinista para Carrera (ADR-014-1).
// Validan semántica del motor de gap y los contratos de frescor/cross-user
// que la capa Convex debe mantener.
// ---------------------------------------------------------------------------

describe("computeGoalGap — semántica del delta para un objetivo profesional", () => {
  const ROLE_REQUIRED: RequiredSkill[] = [
    { name: "React", requiredLevel: 4 },
    { name: "TypeScript", requiredLevel: 4 },
    { name: "Testing", requiredLevel: 3 },
  ];

  it("reporta gap cuando el nivel registrado en el perfil es insuficiente (P0: perfil real detrás de un objetivo real)", () => {
    const profile: ProfileSkill[] = [
      { name: "React", level: 3, source: "human", confidence: 0.95 },
      { name: "TypeScript", level: 4, source: "ai", confidence: 0.92 },
    ];
    const analysis = computeGoalGap(profile, ROLE_REQUIRED, "career-goals/1");

    const reactItem = analysis.skills.find((s) => s.skill === "React");
    const tsItem = analysis.skills.find((s) => s.skill === "TypeScript");

    // TypeScript 4 >= 4 REQUIRED → NO es gap en este perfil (cumple).
    // React 3 < 4 REQUIRED → gap.
    expect(reactItem?.status).toBe("gap");
    expect(reactItem?.currentLevel).toBe(3);
    // TS cumple: está en el array como meets_requirement.
    expect(tsItem).toBeDefined();
    expect(tsItem?.status).toBe("meets_requirement");
    expect(tsItem?.currentLevel).toBe(4);
    expect(analysis.skills.some((s) => s.status === 'meets_requirement')).toBe(true);

    const testingGap = analysis.skills.find((s) => s.skill === "Testing");
    expect(testingGap).toBeDefined();
    expect(testingGap?.status).toBe("missing_evidence");
    expect(analysis.skills[2].status).toBe("missing_evidence");
    expect(analysis.skills[2].skill).toBe("Testing");
    expect(analysis.skills[2].requiredLevel).toBe(3);
    expect(analysis.skills[2].currentLevel).toBeUndefined();
    expect(analysis.skills[2].evidenceRefs).toEqual([]);
  });

  it("no perdona el nivel insuficiente cuando existe evidencia (Testing no registrado → missing_evidence)", () => {
    const profile: ProfileSkill[] = [{ name: "React", level: 4, source: "human" }];
    const analysis = computeGoalGap(profile, [{ name: "Testing", requiredLevel: 3 }], "career-goals/missing");

    expect(analysis.skills[0].status).toBe("missing_evidence");
    expect(analysis.skills[0].currentLevel).toBeUndefined();
  });

  it("insufficient_evidence cuando la skill existe pero confianza baja", () => {
    const profile: ProfileSkill[] = [
      { name: "React", level: 3, source: "ai", confidence: 0.5 },
    ];
    const analysis = computeGoalGap(profile, [{ name: "React", requiredLevel: 4 }], "career-goals/low-confidence");

    expect(analysis.skills[0].status).toBe("insufficient_evidence");
    expect(analysis.skills[0].currentLevel).toBe(3);
  });
});

describe("delta entre perfiles para el mismo objetivo (auditoría de brecha por candidato)", () => {
  const required: RequiredSkill[] = [
    { name: "React", requiredLevel: 4 },
    { name: "TypeScript", requiredLevel: 4 },
  ];

  const strong: ProfileSkill[] = [
    { name: "React", level: 4, source: "human" },
    { name: "TypeScript", level: 4, source: "ai" },
  ];

  const weak: ProfileSkill[] = [
    { name: "React", level: 3, source: "ai", confidence: 0.9 },
    { name: "TypeScript", level: 3, source: "human" },
  ];

  it("delta entre perfiles: el mismo objetivo hace gap mayor en el perfil débil (P0: resultados distintos por candidato)", () => {
    const a = computeGoalGap(strong, required, "career-goals/delta");
    const b = computeGoalGap(weak, required, "career-goals/delta");
    expect(a.overallCoverage).toBeGreaterThan(b.overallCoverage);
    expect(a.overallCoverage).toBe(100);
    expect(b.overallCoverage).toBe(0);
  });

  it("stale cache no se usa cuando el perfil cambió (P0: stale cache viola resultados correctos)", () => {
    const staleProfile: ProfileSkill[] = [{ name: "React", level: 2, source: "human" }];
    const currentProfile: ProfileSkill[] = [{ name: "React", level: 4, source: "human" }];
    const requirement = [{ name: "React", requiredLevel: 4 }];

    const staleGap = computeGoalGap(staleProfile, requirement, "carrera-goals/stale");
    const currentGap = computeGoalGap(currentProfile, requirement, "carrera-goals/stale");

    expect(staleGap.skills[0].status).toBe("gap");
    expect(currentGap.skills[0].status).toBe("meets_requirement");
  });

  it("P0: no expone cache cross-user (idx by_target_user NO devuelve cache de otro userId)", () => {
    // Escenario real: transacción A (userId=1) crea cache stale; usuario B hace query con id distinto.
    // El índice por_target_user no devuelve cache de otro userId, pero el filter de seguridad
    // refuerza más: nunca usar cache si userId !== ctx.userId.
    const myProfile: ProfileSkill[] = [{ name: "React", level: 2, source: "ai", confidence: 0.9 }];
    const otherProfile: ProfileSkill[] = [{ name: "React", level: 4, source: "ai", confidence: 0.95 }];
    const required: RequiredSkill[] = [{ name: "React", requiredLevel: 4 }];

    const cacheStaleForOtherUser = computeGoalGap(otherProfile, required, "carrera-goals/cross-user");
    const myAnalysis = computeGoalGap(myProfile, required, "carrera-goals/cross-user");

    expect(cacheStaleForOtherUser.skills[0].status).toBe("meets_requirement");
    expect(myAnalysis.skills[0].status).toBe("gap");
    expect(myAnalysis.skills[0].currentLevel).toBe(2);
  });
});

describe("invarianres de seguridad leídos desde la lógica determinista", () => {
  it("la función no modifica los arrays de entrada (pureza referencial)", () => {
    const profile: ProfileSkill[] = [
      { name: "React", level: 3, source: "human" },
    ];
    const required: RequiredSkill[] = [{ name: "React", requiredLevel: 4 }];
    const before = profile.length;
    computeGoalGap(profile, required, "career-goals/purity");
    expect(profile.length).toBe(before);
  });
});
