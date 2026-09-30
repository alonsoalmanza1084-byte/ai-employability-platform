import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMembership } from "./lib/rbac";

/** Match completo de una application, con evidencia por requisito (miembros). */
export const getForApplication = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    await requireMembership(ctx, application.organizationId, "hiring_manager");
    const match = await ctx.db
      .query("candidateJobMatches")
      .withIndex("by_application", (q) => q.eq("applicationId", args.applicationId))
      .first();
    return match;
  },
});
