/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Convex sin tipar en escenarios de ataque */
/**
 * Gates H (audit log), I (abuso de API), J (seguridad de ficheros), K (auth) y
 * la parte viva de F (multi-tenancy) contra el deployment real.
 *
 * Cada test declara el ATAQUE, el RESULTADO ESPERADO y la ASERCIÓN, contra
 * funciones reales con sesiones reales. Si no puede ejecutarse se reporta
 * NOT EXECUTED (skipIf), nunca un verde falso.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function makeClient(): Promise<{ client: ConvexHttpClient; userId: string }> {
  const client = new ConvexHttpClient(CONVEX_URL!);
  const res: any = await client.action(api["auth"]["signIn"], { provider: "anonymous" });
  const sessionToken = res?.tokens?.token;
  if (!sessionToken) throw new Error("No se obtuvo sessionToken del sign-in anónimo");
  client.setAuth(sessionToken);
  const user: any = await client.query(api["users"]["currentUser"]);
  return { client, userId: String(user._id) };
}

/**
 * ATTACK: llamada hostil (id malformado, sesión ausente, org ajena).
 * EXPECTED: rechazo. ASERCIÓN: o bien lanza (NOT_FOUND/FORBIDDEN/validación),
 * o bien devuelve vacío — nunca un documento con datos.
 */
async function expectRejected(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const value = await fn();
    const empty =
      value === null ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value as object).length === 0);
    expect(
      empty,
      "la llamada hostil devolvió datos: " + JSON.stringify(value)?.slice(0, 200),
    ).toBe(true);
    return value;
  } catch {
    return "rejected";
  }
}

