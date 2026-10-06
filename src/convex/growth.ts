import { v } from "convex/values";
import {
  query,
  mutation,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSelf, requireMembership } from "./lib/rbac";
import { audit } from "./lib/audit";
import { LIMITS } from "./lib/limits";
import { computeDiagnosis } from "./lib/diagnosis";
import { computeMatch, MATCHING_ENGINE_VERSION } from "./lib/matching";


// ─── Local limits for growth features ──────────────────────────────────────

export const GROWTH_LIMITS = Object.freeze({
  maxCareerGoalsPerUser: 10,
  maxCareerGoalSkills: 12,
  jobsPerOrgQueryLimit: 50,
  maxApplicationsPerJob: LIMITS.maxRequirementsPerJob * 5,
});

// ─── Deterministic gap engine for career profile ──────────────────────────

export const GAP_ENGINE_VERSION = "gap-deterministic-v7";

export function computeGapAnalysis(
  profile: {
    skills: { name: string; level: number; source: "ai" | "human"; evidence?: string; confidence?: number }[];
    experience: { company: string; title: string; start: string; end?: string; current?: boolean; description: string; achievements: string[]; source: "ai" | "human"; evidence?: string; confidence?: number }[];
    education: { institution: string; degree: string; field?: string; source: "ai" | "human" }[];
    certifications: { name: string; source: "ai" | "human" }[];
  },
  targets: { id: Id<"careerGoals">; skills: { name: string; requiredLevel: number; category?: string }[] },
): {
  analysis: {
    targetId: Id<"careerGoals">;
    engineVersion: string;
    generatedAt: number;
    overallCoverage: number;
    skills: {
      skill: string;
      requiredLevel: number;
      currentLevel?: number;
      status: "meets_requirement" | "gap" | "missing_evidence" | "insufficient_evidence";
      evidenceRefs: string[];
      explanation: string;
    }[];
  };
  diagnosis: { hasSufficientData: boolean };
} {
  const now = Date.now();
  const items: Array<{
    skill: string;
    requiredLevel: number;
    currentLevel?: number;
    status: "meets_requirement" | "gap" | "missing_evidence" | "insufficient_evidence";
    evidenceRefs: string[];
    explanation: string;
  }> = [];

  for (const t of targets.skills) {
    const matches = profile.skills.filter(
      (s) => s.name.toLowerCase().includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(s.name.toLowerCase()),
    );
    if (matches.length === 0) {
      items.push({
        skill: t.name,
        requiredLevel: t.requiredLevel,
        status: "missing_evidence",
        evidenceRefs: [],
        explanation: `No hay evidencia registrada para esta habilidad en tu perfil.`,
      });
      continue;
    }
    const best = matches.reduce((a, b) => (a.level >= b.level ? a : b));
    const confidence = best.confidence ?? 1;
    if (confidence < 0.6) {
      items.push({
        skill: t.name,
        requiredLevel: t.requiredLevel,
        currentLevel: best.level,
        status: "insufficient_evidence",
        evidenceRefs: [],
        explanation: `Tenemos evidencia de esta skill pero es débil/confiable: revísala y corrígela.`,
      });
      continue;
    }
    if (best.level >= t.requiredLevel) {
      items.push({
        skill: t.name,
        requiredLevel: t.requiredLevel,
        currentLevel: best.level,
        status: "meets_requirement",
        evidenceRefs: [],
        explanation: `Nivel suficiente registrado (${best.level}/${t.requiredLevel}).`,
      });
    } else {
      items.push({
        skill: t.name,
        requiredLevel: t.requiredLevel,
        currentLevel: best.level,
        status: "gap",
        evidenceRefs: [],
        explanation: `Supera el nivel requerido: tienes ${best.level}, necesitas ${t.requiredLevel}.`,
      });
    }
  }

  const met = items.filter((i) => i.status === "meets_requirement").length;
  const total = items.length;
  const overallCoverage = total > 0 ? Math.round((met / total) * 100) : 0;

  const rawDiagnosis = computeDiagnosis({
    fullName: undefined,
    headline: undefined,
    location: undefined,
    summary: undefined,
    yearsExperience: undefined,
    skills: profile.skills,
    experience: profile.experience,
    education: profile.education,
    certifications: profile.certifications,
  });

  return {
    analysis: {
      targetId: targets.id,
      engineVersion: GAP_ENGINE_VERSION,
      generatedAt: now,
      overallCoverage,
      skills: items,
    },
    diagnosis: { hasSufficientData: rawDiagnosis.hasSufficientData },
  };
}

