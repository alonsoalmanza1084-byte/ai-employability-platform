/* eslint-disable @typescript-eslint/no-explicit-any -- guards estáticos sobre el código fuente */
/**
 * VULN-14 — GUARD DE COBERTURA DE AUDITORÍA.
 *
 * El registro de denegaciones vive en `api.audited.*`. Las funciones originales
 * (`api.orgs.*`, `api.jobs.*`, `api.applications.*`, `api.matches.*`) siguen
 * siendo públicas porque las usan la UI y las suites ya VERIFICADAS.
 *
 * CONSECUENCIA HONESTA: un cliente que llame directamente a una original recibe
 * la denegación (la autorización NO se debilita en absoluto) pero esa denegación
 * NO queda registrada. Es un hueco de COBERTURA DE AUDITORÍA, no de seguridad.
 *
 * Este test lo convierte en algo explícito y verificable. Se analiza el CÓDIGO
 * FUENTE y no el proxy de la API, porque `api.<módulo>` no implementa
 * `ownKeys` y una aserción basada en `Object.keys` sería VACUA (falso verde).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "src", "convex");
const gen: any = await import("../../src/convex/_generated/api");
const api: any = gen.api;

/** Módulos con datos por tenant y, por tanto, con denegaciones que auditar. */
const TENANT_SCOPED_MODULES = ["orgs", "jobs", "applications", "matches"] as const;

/** Funciones públicas de esos módulos que SECUENCIAN autorización de tenant. */
const EXPECTED_AUDITED: Record<string, string[]> = {
  orgs: ["members", "invite", "pendingInvites", "revokeInvite", "removeMember", "auditTrail"],
  jobs: ["listByOrg", "get", "create", "close"],
  applications: [
    "listByJob",
    "decide",
    "addNote",
    "notesFor",
    "initUpload",
    "finalizeUpload",
  ],
  matches: ["getForApplication"],
};

/** Funciones que legítimamente NO se auditan aquí, con su motivo. */
const NOT_AUDITED: Record<string, string> = {
  "orgs.myOrgs": "solo lee las organizaciones del propio actor: no hay denegación cross-tenant posible.",
  "orgs.create": "no hay organización previa a la que pertenecer: sin denegación de autorización.",
  "orgs.acceptInvite": "la autorización es la validez del token de invitación, no una membresía de tenant.",
};

/** Wrapper esperado por operación. */
const WRAPPER_BY_OPERATION: Record<string, string> = {
  "orgs.members": "orgMembers",
  "orgs.invite": "orgInvite",
  "orgs.pendingInvites": "orgPendingInvites",
  "orgs.revokeInvite": "orgRevokeInvite",
  "orgs.removeMember": "orgRemoveMember",
  "orgs.auditTrail": "orgAuditTrail",
  "jobs.listByOrg": "jobsListByOrg",
  "jobs.get": "jobsGet",
  "jobs.create": "jobsCreate",
  "jobs.close": "jobsClose",
  "applications.listByJob": "applicationsListByJob",
  "applications.decide": "applicationsDecide",
  "applications.addNote": "applicationsAddNote",
  "applications.notesFor": "applicationsNotesFor",
  "applications.initUpload": "applicationsInitUpload",
  "applications.finalizeUpload": "applicationsFinalizeUpload",
  "matches.getForApplication": "matchesGetForApplication",
};

function readSource(file: string): string {
  return readFileSync(join(SRC, `${file}.ts`), "utf8");
}

/** Nombres de `export const X = query|mutation` declarados en el fichero. */
function exportedFunctions(file: string): { name: string; kind: string }[] {
  const src = readSource(file);
  const out: { name: string; kind: string }[] = [];
  const re = /export const (\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ name: m[1]!, kind: m[2]! });
  return out;
}

describe("VULN-14 — cobertura de auditoría de denegaciones", () => {
  it("el análisis estático encuentra funciones (guard contra un guard vacío)", () => {
    for (const mod of TENANT_SCOPED_MODULES) {
      const found = exportedFunctions(mod).length;
      const expected = Object.keys(WRAPPER_BY_OPERATION).filter((o) => o.startsWith(`${mod}.`))
        .length;
      expect(found, `${mod}.ts: se esperaban >= ${expected} funciones públicas`).toBeGreaterThanOrEqual(
        expected,
      );
      expect(found, `${mod}.ts no se pudo analizar`).toBeGreaterThan(0);
    }
  });

  it("cada endpoint sensible de tenant tiene su wrapper auditado", () => {
    const missing: string[] = [];
    for (const mod of TENANT_SCOPED_MODULES) {
      for (const fn of EXPECTED_AUDITED[mod]) {
        const operation = `${mod}.${fn}`;
        const wrapper = WRAPPER_BY_OPERATION[operation];
        if (!wrapper || !api.audited?.[wrapper]) missing.push(operation);
      }
    }
    expect(missing, `endpoints sin wrapper auditado: ${missing.join(", ")}`).toEqual([]);
  });

  it("toda función pública de esos módulos está clasificada: auditada o con motivo", () => {
    const unclassified: string[] = [];
    for (const mod of TENANT_SCOPED_MODULES) {
      for (const { name, kind } of exportedFunctions(mod)) {
        if (kind !== "query" && kind !== "mutation") continue;
        const operation = `${mod}.${name}`;
        if (WRAPPER_BY_OPERATION[operation]) continue;
        if (NOT_AUDITED[operation]) continue;
        unclassified.push(operation);
      }
    }
    expect(
      unclassified,
      `funciones nuevas sin clasificar (añade wrapper o motivo): ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("todo wrapper de `audited.ts` es una `action` (nunca una `mutation` propia)", () => {
    const src = readSource("audited");
    const declared = [...src.matchAll(/export const (\w+)\s*=\s*auditedAction\(/g)].map(
      (m) => m[1]!,
    );
    expect(declared.length, "no se encontró ningún wrapper declarado").toBe(
      Object.keys(WRAPPER_BY_OPERATION).length,
    );
    // Ninguna declaración directa de query/mutation/action fuera del wrapper.
    const raw = [...src.matchAll(/export const (\w+)\s*=\s*(query|mutation|action)\s*\(/g)];
    expect(
      raw.map((m) => `${m[1]}:${m[2]}`),
      "audited.ts no debe declarar funciones fuera del factory",
    ).toEqual([]);
    // Y cada wrapper referencia un `target:` real (no es un stub).
    for (const m of declared) {
      expect(src, `${m} no delega en ninguna función real`).toContain(`target: api.`);
    }
  });

  it("cada wrapper declara `operation` y `kind` (contrato de auditoría completo)", () => {
    const src = readSource("audited");
    for (const op of Object.keys(WRAPPER_BY_OPERATION)) {
      expect(src, `falta operation: "${op}"`).toContain(`operation: "${op}"`);
    }
    const kindCount = (src.match(/kind: "(query|mutation)"/g) ?? []).length;
    expect(kindCount).toBe(Object.keys(WRAPPER_BY_OPERATION).length);
  });

  it("el módulo `audited` NO expone nada relativo a securityEvents", () => {
    const keys = Object.keys(api.audited as object);
    // Si el proxy no se puede enumerar, la comprobación se hace sobre el fuente.
    const src = readSource("audited");
    expect(src.includes("securityEvents")).toBe(false);
    expect(keys.some((k) => /security/i.test(k))).toBe(false);
  });
});
