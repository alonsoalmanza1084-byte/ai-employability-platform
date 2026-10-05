/** Abstracción de proveedores IA (docs/AI_PROVIDER.md). Cambiar proveedor = env var, no código. */

export type AIErrorCode =
  | "RATE_LIMITED"
  | "SCHEMA_INVALID"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  /** El proveedor rechazó la petición por su filtro de contenido (auditoría #4). */
  | "CONTENT_FILTERED";

export interface AIRequest {
  /** Tarea que define el prompt/telemetría. Ampliar aquí = revisar providers. */
  task: "cv_extract" | "career_coach";
  system: string;
  /** Dato del usuario, ya delimitado por el llamador. */
  userContent: string;
  maxOutputTokens: number;
  temperature: number;
  /** JSON schema estricto que la salida debe cumplir. */
  responseJsonSchema: Record<string, unknown>;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AISuccess<T> {
  ok: true;
  data: T;
  usage: AIUsage | null;
  model: string;
  durationMs: number;
}

export interface AIFailure {
  ok: false;
  error: { code: AIErrorCode; message: string };
  usage: AIUsage | null;
  model: string;
  durationMs: number;
}

export type AIResponse<T> = AISuccess<T> | AIFailure;

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete<T>(request: AIRequest, parse: (raw: string) => T): Promise<AIResponse<T>>;
}
