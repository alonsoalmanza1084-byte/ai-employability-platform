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

/**
 * Revocar una invitación pendiente (org_admin). Marca `revoked` — aceptarla
 * después falla (acceptInvite solo acepta status "pending").
 */
export const revokeInvite = mutation({
  args: { organizationId: v.id("organizations"), invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const { userId } = await requireMembership(ctx, args.organizationId, "org_admin");
    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.organizationId !== args.organizationId) {
      throw new Error("NOT_FOUND");
    }
    if (inv.status !== "pending") throw new Error("NOT_FOUND");
    await ctx.db.patch(args.invitationId, { status: "revoked" });
    await audit(ctx, {
      actorUserId: userId,
      organizationId: args.organizationId,
      action: "org.invite.revoke",
      targetType: "invitation",
      targetId: args.invitationId,
    });
    return { ok: true };
  },
});

/**
 * Remover un miembro de la organización (org_admin) — camino administrativo
 * de revocación de acceso (auditoría #3). No es una feature de producto: es
 * el control de seguridad que cierra el gap "membresías no revocables" de la
 * auditoría #2. Reglas:
 *  - targetUserId debe ser miembro ACTUAL de la org (si no → NOT_FOUND).
 *  - Un org_admin NO puede remover a otro org_admin ni a sí mismo (cierre de
 *    take-over: impedimos dejar a la org sin admins y evitamos auto-bye).
 *  - No borra datos del usuario (eso es deleteAccount); solo corta el acceso.
 */
export const removeMember = mutation({
  args: { organizationId: v.id("organizations"), targetUserId: v.id("users") },
  handler: async (ctx, args) => {
    const { userId: actorId } = await requireMembership(
      ctx,
      args.organizationId,
      "org_admin",
    );
    if (args.targetUserId === actorId) {
      throw new Error("No puedes removerte a ti mismo de la organización.");
    }
    const target = await ctx.db.get(args.targetUserId);
    if (!target) throw new Error("NOT_FOUND");
    let membership = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.targetUserId),
      )
      .first();
    if (!membership) throw new Error("NOT_FOUND");
    if (membership.role === "org_admin") {
      throw new Error(
        "No puedes remover a otro org_admin; transfiere primero la propiedad.",
      );
    }
    // Se conserva la fila ORIGINAL para la auditoría (el bucle de abajo deja
    // `membership` en null cuando termina).
    const removedRole = membership.role;
    const removedRowId = membership._id;
    // REVOCACIÓN EXHAUSTIVA: hay que borrar TODAS las filas de membresía de ese
    // par (org, usuario), no solo la primera. El índice `by_org_user` NO es
    // único en Convex, así que un restore o un import de fixtures puede haber
    // dejado filas duplicadas; con un solo delete el usuario conservaría
    // acceso con la sesión viva (bypass de revocación).
    //
    // Sin `.collect()` a propósito: cada vuelta relee UNA fila por índice
    // (lectura acotada, igual que el resto del código — guard estático
    // `api_surface.test.ts`). `REVOKE_MAX_ROWS` es un techo de seguridad: si
    // llegara a alcanzarse, la mutación FALLA (fail-closed) en lugar de
    // anunciar una revocación que quedó incompleta.
    const REVOKE_MAX_ROWS = 50;
    let removedRows = 0;
    while (membership) {
      if (removedRows >= REVOKE_MAX_ROWS) {
        throw new Error("REVOCACION_INCOMPLETA");
      }
      await ctx.db.delete(membership._id);
      removedRows++;
      membership = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", args.organizationId).eq("userId", args.targetUserId),
        )
        .first();
    }
    await audit(ctx, {
      actorUserId: actorId,
      organizationId: args.organizationId,
      action: "org.member.remove",
      targetType: "organizationMember",
      targetId: removedRowId,
      metadata: { removedRole },
    });
    return { ok: true, removedRows };
  },
});

/**
 * Trail de auditoría de la org: SOLO org_admin (server-side, lectura).
 * El auditLog es inmutable desde el cliente (no hay mutaciones públicas); el
 * acceso de lectura queda restringido al rol máximo del tenant. Devuelve solo
 * campos no sensibles (nunca contenido de CVs ni emails completos — regla de
 * DATABASE.md; metadata ya se escribe acotada). Lectura acotada por página.
 */
export const auditTrail = query({
  args: {
    organizationId: v.id("organizations"),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.organizationId, "org_admin");
    const PAGE = 100;
    const page = Math.max(0, Math.floor(args.page ?? 0));
    const desc = await ctx.db
      .query("auditLog")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      // Orden DESC desde la lectura: el índice `by_org` se recorre ASC, así que
      // take() traía las filas MÁS ANTIGUAS del tenant y la "página 0" no
      // contenía los eventos recientes (bug encontrado por test, auditoría #3).
      // Con order("desc") la lectura llega del más nuevo al más viejo y el corte
      // por página no se solapa ni pierde eventos.
      .order("desc")
      .take((page + 1) * PAGE);
    return desc.slice(page * PAGE, page * PAGE + PAGE).map((e) => ({
      _id: e._id,
      _creationTime: e._creationTime,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      actorUserId: e.actorUserId,
      metadata: e.metadata,
    }));
  },
});
