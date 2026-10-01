/* eslint-disable @typescript-eslint/no-explicit-any -- fixture RBAC */
/**
 * BLOCKER D (fase 1) — Crear las identidades sintéticas de la matriz RBAC.
 *
 * Convex Auth exige email verificado para `acceptInvite`, así que un usuario
 * anónimo no puede completar el flujo de invitación en CI. Para poder probar la
 * matriz END-TO-END (no con mocks), esta fase crea las sesiones reales y una
 * organización, y escribe un manifiesto con los `userId` y `token`.
 *
 * Las MEMBRESÍAS no se crean aquí: se siembran por importación de datos
 * (`scripts/rbac_seed_memberships.sh`), que es el mismo mecanismo que usa un
 * restore. No se añade NINGÚN endpoint ni bypass al código de producción.
 *
 * El manifiesto vive en /tmp (fuera del repo): contiene tokens de sesión.
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

export const RBAC_MANIFEST_PATH = "/tmp/tf/rbac-manifest.json";

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

describe.skipIf(!CONVEX_URL)("RBAC E2E (fase 1) — siembra de identidades", () => {
  it("crea org_admin, recruiter, hiring_manager, candidate y outsider", async () => {
    const stamp = Date.now();

    // org_admin: el creador de la organización queda como org_admin.
    const admin = await makeClient();
    const org: any = await admin.client.mutation(api["orgs"]["create"], {
      name: `RBAC Matrix ${stamp}`,
    });
    const orgId = String(org.organizationId);

    const recruiter = await makeClient();
    const manager = await makeClient();
    const candidate = await makeClient();
    const outsider = await makeClient();

    const job: any = await admin.client.mutation(api["jobs"]["create"], {
      organizationId: orgId,
      title: "Vacante para la matriz RBAC",
      description: "Vacante creada para verificar la matriz RBAC end-to-end",
      requirements: [
        { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
      ],
    });

    // Un segundo candidato con CV, para probar que `candidate` no ve nada de la org.
    const cv = new TextEncoder().encode(
      "Carla Matriz\nAnalista de Datos\nHabilidades: Python, SQL.\n4 años de experiencia.",
    );
    const { uploadUrl }: any = await candidate.client.mutation(
      api["candidates"]["initUpload"],
      { fileName: "matriz.txt", fileSize: cv.byteLength, mimeType: "text/plain" },
    );
    const up = await fetch(uploadUrl, {
      method: "POST",
      body: new Blob([cv], { type: "text/plain" }),
    });
    const { storageId } = (await up.json()) as { storageId: string };
    const fin: any = await candidate.client.mutation(api["candidates"]["finalizeUpload"], {
      fileName: "matriz.txt",
      fileSize: cv.byteLength,
      mimeType: "text/plain",
      storageId,
    });

    // CV de la empresa (para probar decide/note por rol).
    const acv = new TextEncoder().encode(
      "Carla Aplicante\nAnalista de Datos\nHabilidades: Python.\n5 años de experiencia.",
    );
    const orgUp: any = await admin.client.mutation(api["applications"]["initUpload"], {
      jobId: String(job.jobId),
      fileName: "aplicante.txt",
      fileSize: acv.byteLength,
    });
    const orgUpRes = await fetch(orgUp.uploadUrl, {
      method: "POST",
      body: new Blob([acv], { type: "text/plain" }),
    });
    const orgStorage = (await orgUpRes.json()) as { storageId: string };
    const orgFin: any = await admin.client.mutation(api["applications"]["finalizeUpload"], {
      jobId: String(job.jobId),
      storageId: orgStorage.storageId,
      fileName: "aplicante.txt",
      fileSize: acv.byteLength,
      candidateName: "Carla Aplicante",
    });

    const manifest = {
      stamp,
      orgId,
      jobId: String(job.jobId),
      applicationId: String(orgFin.applicationId),
      candidateResumeVersionId: String(fin.resumeVersionId),
      actors: {
        org_admin: { userId: admin.userId, token: admin.token },
        recruiter: { userId: recruiter.userId, token: recruiter.token },
        hiring_manager: { userId: manager.userId, token: manager.token },
        candidate: { userId: candidate.userId, token: candidate.token },
        outsider: { userId: outsider.userId, token: outsider.token },
      },
    };
    mkdirSync("/tmp/tf", { recursive: true });
    writeFileSync(RBAC_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(
      "RBAC_SEED " +
        JSON.stringify({
          orgId,
          jobId: manifest.jobId,
          users: Object.fromEntries(
            Object.entries(manifest.actors).map(([k, v]: any) => [k, v.userId]),
          ),
        }),
    );

    // El outsider NO debe tener membresía todavía (se verifica en la matriz).
    const membersBefore: any[] = await admin.client.query(api["orgs"]["members"], {
      organizationId: orgId,
    });
    expect(membersBefore.length).toBe(1);
    expect(String(membersBefore[0].userId)).toBe(admin.userId);
  }, 300_000);
});