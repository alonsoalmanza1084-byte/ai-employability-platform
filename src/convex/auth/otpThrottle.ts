/**
 * Límite de ENVÍO de códigos OTP (protección pre-auth).
 *
 * Convex Auth ya limita la VERIFICACIÓN de códigos (authRateLimits: 10
 * intentos fallidos/hora), pero el ENVÍO del código no tiene límite por
 * defecto: sin esto, un atacante puede pedir códigos en bucle para un email
 * (email bombing desde nuestro remitente + coste de infraestructura).
 *
 * Límites aplicados (dos capas, auditoría #3):
 *  1. POR EMAIL: bucket de 5 envíos/hora (LIMITS.otpSendsPerEmailPerHour).
 *  2. GLOBAL: backstop de 200 envíos/hora en toda la plataforma (agregado; corta
 *     en el envío número 201 de la ventana). La API de
 *     Convex NO expone la IP del cliente en mutations/actions (solo en
 *     httpActions, y las rutas HTTP de auth pertenecen al runtime de Convex
 *     Auth), así que NO es posible aplicar límite por IP real dentro de la
 *     app: el backstop global es el único freno agregado app-side contra un
 *     atacante que rote emails arbitrarios. El límite por IP en el edge
 *     (CDN/WAF) es el boundary real y queda documentado como responsabilidad
 *     de plataforma en SECURITY_AUDIT.md §10.2.
 *
 * Las filas fuera de ventana se purgan en el mismo chequeo para que la tabla
 * no crezca sin cota. Lanza error ANTES de gastar el envío real del email.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de servidor con ctx loose (convención de lib/*) */
import { LIMITS } from "../lib/limits";

const OTP_WINDOW_MS = 60 * 60 * 1000; // 1 hora

/** Backstop global de envíos por hora (rotación de emails por atacante). */
export const OTP_GLOBAL_HOURLY_CAP = 200;

export async function verifyOtpSendLimit(
  ctx: { db: any },
  rawEmail: string,
): Promise<void> {
  const email = String(rawEmail).trim().toLowerCase();
  const now = Date.now();
  const maxSends = LIMITS.otpSendsPerEmailPerHour;

  // Capa 2: backstop global. Lectura SIN índice pero acotada: order("desc")
  // recorre por _creationTime descendente y take() trae solo los ~200 envíos
  // más recientes — exactamente la ventana relevante. (No se puede usar un
  // rango sobre "sentAt" con el índice by_email: Convex exige que los campos
  // de rango extiendan el prefijo del índice.)
  const recentGlobal = await ctx.db
    .query("otpSendLog")
    .order("desc")
    .take(OTP_GLOBAL_HOURLY_CAP + 1);
  const inWindow = recentGlobal.filter(
    (r: any) => now - r.sentAt < OTP_WINDOW_MS,
  );
  if (inWindow.length >= OTP_GLOBAL_HOURLY_CAP) {
    throw new Error("Servicio de códigos saturado. Reintenta en unos minutos.");
  }

  // Capa 1: bucket por email (take acotado; se purga en cada envío).
  const prior = await ctx.db
    .query("otpSendLog")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .take(LIMITS.otpSendsPerEmailPerHour + 10);

  const recent = prior.filter((r: any) => now - r.sentAt < OTP_WINDOW_MS);
  if (recent.length >= maxSends) {
    throw new Error(
      "Demasiados códigos solicitados para este email. Reintenta en una hora.",
    );
  }
  for (const r of prior) {
    if (now - r.sentAt >= OTP_WINDOW_MS) await ctx.db.delete(r._id);
  }
  await ctx.db.insert("otpSendLog", { email, sentAt: now });
}