// ─── Public queries: career profile + gap analysis (self) ─────────────────

export const myCareerGoals = query({
  args: {},
  handler: async (ctx: any) => {
    const userId = await requireSelf(ctx);
    const goals = await ctx.db
      .query("careerGoals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(GROWTH_LIMITS.maxCareerGoalsPerUser);
    return goals.map((g) => ({
      _id: g._id,
      kind: g.kind,
      value: g.value,
      source: g.source,
      createdAt: g._creationTime,
    }));
  },
});

export const myProfileSummary = query({
  args: {},
  handler: async (ctx: any) => {
    const userId = await requireSelf(ctx);
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) return null;
    return {
      _id: profile._id,
      fullName: profile.fullName,
      headline: profile.headline,
      location: profile.location,
      summary: profile.summary,
      yearsExperience: profile.yearsExperience,
      skills: profile.skills.map((s) => ({ name: s.name, level: s.level, source: s.source })),
      experienceCount: profile.experience.length,
      educationCount: profile.education.length,
      certificationsCount: profile.certifications.length,
    };
  },
});

export const myGapAnalysis = query({
  args: { targetId: v.id("careerGoals") },
  handler: async (ctx: any, args) => {
    const userId = await requireSelf(ctx);
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Profile not found");

    const goal = await ctx.db.get(args.targetId);
    if (!goal || goal.userId !== userId) throw new Error("Goal not found");

    const cached = await ctx.db
      .query("gapAnalyses")
      .withIndex("by_target_user", (q) => q.eq("targetId", args.targetId).eq("userId", userId))
      .first();

    const result = computeGapAnalysis(
      {
        skills: profile.skills,
        experience: profile.experience,
        education: profile.education,
        certifications: profile.certifications,
      },
      { id: args.targetId, skills: goal.skills },
    );

    if (cached) {
      await ctx.db.patch(cached._id, { analysis: result.analysis, updatedAt: Date.now() });
      return { _id: cached._id, analysis: result.analysis, computedAt: cached._creationTime };
    }

    const inserted = await ctx.db.insert("gapAnalyses", {
      userId,
      targetId: args.targetId,
      analysis: result.analysis,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "gap_analysis.generate",
      targetType: "gapAnalysis",
      targetId: inserted,
      metadata: { targetId: args.targetId, engineVersion: GAP_ENGINE_VERSION },
    });
    return { _id: inserted, analysis: result.analysis, computedAt: inserted._creationTime };
  },
});

