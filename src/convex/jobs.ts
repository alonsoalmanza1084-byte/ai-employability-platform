import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMembership } from "./lib/rbac";
import { audit, countUsage, recordUsage } from "./lib/audit";
import { DAY_MS, LIMITS } from "./lib/limits";

/** Lecturas acotadas (auditoría #2): sin .collect() sin límite. */
const JOBS_PAGE = 200;
const REQUIREMENTS_PAGE = 50;

const requirementValidator = v.object({
  type: v.union(
    v.literal("skill"),
    v.literal("experience_years"),
    v.literal("education"),
    v.literal("certification"),
  ),
  label: v.string(),
  minLevel: v.optional(v.number()),
  minYears: v.optional(v.number()),
  weight: v.number(),
  isMustHave: v.boolean(),
});

/** Vacantes de una organización (solo miembros). */
export const listByOrg = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.organizationId, "hiring_manager");
    return await ctx.db
      .query("jobs")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .take(JOBS_PAGE);
  },
});

/** Detalle de vacante + requisitos (solo miembros de ESA org). */
export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("NOT_FOUND");
    await requireMembership(ctx, job.organizationId, "hiring_manager");
    const requirements = await ctx.db
      .query("jobRequirements")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .take(REQUIREMENTS_PAGE);
    return { job, requirements };
  },
});

/** Crear vacante con requisitos (recruiter/org_admin). 🔍 */
export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    description: v.string(),
    location: v.optional(v.string()),
    seniority: v.optional(v.string()),
    requirements: v.array(requirementValidator),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMembership(ctx, args.organizationId, "recruiter");

    if (args.title.trim().length < 3 || args.title.length > 120) {
      throw new Error("El título debe tener entre 3 y 120 caracteres.");
    }
    if (args.description.trim().length < 10 || args.description.length > 6000) {
      throw new Error("La descripción debe tener entre 10 y 6000 caracteres.");
    }
    if (args.requirements.length < 1 || args.requirements.length > 20) {
      throw new Error("Define entre 1 y 20 requisitos.");
    }
    for (const r of args.requirements) {
      if (!r.label.trim() || r.label.length > 80) {
        throw new Error("Cada requisito necesita un nombre de 1–80 caracteres.");
      }
      if (r.weight < 0.1 || r.weight > 1) {
        throw new Error("El peso de cada requisito debe estar entre 0.1 y 1.");
      }
      if (r.type === "skill" && (r.minLevel === undefined || r.minLevel < 1 || r.minLevel > 5)) {
        throw new Error("Los requisitos de skill necesitan minLevel entre 1 y 5.");
      }
      if (r.type === "experience_years" && (r.minYears === undefined || r.minYears < 0 || r.minYears > 50)) {
        throw new Error("Los requisitos de experiencia necesitan minYears entre 0 y 50.");
      }
    }

    const used = await countUsage(ctx, {
      userId,
      organizationId: args.organizationId,
      kind: "job.create",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.jobCreatePerDay) {
      throw new Error("Límite de vacantes por día alcanzado.");
    }

    const jobId = await ctx.db.insert("jobs", {
      organizationId: args.organizationId,
      createdByUserId: userId,
      title: args.title.trim(),
      description: args.description.trim(),
      location: args.location?.trim() || undefined,
      seniority: args.seniority?.trim() || undefined,
      status: "open",
    });

    for (const req of args.requirements) {
      await ctx.db.insert("jobRequirements", {
        jobId,
        type: req.type,
        label: req.label.trim(),
        minLevel: req.type === "skill" ? req.minLevel : undefined,
        minYears: req.type === "experience_years" ? req.minYears : undefined,
        weight: req.weight,
        isMustHave: req.isMustHave,
      });
    }

    await audit(ctx, {
      actorUserId: userId,
      organizationId: args.organizationId,
      action: "job.create",
      targetType: "job",
      targetId: jobId,
      metadata: { requirements: args.requirements.length },
    });
    await recordUsage(ctx, {
      userId,
      organizationId: args.organizationId,
      kind: "job.create",
      dedupeKey: `job.create:${jobId}`,
    });

    return { jobId };
  },
});

/** Cerrar vacante (org_admin). 🔍 */
export const close = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("NOT_FOUND");
    const { userId } = await requireMembership(ctx, job.organizationId, "org_admin");
    await ctx.db.patch(args.jobId, { status: "closed" });
    await audit(ctx, {
      actorUserId: userId,
      organizationId: job.organizationId,
      action: "job.close",
      targetType: "job",
      targetId: args.jobId,
    });
    return { ok: true };
  },
});
