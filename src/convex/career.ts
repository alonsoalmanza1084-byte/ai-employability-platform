/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de Context de Convex */
/**
 * Career intelligence (R6) — persona value loop.
 *
 * CV → perfil → objetivo profesional → brecha determinista → matching → siguiente acción.
 *
 * Contratos inquebrantables (ADR-011/012/014):
 *  - Requiere sesión propia (requireSelf). Ninguna función acepta userId del cliente.
 *  - Coach NO escribe aquí ni en candidateProfiles (eso sigue en coach.ts: read-only + proposals).
 *  - No existe `accepted` en ninguna tabla de este módulo.
 *  - Brecha = función pura determinista (lib/gap), sin LLM.
 *  - Matching = reutiliza computeMatch (lib/matching), sin segundo algoritmo.
 *  - Privacidad: PRIVATE (self-only). Diseñado para que luego se pueda agregar visibilidad
 *    organizacional sin romper auth, pero aún no.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSelf } from "./lib/rbac";
import { audit } from "./lib/audit";
import { LIMITS } from "./lib/limits";
import { computeMatch, type MatchRequirementInput } from "./lib/matching";
import {
  computeGoalGap,
  type GapAnalysis,
  type GapItem,
  type ProfileSkill,
  type RequiredSkill,
} from "./lib/gap";
import { ROLE_TEMPLATES, ROLE_REQUIREMENTS_VERSION } from "./lib/roles";

import type { Doc } from "./_generated/dataModel";

// ─── Tipos locales (espejo del schema, para no acoplar al modelo genérico) ───

type CareerGoalDoc = Doc<"careerGoals">;
type ProfileDoc = Doc<"candidateProfiles">;

// ─── Queries: lectura propia (requireSelf) ──────────────────────────────────

export const myCareerGoals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);
    const goals = await ctx.db
      .query("careerGoals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(LIMITS.maxCareerGoalsPerUser);

    return goals.map((g) => ({
      _id: g._id,
      kind: g.kind,
      value: g.value,
      skills: g.skills,
      source: g.source,
      createdAt: g._creationTime,
      updatedAt: g.updatedAt,
    }));
  },
});

export const myGapAnalysis = query({
  args: { targetId: v.id("careerGoals") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    const goal = await ctx.db.get(args.targetId);
    if (!goal || goal.userId !== userId) {
      throw new Error("Objetivo no encontrado");
    }

    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!profile) {
      throw new Error("Perfil no encontrado");
    }

    const cached = await ctx.db
      .query("gapAnalyses")
      .withIndex("by_target_user", (q) =>
        q.eq("targetId", args.targetId).eq("userId", userId),
      )
      .first();

    // Las queries de Convex son de solo lectura (ADR-014-01).
    // El cálculo es una función pura determinista (sin LLM), sin persistir.
    // La persistencia queda exclusivamente en `regenerateGapAnalysis`.
    let analysis: GapAnalysis;
    let usedCache = false;

    if (
      cached !== null &&
      cached.userId === userId &&
      cached.targetId === args.targetId &&
      cached.analysis.generatedAt >= profile.updatedAt &&
      cached.updatedAt >= profile.updatedAt
    ) {
      analysis = cached.analysis;
      usedCache = true;
    } else {
      // Cache stale o inexistente → computable determinísticamente in-memory.
      // Si la DB tuviera cache de otro userId/targetId no alcanzable por este índice,
      // nunca la expondríamos; ignoramos ese estado.
      analysis = computeGoalGap(
        profile.skills as ProfileSkill[],
        goalSkillsAsRequired(goal),
        goal._id,
      );
    }

    return {
      _id: cached ? cached._id : null,
      analysis,
      computedAt: usedCache ? cached!._creationTime : Date.now(),
    };
  },
});

export const matchGoal = query({
  args: { targetId: v.id("careerGoals") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    const goal = await ctx.db.get(args.targetId);
    if (!goal || goal.userId !== userId) {
      throw new Error("Objetivo no encontrado");
    }

    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Perfil no encontrado");

    const match = computeMatch(profileToExtraction(profile), goalSkillsToMatchInputs(goal));
    return match;
  },
});

export const compatibleRoles = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) return [];

    const limit = Math.max(1, Math.min(
      args.limit ?? 6,
      20,
    ));

    const results = ROLE_TEMPLATES.map((role: (typeof ROLE_TEMPLATES)[0]) => {
      const match = computeMatch(
        profileToExtraction(profile),
        roleSkillsToMatchInputs(role),
      );
      return {
        roleId: role.id,
        label: role.label,
        description: role.description,
        matchVersion: ROLE_REQUIREMENTS_VERSION,
        match: {
          overall: match.overall,
          skills: match.skills,
          experience: match.experience,
          education: match.education,
          requirements: match.requirements,
          engineVersion: match.engineVersion,
        },
      };
    });

    results.sort((a: (typeof results)[0], b: (typeof results)[0]) => b.match.overall - a.match.overall);
    return results.slice(0, limit);
  },
});

// ─── Mutations: objetivo profesional propio (requireSelf) ──────────────────

export const setCareerGoal = mutation({
  args: {
    kind: v.union(
      v.literal("target_role"),
      v.literal("aspiration"),
      v.literal("goal"),
    ),
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
    source: v.optional(
      v.union(
        v.literal("user-provided"),
        v.literal("system-derived"),
        v.literal("ai-generated"),
        v.literal("proposed"),
        v.literal("verified"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    if (!args.value.trim()) {
      throw new Error("El objetivo no puede estar vacío.");
    }
    if (args.skills && args.skills.length > LIMITS.maxCareerGoalSkills) {
      throw new Error(
        `Máximo ${LIMITS.maxCareerGoalSkills} skills por objetivo.`,
      );
    }
    for (const s of args.skills ?? []) {
      if (s.requiredLevel < 1 || s.requiredLevel > 5) {
        throw new Error("El nivel requerido debe estar entre 1 y 5.");
      }
    }

    const existing = await ctx.db
      .query("careerGoals")
      .withIndex("by_user_kind", (q) =>
        q.eq("userId", userId).eq("kind", args.kind),
      )
      .first();

    const now = Date.now();

    if (existing) {
      const skills =
        args.skills !== undefined ? args.skills : existing.skills;
      const updated = await ctx.db.patch(existing._id, {
        value: args.value.trim(),
        skills,
        source: args.source ?? existing.source,
        updatedAt: now,
      });
      await audit(ctx, {
        actorUserId: userId,
        action: "career_goal.update",
        targetType: "careerGoal",
        targetId: existing._id,
        metadata: { kind: args.kind },
      });
      return { _id: updated, action: "updated" as const };
    }

    const created = await ctx.db.insert("careerGoals", {
      userId,
      kind: args.kind,
      value: args.value.trim(),
      skills: args.skills ?? [],
      source: args.source ?? ("user-provided" as const),
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, {
      actorUserId: userId,
      action: "career_goal.create",
      targetType: "careerGoal",
      targetId: created,
      metadata: { kind: args.kind },
    });
    return { _id: created, action: "created" as const };
  },
});

export const removeCareerGoal = mutation({
  args: { goalId: v.id("careerGoals") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("Objetivo no encontrado");
    if (goal.userId !== userId) throw new Error("No autorizado");

    // Borrado en cascada de los análisis de brecha de este objetivo.
    const analyses = await ctx.db
      .query("gapAnalyses")
      .withIndex("by_target_user", (q) => q.eq("targetId", args.goalId))
      .take(100);
    for (const a of analyses) {
      await ctx.db.delete(a._id);
    }

    await ctx.db.delete(args.goalId);

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

export const regenerateGapAnalysis = mutation({
  args: { targetId: v.id("careerGoals") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    const goal = await ctx.db.get(args.targetId);
    if (!goal || goal.userId !== userId) {
      throw new Error("Objetivo no encontrado o no autorizado.");
    }

    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Perfil no encontrado.");

    const analysis = computeGoalGap(
      profile.skills as ProfileSkill[],
      goal.skills as Parameters<typeof computeGoalGap>[1],
      args.targetId,
    );

    let existing = await ctx.db
      .query("gapAnalyses")
      .withIndex("by_target_user", (q) =>
        q.eq("targetId", args.targetId).eq("userId", userId),
      )
      .first();

    // Stale-remove: cualquier gapAnalysis crasheado (misma targetId pero userId distinto)
    // lo sobreescribimos con el ciclo de usuario actual; conservamos auditoría.
    if (existing && existing.userId !== userId) {
      existing = null;
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        analysis: analysis as any,
        updatedAt: now,
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
      analysis: analysis as any,
      createdAt: now,
      updatedAt: now,
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

// ─── Helpers internos ───────────────────────────────────────────────────────

/** Convierte un candidateProfile en la forma que espera computeMatch. */
function profileToExtraction(profile: ProfileDoc) {
  return {
    fullName: profile.fullName,
    headline: profile.headline,
    location: profile.location,
    summary: profile.summary,
    yearsExperience: profile.yearsExperience,
    skills: profile.skills as any,
    experience: profile.experience as any,
    education: profile.education as any,
    certifications: profile.certifications as any,
  };
}

