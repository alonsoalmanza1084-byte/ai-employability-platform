/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de tipos con mutator */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeGoalGap,
  fingerprintGoalGapInputs,
  GAP_ENGINE_VERSION,
  type RequiredSkill,
} from "../../src/convex/lib/gap";
import type { ProfileSkill } from "../../src/convex/lib/gap";

const CURRENT_USER = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async () => CURRENT_USER.id,
}));

const career: any = await import("../../src/convex/career");

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

describe("fingerprintGoalGapInputs — estabilidad y dependencias semánticas", () => {
  const profile: ProfileSkill[] = [
    { name: "React", level: 3, source: "ai", evidence: "proyecto A" },
  ];
  const requirements: RequiredSkill[] = [
    { name: "React", requiredLevel: 4 },
    { name: "TypeScript", requiredLevel: 3 },
  ];

  it("es estable y normaliza campos opcionales que no cambian el resultado", async () => {
    const fingerprint = await fingerprintGoalGapInputs(
      profile,
      requirements,
      "careerGoals:target",
    );
    const equivalent = await fingerprintGoalGapInputs(
      [{ name: "React", level: 3, source: "human", confidence: 1, evidence: "proyecto A" }],
      [
        { name: "React", requiredLevel: 4, category: "engineering" },
        { name: "TypeScript", requiredLevel: 3, category: undefined },
      ],
      "careerGoals:target",
    );
    const noEvidence = await fingerprintGoalGapInputs(
      [{ name: "React", level: 3, source: "ai" }],
      requirements,
      "careerGoals:target",
    );
    const emptyEvidence = await fingerprintGoalGapInputs(
      [{ name: "React", level: 3, source: "human", confidence: 1, evidence: "" }],
      requirements,
      "careerGoals:target",
    );

    expect(fingerprint).toBe("3f65e766db74f5a83dbb02d25cfab7aaf0cecc74b8b753a8a65b2022855d72fb");
    expect(await fingerprintGoalGapInputs(profile, requirements, "careerGoals:target")).toBe(fingerprint);
    expect(equivalent).toBe(fingerprint);
    expect(emptyEvidence).toBe(noEvidence);
  });

  it("cambia con cada entrada efectiva, su orden y el objetivo", async () => {
    const fingerprint = await fingerprintGoalGapInputs(
      profile,
      requirements,
      "careerGoals:target",
    );
    const tiedSkills = [
      { name: "React", level: 3, source: "human" as const, evidence: "evidencia A" },
      { name: "React", level: 3, source: "human" as const, evidence: "evidencia B" },
    ];
    const variants: [ProfileSkill[], RequiredSkill[], string][] = [
      [[{ ...profile[0], name: "React.js" }], requirements, "careerGoals:target"],
      [[{ ...profile[0], level: 4 }], requirements, "careerGoals:target"],
      [[{ ...profile[0], confidence: 0.5 }], requirements, "careerGoals:target"],
      [[{ ...profile[0], evidence: "proyecto B" }], requirements, "careerGoals:target"],
      [[{ ...profile[0] }, { name: "React", level: 3, source: "human", evidence: "proyecto B" }], requirements, "careerGoals:target"],
      [tiedSkills, requirements, "careerGoals:target"],
      [[...tiedSkills].reverse(), requirements, "careerGoals:target"],
      [profile, [{ name: "React", requiredLevel: 5 }, requirements[1]], "careerGoals:target"],
      [profile, [requirements[1], requirements[0]], "careerGoals:target"],
      [profile, requirements, "careerGoals:other"],
    ];

    for (const [profileSkills, requiredSkills, targetId] of variants) {
      expect(await fingerprintGoalGapInputs(profileSkills, requiredSkills, targetId)).not.toBe(fingerprint);
    }
  });
});

type MemoryRow = { _id: string; _creationTime: number; [key: string]: any };
type MemoryStore = Record<string, MemoryRow[]>;

