/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Convex sin tipar en escenarios de ataque */
/**
 * Tests de INTEGRACIÓN de seguridad contra el deployment Convex real.
 *
 * Estrategia: dos usuarios anónimos reales (A y B) con tokens de sesión
 * válidos (signIn("anonymous") de Convex Auth). A crea recursos propios;
 * B intenta leerlos/modificarlos cambiando IDs (IDOR), forjando args
 * (mass assignment) y accediendo a la organización de A (cross-tenant).
 * Todos los ataques DEBEN fallar o devolver null/NOT_FOUND — nunca datos.
 *
 * Nota de alcance: los flujos que dependen de extracción IA (p. ej.
 * candidateProfiles, que nace en applyExtraction) no se ejercitan aquí para
 * no depender de OPENAI_API_KEY; su enforcement se cubre con tests estáticos
 * (superficie interna) y los tests vivos cubren el resto de la superficie.
 *
 * Si no hay deployment disponible, la suite se marca skip (no falso verde).
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
const anyApi: any = gen.anyApi ?? gen.api;

/** Cliente HTTP con sesión anónima real (tokens emitidos por Convex Auth). */
async function makeClient(): Promise<{ client: ConvexHttpClient; userId: string }> {
  const client = new ConvexHttpClient(CONVEX_URL!);
  // auth.signIn es un ACTION (no mutation) en Convex Auth.
  const res: any = await client.action(anyApi["auth"]["signIn"], {
    provider: "anonymous",
  });
  const sessionToken = res?.tokens?.token;
  if (!sessionToken) throw new Error("No se obtuvo sessionToken del sign-in anónimo");
  client.setAuth(sessionToken);
  const user = await client.query(anyApi["users"]["currentUser"]);
  return { client, userId: String(user._id) };
}

/** Sube un CV real (storage privado) para un cliente y devuelve sus ids. */
async function uploadCv(
  client: ConvexHttpClient,
  name: string,
): Promise<{ resumeId: string; resumeVersionId: string }> {
  const { uploadUrl }: { uploadUrl: string } = await client.mutation(
    anyApi["candidates"]["initUpload"],
    {
      fileName: `${name}.pdf`,
      fileSize: 1024,
      mimeType: "application/pdf",
    },
  );
  const up = await fetch(uploadUrl, {
    method: "POST",
    body: new Blob([new Uint8Array(1024)], { type: "application/pdf" }),
  });
  const { storageId } = (await up.json()) as { storageId: string };
  const fin: any = await client.mutation(anyApi["candidates"]["finalizeUpload"], {
    fileName: `${name}.pdf`,
    fileSize: 1024,
    mimeType: "application/pdf",
    storageId,
  });
  return { resumeId: String(fin.resumeId), resumeVersionId: String(fin.resumeVersionId) };
}

