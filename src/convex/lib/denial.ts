/* eslint-disable @typescript-eslint/no-explicit-any -- helpers de contexto Convex */
/**
 * VULN-14 — Taxonomía de denegaciones.
 *
 * Convierte el error de autorización en una CATEGORÍA CERRADA. Nunca se persiste
 * el mensaje crudo del error (puede contener identificadores, rutas o detalle de
 * otro tenant) ni ningún tipo de secreto o PII.
 *
 * Los mensajes que produce `requireMembership` son deliberadamente genéricos
 * ("NOT_FOUND" / "FORBIDDEN: ...") precisamente para no filtrar existencia.
 */
import type { Id } from "../_generated/dataModel";

/** Categorías cerradas de denegación. Nada fuera de esta lista se persiste. */
export const DENIAL_REASONS = [
  /** Sin sesión válida (o `getAuthUserId` no devuelve nada). */
  "unauthenticated",
  /** El actor no es miembro de la organización objetivo. */
  "not_a_member",
  /** El actor es miembro pero su rol no alcanza el mínimo exigido. */
  "insufficient_role",
  /** Fila de membresía con un rol fuera de la jerarquía (dato corrupto). */
  "corrupt_membership",
  /** El recurso referenciado no existe o fue borrado. */
  "resource_not_found",
  /** El recurso existe pero pertenece a otra organización. */
  "cross_tenant",
  /** El ID no tiene el formato esperado. */
  "malformed_id",
  /** Límite de uso alcanzado (rate limiting server-side). */
  "rate_limited",
  /** Fallo de validación de entrada. */
  "validation_failed",
  /** Denegación no classificable (fail-closed: se registra como `unknown`). */
  "unknown",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

const DENIAL_SET = new Set<string>(DENIAL_REASONS);

/** Nunca confiar en un motivo que venga de fuera: se valida contra la lista. */
export function normalizeDenialReason(candidate: unknown): DenialReason {
  if (typeof candidate === "string" && DENIAL_SET.has(candidate)) {
    return candidate as DenialReason;
  }
  return "unknown";
}

/**
 * Clasifica un error capturado en el wrapper de auditoría.
 *
 * Mapea los mensajes de `requireMembership` / `requireUser` (y los de los
 * validadores de Convex) a categorías. Devuelve `null` si el error NO es una
 * denegación de autorización — en ese caso el wrapper debe propagarlo sin
 * registrar nada, para no generar falsos positivos de auditoría.
 */
export function classifyDenial(error: unknown): DenialReason | null {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error != null && typeof (error as any).data === "string"
          ? (error as any).data
          : "";

  if (!raw) return null;

  // Convex envuelve los argumentos inválidos con este mensaje.
  if (raw.includes("ArgumentValidationError") || raw.includes("Invalid args")) {
    return "malformed_id";
  }

  // Orden importante: `NOT_FOUND` de requireMembership significa "no eres
  // miembro o no existe". No se puede distinguir sin filtrar existencia, así que
  // se registra como `not_a_member` y la operación sigue denegada igual.
  if (raw.includes("UNAUTHENTICATED")) return "unauthenticated";
  if (raw.includes("FORBIDDEN")) {
    return raw.includes("rol") || raw.includes("role")
      ? "corrupt_membership"
      : "insufficient_role";
  }
  if (raw.includes("NOT_FOUND") || raw.includes("not found")) {
    return "not_a_member";
  }
  if (raw.includes("RATE_LIMIT")) return "rate_limited";

  return null;
}

/**
 * Referencia SEGURA a un recurso para el evento: nunca el valor crudo que envía
 * el cliente (podría contener un payload enorme, un traversal o un string
 * inyectado). Solo se conserva si parece un Id de Convex; si no, se marca.
 */
export function safeResourceRef(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "none";
  if (!/^[a-z0-9]{20,40}$/.test(value)) return "malformed";
  return value;
}

/**
 * Referencia a la organización objetivo. Se devuelve como `Id` SOLO si el
 * llamador la pasó; la verificación real de que ese tenant es el correcto la
 * hace el servidor (ver `logDenial`), nunca el cliente.
 */
export function safeOrgRef(value: unknown): Id<"organizations"> | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^[a-z0-9]{20,40}$/.test(value)) return undefined;
  return value as Id<"organizations">;
}
