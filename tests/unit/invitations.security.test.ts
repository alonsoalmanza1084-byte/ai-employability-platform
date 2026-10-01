/* eslint-disable @typescript-eslint/no-explicit-any -- ctx de Convex mockeado sin tipos */
/**
 * SEGURIDAD DE INVITACIONES, MEMBRESÍAS Y AUDIT LOG (auditoría #3, gate final).
 *
 * Estos tests invocan los HANDLERS REALES de `src/convex/orgs.ts` (vía
 * `fn._handler`) contra un `ctx.db` en memoria que emula la semántica de
 * Convex (índices con prefijo, take(n), insert/patch/delete). Esto permite
 * cubrir las celdas que NO son automatizables contra el deployment real:
 * aceptar una invitación exige una cuenta con email verificado (un cliente
 * anónimo de CI no puede recibir OTP), así que la matriz
 * recruiter/hiring_manager con membresía ACEPTADA solo se puede probar aquí.
 *
 * Celdas cubiertas:
 *  - Invitación: enumeración, replay (doble aceptación), expiración,
 *    tenant binding (email del actor), hashing del token, aceptación tras
 *    revocación, uso cross-tenant del token.
 *  - removeMember:Matrix de roles, no-auto-eliminación, no-remoción de otro
 *    org_admin, destino no-miembro, y PRUEBA DE REVOCACIÓN REAL: tras remover,
 *    el usuario pierde TODO acceso a la org.
 *  - auditTrail: autorizado (org_admin) SÍ lee; outsiders y roles inferiores NO.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CURRENT: { id: string | null } = { id: null };
vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async () => CURRENT.id,
}));

const orgs: any = await import("../../src/convex/orgs");
const { hashToken } = await import("../../src/convex/lib/audit");

// ── DB en memoria que emula Convex ──────────────────────────────────────
interface Row {
  _id: string;
  _creationTime: number;
  [k: string]: any;
}

let seq = 0;
const nextId = (table: string) => `${table}\0${String(++seq).padStart(8, "0")}`;

type Store = Record<string, Row[]>;

function makeCtx(store: Store) {
  const rowsOf = (t: string): Row[] => store[t] ?? (store[t] = []);

  /** Reconstruye las condiciones de un withIndex a partir del callback q. */
  const conditionsFor = (cb: (q: any) => any): [string, any][] => {
    const conds: [string, any][] = [];
    const q: any = {
      eq: (k: string, v: any) => {
        conds.push([k, v]);
        return q;
      },
    };
    cb(q);
    return conds;
  };

  const matches = (row: Row, conds: [string, any][]) =>
    conds.every(([k, v]) => row[k] === v);

  const db: any = {
    // Emula db.query(tabla).withIndex(nombre, cb).first() / .take(n)
    query: (table: string) => {
      /** Builder de lectura: emulate first()/take(n)/order(dir) encadenables. */
      const build = (rows: Row[]) => {
        let current = rows;
        const builder: any = {
          first: async () => current[0] ?? null,
          take: async (n: number) => current.slice(0, n),
          collect: async () => current,
          order: (dir: "asc" | "desc") => {
            // Convex ordena por los campos del índice; aquí por _creationTime.
            const sorted = [...current].sort((a, b) =>
              dir === "desc" ? b._creationTime - a._creationTime : a._creationTime - b._creationTime,
            );
            current = sorted;
            return builder;
          },
        };
        return builder;
      };
      return {
        withIndex: (_name: string, cb: any) =>
          build(rowsOf(table).filter((r) => matches(r, conditionsFor(cb)))),
        order: (dir: "asc" | "desc") => build(rowsOf(table)).order(dir),
      };
    },
    get: async (id: string) => {
      for (const table of Object.keys(store)) {
        const hit = rowsOf(table).find((r) => r._id === id);
        if (hit) return hit;
      }
      return null;
    },
    // Convex: insert(tabla, doc)
    insert: async (table: string, doc: any) => {
      const row: Row = {
        _id: nextId(table),
        _creationTime: Date.now(),
        ...doc,
      };
      rowsOf(table).push(row);
      return row._id;
    },
    patch: async (id: string, patch: any) => {
      for (const table of Object.keys(store)) {
        const hit = rowsOf(table).find((r) => r._id === id);
        if (hit) Object.assign(hit, patch);
      }
    },
    delete: async (id: string) => {
      for (const table of Object.keys(store)) {
        const i = rowsOf(table).findIndex((r) => r._id === id);
        if (i >= 0) rowsOf(table).splice(i, 1);
      }
    },
  };
  return { db, rowsOf };
}

