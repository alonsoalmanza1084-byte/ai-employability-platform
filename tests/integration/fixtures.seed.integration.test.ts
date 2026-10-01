/* eslint-disable @typescript-eslint/no-explicit-any -- fixture de recuperación */
/**
 * BLOCKER B/C — Siembra de datos sintéticos para el drill de backup/restore.
 *
 * Crea un grafo completo y determinista en el deployment:
 *   TENANT_A (org_admin)  ─┬─ job ─ application ─ match ─ note
 *                          ├─ candidate ─ CV en storage real
 *                          ├─ membership
 *                          └─ audit events
 *   TENANT_B (org_admin)  ── gemselos y datos propios para detectar fuga
 *
 * NO contiene PII real ni secretos: nombres, emails y CVs sintéticos.
 * Escribe un manifiesto en /tmp/tf/manifest.json (fuera del repo) con los IDs
 * created, para que el verificador de restore pueda compararlos tras importar.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

export const MANIFEST_PATH = "/tmp/tf/manifest.json";

async function makeClient(): Promise<{
  client: ConvexHttpClient;
  userId: string;
  token: string;
}> {
  const client = new ConvexHttpClient(CONVEX_URL!);
  const res: any = await client.action(api["auth"]["signIn"], { provider: "anonymous" });
  const token = res?.tokens?.token;
  if (!token) throw new Error("No sessionToken");
  client.setAuth(token);
  const user: any = await client.query(api["users"]["currentUser"]);
  return { client, userId: String(user._id), token };
}

const REQS = [
  { type: "skill", label: "Python", minLevel: 3, weight: 0.5, isMustHave: false },
  { type: "experience_years", label: "Experiencia", minYears: 2, weight: 0.5, isMustHave: false },
];

const CV_A = `Carla Recuperacion
Analista de Datos
Empresa Delta (2019-2023): reportes con Python y SQL.
Habilidades: Python, SQL.
3 años de experiencia en análisis de datos.`;

const CV_B = `Bruno Recuperacion
Vendedor
Empresa Epsilon (2022-2024): atención al cliente.
Habilidades: ventas.`;

/** Sube un TXT real al storage privado y devuelve el resumeVersionId. */
async function uploadCandidateCv(
  client: ConvexHttpClient,
  name: string,
  cv: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(cv);
  const { uploadUrl }: any = await client.mutation(api["candidates"]["initUpload"], {
    fileName: `${name}.txt`,
    fileSize: bytes.byteLength,
    mimeType: "text/plain",
  });
  const up = await fetch(uploadUrl, {
    method: "POST",
    body: new Blob([bytes], { type: "text/plain" }),
  });
  const { storageId } = (await up.json()) as { storageId: string };
  const fin: any = await client.mutation(api["candidates"]["finalizeUpload"], {
    fileName: `${name}.txt`,
    fileSize: bytes.byteLength,
    mimeType: "text/plain",
    storageId,
  });
  return String(fin.resumeVersionId);
}

/** Sube un CV a una vacante (lado empresa) y devuelve el applicationId. */
async function uploadApplicationCv(
  client: ConvexHttpClient,
  jobId: string,
  name: string,
  cv: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(cv);
  const { uploadUrl }: any = await client.mutation(api["applications"]["initUpload"], {
    jobId,
    fileName: `${name}.txt`,
    fileSize: bytes.byteLength,
  });
  const up = await fetch(uploadUrl, {
    method: "POST",
    body: new Blob([bytes], { type: "text/plain" }),
  });
  const { storageId } = (await up.json()) as { storageId: string };
  const fin: any = await client.mutation(api["applications"]["finalizeUpload"], {
    jobId,
    storageId,
    fileName: `${name}.txt`,
    fileSize: bytes.byteLength,
    candidateName: name,
  });
  return String(fin.applicationId);
}