describe.skipIf(!CONVEX_URL)("integración de seguridad (deployment real)", () => {
  let clientA: ConvexHttpClient;
  let clientB: ConvexHttpClient;
  let idA = "";
  let idB = "";

  beforeAll(async () => {
    const a = await makeClient();
    clientA = a.client;
    idA = a.userId;
    const b = await makeClient();
    clientB = b.client;
    idB = b.userId;
    expect(idA).not.toBe(idB);
  });

  afterAll(() => {
    // ConvexHttpClient (v1.30) no expone close(): se descarta la sesión.
    clientA?.clearAuth();
    clientB?.clearAuth();
  });

  // ── AUTENTICACIÓN ────────────────────────────────────────────────────
  describe("autenticación", () => {
    it("sin sesión, myProfile se deniega (UNAUTHENTICATED) y nunca devuelve datos", async () => {
      const anon = new ConvexHttpClient(CONVEX_URL!);
      await expect(anon.query(anyApi["candidates"]["myProfile"])).rejects.toThrow(
        /UNAUTHENTICATED/i,
      );
      anon.clearAuth();
    });

    it("dos sesiones distintas tienen usuarios distintos (tokens no compartidos)", () => {
      expect(idA).not.toBe(idB);
    });
  });

  // ── IDOR CANDIDATO ───────────────────────────────────────────────────
  describe("IDOR entre usuarios candidatos", () => {
    let resumeIdA = "";
    let versionIdA = "";

    beforeAll(async () => {
      const r = await uploadCv(clientA, "cv-audit-A");
      resumeIdA = r.resumeId;
      versionIdA = r.resumeVersionId;
    });

    it("B no puede activar la versión de A (IDOR de escritura)", async () => {
      await expect(
        clientB.mutation(anyApi["candidates"]["setActiveVersion"], {
          resumeVersionId: versionIdA,
        }),
      ).rejects.toThrow();
    });

    it("B no ve las versiones de A en su propio myResumes", async () => {
      const resumes: any[] = await clientB.query(anyApi["candidates"]["myResumes"]);
      expect(resumes).toHaveLength(0);
    });

    it("A sigue viendo exactamente SU recurso tras los ataques (sin corrupción)", async () => {
      const resumes: any[] = await clientA.query(anyApi["candidates"]["myResumes"]);
      expect(resumes).toHaveLength(1);
      expect(String(resumes[0].resume._id)).toBe(resumeIdA);
    });

    it("mass assignment vivo: updateProfile con campos forjados (userId/diagnosis/_id) es rechazado por el validador", async () => {
      await expect(
        clientA.mutation(anyApi["candidates"]["updateProfile"], {
          headline: "Intento legítimo",
          userId: idB,
          diagnosis: { completeness: 100 },
          ...({ _id: "jsmith" } as any),
        } as any),
      ).rejects.toThrow();
    });
  });

  // ── MULTI-TENANCY ORG ────────────────────────────────────────────────
  describe("multi-tenancy entre organizaciones", () => {
    let orgA = "";

    beforeAll(async () => {
      const res: any = await clientA.mutation(anyApi["orgs"]["create"], {
        name: "Org A Security Audit",
      });
      orgA = String(res.organizationId);
    });

    it("B no puede leer los miembros de la org de A", async () => {
      await expect(
        clientB.query(anyApi["orgs"]["members"], { organizationId: orgA }),
      ).rejects.toThrow();
    });

    it("B no puede listar vacantes de la org de A", async () => {
      await expect(
        clientB.query(anyApi["jobs"]["listByOrg"], { organizationId: orgA }),
      ).rejects.toThrow();
    });

    it("B no puede crear vacante en la org de A (mutation cross-tenant)", async () => {
      await expect(
        clientB.mutation(anyApi["jobs"]["create"], {
          organizationId: orgA,
          title: "Puesto intruso",
          description: "B no debería poder crear esto",
          requirements: [
            { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: true },
          ],
        }),
      ).rejects.toThrow();
    });

    it("B no puede decidir sobre una application de la org de A (id forjado)", async () => {
      await expect(
        clientB.mutation(anyApi["applications"]["decide"], {
          applicationId: `${orgA}000000000000000000000000000` as any,
          status: "shortlisted",
        } as any),
      ).rejects.toThrow();
    });

    it("B no puede auto-agregarse como miembro con args forjados", async () => {
      await expect(
        clientB.query(anyApi["orgs"]["members"], {
          organizationId: orgA,
          role: "org_admin",
          userId: idB,
        } as any),
      ).rejects.toThrow(); // validador rechaza args extra (no existe endpoint de alta)
    });
  });

  // ── ESCALADA DE PRIVILEGIOS ──────────────────────────────────────────
  describe("escalada de privilegios via args forjados", () => {
    it("orgs.create ignora/rechaza role y userId forjados", async () => {
      await expect(
        clientB.mutation(anyApi["orgs"]["create"], {
          name: "Evil Corp",
          role: "org_admin",
          userId: idB,
        } as any),
      ).rejects.toThrow(); // validador estricto rechaza args extra
    });

    it("users.role no cambia con args forjados vía currentUser (solo lectura)", async () => {
      const after = await clientB.query(anyApi["users"]["currentUser"]);
      expect(["candidate", null, undefined]).toContain(after?.role ?? null);
    });
  });

  // ── INPUTS EXCESIVAMENTE GRANDES ─────────────────────────────────────
  describe("inputs excesivamente grandes", () => {
    it("jobs.create rechaza título gigante y demasiados requisitos", async () => {
      const res: any = await clientA.mutation(anyApi["orgs"]["create"], {
        name: "Org Limits Audit",
      });
      const orgId = String(res.organizationId);

      await expect(
        clientA.mutation(anyApi["jobs"]["create"], {
          organizationId: orgId,
          title: "T".repeat(5000),
          description: "desc",
          requirements: [
            { type: "skill", label: "x", minLevel: 1, weight: 1, isMustHave: true },
          ],
        }),
      ).rejects.toThrow();

      await expect(
        clientA.mutation(anyApi["jobs"]["create"], {
          organizationId: orgId,
          title: "Puesto normal",
          description: "Descripción normal del puesto para el test",
          requirements: Array.from({ length: 30 }, (_, i) => ({
            type: "skill",
            label: `Skill${i}`,
            minLevel: 1,
            weight: 0.5,
            isMustHave: false,
          })),
        }),
      ).rejects.toThrow();
    });

    it("updateProfile rechaza un resumen excesivamente grande (input rejected)", async () => {
      await expect(
        clientA.mutation(anyApi["candidates"]["updateProfile"], {
          summary: "S".repeat(5000), // límite del handler: 800
        }),
      ).rejects.toThrow();
    });
  });
});
