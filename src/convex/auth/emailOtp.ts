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
    // CLAVE DE API DEL SERVICIO DE CORREO — server-side, NUNCA en el repositorio.
    //
    // HALLAZGO DE SEGURIDAD (auditoría #5): la clave `fb_email_…` estaba
    // escrita como literal en este archivo, es decir, versionada en el
    // repositorio y visible para cualquiera con acceso al árbol de fuentes
    // (y para todo el historial de git). Se elimina de aquí y pasa a leerse de
    // la variable de entorno `VLY_EMAIL_API_KEY`.
    //
    // ACCIÓN REQUERIDA (bloqueante): añadir `VLY_EMAIL_API_KEY` en la pestaña de
    // Keys/API del proyecto y ROTAR la clave expuesta en el proveedor. Sin la
    // variable, el envío de OTP falla cerrado con un mensaje claro en vez de
    // usar (o filtrar) una credencial compromise.
    const emailApiKey = process.env.VLY_EMAIL_API_KEY;
    if (!emailApiKey) {
      throw new Error(
        "Falta VLY_EMAIL_API_KEY: no se puede enviar el código de verificación.",
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
            "x-api-key": emailApiKey,
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