/**
 * Convierte las skills almacenadas en un goal a RequiredSkill[]
 * (la forma que espera computeGoalGap / el motor de brechas).
 */
function goalSkillsAsRequired(goal: CareerGoalDoc): Parameters<typeof computeGoalGap>[1] {
  return goal.skills.map((s) => ({ name: s.name, requiredLevel: s.requiredLevel, category: s.category ?? undefined }));
}

/**
 * Convierte las skills almacenadas en un goal a MatchRequirementInput[]
 * para reutilizar computeMatch (todos must-have, peso 1, type skill).
 */
function goalSkillsToMatchInputs(goal: CareerGoalDoc): MatchRequirementInput[] {
  return goal.skills.map((s: { name: string; requiredLevel: number }) => ({
    id: s.name,
    type: "skill" as const,
    label: s.name,
    minLevel: s.requiredLevel,
    weight: 1,
    isMustHave: true,
  }));
}

/**
 * Convierte las skills de una RoleTemplate a MatchRequirementInput[]
 * para match del perfil contra una plantilla de puesto de referencia.
 */
function roleSkillsToMatchInputs(role: (typeof ROLE_TEMPLATES)[0]): MatchRequirementInput[] {
  return role.skills.map((s: { name: string; requiredLevel: number }) => ({
    id: s.name,
    type: "skill" as const,
    label: s.name,
    minLevel: s.requiredLevel,
    weight: 1,
    isMustHave: true,
  }));
}

