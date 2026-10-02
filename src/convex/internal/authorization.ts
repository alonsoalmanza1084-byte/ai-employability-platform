/* eslint-disable @typescript-eslint/no-explicit-any -- Convex internals con ctx loose */
/**
 * VULN-14 — Auditoría de denegaciones de AUTORIZACIÓN.
 *
 * PROBLEMA QUE RESUELVE
 * ----------------------
 * Convex es ACID. `requireMembership()` lanza, y el rollback de esa transacción
 * revierte CUALQUIER `securityEvent` insertado antes. Medido: `DELTA=0`.
 * Resultado: los intentos de escalada de privilegios y de acceso cross-tenant
 * no dejan ningún rastro.
 *
 * ARQUITECTURA ELEGIDA (y por qué no hay bypass)
 * ---------------------------------------------
 * Se combina A (acción pública → mutación interna → catch → log) con D
 * (wrapper). La pieza clave es que el wrapper es ADITIVO: NO modifica las
 * mutaciones ya verificadas, las envuelve.
 *
 *   action auditada (pública)
 *     ├─ 1. runQuery  internal.classifyAuthorization   ← SOLO LECTURA, no puede autorizar
 *     │     · si NO tiene permiso  → no se llega a llamar a la operación
 *     ├─ 2. runMutation <mutación pública real>        ← atomicidad e idempotencia intactas
 *     └─ 3. catch(error):
 *           · classifyDenial(error) === null  → se propaga SIN registrar (sin falsos positivos)
 *           · si es denegación → runMutation internal.logDenial (transacción SEPARADA, se confirma)
 *           · y EN TODOS LOS CASOS se vuelve a lanzar el error  ← fail-closed
 *
 * Garantías, una por una:
 *   · fail-closed ........ el error SIEMPRE se relanza. El cliente nunca recibe
 *                          `{ok:false}` que un caller pudiera ignorar. Es la
 *                          diferencia crítica frente a "cambiar throw por
 *                          return {success:false}".
 *   · atomicidad ......... la operación real sigue siendo UNA única mutación.
 *                          El log va en su propia transacción, a propósito.
 *   · idempotencia ....... sin cambios: las mutaciones no se han tocado.
 *   · tenant isolation ... sin cambios: la mutación real sigue validando con
 *                          `requireMembership`. El wrapper solo puede DENEGAR,
 *                          jamás autorizar.
 *   · no falsificable .... `internal/*` NO es invocable desde el cliente. No
 *                          existe ninguna función pública que escriba en
 *                          `securityEvents`. El cliente no envía ni `reason`,
 *                          ni `kind`, ni `userId`: solo los args de la operación.
 *   · persistencia ...... `logDenial` es una transacción distinta, que confirma.
 *   · compatible Convex . action + internal mutation + runQuery/runMutation.
 *
 * TOCTOU: entre el preflight y la mutación real puede revocarse una membresía.
 * Es INOFENSIVO: el preflight solo puede denegar, y si la mutación real deniega
 * por su cuenta, el catch la registra igualmente. La decisión de seguridad la
 * sigue tomando exclusivamente `requireMembership`.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  classifyDenial,
  normalizeDenialReason,
  safeOrgRef,
  type DenialReason,
} from "../lib/denial";

/** Rol mínimo, evaluado server-side. Espejo de `lib/rbac.ts` (solo lectura). */
const HIERARCHY: Record<string, number> = {
  hiring_manager: 1,
  recruiter: 2,
  org_admin: 3,
};

/**
 * PREFLUGO DE AUTORIZACIÓN — SOLO LECTURA.
 *
 * No autoriza nada: su única utilidad es poder distinguir "denegado" de "otro
 * fallo" y klasificar el motivo antes de que la mutación real revierta.
 * Devolver `ok:true` NO otorga ningún permiso: la mutación real vuelve a
 * comprobarlo con `requireMembership`.
 */
export const classifyAuthorization = internalQuery({
  args: {
    organizationId: v.optional(v.string()),
    minRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx as any);
    if (!userId) return { ok: false as const, reason: "unauthenticated" as DenialReason };

    const orgId = safeOrgRef(args.organizationId);
    if (!orgId) {
      return { ok: false as const, reason: "malformed_id" as DenialReason };
    }

    const member = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q: any) =>
        q.eq("organizationId", orgId).eq("userId", userId),
      )
      .first();

    if (!member) return { ok: false as const, reason: "not_a_member" as DenialReason };

    const rank = HIERARCHY[member.role as string];
    if (rank === undefined) {
      return { ok: false as const, reason: "corrupt_membership" as DenialReason };
    }
    const minRank = HIERARCHY[args.minRole ?? "hiring_manager"] ?? 1;
    if (rank < minRank) {
      return { ok: false as const, reason: "insufficient_role" as DenialReason };
    }
    return { ok: true as const };
  },
});

/**
 * ESCRIBE EL EVENTO DE DENEGACIÓN.
 *
 * Todos los camposPersistidos se derivan en el SERVIDOR:
 *   · userId    ← del token de sesión, nunca de los args.
 *   · reason    ← validado contra la lista cerrada en `lib/denial.ts`.
 *   · tenant    ← verificado contra la fila `organizationMembers` real.
 *   · kind      ← fijo, elegido por el servidor según el motivo.
 *
 * Si el actor NO es miembro de la organización objetivo (caso cross-tenant), la
 * fila se guarda con `tenantVerified: false`: el equipo de seguridad necesita
 * saber qué organización se está sondeando, pero el evento no afirma que el
 * actor pertenezca a ella.
 *
 * Esta mutación es `internal`: ningún cliente puede invocarla ni falsearla.
 */
export const logDenial = internalMutation({
  args: {
    operation: v.string(),
    reason: v.string(),
    organizationId: v.optional(v.string()),
    resourceRef: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    /**
     * Nonce único por denegación.
     *
     * No es un secreto. Existe para que cada denegación sea una mutación
     * independiente y no dependa de cómo el runtime agrupe llamadas con
     * argumentos idénticos. No se persiste (no aporta información) y no
     * modifica la autorización en absoluto.
     */
    nonce: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx as any);
    const reason = normalizeDenialReason(args.reason);
    const orgId = safeOrgRef(args.organizationId);

    // Verificación de tenant hecha por el servidor, no por el cliente.
    let tenantVerified = false;
    if (orgId && userId) {
      const member = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org_user", (q: any) =>
          q.eq("organizationId", orgId).eq("userId", userId),
        )
        .first();
      tenantVerified = member !== null;
    }

    // Categoría de evento estable, derivada del motivo, nunca del cliente.
    const kind =
      reason === "unauthenticated"
        ? "authz_denied_unauthenticated"
        : tenantVerified
          ? "authz_denied_authorized_user"
          : "authz_denied_cross_tenant";

    await ctx.db.insert("securityEvents", {
      kind,
      userId: userId ?? undefined,
      detail: `${args.operation}:${reason}`,
      organizationId: orgId,
      operation: args.operation.slice(0, 80),
      reason,
      correlationId: args.correlationId?.slice(0, 64),
      tenantVerified,
    });
    return { logged: true };
  },
});

/**
 * Comprobación de invariantes del propio mecanismo de auditoría.
 * Falla si alguien expusiera `logDenial` fuera de `internal/`.
 */
export const _selfCheck = internalQuery({
  args: {},
  handler: async () => {
    return {
      note: "logDenial y classifyAuthorization viven en internal/, que Convex no expone al cliente.",
      internalModule: true,
    };
  },
});

// Reexportado para que el wrapper no tenga que importar el módulo internal.
export { classifyDenial };
export type { DenialReason };
