/**
 * Eliminación de cuenta y retención de datos (auditoría #2, PRIVACY.md).
 *
 * Alcance de seguridad/privacidad (no es una feature de producto): el usuario
 * autenticado borra SU cuenta y sus datos personales. Comportamiento:
 *
 *  1. Hard delete de candidateProfiles, resumes y resumeVersions propios,
 *     incluyendo el BINARIO en storage privado (PII).
 *  2. Baja de sus organizationMembers (revoca acceso residual si sobreviviera
 *     cualquier token; requireMembership → NOT_FOUND sin membresía).
 *  3. Cierre forzoso de sesiones y borrado de authAccounts del usuario:
 *     sin esto, un OTP al email original podría "resucitar" la cuenta
 *     borrada (el provider casaría authAccounts.providerAccountId).
 *     authAccounts además guarda el email en claro → se elimina (PII).
 *  4. Identidad en `users`: email sobrescrito con marcador no enrutable
 *     (rompe el índice email y las invitaciones futuras) y name anónimo.
 *  5. Lo que NO se borra: auditLog (inmutable por diseño, sin PII de
 *     contenido), aplicaciones recruiter_upload (pertenecen a la org, no hay
 *     enlace usuario↔application en el modelo V1) y recruiterNotes ajenas
 *     (el autor se muestra ya anonimizado vía users.name tras el paso 4).
 *
 * Fuera de alcance V1 (documentado en SECURITY_AUDIT.md): retención
 * programada de securityEvents/usageEvents (telemetría sin PII).
 */

/** Marcador de anonimización (sin PII, estable para tests). */
export const ANON_PLACEHOLDER = "[cuenta-eliminada]";

import { mutation } from "./_generated/server";
import { requireSelf } from "./lib/rbac";
import { audit } from "./lib/audit";
import { LIMITS } from "./lib/limits";

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);

    // 1) Perfil propio (hard delete; el diagnóstico vive dentro del perfil).
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (profile) await ctx.db.delete(profile._id);

    // 2) CVs propios: binario + versiones + resume (límites estructurales).
    const resumes = await ctx.db
      .query("resumes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(LIMITS.maxCvVersionsPerResume);
    for (const r of resumes) {
      const versions = await ctx.db
        .query("resumeVersions")
        .withIndex("by_resume", (q) => q.eq("resumeId", r._id))
        .take(LIMITS.maxCvVersionsPerResume);
      for (const ver of versions) {
        try {
          await ctx.storage.delete(ver.storageId);
        } catch {
          // Binario ya inexistente: continuamos con el resto del borrado.
        }
        await ctx.db.delete(ver._id);
      }
      await ctx.db.delete(r._id);
    }

    // 3) Membresías: revocación de acceso (no son datos personales del
    //    usuario sino vínculos; sin ellas requireMembership niega todo).
    const memberships = await ctx.db
      .query("organizationMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    for (const m of memberships) await ctx.db.delete(m._id);

    // 4) Sesiones activas + cuentas de autenticación (anti-resurrección OTP
    //    y borrado del email en claro que guarda authAccounts).
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .take(100);
    for (const s of sessions) await ctx.db.delete(s._id);
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .take(50);
    for (const a of accounts) await ctx.db.delete(a._id);

    // 5) Identidad: marcador (el id completo garantiza unicidad del índice).
    await ctx.db.patch(userId, {
      email: `${userId}@deleted.invalid`,
      name: ANON_PLACEHOLDER,
    });

    await audit(ctx, {
      action: "account.delete",
      targetType: "user",
      targetId: userId,
    });

    return { ok: true };
  },
});