describe.skipIf(!CONVEX_URL)("SIEMBRA — dataset sintético para backup/restore", () => {
  it("crea TENANT_A y TENANT_B con grafo completo y escribe el manifiesto", async () => {
    const stamp = Date.now();
    const a = await makeClient();
    const b = await makeClient();

    const orgA: any = await a.client.mutation(api["orgs"]["create"], { name: `Tenant A ${stamp}` });
    const orgB: any = await b.client.mutation(api["orgs"]["create"], { name: `Tenant B ${stamp}` });

    const jobA: any = await a.client.mutation(api["jobs"]["create"], {
      organizationId: String(orgA.organizationId),
      title: "Analista de Datos",
      description: "Vacante del tenant A para el drill de recuperación",
      requirements: REQS,
    });
    const jobB: any = await b.client.mutation(api["jobs"]["create"], {
      organizationId: String(orgB.organizationId),
      title: "Vendedor",
      description: "Vacante del tenant B para el drill de recuperación",
      requirements: [{ type: "skill", label: "ventas", minLevel: 2, weight: 1, isMustHave: false }],
    });

    const applicationA = await uploadApplicationCv(
      a.client,
      String(jobA.jobId),
      "Carla Recuperacion",
      CV_A,
    );
    await uploadApplicationCv(b.client, String(jobB.jobId), "Bruno Recuperacion", CV_B);

    const note: any = await a.client.mutation(api["applications"]["addNote"], {
      applicationId: applicationA,
      body: "Nota sintética del tenant A para verificar integridad tras restore",
    });
    await a.client.mutation(api["applications"]["decide"], {
      applicationId: applicationA,
      status: "shortlisted",
    });
    const invite: any = await a.client.mutation(api["orgs"]["invite"], {
      organizationId: String(orgA.organizationId),
      email: `recruiter.${stamp}@example.test`,
      role: "recruiter",
    });
    const resumeVersionA = await uploadCandidateCv(a.client, "Carla Recuperacion", CV_A);

    const auditA: any[] = await a.client.query(api["orgs"]["auditTrail"], {
      organizationId: String(orgA.organizationId),
    });

    // Eventos de seguridad sintéticos: la tabla `securityEvents` es la tabla
    // SACRIFICIAL del drill de restore (perderla no degrada el producto: es un
    // log append-only de auditoría de seguridad).
    for (let i = 0; i < 4; i++) {
      try {
        await a.client.mutation(api["candidates"]["initUpload"], {
          fileName: `sintetico${i}.exe`,
          fileSize: 128,
          mimeType: "application/octet-stream",
        });
      } catch (e) {
        // Rechazo esperado: el evento queda registrado en securityEvents.
        console.log("SEED_SEC_EVENT " + String((e as any)?.message ?? e).slice(0, 160));
      }
    }
    try {
      await a.client.mutation(api["candidates"]["initUpload"], {
        fileName: "enorme.pdf",
        fileSize: 50 * 1024 * 1024,
        mimeType: "application/pdf",
      });
    } catch (e) {
      console.log("SEED_SEC_EVENT " + String((e as any)?.message ?? e).slice(0, 160));
    }

    const manifest = {
      stamp,
      createdAt: new Date().toISOString(),
      tenants: {
        A: {
          orgId: String(orgA.organizationId),
          orgName: `Tenant A ${stamp}`,
          adminUserId: a.userId,
          adminToken: a.token,
          jobId: String(jobA.jobId),
          applicationId: applicationA,
          noteId: String(note.noteId),
          inviteEmail: `recruiter.${stamp}@example.test`,
          inviteToken: invite?.token ?? null,
          resumeVersionId: resumeVersionA,
          auditEventCount: auditA.length,
        },
        B: {
          orgId: String(orgB.organizationId),
          orgName: `Tenant B ${stamp}`,
          adminUserId: b.userId,
          adminToken: b.token,
          jobId: String(jobB.jobId),
        },
      },
    };
    mkdirSync("/tmp/tf", { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log("SEED_MANIFEST " + MANIFEST_PATH + " " + JSON.stringify({
      orgA: manifest.tenants.A.orgId,
      orgB: manifest.tenants.B.orgId,
      applicationA,
      auditA: auditA.length,
    }));

    expect(manifest.tenants.A.orgId).not.toBe(manifest.tenants.B.orgId);
    expect(applicationA).toBeTruthy();
    expect(auditA.length).toBeGreaterThan(0);
  }, 300_000);
});