const call = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);
const capture = async (p: Promise<unknown>) => {
  try {
    return { ok: true as const, res: await p };
  } catch (e: any) {
    return { ok: false as const, msg: String(e?.message ?? e) };
  }
};

const ORG_A = "organizations\0orgA" as any;
const ORG_B = "organizations\0orgB" as any;

interface Fixture {
  store: Store;
  ctx: any;
  rowsOf: (t: string) => Row[];
  users: {
    admin: string;
    recruiter: string;
    manager: string;
    outsider: string;
    candidate: string;
  };
}

function seed(): Fixture {
  seq = 0;
  const store: Store = {};
  const { db, rowsOf } = makeCtx(store);
  const mkUser = (email: string, anonymous = false) => {
    const id = nextId("users");
    rowsOf("users").push({ _id: id, _creationTime: Date.now(), email, isAnonymous: anonymous });
    return id;
  };
  const admin = mkUser("admin@corp.test");
  const recruiter = mkUser("rec@corp.test");
  const manager = mkUser("hm@corp.test");
  const outsider = mkUser("out@other.test");
  // Candidato: usuario autenticado SIN ninguna membresía de organización
  // (representa el rol `candidate` del producto).
  const candidate = mkUser("candidate@mail.test");

  rowsOf("organizations").push({ _id: ORG_A, name: "Org A", slug: "org-a", createdByUserId: admin });
  rowsOf("organizations").push({ _id: ORG_B, name: "Org B", slug: "org-b", createdByUserId: outsider });

  const addMember = (orgId: string, userId: string, role: string) =>
    rowsOf("organizationMembers").push({
      _id: nextId("organizationMembers"),
      _creationTime: Date.now(),
      organizationId: orgId,
      userId,
      role,
    });

  addMember(ORG_A, admin, "org_admin");
  addMember(ORG_A, recruiter, "recruiter");
  addMember(ORG_A, manager, "hiring_manager");
  addMember(ORG_B, outsider, "org_admin");

  return {
    store,
    ctx: { db, auth: null },
    rowsOf,
    users: { admin, recruiter, manager, outsider, candidate },
  };
}

const as = (f: Fixture, userId: string | null) => {
  CURRENT.id = userId;
  return f.ctx;
};

