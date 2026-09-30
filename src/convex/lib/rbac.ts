import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";

export type OrgRole = "org_admin" | "recruiter" | "hiring_manager";

const HIERARCHY: Record<OrgRole, number> = {
  hiring_manager: 1,
  recruiter: 2,
  org_admin: 3,
};

/**
 * Verifica membresía activa + rol mínimo dentro de la organización.
 * Server-side ONLY. Nunca confiar en rol/org enviados por el cliente.
 * Denegación = NOT_FOUND genérico (no filtramos existencia).
 */
export async function requireMembership(
  ctx: { db: any },
  organizationId: Id<"organizations">,
  minRole: OrgRole = "hiring_manager",
): Promise<{ userId: Id<"users">; member: Doc<"organizationMembers"> }> {
  const userId = await getAuthUserId(ctx as any);
  if (!userId) throw new Error("NOT_FOUND");

  const member = await ctx.db
    .query("organizationMembers")
    .withIndex("by_org_user", (q: any) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .first();

  if (!member) throw new Error("NOT_FOUND");
  if (HIERARCHY[member.role as OrgRole] < HIERARCHY[minRole]) {
    throw new Error("FORBIDDEN: no tienes permisos para esta acción.");
  }
  return { userId, member };
}

/** El actor debe ser dueño del recurso (datos personales del candidato). */
export async function requireSelf(ctx: any): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED: inicia sesión para continuar.");
  return userId;
}

/** Normaliza slug de organización (a-z0-9-). */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}
