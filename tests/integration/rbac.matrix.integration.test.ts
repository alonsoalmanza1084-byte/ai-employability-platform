/* eslint-disable @typescript-eslint/no-explicit-any -- matriz RBAC E2E */
/**
 * BLOCKER D — MATRIZ RBAC END-TO-END con sesiones y roles REALES.
 *
 * A diferencia de `invitations.security.test.ts` (que usa ctx mock), aquí cada
 * celda se ejecuta contra el deployment con:
 *   - sesiones reales emitidas por Convex Auth,
 *   - membresías reales en `organizationMembers`,
 *   - `requireMembership` real (sin mocks, sin stubs, sin monkey-patching).
 *
 * Precondición: `tests/integration/rbac.seed.integration.test.ts` +
 * `scripts/rbac_seed_memberships.sh` (siembra de membresías por import de datos,
 * porque `acceptInvite` exige email verificado y no es automatizable).
 *
 * Para cada celda se registra ATACQUE → RESULTADO ESPERADO → ASERCIÓN.
 * `allow()` exige que la operación funcione; `deny()` exige que NO funcione y
 * que además no devuelva datos.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
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
const MANIFEST = process.env.RBAC_MANIFEST ?? "/tmp/tf/rbac-manifest.json";
const gen: any = await import("../../src/convex/_generated/api");
const api: any = gen.anyApi ?? gen.api;

type Actor = "org_admin" | "recruiter" | "hiring_manager" | "candidate" | "outsider";

interface Manifest {
  orgId: string;
  jobId: string;
  applicationId: string;
  candidateResumeVersionId: string;
  actors: Record<Actor, { userId: string; token: string }>;
}

const clients = {} as Record<Actor, ConvexHttpClient>;
let M: Manifest;

function clientFor(actor: Actor): ConvexHttpClient {
  return clients[actor];
}

/** Ejecuta `fn` y devuelve true si la operación fue PERMITIDA con datos. */
async function allow(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const v = await fn();
    const empty =
      v === null ||
      v === undefined ||
      (Array.isArray(v) && v.length === 0);
    return !empty;
  } catch {
    return false;
  }
}

/** Ejecuta `fn` y exige que sea denegada (o vacía). Nunca acepta datos. */
async function deny(fn: () => Promise<unknown>): Promise<string> {
  try {
    const v = await fn();
    const empty =
      v === null ||
      v === undefined ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
    expect(
      empty,
      "la operación denegada devolvió datos: " +
        (typeof v === "object" ? JSON.stringify(v).slice(0, 160) : String(v)),
    ).toBe(true);
    return "empty";
  } catch {
    return "denied";
  }
}

const READY = existsSync(MANIFEST) && !!CONVEX_URL;

