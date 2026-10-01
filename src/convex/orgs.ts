import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { requireMembership, slugify } from "./lib/rbac";
import {
  audit,
  countUsage,
  hashToken,
  randomToken,
  recordUsage,
} from "./lib/audit";
import { DAY_MS, LIMITS } from "./lib/limits";

/** Techo estructural de la org: miembros e invitaciones listadas (audit #2). */
const ORG_MEMBERS_PAGE = 500;
const ORG_INVITES_PAGE = 200;

/** Organizaciones del usuario autenticado. */
export const myOrgs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(ORG_MEMBERS_PAGE);
    const orgs = [];
    for (const m of memberships) {
      const org = await ctx.db.get(m.organizationId);
      if (org) orgs.push({ ...org, myRole: m.role });
    }
    return orgs;
  },
});

/** Crear organización: el creador queda como org_admin. 🔍 */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED: inicia sesión para continuar.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new Error("El nombre debe tener entre 2 y 80 caracteres.");
    }

    const used = await countUsage(ctx, {
      userId,
      kind: "org.create",
      sinceMs: DAY_MS,
    });
    if (used >= 5) throw new Error("Límite de organizaciones por día alcanzado.");

    const base = slugify(args.name);
    let slug = base;
    for (let i = 0; i < 20; i++) {
      const clash = await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!clash) break;
      slug = `${base}-${Math.floor(Math.random() * 10000)}`;
    }

    const orgId = await ctx.db.insert("organizations", {
      name: name.slice(0, 80),
      slug,
      createdByUserId: userId,
    });
    await ctx.db.insert("organizationMembers", {
      organizationId: orgId,
      userId,
      role: "org_admin",
    });

    await audit(ctx, {
      actorUserId: userId,
      organizationId: orgId,
      action: "org.create",
      targetType: "organization",
      targetId: orgId,
    });
    await recordUsage(ctx, { userId, kind: "org.create", dedupeKey: `org.create:${orgId}` });

    return { organizationId: orgId };
  },
});

/** Miembros de una org (solo miembros). */
export const members = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.organizationId, "hiring_manager");
    return await ctx.db
      .query("organizationMembers")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .take(ORG_MEMBERS_PAGE);
  },
});

/**
 * Invitar miembro por email. V1: al aceptar con el token, si existe una cuenta
 * con ese email se une; si no, se guarda la invitación pendiente y se une al
 * registrarse con ese email (acceptInvite). Token aleatorio, guardamos solo
 * su hash. 🔍
 */
export const invite = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("org_admin"),
      v.literal("recruiter"),
      v.literal("hiring_manager"),
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMembership(ctx, args.organizationId, "org_admin");

    const used = await countUsage(ctx, {
      userId,
      organizationId: args.organizationId,
      kind: "org.invite",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.invitePerDay) {
      throw new Error("Límite de invitaciones por día alcanzado.");
    }

    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Email inválido.");
    }
    const token = randomToken(24);
    const tokenHash = await hashToken(token);

    // ¿Ya es miembro? (lectura acotada — auditoría #2; un email ya está
    // limitado a una cuenta por Convex Auth)
    const existingUsers = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(2);
    const existingUser = existingUsers[0];
    if (existingUser && !existingUser.isAnonymous) {
      const already = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", args.organizationId).eq("userId", existingUser._id),
        )
        .first();
      if (already) throw new Error("Esa persona ya es miembro de la organización.");
    }

    await ctx.db.insert("invitations", {
      organizationId: args.organizationId,
      email,
      role: args.role,
      tokenHash,
      invitedByUserId: userId,
      expiresAt: Date.now() + 14 * DAY_MS,
      status: "pending",
    });

    await audit(ctx, {
      actorUserId: userId,
      organizationId: args.organizationId,
      action: "org.invite",
      targetType: "invitation",
      metadata: { role: args.role },
    });
    await recordUsage(ctx, {
      userId,
      organizationId: args.organizationId,
      kind: "org.invite",
    });

    // En V1 el token se devuelve para compartirlo manualmente (sin email custom).
    return { token, email };
  },
});

/** Aceptar invitación con token: crea membresía si el email coincide. */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("UNAUTHENTICATED: inicia sesión para continuar.");
    const user = await ctx.db.get(userId);
    if (!user?.email || user.isAnonymous) {
      throw new Error(
        "Necesitas una cuenta con email verificado para aceptar invitaciones.",
      );
    }
    const email = user.email.toLowerCase();

    const tokenHash = await hashToken(args.token);
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (
      !invitation ||
      invitation.status !== "pending" ||
      invitation.expiresAt < Date.now() ||
      invitation.email !== email
    ) {
      throw new Error("Invitación inválida o expirada.");
    }

    const already = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", invitation.organizationId).eq("userId", userId),
      )
      .first();
    if (!already) {
      await ctx.db.insert("organizationMembers", {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        invitedByEmail: email,
      });
    }
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedByUserId: userId,
    });

    await audit(ctx, {
      actorUserId: userId,
      organizationId: invitation.organizationId,
      action: "org.join",
      targetType: "organization",
      targetId: invitation.organizationId,
    });

    return { organizationId: invitation.organizationId };
  },
});

/** Listar invitaciones pendientes de la org (admin). */
export const pendingInvites = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.organizationId, "org_admin");
    return await ctx.db
      .query("invitations")
      .withIndex("by_org_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "pending"),
      )
      .take(ORG_INVITES_PAGE);
  },
});
