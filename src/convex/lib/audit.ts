/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de servidor con ctx loose */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Devuelve el usuario autenticado o lanza (nunca silenciar auth). */
export async function requireUser(ctx: any): Promise<Doc<"users"> & { _id: Id<"users"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED: inicia sesión para continuar.");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("UNAUTHENTICATED: sesión inválida.");
  return user;
}

/** Escribe en auditLog. Metadata mínima: nunca contenido de documentos ni emails completos. */
export async function audit(
  ctx: { db: any },
  entry: {
    actorUserId?: Id<"users"> | null;
    organizationId?: Id<"organizations"> | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, string | number | boolean>;
  },
) {
  await ctx.db.insert("auditLog", {
    actorUserId: entry.actorUserId ?? undefined,
    organizationId: entry.organizationId ?? undefined,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata as any,
  });
}

/** securityEvents: denegaciones, límites, uploads rechazados. */
export async function securityEvent(
  ctx: { db: any },
  event: { kind: string; userId?: Id<"users"> | null; detail: string },
) {
  await ctx.db.insert("securityEvents", {
    kind: event.kind,
    userId: event.userId ?? undefined,
    detail: event.detail,
  });
}

/**
 * usageEvents con idempotencia (dedupeKey único).
 * Si la clave ya existe, no vuelve a insertar (evita doble conteo/cobro futuro).
 */
export async function recordUsage(
  ctx: { db: any },
  event: {
    userId?: Id<"users"> | null;
    organizationId?: Id<"organizations"> | null;
    kind: string;
    quantity?: number;
    dedupeKey?: string;
  },
): Promise<boolean> {
  if (event.dedupeKey) {
    const existing = await ctx.db
      .query("usageEvents")
      .withIndex("by_dedupe", (q: any) => q.eq("dedupeKey", event.dedupeKey))
      .first();
    if (existing) return false;
  }
  await ctx.db.insert("usageEvents", {
    userId: event.userId ?? undefined,
    organizationId: event.organizationId ?? undefined,
    kind: event.kind,
    quantity: event.quantity ?? 1,
    dedupeKey: event.dedupeKey,
  });
  return true;
}

/** Cuenta eventos de uso en una ventana (rate limiting server-side). */
export async function countUsage(
  ctx: { db: any },
  opts: {
    userId?: Id<"users"> | null;
    organizationId?: Id<"organizations"> | null;
    kind: string;
    sinceMs: number;
  },
): Promise<number> {
  const since = Date.now() - opts.sinceMs;
  if (opts.organizationId) {
    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_organizationId_and_kind", (q: any) =>
        q.eq("organizationId", opts.organizationId).eq("kind", opts.kind),
      )
      .collect();
    return rows.filter((r: any) => r._creationTime >= since).length;
  }
  if (opts.userId) {
    const rows = await ctx.db
      .query("usageEvents")
      .withIndex("by_userId_and_kind", (q: any) =>
        q.eq("userId", opts.userId).eq("kind", opts.kind),
      )
      .collect();
    return rows.filter((r: any) => r._creationTime >= since).length;
  }
  return 0;
}

/** Token aleatorio criptográficamente seguro (compatible con runtime Convex). */
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex de un token (guardamos solo el hash). */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