export const careerRecommendations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx: any, args) => {
    const userId = await requireSelf(ctx);
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) return [];

    const goals = await ctx.db
      .query("careerGoals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(GROWTH_LIMITS.maxCareerGoalsPerUser);

    const recommendations: Array<{
      type: "explore_role" | "close_gap" | "strengthen";
      title: string;
      detail: string;
      evidenceCount: number;
    }> = [];

    for (const g of goals) {
      const analysis = await ctx.db
        .query("gapAnalyses")
        .withIndex("by_target_user", (q) => q.eq("targetId", g._id).eq("userId", userId))
        .first();
      if (!analysis) continue;

      const skills = analysis.analysis.skills;
      const gaps = skills.filter((s) => s.status === "gap" || s.status === "missing_evidence" || s.status === "insufficient_evidence");
      const evidenceCount = skills.filter((s) => s.status === "meets_requirement").length;

      if (gaps.length === 0) {
        recommendations.push({
          type: "explore_role",
          title: `Rol objetivo alcanzable: ${g.value}`,
          detail: "Cubres todos los requisitos registrados para este objetivo.",
          evidenceCount,
        });
      } else {
        recommendations.push({
          type: "close_gap",
          title: `Cierra brechas para ${g.value}`,
          detail: `${gaps.length} habilidad(es) clave sin cubrir.`,
          evidenceCount,
        });
      }

      if (gaps.some((s) => s.status === "gap")) {
        recommendations.push({
          type: "strengthen",
          title: "Refuerza habilidades críticas",
          detail: "Algunas skills ya tienes pero a nivel insuficiente.",
          evidenceCount,
        });
      }
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: "explore_role",
        title: "Define tu objetivo profesional",
        detail: "Sin metas registradas no podemos recomendar hacia dónde dirigirte.",
        evidenceCount: 0,
      });
    }

    return recommendations.slice(0, args.limit ?? 5);
  },
});

// ─── Mutations: career goals (user-provided) ──────────────────────────────

export const setCareerGoal = mutation({
  args: {
    kind: v.union(v.literal("target_role"), v.literal("aspiration"), v.literal("goal")),
    value: v.string(),
    skills: v.optional(
      v.array(
        v.object({
          name: v.string(),
          requiredLevel: v.number(),
          category: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    if (!args.value.trim()) throw new Error("El objetivo no puede estar vacío.");
    if (args.skills && args.skills.length > GROWTH_LIMITS.maxCareerGoalSkills) {
      throw new Error(`Máximo ${GROWTH_LIMITS.maxCareerGoalSkills} skills por objetivo.`);
    }

    const existing = await ctx.db
      .query("careerGoals")
      .withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", args.kind))
      .first();

    if (existing) {
      const updated = await ctx.db.patch(existing._id, {
        value: args.value.trim(),
        skills: args.skills ?? existing.skills,
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        actorUserId: userId,
        action: "career_goal.update",
        targetType: "careerGoal",
        targetId: existing._id,
        metadata: { kind: args.kind },
      });
      return { _id: updated, action: "updated" };
    }

    const created = await ctx.db.insert("careerGoals", {
      userId,
      kind: args.kind,
      value: args.value.trim(),
      skills: args.skills ?? [],
      source: "user-provided",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "career_goal.create",
      targetType: "careerGoal",
      targetId: created,
      metadata: { kind: args.kind },
    });
    return { _id: created, action: "created" };
  },
});

export const removeCareerGoal = mutation({
  args: { goalId: v.id("careerGoals") },
  handler: async (ctx: any, args) => {
    const userId = await requireSelf(ctx);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("Objetivo no encontrado");
    if (goal.userId !== userId) throw new Error("No autorizado");

    await ctx.db.delete(args.goalId);

    const analyses = await ctx.db
      .query("gapAnalyses")
      .withIndex("by_target_user", (q) => q.eq("targetId", args.goalId))
      .take(100);
    for (const a of analyses) {
      await ctx.db.delete(a._id);
    }

    await audit(ctx, {
      actorUserId: userId,
      action: "career_goal.delete",
      targetType: "careerGoal",
      targetId: args.goalId,
      metadata: {},
    });
    return { ok: true };
  },
});

// ─── Internal talent matching (company): reutiliza computeMatch ───────────

export const internalMatchesForJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx: any, args) => {
    await requireMembership(ctx, args.jobId, "hiring_manager");
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");

    const requirements = await ctx.db
      .query("jobRequirements")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(LIMITS.maxRequirementsPerJob);
    const requirementsInput = requirements.map((r) => ({
      id: r._id,
      type: r.type,
      label: r.label,
      minLevel: r.minLevel,
      minYears: r.minYears,
      weight: r.weight,
      isMustHave: r.isMustHave,
    }));

    const applications = await ctx.db
      .query("applications")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(GROWTH_LIMITS.maxApplicationsPerJob);

    const out: Array<{
      applicationId: Id<"applications">;
      fullName: string;
      match: {
        overall: number;
        skills: number;
        experience: number;
        education: number;
        requirements: Array<{
          requirementId: Id<"jobRequirements">;
          label: string;
          met: boolean;
          score: number;
          evidence: string;
          gap?: string;
        }>;
        engineVersion: string;
      };
    }> = [];

    for (const app of applications) {
      if (app.extractStatus !== "ready" || !app.structured) continue;
      const match = computeMatch(app.structured as any, requirementsInput);
      out.push({
        applicationId: app._id,
        fullName: app.fullName,
        match: {
          overall: match.overall,
          skills: match.skills,
          experience: match.experience,
          education: match.education,
          requirements: match.requirements,
          engineVersion: match.engineVersion,
        },
      });
    }

    out.sort((a, b) => b.match.overall - a.match.overall);
    return out;
  },
});

// ─── Dashboard: company gaps summary ──────────────────────────────────────

export const companyGapsSummary = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx: any, args) => {
    await requireMembership(ctx, args.organizationId, "hiring_manager");

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .take(GROWTH_LIMITS.jobsPerOrgQueryLimit);

    const summary: Array<{
      jobId: Id<"jobs">;
      title: string;
      open: boolean;
      totalApplications: number;
      avgMatch: number | null;
      hardToFill: boolean;
    }> = [];

    for (const j of jobs) {
      const matchIter = await ctx.db
        .query("candidateJobMatches")
        .withIndex("by_job", (q) => q.eq("jobId", j._id))
        .take(1);
      const match = matchIter[0] as any;
      if (!match) {
        summary.push({ jobId: j._id, title: j.title, open: j.status === "open", totalApplications: 0, avgMatch: null, hardToFill: false });
        continue;
      }
      const applications = await ctx.db
        .query("applications")
        .withIndex("by_job_status", (q) => q.eq("jobId", j._id).eq("status", "pending"))
        .take(100);
      summary.push({
        jobId: j._id,
        title: j.title,
        open: j.status === "open",
        totalApplications: applications.length,
        avgMatch: applications.length > 0 ? match.overall : null,
        hardToFill: applications.length === 0,
      });
    }

    return summary;
  },
});

