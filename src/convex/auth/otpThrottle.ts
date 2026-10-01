/**
 * Límite de ENVÍO de códigos OTP por email (protección pre-auth, auditoría #2).
 *
 * Convex Auth ya limita la VERIFICACIÓN de códigos (authRateLimits: 10
 * intentos fallidos/hora), pero el ENVÍO del código no tiene límite por
 * defecto: sin esto, un atacante puede pedir códigos en bucle para un email
 * (email bombing desde nuestro remitente + coste de infraestructura).
 *
 * Bucket por email con ventana de 1h; las filas fuera de ventana se purgan
 * en el mismo chequeo para que la tabla no crezca sin cota. Lanza error ANTES
 * de gastar el envío real del email.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de servidor con ctx loose (convención de lib/*) */
import { LIMITS } from "../lib/limits";

const OTP_WINDOW_MS = 60 * 60 * 1000; // 1 hora

export async function verifyOtpSendLimit(
  ctx: { db: any },
  rawEmail: string,
): Promise<void> {
  const email = String(rawEmail).trim().toLowerCase();
  const now = Date.now();
  const maxSends = LIMITS.otpSendsPerEmailPerHour;

  // take acotado: ya se purga en cada envío, así que debería haber ≤ maxSends
  // filas; el techo cubre rachas bajo el límite de escritura.
  const prior = await ctx.db
    .query("otpSendLog")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .take(LIMITS.otpSendsPerEmailPerHour + 10);

  const recent = prior.filter((r: any) => now - r.sentAt < OTP_WINDOW_MS);
  if (recent.length >= maxSends) {
    // (recent.length ≤ take() siempre; el límite es significativamente menor
    // que el techo de lectura, así que la decisión nunca se degrada.)
    throw new Error(
      "Demasiados códigos solicitados para este email. Reintenta en una hora.",
    );
  }
  for (const r of prior) {
    if (now - r.sentAt >= OTP_WINDOW_MS) await ctx.db.delete(r._id);
  }
  await ctx.db.insert("otpSendLog", { email, sentAt: now });
}