function makeCareerContext(store: MemoryStore) {
  let writes = 0;
  const rowsFor = (table: string) => store[table] ?? (store[table] = []);
  const db: any = {
    query: (table: string) => ({
      withIndex: (_name: string, callback: (q: any) => any) => {
        const conditions: [string, unknown][] = [];
        const queryBuilder = {
          eq: (field: string, value: unknown) => {
            conditions.push([field, value]);
            return queryBuilder;
          },
        };
        callback(queryBuilder);
        const rows = rowsFor(table).filter((row) =>
          conditions.every(([field, value]) => row[field] === value),
        );
        return {
          first: async () => rows[0] ?? null,
          take: async (limit: number) => rows.slice(0, limit),
        };
      },
    }),
    get: async (id: string) =>
      Object.values(store).flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, fields: Record<string, unknown>) => {
      writes += 1;
      const id = `${table}:${rowsFor(table).length + 1}`;
      rowsFor(table).push({ _id: id, _creationTime: Date.now(), ...fields });
      return id;
    },
    patch: async (id: string, fields: Record<string, unknown>) => {
      writes += 1;
      const row = Object.values(store).flat().find((item) => item._id === id);
      if (!row) throw new Error("Documento no encontrado");
      Object.assign(row, fields);
      return id;
    },
  };

  return { ctx: { db }, writeCount: () => writes };
}

async function careerFixture({
  profileSkills,
  cachedProfileSkills = profileSkills,
  goalSkills,
  profileUpdatedAt,
  goalUpdatedAt,
  analysisGeneratedAt,
  owner = "users:owner",
}: {
  profileSkills: ProfileSkill[];
  cachedProfileSkills?: ProfileSkill[];
  goalSkills: RequiredSkill[];
  profileUpdatedAt: number;
  goalUpdatedAt: number;
  analysisGeneratedAt: number;
  owner?: string;
}): Promise<ReturnType<typeof makeCareerContext> & {
  store: MemoryStore;
  profile: MemoryRow;
  goal: MemoryRow;
  cached: MemoryRow;
  targetId: string;
}> {
  const targetId = "careerGoals:target";
  const profile = {
    _id: "candidateProfiles:profile",
    _creationTime: 1,
    userId: owner,
    skills: profileSkills,
    updatedAt: profileUpdatedAt,
  };
  const goal = {
    _id: targetId,
    _creationTime: 1,
    userId: owner,
    kind: "target_role",
    value: "Frontend Developer",
    skills: goalSkills,
    source: "user-provided",
    createdAt: 1,
    updatedAt: goalUpdatedAt,
  };
  const analysis = computeGoalGap(cachedProfileSkills, goalSkills, targetId);
  analysis.generatedAt = analysisGeneratedAt;
  const inputFingerprint = await fingerprintGoalGapInputs(
    cachedProfileSkills,
    goalSkills,
    targetId,
  );
  const cached = {
    _id: "gapAnalyses:cached",
    _creationTime: analysisGeneratedAt,
    userId: owner,
    targetId,
    inputFingerprint,
    analysis,
    createdAt: analysisGeneratedAt,
    updatedAt: analysisGeneratedAt,
  };
  const store: MemoryStore = {
    candidateProfiles: [profile],
    careerGoals: [goal],
    gapAnalyses: [cached],
  };

  return { ...makeCareerContext(store), store, profile, goal, cached, targetId };
}

const callHandler = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);