// ─── Action: regenerate gap analysis for a goal ───────────────────────────

export const regenerateGapAnalysis = mutation({
  args: { targetId: v.id("careerGoals") },
  handler: async (ctx: any, args) => {
    const userId = await requireSelf(ctx);
    const goal = await ctx.db.get(args.targetId);
    if (!goal || goal.userId !== userId) {
      throw new Error("Objetivo no encontrado o no autorizado.");
    }

    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Perfil no encontrado.");

    const result = computeGapAnalysis(
      {
        skills: profile.skills,
        experience: profile.experience,
        education: profile.education,
        certifications: profile.certifications,
      },
      { id: args.targetId, skills: goal.skills },
    );

    const existing = await ctx.db
      .query("gapAnalyses")
      .withIndex("by_target_user", (q: any) => q.eq("targetId", args.targetId).eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        analysis: result.analysis,
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        actorUserId: userId,
        action: "gap_analysis.regenerate",
        targetType: "gapAnalysis",
        targetId: existing._id,
        metadata: { targetId: args.targetId },
      });
      return { ok: true, _id: existing._id, regenerated: true };
    }

    const inserted = await ctx.db.insert("gapAnalyses", {
      userId,
      targetId: args.targetId,
      analysis: result.analysis,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "gap_analysis.generate",
      targetType: "gapAnalysis",
      targetId: inserted,
      metadata: { targetId: args.targetId },
    });
    return { ok: true, _id: inserted, regenerated: false };
  },
});
