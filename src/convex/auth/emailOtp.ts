/* eslint-disable @typescript-eslint/no-explicit-any -- Convex Auth pasa ctx sin tiparlo (ver signIn.js de la librería) */
import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { verifyOtpSendLimit } from "./otpThrottle";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: any,
  ) {
    if (ctx?.db) {
      // Protección pre-auth: el límite corre ANTES de gastar el envío real.
      await verifyOtpSendLimit(ctx, email);
    }
    const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.VLY_EMAIL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Falta AUTH_RESEND_KEY o VLY_EMAIL_API_KEY: no se puede enviar el código de verificación.",
      );
    }
    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": apiKey,
          },
        },
      );
    } catch {
      // Nunca se propaga el error crudo del proveedor (puede contener cabeceras
      // de autenticación). El detalle técnico no se filtra al cliente.
      throw new Error("No se pudo enviar el código de verificación. Intenta de nuevo.");
    }
  },
});