describe.skipIf(!READY)("BLOQUE D — matriz RBAC end-to-end (sesiones reales)", () => {
  beforeAll(() => {
    M = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
    for (const actor of Object.keys(M.actors) as Actor[]) {
      const c = new ConvexHttpClient(CONVEX_URL!);
      c.setAuth(M.actors[actor].token);
      clients[actor] = c;
    }
  });

  // ── CONFIGURACIÓN (precondición verificada, no asumida) ────────────────
  it("precondición: org_admin, recruiter y hiring_manager tienen membresía real", async () => {
    const members: any[] = await clientFor("org_admin").query(api["orgs"]["members"], {
      organizationId: M.orgId,
    });
    const byUser = new Map(members.map((m) => [String(m.userId), m.role]));
    expect(byUser.get(M.actors.org_admin.userId)).toBe("org_admin");
    expect(byUser.get(M.actors.recruiter.userId)).toBe("recruiter");
    expect(byUser.get(M.actors.hiring_manager.userId)).toBe("hiring_manager");
    expect(byUser.has(M.actors.candidate.userId)).toBe(false);
    expect(byUser.has(M.actors.outsider.userId)).toBe(false);
  });

  // ── FILA: Ver organización ────────────────────────────────────────────
  it("ver org: los 3 roles de la org ven SU organización; candidate/outsider no", async () => {
    for (const a of ["org_admin", "recruiter", "hiring_manager"] as Actor[]) {
      const orgs: any[] = await clientFor(a).query(api["orgs"]["myOrgs"], {});
      expect(orgs.map((o) => String(o._id)), `${a} no ve su propia org`).toContain(M.orgId);
    }
    for (const a of ["candidate", "outsider"] as Actor[]) {
      const orgs: any[] = await clientFor(a).query(api["orgs"]["myOrgs"], {});
      expect(orgs.map((o) => String(o._id)), `${a} ve una org que no es suya`).not.toContain(
        M.orgId,
      );
      await deny(() =>
        clientFor(a).query(api["jobs"]["get"], { jobId: M.jobId }),
      );
    }
    // Un miembro sí puede leer el detalle de una vacante de SU org.
    expect(await allow(() => clientFor("recruiter").query(api["jobs"]["get"], { jobId: M.jobId }))).toBe(
      true,
    );
  });

  // ── FILA: Ver miembros (política real: `requireMembership(hiring_manager)`) ──
  it("ver miembros: los 3 roles de la org sí (política hiring_manager+); fuera, no", async () => {
    const q = (a: Actor) => () =>
      clientFor(a).query(api["orgs"]["members"], { organizationId: M.orgId });
    for (const a of ["org_admin", "recruiter", "hiring_manager"] as Actor[]) {
      expect(await allow(q(a)), `${a} no puede ver los miembros de su org`).toBe(true);
    }
    await deny(q("candidate"));
    await deny(q("outsider"));
  });

  // ── FILA: Crear vacante ──────────────────────────────────────────────
  it("crear vacante: org_admin y recruiter sí; hiring_manager/candidate/outsider no", async () => {
    const c = (a: Actor) => () =>
      clientFor(a).mutation(api["jobs"]["create"], {
        organizationId: M.orgId,
        title: `Vacante de ${a}`,
        description: "Intento de creación de vacante para verificar la matriz RBAC",
        requirements: [
          { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
        ],
      });
    expect(await allow(c("org_admin")), "org_admin no puede crear vacantes").toBe(true);
    expect(await allow(c("recruiter")), "recruiter no puede crear vacantes").toBe(true);
    await deny(c("hiring_manager"));
    await deny(c("candidate"));
    await deny(c("outsider"));
  });

  // ── FILA: Cerrar vacante (org_admin) ─────────────────────────────────
  it("cerrar vacante: solo org_admin", async () => {
    const created: any = await clientFor("org_admin").mutation(api["jobs"]["create"], {
      organizationId: M.orgId,
      title: "Vacante a cerrar",
      description: "Vacante creada para probar el cierre por rol",
      requirements: [
        { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
      ],
    });
    const close = (a: Actor) => () =>
      clientFor(a).mutation(api["jobs"]["close"], { jobId: String(created.jobId) });
    expect(await allow(close("org_admin"))).toBe(true);
    const c2: any = await clientFor("org_admin").mutation(api["jobs"]["create"], {
      organizationId: M.orgId,
      title: "Segunda vacante a cerrar",
      description: "Segunda vacante creada para probar el cierre por rol",
      requirements: [
        { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
      ],
    });
    const close2 = (a: Actor) => () =>
      clientFor(a).mutation(api["jobs"]["close"], { jobId: String(c2.jobId) });
    await deny(close2("recruiter"));
    await deny(close2("hiring_manager"));
    await deny(close2("outsider"));
  });

  // ── FILA: Ver vacantes ───────────────────────────────────────────────
  it("ver vacantes: los 3 roles de la org sí; los demás no", async () => {
    const q = (a: Actor) => () =>
      clientFor(a).query(api["jobs"]["listByOrg"], { organizationId: M.orgId });
    for (const a of ["org_admin", "recruiter", "hiring_manager"] as Actor[]) {
      expect(await allow(q(a)), `${a} no ve las vacantes de su org`).toBe(true);
    }
    await deny(q("candidate"));
    await deny(q("outsider"));
  });

  // ── FILA: Subir CV de candidato ──────────────────────────────────────
  it("subir CV a la vacante: org_admin y recruiter sí; hiring_manager no", async () => {
    const bytes = new TextEncoder().encode(
      "Carla Matriz\nAnalista de Datos\nHabilidades: Python.\n5 años de experiencia.",
    );
    const up = async (a: Actor) => {
      const { uploadUrl }: any = await clientFor(a).mutation(
        api["applications"]["initUpload"],
        { jobId: M.jobId, fileName: "rbac.txt", fileSize: bytes.byteLength },
      );
      const r = await fetch(uploadUrl, {
        method: "POST",
        body: new Blob([bytes], { type: "text/plain" }),
      });
      const { storageId } = (await r.json()) as { storageId: string };
      return clientFor(a).mutation(api["applications"]["finalizeUpload"], {
        jobId: M.jobId,
        storageId,
        fileName: "rbac.txt",
        fileSize: bytes.byteLength,
        candidateName: "Carla Rbac",
      });
    };
    expect(await allow(() => up("recruiter")), "recruiter no puede subir CVs").toBe(true);
    expect(await allow(() => up("org_admin")), "org_admin no puede subir CVs").toBe(true);
    await deny(() => up("hiring_manager"));
    await deny(() => up("candidate"));
    await deny(() => up("outsider"));
  });

  // ── FILA: Ver applicants / application / match ────────────────────────
  it("ver applicants: los 3 roles de la org sí; candidate/outsider no", async () => {
    const q = (a: Actor) => () =>
      clientFor(a).query(api["applications"]["listByJob"], { jobId: M.jobId });
    for (const a of ["org_admin", "recruiter", "hiring_manager"] as Actor[]) {
      expect(await allow(q(a)), `${a} no ve los applicants`).toBe(true);
    }
    await deny(q("candidate"));
    await deny(q("outsider"));
  });

  it("candidate NO puede ver su propia application desde el lado empresa", async () => {
    await deny(() =>
      clientFor("candidate").query(api["matches"]["getForApplication"], {
        applicationId: M.applicationId,
      }),
    );
    await deny(() =>
      clientFor("candidate").query(api["applications"]["notesFor"], {
        applicationId: M.applicationId,
      }),
    );
  });

  // ── FILA: Añadir nota (hiring_manager sí) ─────────────────────────────
  it("añadir nota: los 3 roles de la org sí; candidate/outsider no", async () => {
    const n = (a: Actor) => () =>
      clientFor(a).mutation(api["applications"]["addNote"], {
        applicationId: M.applicationId,
        body: `Nota sintética creada por ${a} en la matriz RBAC`,
      });
    expect(await allow(n("hiring_manager")), "hiring_manager no puede añadir notas").toBe(true);
    expect(await allow(n("recruiter"))).toBe(true);
    expect(await allow(n("org_admin"))).toBe(true);
    await deny(n("candidate"));
    await deny(n("outsider"));
  });

  // ── FILA: Decidir / shortlist / reject (recruiter sí) ─────────────────
  it("decidir (shortlist): org_admin y recruiter sí; hiring_manager NO (decisión es humana y de niveles superiores)", async () => {
    const shortlist = (a: Actor) => () =>
      clientFor(a).mutation(api["applications"]["decide"], {
        applicationId: M.applicationId,
        status: "shortlisted",
      });
    expect(await allow(shortlist("recruiter")), "recruiter no puede hacer shortlist").toBe(true);
    expect(await allow(shortlist("org_admin"))).toBe(true);
    await deny(shortlist("hiring_manager"));
    await deny(shortlist("candidate"));
    await deny(shortlist("outsider"));
  });

  it("rechazar: también exige nota y solo recruiter/org_admin", async () => {
    const rejectNoNote = (a: Actor) => () =>
      clientFor(a).mutation(api["applications"]["decide"], {
        applicationId: M.applicationId,
        status: "rejected",
      });
    let threw = false;
    try {
      await clientFor("org_admin").mutation(api["applications"]["decide"], {
        applicationId: M.applicationId,
        status: "rejected",
      });
    } catch {
      threw = true;
    }
    expect(threw, "se aceptó un rechazo SIN nota").toBe(true);

    const reject = (a: Actor) => () =>
      clientFor(a).mutation(api["applications"]["decide"], {
        applicationId: M.applicationId,
        status: "rejected",
        note: "Rechazo sintético con nota obligatoria para verificar la matriz RBAC",
      });
    expect(await allow(reject("recruiter"))).toBe(true);
    await deny(reject("hiring_manager"));
    await deny(reject("candidate"));
    await deny(reject("outsider"));
    void rejectNoNote;
  });

  // ── FILA: Audit log (org_admin) ──────────────────────────────────────
  it("audit log: solo org_admin", async () => {
    const q = (a: Actor) => () =>
      clientFor(a).query(api["orgs"]["auditTrail"], { organizationId: M.orgId });
    expect(await allow(q("org_admin"))).toBe(true);
    await deny(q("recruiter"));
    await deny(q("hiring_manager"));
    await deny(q("candidate"));
    await deny(q("outsider"));
  });

  // ── FILA: Invitar miembro (org_admin) ────────────────────────────────
  it("invitar miembro: solo org_admin", async () => {
    const inv = (a: Actor) => () =>
      clientFor(a).mutation(api["orgs"]["invite"], {
        organizationId: M.orgId,
        email: `destinatario.${a}.${M.stamp}@example.test`,
        role: "recruiter",
      });
    expect(await allow(inv("org_admin"))).toBe(true);
    await deny(inv("recruiter"));
    await deny(inv("hiring_manager"));
    await deny(inv("candidate"));
    await deny(inv("outsider"));
  });

  // ── FILA: Listar invitaciones (org_admin) ────────────────────────────
  it("listar invitaciones: solo org_admin", async () => {
    const q = (a: Actor) => () =>
      clientFor(a).query(api["orgs"]["pendingInvites"], { organizationId: M.orgId });
    expect(await allow(q("org_admin"))).toBe(true);
    await deny(q("recruiter"));
    await deny(q("hiring_manager"));
    await deny(q("outsider"));
  });

  // ── FILA: Quitar miembro (org_admin) ─────────────────────────────────
  it("quitar miembro: solo org_admin puede intentarlo, y nunca a sí mismo", async () => {
    const admin: any = await clientFor("org_admin").query(api["users"]["currentUser"]);
    let self = false;
    try {
      await clientFor("org_admin").mutation(api["orgs"]["removeMember"], {
        organizationId: M.orgId,
        targetUserId: admin._id,
      });
    } catch {
      self = true;
    }
    expect(self, "org_admin pudo auto-eliminarse").toBe(true);

    // Quitar a alguien que NO es miembro falla en todos los casos (fail-closed):
    // los roles sin permiso también.
    const rm = (a: Actor) => () =>
      clientFor(a).mutation(api["orgs"]["removeMember"], {
        organizationId: M.orgId,
        targetUserId: M.actors.candidate.userId,
      });
    await deny(rm("org_admin"));
    await deny(rm("recruiter"));
    await deny(rm("hiring_manager"));
    await deny(rm("outsider"));
  });

  // ── MATRIZ RESUMIDA (evidencia legible en un único artefacto) ─────────
  it("MATRIZ: resumen de permisos por rol (evidencia de la sesión)", async () => {
    const attempts: Record<string, Record<string, string>> = {};
    const run = async (actor: Actor, label: string, fn: () => Promise<unknown>) => {
      try {
        const v = await fn();
        const empty =
          v === null ||
          v === undefined ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
        attempts[actor] ??= {};
        attempts[actor][label] = empty ? "DENY" : "ALLOW";
      } catch {
        attempts[actor] ??= {};
        attempts[actor][label] = "DENY";
      }
    };

    for (const a of Object.keys(M.actors) as Actor[]) {
      await run(a, "ver_org", () =>
        clientFor(a).query(api["jobs"]["get"], { jobId: M.jobId }),
      );
      await run(a, "ver_miembros", () =>
        clientFor(a).query(api["orgs"]["members"], { organizationId: M.orgId }),
      );
      await run(a, "ver_vacantes", () =>
        clientFor(a).query(api["jobs"]["listByOrg"], { organizationId: M.orgId }),
      );
      await run(a, "crear_vacante", () =>
        clientFor(a).mutation(api["jobs"]["create"], {
          organizationId: M.orgId,
          title: `Matriz ${a}`,
          description: "Intento de creación para el resumen de la matriz RBAC",
          requirements: [
            { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
          ],
        }),
      );
      await run(a, "subir_cv", () =>
        clientFor(a).mutation(api["applications"]["initUpload"], {
          jobId: M.jobId,
          fileName: "matriz.txt",
          fileSize: 64,
        }),
      );
      await run(a, "ver_applicants", () =>
        clientFor(a).query(api["applications"]["listByJob"], { jobId: M.jobId }),
      );
      await run(a, "anotar", () =>
        clientFor(a).mutation(api["applications"]["addNote"], {
          applicationId: M.applicationId,
          body: "Nota del resumen de matriz RBAC",
        }),
      );
      await run(a, "decidir", () =>
        clientFor(a).mutation(api["applications"]["decide"], {
          applicationId: M.applicationId,
          status: "shortlisted",
        }),
      );
      await run(a, "audit_log", () =>
        clientFor(a).query(api["orgs"]["auditTrail"], { organizationId: M.orgId }),
      );
      await run(a, "invitar", () =>
        clientFor(a).mutation(api["orgs"]["invite"], {
          organizationId: M.orgId,
          email: `resumen.${a}.${M.stamp}@example.test`,
          role: "recruiter",
        }),
      );
    }
    console.log("RBAC_MATRIX " + JSON.stringify(attempts));

    const EXPECTED: Record<string, Record<string, string>> = {
      org_admin: {
        ver_org: "ALLOW", ver_miembros: "ALLOW", ver_vacantes: "ALLOW",
        crear_vacante: "ALLOW", subir_cv: "ALLOW", ver_applicants: "ALLOW",
        anotar: "ALLOW", decidir: "ALLOW", audit_log: "ALLOW", invitar: "ALLOW",
      },
      recruiter: {
        ver_org: "ALLOW", ver_miembros: "ALLOW", ver_vacantes: "ALLOW",
        crear_vacante: "ALLOW", subir_cv: "ALLOW", ver_applicants: "ALLOW",
        anotar: "ALLOW", decidir: "ALLOW", audit_log: "DENY", invitar: "DENY",
      },
      hiring_manager: {
        ver_org: "ALLOW", ver_miembros: "ALLOW", ver_vacantes: "ALLOW",
        crear_vacante: "DENY", subir_cv: "DENY", ver_applicants: "ALLOW",
        anotar: "ALLOW", decidir: "DENY", audit_log: "DENY", invitar: "DENY",
      },
      candidate: {
        ver_org: "DENY", ver_miembros: "DENY", ver_vacantes: "DENY",
        crear_vacante: "DENY", subir_cv: "DENY", ver_applicants: "DENY",
        anotar: "DENY", decidir: "DENY", audit_log: "DENY", invitar: "DENY",
      },
      outsider: {
        ver_org: "DENY", ver_miembros: "DENY", ver_vacantes: "DENY",
        crear_vacante: "DENY", subir_cv: "DENY", ver_applicants: "DENY",
        anotar: "DENY", decidir: "DENY", audit_log: "DENY", invitar: "DENY",
      },
    };
    expect(attempts).toEqual(EXPECTED);
  });

  // ── REVOCACIÓN E2E (misma sesión, token vivo, endpoints directos) ────
  it("REVOCACIÓN: removeMember deja sin acceso a la MISMA sesión, sin cerrar sesión", async () => {
    const recruiterToken = M.actors.recruiter.token;
    // 1. El recruiter accede con su sesión actual.
    expect(
      await allow(() =>
        clientFor("recruiter").query(api["jobs"]["listByOrg"], { organizationId: M.orgId }),
      ),
      "el recruiter no tenía acceso antes de revocar",
    ).toBe(true);
    expect(
      await allow(() =>
        clientFor("recruiter").query(api["applications"]["listByJob"], { jobId: M.jobId }),
      ),
    ).toBe(true);

    // 2. El org_admin lo elimina de la organización.
    const removed: any = await clientFor("org_admin").mutation(api["orgs"]["removeMember"], {
      organizationId: M.orgId,
      targetUserId: M.actors.recruiter.userId,
    });
    expect(removed.ok).toBe(true);

    // 3. MISMA sesión (mismo token, sin re-loguear, sin cerrar sesión).
    await deny(() =>
      clientFor("recruiter").query(api["jobs"]["listByOrg"], { organizationId: M.orgId }),
    );
    await deny(() =>
      clientFor("recruiter").query(api["applications"]["listByJob"], { jobId: M.jobId }),
    );
    await deny(() =>
      clientFor("recruiter").query(api["matches"]["getForApplication"], {
        applicationId: M.applicationId,
      }),
    );
    await deny(() =>
      clientFor("recruiter").mutation(api["applications"]["addNote"], {
        applicationId: M.applicationId,
        body: "Nota posterior a la revocación: debe fallar",
      }),
    );
    await deny(() =>
      clientFor("recruiter").mutation(api["applications"]["decide"], {
        applicationId: M.applicationId,
        status: "shortlisted",
      }),
    );
    await deny(() =>
      clientFor("recruiter").mutation(api["jobs"]["create"], {
        organizationId: M.orgId,
        title: "Vacante post revocación",
        description: "No debe permitirse tras la revocación de membresía",
        requirements: [
          { type: "skill", label: "Python", minLevel: 3, weight: 1, isMustHave: false },
        ],
      }),
    );

    // 4. Un cliente NUEVO con el MISMO token tampoco accede (no es caché del
    //    cliente HTTP: el deny es server-side).
    const fresh = new ConvexHttpClient(CONVEX_URL!);
    fresh.setAuth(recruiterToken);
    await deny(() => fresh.query(api["jobs"]["listByOrg"], { organizationId: M.orgId }));
    await deny(() =>
      fresh.query(api["applications"]["listByJob"], { jobId: M.jobId }),
    );

    // 5. El token sigue siendo una sesión válida: la revocación es de ACCESO A
    //    LA ORGANIZACIÓN, no de sesión global (documentación explícita).
    const who: any = await fresh.query(api["users"]["currentUser"]);
    expect(String(who._id)).toBe(M.actors.recruiter.userId);
    const mine: any[] = await fresh.query(api["candidates"]["myProfile"], {});
    expect(mine ?? null).toBeNull();
  });
});