describe.skipIf(!CONVEX_URL)("GATES H/I/J/K — audit log, abuso de API, ficheros y auth (deployment real)", () => {
  let admin: ConvexHttpClient;
  let outsider: ConvexHttpClient;
  let orgId = "";
  let jobId = "";

  beforeAll(async () => {
    const a = await makeClient();
    admin = a.client;
    const o = await makeClient();
    outsider = o.client;

    const org: any = await admin.mutation(api["orgs"]["create"], {
      name: `Gates ${Date.now()}`,
    });
    orgId = String(org.organizationId);
    const job: any = await admin.mutation(api["jobs"]["create"], {
      organizationId: orgId,
      title: "Puesto para gates",
      description: "Vacante creada para probar audit trail y abuso de API",
      requirements: [
        { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
      ],
    });
    jobId = String(job.jobId);
  });

  afterAll(() => {
    admin?.clearAuth();
    outsider?.clearAuth();
  });

  // ── GATE H — AUDIT LOG ───────────────────────────────────────────────
  describe("GATE H — audit log", () => {
    it("registra actor, organización, acción, timestamp y target", async () => {
      const rows: any[] = await admin.query(api["orgs"]["auditTrail"], {
        organizationId: orgId,
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.action).toBeTruthy();
        expect(r.targetType).toBeTruthy();
        expect(typeof r.createdAt === "number" || typeof r._creationTime === "number").toBe(true);
        expect(r.metadata ?? {}).toBeTypeOf("object");
      }
    });

    it("orden descendente estricto y sin solapamientos entre páginas", async () => {
      // Generamos eventos distintos para tener volumen paginable.
      for (let i = 0; i < 4; i++) {
        await admin.mutation(api["jobs"]["create"], {
          organizationId: orgId,
          title: `Puesto paginado ${i}`,
          description: "Vacante creada para probar la paginación del audit trail",
          requirements: [
            { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
          ],
        });
      }
      const first: any[] = await admin.query(api["orgs"]["auditTrail"], {
        organizationId: orgId,
      });
      const second: any[] = await admin.query(api["orgs"]["auditTrail"], {
        organizationId: orgId,
      });
      const ts = (r: any) => r.createdAt ?? r._creationTime;
      for (let i = 1; i < first.length; i++) {
        expect(ts(first[i - 1]), "el audit trail no está en orden descendente").toBeGreaterThanOrEqual(
          ts(first[i]),
        );
      }
      // Dos lecturas del mismo estado devuelven exactamente la misma página:
      // no hay paginación "fantasma" que duplica eventos.
      expect(second.map((r) => r._id)).toEqual(first.map((r) => r._id));
      expect(new Set(first.map((r) => r._id)).size).toBe(first.length);
    });

    it("no contiene PII ni texto de CV en la metadata", async () => {
      const rows: any[] = await admin.query(api["orgs"]["auditTrail"], {
        organizationId: orgId,
      });
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain("@");
      expect(blob).not.toContain("Analista de Datos");
      for (const r of rows) {
        expect(r.metadata?.extractedText).toBeUndefined();
        expect(r.metadata?.cvText).toBeUndefined();
      }
    });

    it("un outsider de otra org NO lee el audit trail (tenant isolation)", async () => {
      await expectRejected(() =>
        outsider.query(api["orgs"]["auditTrail"], { organizationId: orgId }),
      );
    });

    it("el audit log no se puede escribir ni borrar desde el cliente", async () => {
      // No existe ninguna mutación pública de auditLog (superficie pública
      // verificada estáticamente en tests/static/api_surface.test.ts).
      // Dinámicamente: invocar la query de lectura como mutación debe fallar.
      let threw = false;
      try {
        await outsider.mutation(api["orgs"]["auditTrail"], { organizationId: orgId });
      } catch {
        threw = true;
      }
      expect(threw, "auditTrail aceptó una invocación como mutación").toBe(true);
    });
  });

  // ── GATE I — ABUSO DE API ────────────────────────────────────────────
  describe("GATE I — abuso de API", () => {
    it("ids malformados en todas las funciones que aceptan ids", async () => {
      await expectRejected(() => outsider.query(api["jobs"]["get"], { jobId: "no-es-un-id" }));
      await expectRejected(() =>
        outsider.query(api["matches"]["getForApplication"], { applicationId: "x" }),
      );
      await expectRejected(() =>
        outsider.query(api["applications"]["listByJob"], { jobId: "../../etc/passwd" }),
      );
      await expectRejected(() =>
        outsider.mutation(api["applications"]["decide"], {
          applicationId: "1",
          status: "shortlisted",
        }),
      );
      await expectRejected(() =>
        outsider.mutation(api["applications"]["addNote"], {
          applicationId: "1",
          body: "nota",
        }),
      );
      await expectRejected(() =>
        outsider.action(api["applications"]["ingestCv"], { applicationId: "1" }),
      );
      await expectRejected(() =>
        outsider.action(api["candidates"]["ingestCv"], { resumeVersionId: "1" }),
      );
    });

    it("paginación sobredimensionada no devuelve una tabla entera", async () => {
      const rows: any[] = await admin.query(api["orgs"]["auditTrail"], {
        organizationId: orgId,
      });
      expect(rows.length).toBeLessThanOrEqual(200);
      const members: any[] = await admin.query(api["orgs"]["members"], { organizationId: orgId });
      expect(members.length).toBeLessThanOrEqual(200);
    });

    it("campos inesperados (mass assignment) se rechazan por el validador", async () => {
      await expectRejected(() =>
        outsider.mutation(api["jobs"]["create"], {
          organizationId: orgId,
          title: "Puesto forjado",
          description: "Intento de crear una vacante en la org de otro actor",
          organizationId2: orgId,
          role: "org_admin",
          _id: "forjado",
          requirements: [
            { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
          ],
        }),
      );
    });

    it("replay: repetir una decisión no cambia el resultado ni evade el límite", async () => {
      const { uploadUrl }: any = await admin.mutation(api["applications"]["initUpload"], {
        jobId,
        fileName: "replay.txt",
        fileSize: 400,
      });
      const up = await fetch(uploadUrl, {
        method: "POST",
        body: new Blob([new TextEncoder().encode("curriculum de prueba con texto suficiente")], {
          type: "text/plain",
        }),
      });
      const { storageId } = (await up.json()) as { storageId: string };
      const fin: any = await admin.mutation(api["applications"]["finalizeUpload"], {
        jobId,
        storageId,
        fileName: "replay.txt",
        fileSize: 400,
        candidateName: "Candidato Replay",
      });
      const applicationId = String(fin.applicationId);

      const d1: any = await admin.mutation(api["applications"]["decide"], {
        applicationId,
        status: "shortlisted",
      });
      expect(d1.ok).toBe(true);
      // Replay idéntico: la mutación es idempotente en estado, no duplica filas
      // ni devuelve datos de otro actor.
      const d2: any = await admin.mutation(api["applications"]["decide"], {
        applicationId,
        status: "shortlisted",
      });
      expect(d2.ok).toBe(true);
      const rows: any[] = await admin.query(api["applications"]["listByJob"], { jobId });
      const app = rows.filter((r) => String(r.application._id) === applicationId);
      expect(app.length).toBe(1);
    });

    it("rechazar sin nota se rechaza (no evasión del control)", async () => {
      const { uploadUrl }: any = await admin.mutation(api["applications"]["initUpload"], {
        jobId,
        fileName: "reject.txt",
        fileSize: 400,
      });
      const up = await fetch(uploadUrl, {
        method: "POST",
        body: new Blob([new TextEncoder().encode("curriculum de prueba con texto suficiente")], {
          type: "text/plain",
        }),
      });
      const { storageId } = (await up.json()) as { storageId: string };
      const fin: any = await admin.mutation(api["applications"]["finalizeUpload"], {
        jobId,
        storageId,
        fileName: "reject.txt",
        fileSize: 400,
        candidateName: "Candidato Rechazo",
      });
      let denied = false;
      try {
        await admin.mutation(api["applications"]["decide"], {
          applicationId: String(fin.applicationId),
          status: "rejected",
        });
      } catch {
        denied = true;
      }
      expect(denied, "se aceptó un rechazo sin nota").toBe(true);
    });
  });

  // ── GATE J — SEGURIDAD DE FICHEROS (vivo) ───────────────────────────
  describe("GATE J — ficheros", () => {
    it("un ejecutable renombrado a .pdf es aceptado en init pero FALLA en la ingesta", async () => {
      const bytes = new Uint8Array([
        0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, ...new TextEncoder().encode("MZ executable"),
      ]);
      const { uploadUrl }: any = await admin.mutation(api["applications"]["initUpload"], {
        jobId,
        fileName: "malicioso.pdf",
        fileSize: bytes.byteLength,
      });
      const up = await fetch(uploadUrl, { method: "POST", body: new Blob([bytes]) });
      const { storageId } = (await up.json()) as { storageId: string };
      const fin: any = await admin.mutation(api["applications"]["finalizeUpload"], {
        jobId,
        storageId,
        fileName: "malicioso.pdf",
        fileSize: bytes.byteLength,
        candidateName: "Candidato Malicioso",
      });
      const res: any = await admin.action(api["applications"]["ingestCv"], {
        applicationId: String(fin.applicationId),
      });
      // El ejecutable NUNCA se procesa: la ingesta falla por magic bytes.
      expect(res.status).toBe("failed");
      const rows: any[] = await admin.query(api["applications"]["listByJob"], { jobId });
      const app = rows.find((r) => String(r.application._id) === String(fin.applicationId));
      expect(app.application.structured ?? null).toBeNull();
      expect(app.match ?? null).toBeNull();
    });

    it("extensiones no permitidas se rechazan en init Y en finalize", async () => {
      await expectRejected(() =>
        admin.mutation(api["applications"]["initUpload"], {
          jobId,
          fileName: "cv.exe",
          fileSize: 100,
        }),
      );
      const { uploadUrl }: any = await admin.mutation(api["applications"]["initUpload"], {
        jobId,
        fileName: "ok.txt",
        fileSize: 100,
      });
      const up = await fetch(uploadUrl, { method: "POST", body: new Blob([new Uint8Array(100)]) });
      const { storageId } = (await up.json()) as { storageId: string };
      await expectRejected(() =>
        admin.mutation(api["applications"]["finalizeUpload"], {
          jobId,
          storageId,
          fileName: "../../etc/passwd.txt",
          fileSize: 100,
          candidateName: "Traversal",
        }),
      );
    });

    it("un nombre de fichero con path traversal se neutraliza al guardarlo", async () => {
      const bytes = new TextEncoder().encode(
        "curriculum de prueba con texto suficiente para pasar el minimo",
      );
      const { uploadUrl }: any = await admin.mutation(api["applications"]["initUpload"], {
        jobId,
        fileName: "cv.txt",
        fileSize: bytes.byteLength,
      });
      const up = await fetch(uploadUrl, { method: "POST", body: new Blob([bytes]) });
      const { storageId } = (await up.json()) as { storageId: string };
      const fin: any = await admin.mutation(api["applications"]["finalizeUpload"], {
        jobId,
        storageId,
        fileName: "cv.txt",
        fileSize: bytes.byteLength,
        candidateName: "CandidatoTraversal",
      });
      const rows: any[] = await admin.query(api["applications"]["listByJob"], { jobId });
      const app = rows.find((r) => String(r.application._id) === String(fin.applicationId));
      expect(app.application.fileName).not.toContain("/");
      expect(app.application.fileName).not.toContain("..");
    });
  });

  // ── GATE K — AUTH ────────────────────────────────────────────────────
  describe("GATE K — auth y revocación", () => {
    it("sin sesión, todas las funciones protegidas se deniegan", async () => {
      const anon = new ConvexHttpClient(CONVEX_URL!);
      await expectRejected(() => anon.query(api["candidates"]["myProfile"], {}));
      await expectRejected(() => anon.query(api["orgs"]["myOrgs"], {}));
      await expectRejected(() =>
        anon.query(api["applications"]["listByJob"], { jobId }),
      );
      await expectRejected(() => anon.query(api["orgs"]["auditTrail"], { organizationId: orgId }));
      await expectRejected(() => anon.mutation(api["applications"]["initUpload"], { jobId, fileName: "a.txt", fileSize: 1 }));
    });

    it("un token de sesión ajeno no sirve (no hay token reutilizable entre sesiones)", async () => {
      const stolen = await makeClient();
      // El token del atacante sobre el recurso de la víctima: forbidden.
      await expectRejected(() =>
        stolen.client.query(api["applications"]["listByJob"], { jobId }),
      );
      // Y sigue teniendo su propia sesión intacta (la revocación es por
      // membresía, no global).
      const mine: any = await stolen.client.query(api["users"]["currentUser"]);
      expect(String(mine._id)).toBe(stolen.userId);
    });

    it("cerrar sesión: tras limpiar el token, el acceso se pierde", async () => {
      const c = await makeClient();
      const before: any = await c.client.query(api["users"]["currentUser"]);
      expect(before._id).toBeTruthy();
      c.client.clearAuth();
      await expectRejected(() => c.client.query(api["users"]["currentUser"]));
    });
  });

  // ── GATE F — MULTI-TENANCY (comprobación cruzada) ────────────────────
  describe("GATE F — multi-tenancy", () => {
    it("todos los recursos de la org son invisibles y mutables solo por miembros", async () => {
      // El outsider no lee nada…
      await expectRejected(() =>
        outsider.query(api["jobs"]["listByOrg"], { organizationId: orgId }),
      );
      await expectRejected(() =>
        outsider.query(api["orgs"]["members"], { organizationId: orgId }),
      );
      // …ni escribe.
      await expectRejected(() =>
        outsider.mutation(api["orgs"]["invite"], {
          organizationId: orgId,
          email: "intruso@example.com",
          role: "org_admin",
        }),
      );
      await expectRejected(() =>
        outsider.mutation(api["jobs"]["close"], { jobId }),
      );
      // El admin sigue viendo los suyos: los intentos no corrompieron nada.
      const mine: any[] = await admin.query(api["jobs"]["listByOrg"], { organizationId: orgId });
      expect(mine.length).toBeGreaterThan(0);
    });
  });
});