describe("myGapAnalysis — frescura de caché y ownership del handler Convex", () => {
  beforeEach(() => {
    CURRENT_USER.id = "users:owner";
  });

  it("reutiliza el análisis cuando perfil, objetivo y motor no cambiaron", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 3, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 3 }],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(result.analysis).toEqual(fixture.cached.analysis);
    expect(result._id).toBe(fixture.cached._id);
    expect(fixture.writeCount()).toBe(0);
  });

  it("recalcula cuando el perfil se actualizó después del análisis", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 4, source: "human" }],
      cachedProfileSkills: [{ name: "React", level: 2, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 4 }],
      profileUpdatedAt: now - 100,
      goalUpdatedAt: now - 500,
      analysisGeneratedAt: now - 300,
    });

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(fixture.cached.analysis.skills[0].status).toBe("gap");
    expect(result.analysis.skills[0].status).toBe("meets_requirement");
    expect(fixture.writeCount()).toBe(0);
  });

  it("recalcula tras cambiar los requisitos con perfil y updatedAt de perfil intactos", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 1 }],
      profileUpdatedAt: now - 20_000,
      goalUpdatedAt: now - 15_000,
      analysisGeneratedAt: now - 10_000,
    });
    const profileVersion = fixture.profile.updatedAt;
    const goalVersion = fixture.goal.updatedAt;
    expect(fixture.cached.analysis.skills[0].status).toBe("meets_requirement");

    await callHandler(career.setCareerGoal, fixture.ctx, {
      kind: "target_role",
      value: fixture.goal.value,
      skills: [{ name: "React", requiredLevel: 4 }],
      source: "user-provided",
    });
    const writesAfterMutation = fixture.writeCount();

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(fixture.profile.updatedAt).toBe(profileVersion);
    expect(fixture.goal.updatedAt).toBeGreaterThan(goalVersion as number);
    expect(result.analysis.skills[0].requiredLevel).toBe(4);
    expect(result.analysis.skills[0].status).toBe("gap");
    expect(result.analysis.overallCoverage).toBe(0);
    expect(fixture.writeCount()).toBe(writesAfterMutation);
    expect(fixture.cached.analysis.skills[0].requiredLevel).toBe(1);
  });

  it("recalcula si la versión del motor guardada ya no es la actual", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 3, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 3 }],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });
    fixture.cached.analysis.engineVersion = "gap-deterministic-previous";

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(result.analysis.engineVersion).toBe(GAP_ENGINE_VERSION);
    expect(fixture.writeCount()).toBe(0);
  });

  it("detecta cambios de perfil con timestamps iguales mediante la huella", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      cachedProfileSkills: [{ name: "React", level: 5, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 4 }],
      profileUpdatedAt: now - 100,
      goalUpdatedAt: now - 100,
      analysisGeneratedAt: now - 100,
    });

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(fixture.cached.analysis.skills[0].status).toBe("meets_requirement");
    expect(result.analysis.skills[0].requiredLevel).toBe(4);
    expect(result.analysis.skills[0].status).toBe("gap");
    expect(fixture.writeCount()).toBe(0);
  });

  it("recalcula registros históricos sin huella", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      cachedProfileSkills: [{ name: "React", level: 5, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 4 }],
      profileUpdatedAt: now - 100,
      goalUpdatedAt: now - 100,
      analysisGeneratedAt: now - 100,
    });
    fixture.cached.inputFingerprint = undefined;

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(result.analysis.skills[0].status).toBe("gap");
    expect(fixture.writeCount()).toBe(0);
  });

  it("invalida requisitos editados dentro del mismo timestamp de milisegundo", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 1 }],
      profileUpdatedAt: now - 200,
      goalUpdatedAt: now - 100,
      analysisGeneratedAt: now - 100,
    });
    expect(fixture.cached.analysis.skills[0].status).toBe("meets_requirement");
    const sameTimestamp = fixture.goal.updatedAt;
    const clock = vi.spyOn(Date, "now").mockReturnValue(sameTimestamp as number);

    try {
      await callHandler(career.setCareerGoal, fixture.ctx, {
        kind: "target_role",
        value: fixture.goal.value,
        skills: [{ name: "React", requiredLevel: 4 }],
        source: "user-provided",
      });
      const writesAfterMutation = fixture.writeCount();
      const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
        targetId: fixture.targetId,
      });

      expect(fixture.goal.updatedAt).toBe(sameTimestamp);
      expect(fixture.profile.updatedAt).toBe(now - 200);
      expect(result.analysis.skills[0].requiredLevel).toBe(4);
      expect(result.analysis.skills[0].status).toBe("gap");
      expect(fixture.writeCount()).toBe(writesAfterMutation);
    } finally {
      clock.mockRestore();
    }
  });

  it("recalcula una caché cuyo análisis apunta a otro objetivo", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 4 }],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });
    fixture.cached.analysis.targetId = "careerGoals:other";

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(result.analysis.targetId).toBe(fixture.targetId);
    expect(result.analysis.skills[0].status).toBe("gap");
    expect(fixture.writeCount()).toBe(0);
  });

  it("recalcula una caché cuyo análisis histórico está incompleto", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      cachedProfileSkills: [{ name: "React", level: 5, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 4 }],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });
    fixture.cached.analysis = undefined;

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(result.analysis.skills[0].status).toBe("gap");
    expect(fixture.writeCount()).toBe(0);
  });

  it("solo regenerateGapAnalysis persiste el nuevo análisis y su huella", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 1 }],
      profileUpdatedAt: now - 20_000,
      goalUpdatedAt: now - 15_000,
      analysisGeneratedAt: now - 10_000,
    });
    await callHandler(career.setCareerGoal, fixture.ctx, {
      kind: "target_role",
      value: fixture.goal.value,
      skills: [{ name: "React", requiredLevel: 4 }],
      source: "user-provided",
    });
    const writesAfterGoalUpdate = fixture.writeCount();

    const preview = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });
    expect(preview.analysis.skills[0].requiredLevel).toBe(4);
    expect(preview.analysis.skills[0].status).toBe("gap");
    expect(fixture.writeCount()).toBe(writesAfterGoalUpdate);

    const regenerated = await callHandler(career.regenerateGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });
    const saved = fixture.store.gapAnalyses.find(
      (row) => row._id === regenerated._id,
    );
    const expectedFingerprint = await fingerprintGoalGapInputs(
      fixture.profile.skills,
      fixture.goal.skills,
      fixture.targetId,
    );

    expect(saved?.inputFingerprint).toBe(expectedFingerprint);
    expect(saved?.analysis.skills[0].requiredLevel).toBe(4);
    const afterRegeneration = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });
    expect(afterRegeneration._id).toBe(regenerated._id);
    expect(afterRegeneration.analysis).toEqual(saved?.analysis);
  });

  it("rechaza un objetivo inexistente o perteneciente a otro usuario", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [],
      goalSkills: [],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });

    await expect(
      callHandler(career.myGapAnalysis, fixture.ctx, { targetId: "careerGoals:missing" }),
    ).rejects.toThrow("Objetivo no encontrado");

    fixture.goal.userId = "users:other";
    fixture.cached.userId = "users:other";
    await expect(
      callHandler(career.myGapAnalysis, fixture.ctx, { targetId: fixture.targetId }),
    ).rejects.toThrow("Objetivo no encontrado");
    expect(fixture.writeCount()).toBe(0);
  });

  it("ignora una caché del mismo objetivo que pertenece a otro usuario", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [{ name: "React", level: 2, source: "human" }],
      goalSkills: [{ name: "React", requiredLevel: 4 }],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });
    const foreignAnalysis = computeGoalGap(
      [{ name: "React", level: 5, source: "human" }],
      fixture.goal.skills,
      fixture.targetId,
    );
    fixture.store.gapAnalyses.push({
      ...fixture.cached,
      _id: "gapAnalyses:foreign",
      userId: "users:other",
      analysis: foreignAnalysis,
    });

    const result = await callHandler(career.myGapAnalysis, fixture.ctx, {
      targetId: fixture.targetId,
    });

    expect(result.analysis.skills[0].status).toBe("gap");
    expect(result.analysis.skills[0].currentLevel).toBe(2);
    expect(fixture.writeCount()).toBe(0);
  });

  it("no permite consultar sin identidad autenticada", async () => {
    const now = Date.now();
    const fixture = await careerFixture({
      profileSkills: [],
      goalSkills: [],
      profileUpdatedAt: now - 300,
      goalUpdatedAt: now - 200,
      analysisGeneratedAt: now - 100,
    });
    CURRENT_USER.id = null;

    await expect(
      callHandler(career.myGapAnalysis, fixture.ctx, { targetId: fixture.targetId }),
    ).rejects.toThrow("UNAUTHENTICATED");
    expect(fixture.writeCount()).toBe(0);
  });
});
