/* eslint-disable @typescript-eslint/no-explicit-any -- wrapper genérico de acciones */
/**
 * VULN-14 — Fábrica de ACCIONES AUDITADAS.
 *
 * Envuelve una función pública ya verificada SIN MODIFICARLA. Ver
 * `internal/authorization.ts` para el análisis completo de por qué este diseño
 * no introduce bypass.
 *
 * REGLA INVIOLABLE DEL WRAPPER: tras registrar el evento, el error se vuelve a
 * LANZAR. Nunca se devuelve `{ ok: false }`, de modo que ningún caller pueda
 * ignorar la denegación y continuar.
 */
import { action } from "../_generated/server";
import { makeFunctionReference } from "convex/server";
import { classifyDenial, type DenialReason } from "./denial";

/**
 * Referencias a `internal/authorization.ts`.
 *
 * `internal/*` NO forma parte de la superficie pública que Convex expone al
 * cliente: no hay ninguna forma de que un navegador la alcance, por lo que
 * usarla aquí no añade superficie atacable. Los argumentos los validan los
 * propios validadores de Convex en `logDenial`.
 */
const internalAuth = {
  classifyAuthorization: makeFunctionReference<
    "query",
    { organizationId?: string; minRole?: string },
    { ok: boolean; reason?: string }
  >("internal/authorization:classifyAuthorization"),
  logDenial: makeFunctionReference<
    "mutation",
    {
      operation: string;
      reason: string;
      organizationId?: string;
      resourceRef?: string;
      correlationId?: string;
      nonce: string;
    },
    { logged: boolean }
  >("internal/authorization:logDenial"),
};

export type AuditedActionOptions = {
  /** Nombre estable de la operación (p. ej. `"orgs.invite"`). */
  operation: string;
  /** `query` o `mutation`: determina cómo se invoca el objetivo. */
  kind: "query" | "mutation";
  /**
   * Rol mínimo exigido. Solo se usa para el preflight; NUNCA autoriza.
   * Omitirlo desactiva el preflight (ver más abajo).
   */
  minRole?: string;
  /**
   * Nombre del argumento que contiene el `organizationId`.
   *
   * Si se omite, NO hay preflight: muchos endpoints se direccionan por
   * `jobId`/`applicationId` y la organización solo se puede resolver dentro de
   * la función real. En ese caso la denegación se registra igualmente, en el
   * `catch`, que es el mecanismo universal y no depende del preflight.
   */
  orgArg?: string;
  /** La función real que ejecuta el trabajo. */
  target: any;
};

/**
 * Construye una `action` pública que:
 *  1. hace un preflight de SOLO LECTURA cuando conoce la organización,
 *  2. delega en la función real (una única llamada ⇒ atomicidad intacta),
 *  3. registra la denegación en su propia transacción cuando algo falla,
 *  4. y SIEMPRE relanza el error original.
 */
export function auditedAction(args: any, opts: AuditedActionOptions) {
  return action({
    args,
    handler: async (ctx: any, callArgs: any) => {
      const orgId: unknown = opts.orgArg ? callArgs?.[opts.orgArg] : undefined;
      const resourceRef: unknown =
        callArgs?.applicationId ?? callArgs?.jobId ?? callArgs?.invitationId;

      const record = async (reason: DenialReason, original: unknown) => {
        try {
          await ctx.runMutation(internalAuth.logDenial, {
            operation: opts.operation,
            reason,
            organizationId: typeof orgId === "string" ? orgId : undefined,
            resourceRef: typeof resourceRef === "string" ? resourceRef : undefined,
            // Nonce único: cada denegación es una mutación independiente.
            nonce: newDenialNonce(),
          });
        } catch {
          // Si el registro falla, el error ORIGINAL se sigue propagando: un fallo
          // de auditoría NUNCA degrada la seguridad.
          //
          // No se escribe nada en consola a propósito: el proyecto prohíbe
          // `console.*` en módulos de servidor (tests/static/dataLeakage.test.ts)
          // para que ningún dato de CV, token o clave acabe en los logs. La
          // ausencia de eventos ES la señal: el pipeline de observabilidad debe
          // alertar sobre "denegaciones esperadas = 0" además de sobre eventos.
        }
        return original;
      };

      // ── 1. PREFLUGO (solo lectura, solo si se conoce la organización). ──
      // Puede DENEGAR, nunca autorizar: la función real vuelve a comprobar.
      if (opts.orgArg && opts.minRole) {
        const pre = await ctx.runQuery(internalAuth.classifyAuthorization, {
          organizationId: typeof orgId === "string" ? orgId : undefined,
          minRole: opts.minRole,
        });
        if (!pre?.ok) {
          const reason: DenialReason = (pre?.reason as DenialReason) ?? "unknown";
          // La operación NO se ejecuta y el cliente recibe un error, igual que
          // sin auditar. Fail-closed intacto.
          throw await record(reason, new Error(denialMessage(reason)));
        }
      }

      // ── 2. OPERACIÓN REAL. Una única llamada: atomicidad e idempotencia. ──
      try {
        return opts.kind === "query"
          ? await ctx.runQuery(opts.target, callArgs)
          : await ctx.runMutation(opts.target, callArgs);
      } catch (error) {
        // ── 3. MECANISMO UNIVERSAL: cualquier denegación, venga del preflight
        //         o de la propia función (IDOR, membresía revocada entremedias,
        //         rol insuficiente, ID malformado) queda registrada. ──
        const reason = classifyDenial(error);
        if (reason) throw await record(reason, error);
        // No es una denegación: se propaga SIN registrar (sin falsos positivos).
        throw error;
      }
    },
  });
}

/**
 * Nonce por denegación.
 *
 * NO es un secreto: solo tiene que ser distinto en cada llamada. Se incluye en
 * los argumentos de `logDenial` para garantizar que cada denegación se registre
 * como una mutación independiente, sin depender de cómo el runtime agrupe
 * llamadas idénticas. Se genera con `Date.now()` + contador + `Math.random()`
 * porque el runtime de las ACTIONS de Convex no expone WebCrypto. Nunca se
 * persiste.
 */
let denialCounter = 0;
function newDenialNonce(): string {
  denialCounter += 1;
  return `${Date.now().toString(36)}-${denialCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Mensajes hacia el cliente. Mantienen la semántica original de
 * `requireMembership` (genérica, sin filtrar existencia) y NO revelan si la
 * organización existe, ni el rol real del actor, ni el motivo exacto.
 */
function denialMessage(reason: DenialReason): string {
  switch (reason) {
    case "unauthenticated":
      return "UNAUTHENTICATED: inicia sesión para continuar.";
    case "insufficient_role":
    case "corrupt_membership":
      return "FORBIDDEN: no tienes permisos para esta acción.";
    default:
      // not_a_member / cross_tenant / resource_not_found / malformed_id →
      // todos "NOT_FOUND", igual que hoy: no se distingue "no existe" de
      // "no eres miembro".
      return "NOT_FOUND";
  }
}
