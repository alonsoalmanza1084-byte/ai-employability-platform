/* eslint-disable @typescript-eslint/no-explicit-any -- SDK tipado de forma heterogénea entre versiones */
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIUsage,
} from "./types";

const TIMEOUT_MS = 60_000;

/**
 * Implementación inicial del AIProvider (ADR-010).
 * Structured Outputs (JSON mode): el modelo debe devolver JSON conforme al schema.
 * Un solo reintento ante errores transitorios; la salida SIEMPRE se valida
 * con el parser entregado por el llamador (zod) antes de tocar la BD.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private client: any;

  constructor(apiKey: string, model?: string) {
    // Import dinámico: este módulo solo se carga en actions "use node".
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: OpenAI } = require("openai") as typeof import("openai");
    this.client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
    this.model = model || process.env.AI_MODEL || "gpt-4o-mini";
  }

  async complete<T>(
    request: AIRequest,
    parse: (raw: string) => T,
  ): Promise<AIResponse<T>> {
    const startedAt = Date.now();
    let lastError: { code: any; message: string } | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.userContent },
          ],
          response_format: { type: "json_object" },
          temperature: attempt === 0 ? request.temperature : 0,
          max_tokens: request.maxOutputTokens,
        });

        const usage: AIUsage | null = completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens ?? 0,
              outputTokens: completion.usage.completion_tokens ?? 0,
            }
          : null;

        const raw = completion.choices?.[0]?.message?.content ?? "";
        try {
          return {
            ok: true,
            data: parse(raw),
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
        const status = err?.status ?? err?.response?.status;
        const code =
          status === 429
            ? "RATE_LIMITED"
            : err?.name === "APIConnectionTimeoutError" || err?.code === "ETIMEDOUT"
              ? "TIMEOUT"
              : "PROVIDER_ERROR";
        lastError = {
          code,
          message: err instanceof Error ? err.message : "Error del proveedor IA",
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

let cached: AIProvider | null = null;

/** Router por env var (AI_PROVIDER). En V1 solo OpenAI; la interfaz admite otros. */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const providerName = process.env.AI_PROVIDER || "openai";
  if (providerName !== "openai") {
    throw new Error(`AI_PROVIDER no soportado en V1: ${providerName}`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta OPENAI_API_KEY (configúrala en las variables de entorno del proyecto).",
    );
  }
  cached = new OpenAIProvider(apiKey, process.env.AI_MODEL);
  return cached;
}
