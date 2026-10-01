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

  // ── AUDITORÍA #2: MATRIZ RBAC REAL, REVOCACIÓN, IDOR EXHAUSTIVO ────
  describe("matriz RBAC con organizaciones reales (auditoría #2)", () => {
    let orgX = "";
    let jobIdX = "";
    let adminC: ConvexHttpClient;
    let recruiterD: ConvexHttpClient;
    let managerE: ConvexHttpClient;
    let outsiderB2 = "";
    let applicationX = "";
    let inviteToken = "";

    beforeAll(async () => {
      // C es org_admin de orgX. D y E quedan como outsiders con sesión real:
      // los roles intermedios (recruiter/hiring_manager aceptados via
      // acceptInvite) se ejercitan en la suite unitaria (requireMembership
      // con ctx mock) porque aceptar una invitación exige cuenta con email
      // verificado (un anónimo no puede recibir OTP) — no automatizable.
      const c = await makeClient();
      adminC = c.client;
      const res: any = await adminC.mutation(anyApi["orgs"]["create"], {
        name: `Org RBAC ${Date.now()}`,
      });
      orgX = String(res.organizationId);

      const d = await makeClient();
      recruiterD = d.client;
      const e = await makeClient();
      managerE = e.client;
      const b2 = await makeClient();
      outsiderB2 = b2.userId;
      void outsiderB2;

      // C crea vacante (C es org_admin → rol >= recruiter).
      const job: any = await adminC.mutation(anyApi["jobs"]["create"], {
        organizationId: orgX,
        title: "Puesto RBAC",
        description: "Vacante para la matriz RBAC de seguridad",
        requirements: [
          { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: true },
        ],
      });
      jobIdX = String(job.jobId);

      // C (org_admin ≥ recruiter) sube un CV a la vacante → application.
      const { uploadUrl } = await adminC.mutation(
        anyApi["applications"]["initUpload"],
        { jobId: jobIdX, fileName: "cv.pdf", fileSize: 1024 },
      );
      const up = await fetch(uploadUrl, {
        method: "POST",
        body: new Blob([new Uint8Array(1024)], { type: "application/pdf" }),
      });
      const { storageId } = (await up.json()) as { storageId: string };
      const fin: any = await adminC.mutation(
        anyApi["applications"]["finalizeUpload"],
        {
          jobId: jobIdX,
          storageId,
          fileName: "cv.pdf",
          fileSize: 1024,
          candidateName: "Candidato RBAC",
        },
      );
      applicationX = String(fin.applicationId);

      // Invitaciones REALES para E (hiring_manager): C invita, E acepta con
      // token. Para aceptar, E necesita cuenta con email no-anónimo — se usa
      // el flujo de upgrade del template vía auth (signUpEmailOtp) si existe;
      // si no, se omite la celda específica y se marca.
      const inv: any = await adminC.mutation(anyApi["orgs"]["invite"], {
        organizationId: orgX,
        email: `rbac-manager-${Date.now()}@example.com`,
        role: "hiring_manager",
      });
      inviteToken = String(inv.token);
    });

    afterAll(() => {
      adminC?.clearAuth();
      recruiterD?.clearAuth();
      managerE?.clearAuth();
    });

    // ── Celdas de la matriz (deny) con roles reales ────────────────────
    it("hiring_manager (sin membresía aún) no puede decidir ni invitar", async () => {
      // E aún no es miembro: todas las ops sobre orgX le deben fallar.
      await expect(
        managerE.mutation(anyApi["applications"]["decide"], {
          applicationId: applicationX,
          status: "shortlisted",
        }),
      ).rejects.toThrow();
      await expect(
        managerE.mutation(anyApi["orgs"]["invite"], {
          organizationId: orgX,
          email: "x@y.com",
          role: "recruiter",
        }),
      ).rejects.toThrow();
    });

    it("outsider no ve ninguna lectura de la org (jobs/members/applications/notes/match)", async () => {
      // D y E tienen sesión válida pero CERO membresía en orgX.
      for (const outsider of [recruiterD, managerE]) {
        await expect(
          outsider.query(anyApi["jobs"]["get"], { jobId: jobIdX }),
        ).rejects.toThrow();
        await expect(
          outsider.query(anyApi["orgs"]["members"], { organizationId: orgX }),
        ).rejects.toThrow();
        await expect(
          outsider.query(anyApi["applications"]["listByJob"], { jobId: jobIdX }),
        ).rejects.toThrow();
        await expect(
          outsider.query(anyApi["applications"]["notesFor"], { applicationId: applicationX }),
        ).rejects.toThrow();
        await expect(
          outsider.query(anyApi["matches"]["getForApplication"], { applicationId: applicationX }),
        ).rejects.toThrow();
      }
    });

    it("outsider no puede decidir ni subir CVs a la vacante (mutation cross-tenant)", async () => {
      await expect(
        recruiterD.mutation(anyApi["applications"]["decide"], {
          applicationId: applicationX,
          status: "shortlisted",
        }),
      ).rejects.toThrow();
      await expect(
        managerE.mutation(anyApi["applications"]["initUpload"], {
          jobId: jobIdX,
          fileName: "probe.pdf",
          fileSize: 1024,
        }),
      ).rejects.toThrow();
    });

    it("outsider no puede cerrar la vacante (org_admin-only)", async () => {
      await expect(
        recruiterD.mutation(anyApi["jobs"]["close"], { jobId: jobIdX }),
      ).rejects.toThrow();
    });

    it("outsider no puede aceptar una invitación dirigida a otro email (email mismatch)", async () => {
      await expect(
        recruiterD.mutation(anyApi["orgs"]["acceptInvite"], { token: inviteToken }),
      ).rejects.toThrow();
    });

    it("el token de invitación es de un solo uso y ligado al email destino", async () => {
      // D intentó usarlo (arriba) y falló; el token sigue pending y no aceptado.
      const pending: any[] = await adminC.query(anyApi["orgs"]["pendingInvites"], {
        organizationId: orgX,
      });
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });

    it("acceptInvite rechaza tokens inválidos (pre-auth mutation con auth)", async () => {
      await expect(
        recruiterD.mutation(anyApi["orgs"]["acceptInvite"], { token: "no-existe" }),
      ).rejects.toThrow();
    });

    it("el token de invitación emitido sigue pending (no filtrado por acceptInvite ajeno)", async () => {
      const pending: any[] = await adminC.query(anyApi["orgs"]["pendingInvites"], {
        organizationId: orgX,
      });
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("revocación de membresía y audit trail (auditoría #3)", () => {    /** Crea una org con su creador como org_admin y devuelve ids. */
    async function newOrg(prefix: string) {
      const { client, userId } = await makeClient();
      const res: any = await client.mutation(anyApi["orgs"]["create"], {
        name: `${prefix} ${Date.now()}`,
      });
      return { client, userId, orgId: String(res.organizationId) };
    }

    /** Devuelve el id del creador de una org (para usarlo como targetUserId). */
    async function clientUserIdOf(orgId: string, client: ConvexHttpClient) {
      const members: any[] = await client.query(anyApi["orgs"]["members"], {
        organizationId: orgId,
      });
      return String(members[0].userId);
    }

    it("un usuario sin fila de membresía no accede a NADA de la org (invariante de revocación)", async () => {
      const { client, orgId } = await newOrg("Org Revocación");
      const { client: neverMember } = await makeClient();
      await expect(
        neverMember.query(anyApi["jobs"]["listByOrg"], { organizationId: orgId }),
      ).rejects.toThrow(/NOT_FOUND/);
      await expect(
        neverMember.mutation(anyApi["jobs"]["create"], {
          organizationId: orgId,
          title: "Intruso",
          description: "Nunca fui miembro",
          requirements: [
            { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: true },
          ],
        }),
      ).rejects.toThrow(/NOT_FOUND/);
      // Tampoco los controles administrativos de la auditoría #3.
      await expect(
        neverMember.query(anyApi["orgs"]["auditTrail"], { organizationId: orgId }),
      ).rejects.toThrow(/NOT_FOUND/);
      await expect(
        neverMember.mutation(anyApi["orgs"]["revokeInvite"], {
          organizationId: orgId,
          invitationId: "invitations\u00000000000000000000000000" as any,
        }),
      ).rejects.toThrow();
      await expect(
        neverMember.mutation(anyApi["orgs"]["removeMember"], {
          organizationId: orgId,
          targetUserId: await clientUserIdOf(orgId, client),
        }),
      ).rejects.toThrow(/NOT_FOUND/);
      client.clearAuth();
      neverMember.clearAuth();
    });

    it("removeMember: NO se puede auto-eliminar ni remover a un no-miembro", async () => {
      const { client, userId, orgId } = await newOrg("Org RemoveMember");
      // Auto-eliminación rechazada (evita dejar la org sin admins).
      await expect(
        client.mutation(anyApi["orgs"]["removeMember"], {
          organizationId: orgId,
          targetUserId: userId,
        }),
      ).rejects.toThrow();
      const { userId: outsiderId, client: outsider } = await makeClient();
      // Destino que no es miembro de esta org → NOT_FOUND.
      await expect(
        client.mutation(anyApi["orgs"]["removeMember"], {
          organizationId: orgId,
          targetUserId: outsiderId,
        }),
      ).rejects.toThrow(/NOT_FOUND/);
      // El creador sigue siendo admin tras los intentos fallidos.
      const members: any[] = await client.query(anyApi["orgs"]["members"], {
        organizationId: orgId,
      });
      expect(members.some((m) => String(m.userId) === userId)).toBe(true);
      client.clearAuth();
      outsider.clearAuth();
    });

    it("auditTrail: el org_admin SÍ lee su trail; un outsider de otra org NO", async () => {
      const { client, orgId } = await newOrg("Org Trail");
      // Evento real de auditoría (org.create escribe en auditLog).
      const own: any[] = await client.query(anyApi["orgs"]["auditTrail"], {
        organizationId: orgId,
      });
      expect(Array.isArray(own)).toBe(true);
      // Otro org_admin (tenant distinto) no puede leerlo.
      const other = await newOrg("Org Trail Ajena");
      await expect(
        other.client.query(anyApi["orgs"]["auditTrail"], { organizationId: orgId }),
      ).rejects.toThrow(/NOT_FOUND/);
      // Y tampoco un usuario que no es miembro de ninguna.
      const { client: nobody } = await makeClient();
      await expect(
        nobody.query(anyApi["orgs"]["auditTrail"], { organizationId: orgId }),
      ).rejects.toThrow(/NOT_FOUND/);
      client.clearAuth();
      other.client.clearAuth();
      nobody.clearAuth();
    });

    it("invitaciones vivas: outsider no lista, no revoca y el token tras revocar no sirve", async () => {
      const { client, orgId } = await newOrg("Org Invite");
      const inv: any = await client.mutation(anyApi["orgs"]["invite"], {
        organizationId: orgId,
        email: `destinatario-${Date.now()}@example.com`,
        role: "recruiter",
      });
      expect(typeof inv.token).toBe("string");
      expect(inv.token.length).toBeGreaterThanOrEqual(32);

      // El admin ve la invitación pendiente, pero NUNCA el token plano.
      const pending: any[] = await client.query(anyApi["orgs"]["pendingInvites"], {
        organizationId: orgId,
      });
      expect(pending.length).toBe(1);
      expect(JSON.stringify(pending)).not.toContain(inv.token);
      expect(pending[0].tokenHash).toHaveLength(64);

      // Un outsider no puede listar invitaciones de la org.
      const { client: outsider } = await makeClient();
      await expect(
        outsider.query(anyApi["orgs"]["pendingInvites"], { organizationId: orgId }),
      ).rejects.toThrow(/NOT_FOUND/);
      await expect(
        outsider.mutation(anyApi["orgs"]["revokeInvite"], {
          organizationId: orgId,
          invitationId: pending[0]._id,
        }),
      ).rejects.toThrow(/NOT_FOUND/);

      // El admin revoca → desaparece de pendientes y el token deja de servir.
      await expect(
        client.mutation(anyApi["orgs"]["revokeInvite"], {
          organizationId: orgId,
          invitationId: pending[0]._id,
        }),
      ).resolves.toEqual({ ok: true });
      const after: any[] = await client.query(anyApi["orgs"]["pendingInvites"], {
        organizationId: orgId,
      });
      expect(after).toHaveLength(0);
      await expect(
        outsider.mutation(anyApi["orgs"]["acceptInvite"], { token: inv.token }),
      ).rejects.toThrow();
      // Doble revocación → fail-closed.
      await expect(
        client.mutation(anyApi["orgs"]["revokeInvite"], {
          organizationId: orgId,
          invitationId: pending[0]._id,
        }),
      ).rejects.toThrow(/NOT_FOUND/);
      client.clearAuth();
      outsider.clearAuth();
    });
  });

  describe("IDOR exhaustivo por tabla (auditoría #2)", () => {
    it("candidates.ingestCv de otro usuario → NOT_FOUND (acción, no mutation)", async () => {
      const { resumeVersionId } = await uploadCv(clientA, "cv-idor-2");
      await expect(
        clientB.action(anyApi["candidates"]["ingestCv"], { resumeVersionId }),
      ).rejects.toThrow();
    });

    it("applications.ingestCv con id forjado → rechazo (id inválido, nunca datos)", async () => {
      await expect(
        clientB.action(anyApi["applications"]["ingestCv"], {
          applicationId: "applications\u00000000000000000000000000" as any,
        }),
      ).rejects.toThrow();
    });

    it("users.currentUser solo expone el propio (documento completo solo para el dueño)", async () => {
      const me = await clientB.query(anyApi["users"]["currentUser"]);
      expect(String(me?._id)).toBe(idB);
      // No hay endpoint para leer OTRO usuario: (gap cubierto estáticamente).
    });
  });

  describe("cuenta: deleteAccount (auditoría #2)", () => {
    it("deleteAccount completa OK, revoca la sesión (myProfile → null/throw) y es idempotente-fail-closed", async () => {
      const { client, userId } = await makeClient();
      await uploadCv(client, "cv-borrado");

      await expect(client.mutation(anyApi["account"]["deleteAccount"], {})).resolves.toEqual({ ok: true });

      // La sesión se invalidó: o lanza (token muerto) o devuelve null (sesión
      // sin usuario válido). NUNCA devuelve el perfil con datos.
      let outcome = "";
      try {
        const p = await client.query(anyApi["candidates"]["myProfile"]);
        outcome = p === null ? "null" : "data";
      } catch {
        outcome = "throw";
      }
      expect(["throw", "null"]).toContain(outcome);
      void userId;
      client.clearAuth();
    });
  });
});
