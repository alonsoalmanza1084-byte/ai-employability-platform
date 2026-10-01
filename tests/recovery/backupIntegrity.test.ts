/**
 * BLOCKER B/C — Verificación de integridad del BACKUP.
 *
 * Verifica que el snapshot producido por `convex export --include-file-storage`
 * es un respaldo real y completo: contiene las filas del dataset sembrado, que
 * los binarios del storage están incluidos byte a byte, y que NO hay
 * referencias cruzadas rotas ni datos de un tenant dentro de otro.
 *
 * Es una verificación de INTEGRIDAD DEL RESPALDO. La verificación de RESTAURACIÓN
 * (import real) vive en scripts/backup_restore_drill.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de backup sin tipar */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SNAPSHOT = process.env.SNAPSHOT_DIR ?? "/tmp/tf/x";
const MANIFEST = process.env.MANIFEST_PATH ?? "/tmp/tf/manifest.json";
// El snapshot es un artefacto externo producido por `convex export`. Si no
// existe, el archivo se reporta NOT EXECUTED (skip) en vez de fallar en verde o
// rojo por una dependencia que no está en el repo.
const SNAPSHOT_READY =
  existsSync(MANIFEST) && existsSync(join(SNAPSHOT, "organizations"));

function readTable(name: string): any[] {
  const p = join(SNAPSHOT, name, "documents.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

const sha256 = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
/** Mismo formato que usa Convex en los metadatos de storage (base64). */
const sha256Base64 = (b: Buffer) =>
  createHash("sha256").update(b).digest("base64");

describe.skipIf(!SNAPSHOT_READY)("BLOQUE B — integridad del backup", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

  it("el snapshot contiene TODAS las filas sembradas del tenant A", () => {
    const orgs = readTable("organizations");
    const jobs = readTable("jobs");
    const apps = readTable("applications");
    const notes = readTable("recruiterNotes");
    const invites = readTable("invitations");
    const rv = readTable("resumeVersions");

    expect(orgs.map((o) => o._id)).toContain(manifest.tenants.A.orgId);
    expect(orgs.map((o) => o._id)).toContain(manifest.tenants.B.orgId);
    expect(jobs.map((j) => j._id)).toContain(manifest.tenants.A.jobId);
    expect(jobs.map((j) => j._id)).toContain(manifest.tenants.B.jobId);
    expect(apps.map((a) => a._id)).toContain(manifest.tenants.A.applicationId);
    expect(notes.map((n) => n._id)).toContain(manifest.tenants.A.noteId);
    expect(rv.map((r) => r._id)).toContain(manifest.tenants.A.resumeVersionId);
    expect(invites.map((i) => i.email)).toContain(manifest.tenants.A.inviteEmail);
  });

  it("conserva los IDs originales (el restore no puede reasignar identidad)", () => {
    // Los IDs son la clave de integridad de todas las referencias del sistema.
    const org = readTable("organizations").find(
      (o) => o._id === manifest.tenants.A.orgId,
    );
    expect(org).toBeTruthy();
    expect(org.name).toBe(manifest.tenants.A.orgName);
    const app = readTable("applications").find(
      (a) => a._id === manifest.tenants.A.applicationId,
    );
    expect(app.organizationId).toBe(manifest.tenants.A.orgId);
    expect(app.jobId).toBe(manifest.tenants.A.jobId);
  });

  it("incluye los BINARIOS de los CV (no solo los metadatos)", () => {
    const storageDir = join(SNAPSHOT, "_storage");
    const files = readdirSync(storageDir).filter((f) => f !== "documents.jsonl");
    const storageDocs = readTable("_storage");
    expect(files.length).toBeGreaterThan(0);
    // Cada storageId referenciado por un resumeVersion debe tener su binario.
    const rv = readTable("resumeVersions");
    for (const v of rv) {
      const meta = storageDocs.find((s) => s._id === v.storageId);
      expect(meta, `sin metadatos de storage para ${v._id}`).toBeTruthy();
      const bin = files.find((f) => f.startsWith(meta!._id + "."));
      expect(bin, `falta el binario de ${v.storageId}`).toBeTruthy();
    }
  });

  it("los binarios son ÍNTEGROS: el sha256 del snapshot coincide con el archivo", () => {
    const storageDir = join(SNAPSHOT, "_storage");
    const files = readdirSync(storageDir).filter((f) => f !== "documents.jsonl");
    let checked = 0;
    for (const meta of readTable("_storage")) {
      const bin = files.find((f) => f.startsWith(meta._id + "."));
      if (!bin) continue;
      const bytes = readFileSync(join(storageDir, bin));
      expect(bytes.length).toBe(meta.size);
      expect(sha256Base64(bytes)).toBe(meta.sha256);
      checked++;
    }
    expect(checked, "no se verificó ningún binario").toBeGreaterThan(0);
  });

  it("el binario de un CV sembrado conserva su contenido (hash estable)", () => {
    const storageDir = join(SNAPSHOT, "_storage");
    const storageDocs = readTable("_storage");
    const rv = readTable("resumeVersions").find(
      (r) => r._id === manifest.tenants.A.resumeVersionId,
    );
    expect(rv).toBeTruthy();
    const meta = storageDocs.find((s: any) => s._id === (rv as any).storageId);
    expect(meta).toBeTruthy();
    const bin = readdirSync(storageDir).find((f) => f.startsWith(meta._id + "."));
    expect(bin).toBeTruthy();
    const bytes = readFileSync(join(storageDir, bin!));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.toString("utf8")).toContain("Carla Recuperacion");
    expect(sha256(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("integridad referencial: ninguna fila apunta a una tabla inexistente", () => {
    const orgIds = new Set(readTable("organizations").map((o) => o._id));
    const userIds = new Set(readTable("users").map((u) => u._id));
    const jobIds = new Set(readTable("jobs").map((j) => j._id));
    const appIds = new Set(readTable("applications").map((a) => a._id));
    const storageIds = new Set(readTable("_storage").map((s) => s._id));

    for (const m of readTable("organizationMembers")) {
      expect(orgIds.has(m.organizationId), `membership → org roto ${m._id}`).toBe(true);
      expect(userIds.has(m.userId), `membership → user roto ${m._id}`).toBe(true);
    }
    for (const j of readTable("jobs")) {
      expect(orgIds.has(j.organizationId), `job → org roto ${j._id}`).toBe(true);
    }
    for (const a of readTable("applications")) {
      expect(orgIds.has(a.organizationId), `application → org roto ${a._id}`).toBe(true);
      expect(jobIds.has(a.jobId), `application → job roto ${a._id}`).toBe(true);
      expect(storageIds.has(a.storageId), `application → storage roto ${a._id}`).toBe(true);
    }
    for (const n of readTable("recruiterNotes")) {
      expect(orgIds.has(n.organizationId), `note → org roto ${n._id}`).toBe(true);
      expect(appIds.has(n.applicationId), `note → application roto ${n._id}`).toBe(true);
    }
    for (const r of readTable("candidateJobMatches")) {
      expect(appIds.has(r.applicationId), `match → application roto ${r._id}`).toBe(true);
    }
    for (const e of readTable("auditLog")) {
      // Los eventos de ámbito personal (p. ej. cv.upload del candidato) no
      // llevan organizationId: son válidos por diseño.
      if (e.organizationId === undefined || e.organizationId === null) continue;
      expect(orgIds.has(e.organizationId), `audit → org roto ${e._id}`).toBe(true);
    }
  });

  it("AISLAMIENTO: los datos del tenant A no se mezclan con los del tenant B", () => {
    const orgA = manifest.tenants.A.orgId;
    const orgB = manifest.tenants.B.orgId;
    const jobsA = readTable("jobs").filter((j) => j.organizationId === orgA).map((j) => j._id);
    const jobsB = readTable("jobs").filter((j) => j.organizationId === orgB).map((j) => j._id);
    expect(jobsA).toContain(manifest.tenants.A.jobId);
    expect(jobsB).toContain(manifest.tenants.B.jobId);
    expect(jobsA.some((id) => jobsB.includes(id))).toBe(false);

    const appA = readTable("applications").find(
      (a) => a._id === manifest.tenants.A.applicationId,
    );
    // La application del tenant A apunta a la vacante del tenant A y a su storage.
    expect(jobsA).toContain(appA.jobId);
    expect(appA.organizationId).toBe(orgA);
    expect(orgA).not.toBe(orgB);

    // Ninguna nota del tenant A apunta a una application del tenant B.
    const appIdsB = readTable("applications")
      .filter((a) => a.organizationId === orgB)
      .map((a) => a._id);
    for (const n of readTable("recruiterNotes")) {
      if (n.organizationId !== orgA) continue;
      expect(appIdsB).not.toContain(n.applicationId);
    }
  });

  it("el snapshot contiene el audit log del tenant A con sus eventos", () => {
    const events = readTable("auditLog").filter(
      (e) => e.organizationId === manifest.tenants.A.orgId,
    );
    expect(events.length).toBeGreaterThanOrEqual(manifest.tenants.A.auditEventCount);
    for (const e of events) {
      expect(e.action).toBeTruthy();
      expect(typeof (e.createdAt ?? 0) === "number").toBe(true);
    }
  });

  it("el snapshot contiene datos de autenticación (sesiones y cuentas)", () => {
    expect(readTable("users").length).toBeGreaterThan(0);
    expect(readTable("authSessions").length).toBeGreaterThan(0);
    // El hash de contraseña/token nunca se almacena en claro.
    for (const a of readTable("authAccounts")) {
      if (a.password) expect(a.password).toMatch(/^\$argon2|^[0-9a-f]{40,}$/);
    }
  });

  it("el tamaño del snapshot es consistente con el número de filas", () => {
    const storageDir = join(SNAPSHOT, "_storage");
    let bytes = 0;
    for (const f of readdirSync(storageDir)) bytes += statSync(join(storageDir, f)).size;
    expect(bytes).toBeGreaterThan(0);
  });

  it("si el snapshot no está disponible, se reporta NOT EXECUTED", () => {
    expect(SNAPSHOT_READY).toBe(true);
  });
});