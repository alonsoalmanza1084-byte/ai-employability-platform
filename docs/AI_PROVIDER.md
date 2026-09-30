# AI_PROVIDER.md — Abstracción de proveedores IA

## 1. Interfaz

```ts
// convex/lib/ai/types.ts
export interface AIRequest {
  task: "cv_extract";                 // tarea, no "prompt libre"
  system: string;                      // prompt versionado del sistema
  userContent: string;                 // dato del usuario (delimitado)
  maxOutputTokens: number;
  temperature: number;
}
export interface AIResponse<T> {
  ok: boolean;
  data?: T;                 // ya validado por schema
  usage?: { inputTokens: number; outputTokens: number };
  error?: { code: "RATE_LIMITED" | "SCHEMA_INVALID" | "PROVIDER_ERROR" | "TIMEOUT"; message: string };
  model: string;
  durationMs: number;
}
```

## 2. Router

`AI_PROVIDER=openai` (default) → `OpenAIProvider` con structured outputs (JSON schema). Otros proveedores (Anthropic, Gemini, self-host vía OpenAI-compatible endpoint) se agregan implementando la misma interfaz; el cambio es config, no código.

- `AI_MODEL` configurable (default: un modelo pequeño/rápido con JSON confiable).
- Reintentos: 1 retry con backoff en error transitorio; schema inválido → 1 retry con mensaje de corrección.
- Timeout duro por request; si falla → estado `failed` accionable.

## 3. Costo y uso

- Cada llamada registra en `aiExtractions`: modelo, tokens in/out, duración, ok/error, promptVersion.
- `usageEvents` registra el evento de negocio (cv.extract) con `dedupeKey` idempotente.
- Costo estimado = tokens × tabla de precios del proveedor (en fase billing).

## 4. Reglas

- Solo actions `"use node"` tocan proveedores.
- La key vive en env var server-side; el código de negocio nunca importa el SDK directamente.
- Cambios de prompt = nueva `promptVersion` (git history como changelog).
