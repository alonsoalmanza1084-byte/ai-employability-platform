/* eslint-disable @typescript-eslint/no-explicit-any -- SDK tipado de forma heterogénea entre versiones */
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIUsage,
} from "./types";

const TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Quita la valla de markdown que algunos modelos añaden alrededor del JSON.
 *
 * NO relaja la validación: el texto resultante sigue pasando por el mismo
 * `parse` del llamador (zod, fail-closed). Solo evita que un ```json ... ```
 * cosmético convierta una extracción correcta en SCHEMA_INVALID.
 */
export function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

/**
 * Provider IA vía la integración oficial de la plataforma (`@vly-ai/integrations`).
 *
 * Existe por una razón operativa y de seguridad concreta: el deployment NO
 * tiene `OPENAI_API_KEY`, así que la ruta OpenAI falla y la extracción de CV
 * nunca llega a ejecutarse — es decir, la defensa del pipeline frente a prompt
 * injection (evidence post-check + matching determinista) nunca se ejercía
 * contra un LLM real. Con esta ruta sí se puede ejecutar la evaluación golden
 * contra un modelo real (GATE A) sin inventar ni falsificar secretos.
 *
 * Propiedades de seguridad:
 *  - El token SOLO se lee de `process.env` (server-side, action "use node").
 *    Nunca se registra, se devuelve ni se escribe en la BD.
 *  - El system prompt viaja como mensaje `system`; el contenido del CV viaja
 *    como mensaje `user` delimitado por `buildCvExtractUserContent`. El LLM no
 *    recibe herramientas, ni acceso a BD, ni secretos.
 *  - La salida NUNCA se confía: se entrega al `parse` del llamador (zod).
 *  - Un solo reintento, con temperatura 0 (determinismo máximo).
 */
export class VlyProvider implements AIProvider {
  readonly name = "vly";
  readonly model: string;
  private deploymentToken: string;
  private client: any = null;

  constructor(deploymentToken: string, model?: string) {
    if (!deploymentToken) {
      throw new Error(
        "Falta VLY_INTEGRATION_KEY (configúrala en las variables de entorno del proyecto).",
      );
    }
    this.deploymentToken = deploymentToken;
    this.model = model || process.env.AI_MODEL || DEFAULT_MODEL;
  }

  /** El cliente se crea en el primer uso (import diferido, solo en actions node). */
  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import("@vly-ai/integrations");
    this.client = new mod.VlyAI({ deploymentToken: this.deploymentToken });
    return this.client;
  }

  async complete<T>(
    request: AIRequest,
    parse: (raw: string) => T,
  ): Promise<AIResponse<T>> {
    const startedAt = Date.now();
    let lastError: { code: any; message: string } | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ai = await this.getClient();
        const res = await ai.completion(
          {
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.userContent },
            ],
            maxTokens: request.maxOutputTokens,
            temperature: attempt === 0 ? request.temperature : 0,
          },
          { timeout: TIMEOUT_MS, retries: 0 },
        );

        if (!res?.success) {
          const message = String(res?.error ?? "El proveedor de IA no respondió.");
          lastError = {
            code: /rate|429|quota/i.test(message)
              ? "RATE_LIMITED"
              : /timeout|timed out/i.test(message)
                ? "TIMEOUT"
                : "PROVIDER_ERROR",
            message,
          };
          continue;
        }

        const finishReason = String(res?.data?.choices?.[0]?.finishReason ?? "");
        if (finishReason === "content-filter") {
          // El proveedor (o su filtro ascendente) rechazó el contenido. No tiene
          // sentido reintentar: se clasifica aparte para que el audit log diga la
          // verdad en lugar de "formato inesperado".
          return {
            ok: false,
            error: {
              code: "CONTENT_FILTERED",
              message:
                "El proveedor de IA rechazó el contenido del documento por su filtro de seguridad.",
            },
            usage: null,
            model: this.model,
            durationMs: Date.now() - startedAt,
          };
        }

        const usage: AIUsage | null = res?.data?.usage
          ? {
              inputTokens: res.data.usage.promptTokens ?? 0,
              outputTokens: res.data.usage.completionTokens ?? 0,
            }
          : null;

        const raw = res?.data?.choices?.[0]?.message?.content ?? "";
        if (raw.trim().length === 0) {
          lastError = {
            code: "SCHEMA_INVALID",
            message: "El proveedor de IA devolvió una respuesta vacía.",
          };
          continue;
        }

        try {
          return {
            ok: true,
            data: parse(stripJsonFence(raw)),
            usage,
            model: this.model,
            durationMs: Date.now() - startedAt,
          };
        } catch (err) {
          lastError = {
            code: "SCHEMA_INVALID",
            message:
              err instanceof Error ? err.message : "JSON inválido del modelo",
          };
        }
      } catch (err: any) {
        const message =
          err instanceof Error ? err.message : "Error del proveedor IA";
        lastError = {
          code:
            err?.name === "AbortError" || /timeout|timed out/i.test(message)
              ? "TIMEOUT"
              : "PROVIDER_ERROR",
          // Nunca incluir el token en el mensaje de error.
          message: message.split(this.deploymentToken).join("[redacted]"),
        };
      }
    }

    return {
      ok: false,
      error: lastError ?? { code: "PROVIDER_ERROR", message: "Error desconocido" },
      usage: null,
      model: this.model,
      durationMs: Date.now() - startedAt,
    };
  }
}