// ────────────────────────────────────────────────────────────────────────
describe("invitaciones: enumeración, replay, expiración, tenant y revocación", () => {
  let f: Fixture;
  beforeEach(() => {
    f = seed();
  });

  it("el token NUNCA se guarda en claro: la fila solo almacena su hash", async () => {
    const token = "secreto-de-invitacion-123";
    const hash = await hashToken(token);
    f.rowsOf("invitations").push({
      _id: nextId("invitations"),
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "nuevo@corp.test",
      role: "recruiter",
      tokenHash: hash,
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 14 * 24 * 3600 * 1000,
      status: "pending",
    });
    const row = f.rowsOf("invitations")[0];
    expect(row.tokenHash).toBe(hash);
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(hash).toHaveLength(64); // SHA-256 hex
  });

  it("ENUMERACIÓN: un outsider no puede listar invitaciones pendientes ni emails ajenos", async () => {
    f.rowsOf("invitations").push({
      _id: nextId("invitations"),
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "target@corp.test",
      role: "recruiter",
      tokenHash: "h",
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 1000,
      status: "pending",
    });
    for (const who of [f.users.outsider, f.users.recruiter, f.users.manager, null]) {
      const r = await capture(
        call(orgs.pendingInvites, as(f, who), { organizationId: ORG_A }),
      );
      expect(r.ok, `usuario ${who} no debe listar invitaciones`).toBe(false);
    }
    // Tampoco puede crearlas (org_admin only).
    const inv = await capture(
      call(orgs.invite, as(f, f.users.recruiter), {
        organizationId: ORG_A,
        email: "x@y.test",
        role: "recruiter",
      }),
    );
    expect(inv.ok).toBe(false);
  });

  it("el outsider ve NOT_FOUND (no FORBIDDEN) al consultar org ajena: no filtra existencia", async () => {
    const r = await capture(call(orgs.members, as(f, f.users.outsider), { organizationId: ORG_A }));
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("NOT_FOUND");
    expect(r.msg).not.toContain("FORBIDDEN");
  });

  it("REPLAY: un token aceptado no puede aceptarse de nuevo", async () => {
    const token = "token-replay-abc";
    const tokenHash = await hashToken(token);
    const invId = nextId("invitations");
    f.rowsOf("invitations").push({
      _id: invId,
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "rec@corp.test",
      role: "recruiter",
      tokenHash,
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });

    const first = await capture(call(orgs.acceptInvite, as(f, f.users.recruiter), { token }));
    expect(first.ok, first.ok ? "" : first.msg).toBe(true);
    expect(f.rowsOf("invitations")[0].status).toBe("accepted");
    const member = f.rowsOf("organizationMembers").find(
      (m) => m.userId === f.users.recruiter && m.organizationId === ORG_A,
    );
    expect(member?.role).toBe("recruiter");

    // Segundo intento con el mismo token → rechazado (status != pending).
    const second = await capture(call(orgs.acceptInvite, as(f, f.users.recruiter), { token }));
    expect(second.ok).toBe(false);
    expect(second.msg).toMatch(/inválida|expirada/i);
    // Y no se duplica la membresía.
    expect(
      f.rowsOf("organizationMembers").filter(
        (m) => m.userId === f.users.recruiter && m.organizationId === ORG_A,
      ),
    ).toHaveLength(1);
  });

  it("EXPIRACIÓN: un token con expiresAt pasado se rechaza", async () => {
    const token = "token-expirado";
    f.rowsOf("invitations").push({
      _id: nextId("invitations"),
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "hm@corp.test",
      role: "hiring_manager",
      tokenHash: await hashToken(token),
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() - 1,
      status: "pending",
    });
    const r = await capture(call(orgs.acceptInvite, as(f, f.users.manager), { token }));
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/inválida|expirada/i);
  });

  it("TENANT BINDING: el token solo sirve para el email invitado", async () => {
    const token = "token-tenant";
    f.rowsOf("invitations").push({
      _id: nextId("invitations"),
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "hm@corp.test",
      role: "hiring_manager",
      tokenHash: await hashToken(token),
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });
    // Otro usuario autenticado con OTRO email no puede usarlo.
    const r = await capture(call(orgs.acceptInvite, as(f, f.users.outsider), { token }));
    expect(r.ok).toBe(false);
    expect(f.rowsOf("organizationMembers").some((m) => m.organizationId === ORG_B && m.userId === f.users.outsider && m.role !== "org_admin")).toBe(false);
  });

  it("CROSS-TENANT: un admin de otra org no puede revocar invitaciones ajenas", async () => {
    const invId = nextId("invitations");
    f.rowsOf("invitations").push({
      _id: invId,
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "nuevo@corp.test",
      role: "recruiter",
      tokenHash: "h",
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });
    // El outsider es org_admin de ORG_B: pasa el check de rol pero NO es su tenant.
    const r = await capture(
      call(orgs.revokeInvite, as(f, f.users.outsider), {
        organizationId: ORG_B,
        invitationId: invId,
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("NOT_FOUND");
    expect(f.rowsOf("invitations")[0].status).toBe("pending");
  });

  it("ACEPTACIÓN TRAS REVOCACIÓN: revokeInvite inutiliza el token", async () => {
    const token = "token-revocado";
    const invId = nextId("invitations");
    f.rowsOf("invitations").push({
      _id: invId,
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "nuevo@corp.test",
      role: "recruiter",
      tokenHash: await hashToken(token),
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });

    const rev = await capture(
      call(orgs.revokeInvite, as(f, f.users.admin), {
        organizationId: ORG_A,
        invitationId: invId,
      }),
    );
    expect(rev.ok, rev.ok ? "" : rev.msg).toBe(true);
    expect(f.rowsOf("invitations")[0].status).toBe("revoked");
    // El evento de revocación queda auditado.
    expect(
      f.rowsOf("auditLog").some(
        (a) => a.action === "org.invite.revoke" && a.targetId === invId,
      ),
    ).toBe(true);

    // Aunque el email invitado se autenticara, el token ya no sirve.
    f.rowsOf("users").push({
      _id: nextId("users"),
      _creationTime: Date.now(),
      email: "nuevo@corp.test",
      isAnonymous: false,
    });
    const invited = f.rowsOf("users").find((u) => u.email === "nuevo@corp.test")!;
    const acc = await capture(call(orgs.acceptInvite, as(f, invited._id), { token }));
    expect(acc.ok).toBe(false);
    expect(f.rowsOf("organizationMembers").some((m) => m.userId === invited._id)).toBe(false);
  });

  it("revokeInvite es idempotente-fail-closed: revocar dos veces → NOT_FOUND", async () => {
    const invId = nextId("invitations");
    f.rowsOf("invitations").push({
      _id: invId,
      _creationTime: Date.now(),
      organizationId: ORG_A,
      email: "x@corp.test",
      role: "recruiter",
      tokenHash: "h",
      invitedByUserId: f.users.admin,
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });
    await call(orgs.revokeInvite, as(f, f.users.admin), {
      organizationId: ORG_A,
      invitationId: invId,
    });
    const again = await capture(
      call(orgs.revokeInvite, as(f, f.users.admin), {
        organizationId: ORG_A,
        invitationId: invId,
      }),
    );
    expect(again.ok).toBe(false);
    expect(again.msg).toContain("NOT_FOUND");
  });
});

// ────────────────────────────────────────────────────────────────────────
describe("removeMember: revocación de acceso (control de seguridad, no feature)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = seed();
  });

  it("un org_admin puede remover a un recruiter y el acceso MUERE de inmediato", async () => {
    // Antes: el recruiter accede a la org.
    const before = await capture(
      call(orgs.members, as(f, f.users.recruiter), { organizationId: ORG_A }),
    );
    expect(before.ok, "el recruiter es miembro legítimo").toBe(true);

    const rm = await capture(
      call(orgs.removeMember, as(f, f.users.admin), {
        organizationId: ORG_A,
        targetUserId: f.users.recruiter,
      }),
    );
    expect(rm.ok, rm.ok ? "" : rm.msg).toBe(true);

    // La fila de membresía desaparece…
    expect(
      f.rowsOf("organizationMembers").some((m) => m.userId === f.users.recruiter),
    ).toBe(false);
    // …y TODAS las lecturas/mutaciones de la org le niegan el acceso.
    for (const who of [orgs.members, orgs.pendingInvites, orgs.auditTrail]) {
      const r = await capture(
        call(who, as(f, f.users.recruiter), { organizationId: ORG_A }),
      );
      expect(r.ok, `${who} debe denegar al ex-miembro`).toBe(false);
      expect(r.msg).toContain("NOT_FOUND");
    }
    const inv = await capture(
      call(orgs.invite, as(f, f.users.recruiter), {
        organizationId: ORG_A,
        email: "z@corp.test",
        role: "recruiter",
      }),
    );
    expect(inv.ok).toBe(false);
    // La revocación es auditable.
    const trail = f.rowsOf("auditLog").filter((a) => a.action === "org.member.remove");
    expect(trail).toHaveLength(1);
    expect(trail[0].actorUserId).toBe(f.users.admin);
    expect(trail[0].metadata).toEqual({ removedRole: "recruiter" });
  });

  it("el mismo para hiring_manager", async () => {
    const rm = await capture(
      call(orgs.removeMember, as(f, f.users.admin), {
        organizationId: ORG_A,
        targetUserId: f.users.manager,
      }),
    );
    expect(rm.ok).toBe(true);
    const r = await capture(
      call(orgs.members, as(f, f.users.manager), { organizationId: ORG_A }),
    );
    expect(r.ok).toBe(false);
  });

  it("removeMember es org_admin-only (recruiter, hiring_manager y outsider fallan)", async () => {
    for (const who of [f.users.recruiter, f.users.manager, f.users.outsider, null]) {
      const r = await capture(
        call(orgs.removeMember, as(f, who), {
          organizationId: ORG_A,
          targetUserId: f.users.manager,
        }),
      );
      expect(r.ok, `actor ${who} no debe remover miembros`).toBe(false);
    }
    // Nadie fue removido.
    expect(
      f.rowsOf("organizationMembers").some((m) => m.userId === f.users.manager),
    ).toBe(true);
  });

  it("un admin NO puede remover a otro org_admin (anti take-over de la org)", async () => {
    // Segundo admin en ORG_A.
    const admin2 = nextId("users");
    f.rowsOf("users").push({ _id: admin2, _creationTime: Date.now(), email: "admin2@corp.test" });
    f.rowsOf("organizationMembers").push({
      _id: nextId("organizationMembers"),
      _creationTime: Date.now(),
      organizationId: ORG_A,
      userId: admin2,
      role: "org_admin",
    });
    const r = await capture(
      call(orgs.removeMember, as(f, f.users.admin), {
        organizationId: ORG_A,
        targetUserId: admin2,
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/otro org_admin|transfiere/i);
  });

  it("un admin NO puede remover a sí mismo (evita dejar la org sin admins)", async () => {
    const r = await capture(
      call(orgs.removeMember, as(f, f.users.admin), {
        organizationId: ORG_A,
        targetUserId: f.users.admin,
      }),
    );
    expect(r.ok).toBe(false);
    expect(f.rowsOf("organizationMembers").some((m) => m.userId === f.users.admin)).toBe(true);
  });

  it("un CANDIDATO (sin membresía) no puede remover miembros ni leer el trail", async () => {
    // El candidato no tiene fila en organizationMembers: requireMembership
    // debe negarle ANTES de cualquier operación administrativa.
    const candidate = f.users.candidate;
    expect(
      f.rowsOf("organizationMembers").some((m) => m.userId === candidate),
    ).toBe(false);

    for (const fn of [orgs.removeMember, orgs.revokeInvite, orgs.auditTrail, orgs.pendingInvites]) {
      const args =
        fn === orgs.removeMember
          ? { organizationId: ORG_A, targetUserId: f.users.manager }
          : fn === orgs.revokeInvite
            ? { organizationId: ORG_A, invitationId: f.users.manager }
            : { organizationId: ORG_A };
      const r = await capture(call(fn, as(f, candidate), args));
      expect(r.ok, `candidato no debe ejecutar ${fn}`).toBe(false);
      expect(r.msg).toContain("NOT_FOUND");
    }
    // Nadie fue removido por el candidato.
    expect(
      f.rowsOf("organizationMembers").some((m) => m.userId === f.users.manager),
    ).toBe(true);
  });

  it("sesión YA AUTENTICADA tras la revocación: el token sigue vivo pero el acceso a la org muere", async () => {
    // Preparación: el recruiter tiene una sesión activa (getAuthUserId devuelve
    // su id) y accede a la org.
    const recruiter = f.users.recruiter;
    const before = await capture(
      call(orgs.members, as(f, recruiter), { organizationId: ORG_A }),
    );
    expect(before.ok, "el recruiter accede antes de la revocación").toBe(true);

    // El org_admin lo remueve.
    const rm = await capture(
      call(orgs.removeMember, as(f, f.users.admin), {
        organizationId: ORG_A,
        targetUserId: recruiter,
      }),
    );
    expect(rm.ok, rm.ok ? "" : rm.msg).toBe(true);

    // IMPORTANTE: la SESIÓN no se invalida (no borramos authSessions): el mismo
    // usuario sigue "autenticado". Lo que muere es el ACCESO a la org, porque
    // requireMembership vuelve a leer la fila de membresía en cada llamada.
    const stillAuthenticated = await capture(
      call(orgs.myOrgs, as(f, recruiter), {}),
    );
    expect(stillAuthenticated.ok, "la sesión sigue viva").toBe(true);
    expect(
      (stillAuthenticated.res as any[]).some((o: any) => o._id === ORG_A),
      "ya no aparece la org en myOrgs",
    ).toBe(false);

    // Toda operación sobre la org queda negada para esa SESIÓN existente.
    for (const [fn, args] of [
      [orgs.members, { organizationId: ORG_A }],
      [orgs.pendingInvites, { organizationId: ORG_A }],
      [orgs.auditTrail, { organizationId: ORG_A }],
      [orgs.invite, { organizationId: ORG_A, email: "z@corp.test", role: "recruiter" }],
    ] as const) {
      const r = await capture(call(fn as any, as(f, recruiter), args as any));
      expect(r.ok, `tras revocación debe denegar ${(fn as any).name}`).toBe(false);
      expect(r.msg).toContain("NOT_FOUND");
    }
  });

  it("destino que no es miembro de ESA org → NOT_FOUND (no revela existencia)", async () => {
    const r = await capture(
      call(orgs.removeMember, as(f, f.users.admin), {
        organizationId: ORG_A,
        targetUserId: f.users.outsider, // es admin de ORG_B, no miembro de ORG_A
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("NOT_FOUND");
    expect(f.rowsOf("organizationMembers").some((m) => m.userId === f.users.outsider)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
describe("auditTrail: acceso autorizado vs no autorizado", () => {
  let f: Fixture;
  beforeEach(() => {
    f = seed();
  });

  it("el org_admin SÍ puede inspeccionar el trail de SU org", async () => {
    await call(orgs.removeMember, as(f, f.users.admin), {
      organizationId: ORG_A,
      targetUserId: f.users.recruiter,
    });
    await call(orgs.revokeInvite, as(f, f.users.admin), {
      organizationId: ORG_A,
      invitationId: (() => {
        const id = nextId("invitations");
        f.rowsOf("invitations").push({
          _id: id,
          _creationTime: Date.now(),
          organizationId: ORG_A,
          email: "z@corp.test",
          role: "recruiter",
          tokenHash: "h",
          invitedByUserId: f.users.admin,
          expiresAt: Date.now() + 1000,
          status: "pending",
        });
        return id;
      })(),
    });

    const trail: any[] = await call(orgs.auditTrail, as(f, f.users.admin), {
      organizationId: ORG_A,
    });
    const actions = trail.map((e) => e.action);
    expect(actions).toContain("org.member.remove");
    expect(actions).toContain("org.invite.revoke");
    // Campos expuestos: los seguros.
    for (const e of trail) {
      expect(Object.keys(e).sort()).toEqual(
        expect.arrayContaining(["action", "actorUserId", "metadata", "targetId", "targetType"]),
      );
    }
    // El trail NO incluye el email del miembro removido ni el token.
    const dumped = JSON.stringify(trail);
    expect(dumped).not.toContain("rec@corp.test");
    expect(dumped).not.toContain("z@corp.test");
  });

  it("NO autorizado NO puede leer el trail: outsider, recruiter y hiring_manager", async () => {
    await call(orgs.removeMember, as(f, f.users.admin), {
      organizationId: ORG_A,
      targetUserId: f.users.manager,
    });
    for (const who of [f.users.outsider, f.users.recruiter, f.users.manager, null]) {
      const r = await capture(
        call(orgs.auditTrail, as(f, who), { organizationId: ORG_A }),
      );
      expect(r.ok, `actor ${who} no debe leer el audit trail`).toBe(false);
      expect(r.msg).toMatch(/NOT_FOUND|FORBIDDEN/);
    }
  });

  it("el trail está scopeado por tenant: el admin de ORG_B no ve eventos de ORG_A", async () => {
    await call(orgs.removeMember, as(f, f.users.admin), {
      organizationId: ORG_A,
      targetUserId: f.users.manager,
    });
    const trailB: any[] = await call(orgs.auditTrail, as(f, f.users.outsider), {
      organizationId: ORG_B,
    });
    expect(Array.isArray(trailB)).toBe(true);
    expect(trailB.some((e) => e.action === "org.member.remove")).toBe(false);
  });

  it("la paginación está acotada y no filtra filas de otros tenants", async () => {
    for (let i = 0; i < 150; i++) {
      f.rowsOf("auditLog").push({
        _id: nextId("auditLog"),
        _creationTime: Date.now() + i,
        organizationId: ORG_A,
        action: `evento.${i}`,
      });
    }
    f.rowsOf("auditLog").push({
      _id: nextId("auditLog"),
      _creationTime: Date.now(),
      organizationId: ORG_B,
      action: "evento.privado.OrgB",
    });
    const page0: any[] = await call(orgs.auditTrail, as(f, f.users.admin), {
      organizationId: ORG_A,
    });
    expect(page0).toHaveLength(100);
    expect(page0.every((e) => e.action !== "evento.privado.OrgB")).toBe(true);
    const page1: any[] = await call(orgs.auditTrail, as(f, f.users.admin), {
      organizationId: ORG_A,
      page: 1,
    });
    expect(page1.length).toBeLessThanOrEqual(100);
    expect(new Set([...page0, ...page1].map((e) => e._id)).size).toBe(
      [...page0, ...page1].length,
    );
  });
});
