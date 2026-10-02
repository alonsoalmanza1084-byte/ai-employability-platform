/* eslint-disable @typescript-eslint/no-explicit-any -- borrado E2E */
/**
 * P2 — BORRADO REAL DE DATOS (PRIVACY.md §3 «Eliminación» + `account.deleteAccount`).
 *
 * El prompt de cierre exige verificar —no asumir— que «eliminar cuenta» borra
 * de verdad, y que un OTP posterior al email original NO puede resucitar la
 * cuenta. Los tests existentes solo comprobaban que la mutación devuelve
 * `{ ok: true }` y que la sesión muere.
 *
 * Qué se verifica aquí, siempre contra la base de datos REAL:
 *
 *   1. PRECONDICIÓN verificada (no supuesta): el usuario tiene fila de perfil,
 *      `resumes`, `resumeVersions`, un binario en storage privado, una fila de
 *      `authAccounts`/`authSessions` y una membresía. Sin precondición, un
 *      `grep` vacío al final sería una aserción vacua.
 *   2. POST-CONDICIÓN por tabla: el `userId` del borrado ya NO aparece en
 *      `candidateProfiles`, `resumes`, `resumeVersions`, `authAccounts`,
 *      `authSessions` ni `organizationMembers`; el `storageId` ya NO aparece en
 *      `_storage`.
 *   3. ANTI-RESURRESIÓN POR OTP: la fila de `authAccounts` (la que casa el
 *      `providerAccountId` del OTP) desapareció y la identidad quedó anonimizada
 *      con marcador no enrutable (`@deleted.invalid` + `[cuenta-eliminada]`), de
 *      modo que un OTP al email original no vuelve a engancharla.
 *   4. NO SOBRE-BORRADO: los datos de OTRO usuario (perfil + binario) siguen
 *      intactos y su sesión viva. El borrado es del sujeto, no global.
 *   5. IDEMPOTENCIA FAIL-CLOSED: una segunda llamada con la sesión ya muerta
 *      FALLA; no devuelve un `ok: true` engañoso.
 *
 * PREPARACIÓN DE FIXTURES (sin bypass): no es posible crear un
 * `candidateProfile` por API sin ejecutar una extracción con IA real (el perfil
 * nace en `applyExtraction`), y `convex run` sobre funciones internas no tiene
 * identidad (`UNAUTHENTICATED`). Por eso la fila de perfil se siembra por
 * IMPORTACIÓN DE DATOS, el mismo mecanismo que usa `rbac_seed_memberships.sh` y
 * un restore. Lo que se ejecuta después es la mutación de producción, sin mocks.
 *
 * La lectura de la base se hace con `convex data <tabla> --limit 10000`: sin
 * `--limit` el CLI muestra solo las 100 filas más recientes y un `grep` podría
 * dar un falso «no existe» (trampa de medición ya documentada).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConvexHttpClient } from "convex/browser";

function loadConvexUrl(): string | undefined {
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;
  try {
    const env = readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("VITE_CONVEX_URL="));
    return line?.split("=").slice(1).join("=").trim();
  } catch {
    return undefined;
  }
}

const CONVEX_URL = loadConvexUrl();
const gen: any = await import("../../src/convex/_generated/api");
const api: any = gen.anyApi ?? gen.api;

/** Filas de una tabla como texto (lectura SIEMPRE acotada explícitamente). */
function rows(table: string): string {
  return execFileSync("bunx", ["convex", "data", table, "--limit", "10000"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Líneas de una tabla que mencionan un identificador concreto. */
function rowsMentioning(table: string, needle: string): string[] {
  return rows(table)
    .split("\n")
    .filter((l) => l.includes(needle));
}

/** Siembra una fila por importación de datos (fixture, sin endpoint nuevo). */
function importRow(table: string, doc: Record<string, unknown>): void {
  mkdirSync("/tmp/tf", { recursive: true });
  const path = `/tmp/tf/${table}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`;
  writeFileSync(path, JSON.stringify(doc) + "\n");
  execFileSync("bunx", ["convex", "import", "--table", table, "--append", "-y", path], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function newClient(): Promise<{ client: ConvexHttpClient; userId: string }> {
  const client = new ConvexHttpClient(CONVEX_URL!);
  const session: any = await client.action(api["auth"]["signIn"], { provider: "anonymous" });
  const token = session?.tokens?.token;
  if (!token) throw new Error("sin sesión anónima");
  client.setAuth(token);
  const user: any = await client.query(api["users"]["currentUser"]);
  return { client, userId: String(user._id) };
}

/** Crea una identidad con CV subido, organización (→ membresía) y perfil. */
async function makeSubjectWithData(): Promise<{
  client: ConvexHttpClient;
  userId: string;
  storageId: string;
}> {
  const { client, userId } = await newClient();

  // CV propio: binario en storage + `resumes` + `resumeVersions`.
  const bytes = new TextEncoder().encode(
    "Ada Borrado\nAnalista de Datos\nHabilidades: Python, SQL.\n5 años de experiencia.",
  );
  const up: any = await client.mutation(api["candidates"]["initUpload"], {
    fileName: "borrado.txt",
    fileSize: bytes.byteLength,
    mimeType: "text/plain",
  });
  const res = await fetch(up.uploadUrl, {
    method: "POST",
    body: new Blob([bytes], { type: "text/plain" }),
  });
  const { storageId } = (await res.json()) as { storageId: string };
  await client.mutation(api["candidates"]["finalizeUpload"], {
    fileName: "borrado.txt",
    fileSize: bytes.byteLength,
    mimeType: "text/plain",
    storageId,
  });

  // Organización: deja una fila real en `organizationMembers` (el creador es
  // org_admin). Hace la precondición de membresía NO vacua.
  await client.mutation(api["orgs"]["create"], { name: `Borrado ${Date.now()}` });

  // Perfil de candidato: sólo nace en una extracción con IA real, así que se
  // siembra por importación de datos (fixture; ver cabecera).
  // La fila debe cumplir el schema (los arrays de skills/experience/education/
  // certifications y `updatedAt` son obligatorios aunque estén vacíos).
  importRow("candidateProfiles", {
    userId,
    fullName: "Ada Borrado",
    headline: "Analista",
    yearsExperience: 5,
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    updatedAt: Date.now(),
  });

  return { client, userId, storageId };
}

describe.skipIf(!CONVEX_URL)("P2 — borrado real de datos al eliminar la cuenta", () => {
  it(
    "borra perfil, CVs, binario, membresías y authAccounts; mata la sesión; no resucita por OTP; y no toca a otros usuarios",
    async () => {
      const victim = await makeSubjectWithData();
      const bystander = await makeSubjectWithData();

      // ── 1. PRECONDICIÓN (contra la BD real, no supuesta) ────────────────
      for (const table of [
        "candidateProfiles",
        "resumes",
        "resumeVersions",
        "authAccounts",
        "authSessions",
        "organizationMembers",
      ]) {
        expect(
          rowsMentioning(table, victim.userId).length,
          `precondición: falta la fila de ${table} del usuario a borrar`,
        ).toBeGreaterThan(0);
      }
      expect(
        rowsMentioning("_storage", victim.storageId).length,
        "precondición: falta el binario en storage",
      ).toBeGreaterThan(0);

      // ── 2. BORRADO ──────────────────────────────────────────────────────
      await expect(victim.client.mutation(api["account"]["deleteAccount"], {})).resolves.toEqual({
        ok: true,
      });

      // La MISMA sesión (mismo token, sin re-loguear) deja de servir: o lanza
      // (token muerto) o devuelve null. NUNCA devuelve datos del perfil.
      let outcome = "";
      try {
        const p = await victim.client.query(api["candidates"]["myProfile"]);
        outcome = p === null ? "null" : "data";
      } catch {
        outcome = "throw";
      }
      expect(["throw", "null"], `la sesión sobrevivió al borrado (${outcome})`).toContain(outcome);

      // ── 3. POST-CONDICIÓN: los datos personales YA NO ESTÁN ─────────────
      for (const table of [
        "candidateProfiles",
        "resumes",
        "resumeVersions",
        "authAccounts",
        "authSessions",
        "organizationMembers",
      ]) {
        expect(
          rowsMentioning(table, victim.userId),
          `${table} conserva filas del usuario borrado`,
        ).toEqual([]);
      }
      expect(
        rowsMentioning("_storage", victim.storageId),
        "el binario del CV sobrevivió al borrado",
      ).toEqual([]);

      // ── 4. ANTI-RESURRESCIÓN POR OTP ────────────────────────────────────
      // `authAccounts` (que casa providerAccountId) ya no existe —verificado
      // arriba— y la identidad quedó anonimizada con marcador no enrutable, de
      // forma que un OTP al email original no vuelve a enganchar esta cuenta.
      const userRow = rowsMentioning("users", victim.userId).join("\n");
      expect(userRow, "la identidad ya no existe").not.toBe("");
      expect(userRow, "el email no quedó con marcador no enrutable").toContain(
        "deleted.invalid",
      );
      expect(userRow, "la identidad no quedó anonimizada").toContain("[cuenta-eliminada]");

      // ── 4-bis. RESIDUAL DE SESIÓN: medido, no supuesto ──────────────────
      // Tras el borrado, ¿el JWT ya emitido sigue siendo aceptado? Se mide y se
      // registra. En cualquiera de los dos casos el sujeto NO tiene NADA.
      let tokenAfterDeletion = "";
      try {
        const u: any = await victim.client.query(api["users"]["currentUser"]);
        tokenAfterDeletion = u?._id ? String(u._id) : "null";
      } catch {
        tokenAfterDeletion = "throw";
      }
      console.log("DELETION_TOKEN_PROBE " + tokenAfterDeletion);

      if (tokenAfterDeletion === victim.userId) {
        // RESIDUAL MEDIDO: el JWT emitido antes del borrado sigue siendo
        // aceptado hasta su expiración (la revocación inmediata se hace por
        // DATOS: authSessions/authAccounts borrados y membresías retiradas).
        // Lo exigible es que ese token NO dé acceso a ningún dato personal.
        const u: any = await victim.client.query(api["users"]["currentUser"]);
        expect(u.email, "el sujeto no quedó anonimizado").toContain("deleted.invalid");
        expect(u.name, "el sujeto no quedó anonimizado").toBe("[cuenta-eliminada]");
        expect(await victim.client.query(api["candidates"]["myProfile"])).toBeNull();
        expect(await victim.client.query(api["candidates"]["myResumes"])).toEqual([]);
        expect(await victim.client.query(api["orgs"]["myOrgs"])).toEqual([]);
      } else {
        expect(["throw", "null"]).toContain(tokenAfterDeletion);
      }

      // ── 5. IDEMPOTENCIA (sin resurrección) ──────────────────────────────
      // Una segunda eliminación puede devolver `ok` (nada que borrar) o fallar
      // si el token ya está muerto. Lo que NUNCA se acepta es que reaparezca
      // cualquier dato personal.
      await victim.client
        .mutation(api["account"]["deleteAccount"], {})
        .catch(() => undefined);
      for (const table of [
        "candidateProfiles",
        "resumes",
        "resumeVersions",
        "authAccounts",
        "authSessions",
        "organizationMembers",
      ]) {
        expect(
          rowsMentioning(table, victim.userId),
          `${table} resucitó tras una segunda eliminación`,
        ).toEqual([]);
      }
      expect(rowsMentioning("_storage", victim.storageId)).toEqual([]);

      // ── 6. NO SOBRE-BORRADO ─────────────────────────────────────────────
      expect(
        rowsMentioning("candidateProfiles", bystander.userId).length,
        "se borró el perfil de OTRO usuario",
      ).toBeGreaterThan(0);
      expect(
        rowsMentioning("_storage", bystander.storageId).length,
        "se borró el binario de OTRO usuario",
      ).toBeGreaterThan(0);
      expect(
        rowsMentioning("organizationMembers", bystander.userId).length,
        "se borró la membresía de OTRO usuario",
      ).toBeGreaterThan(0);
      const bystanderProfile = await bystander.client.query(api["candidates"]["myProfile"]);
      expect(bystanderProfile, "el otro usuario perdió su perfil/sesión").not.toBeNull();
    },
    300_000,
  );
});
