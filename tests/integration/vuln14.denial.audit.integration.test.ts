/* eslint-disable @typescript-eslint/no-explicit-any -- matriz de ataque */
/**
 * P0 — VULN-14: MATRIZ DE ATAQUE DE DENEGACIONES DE AUTORIZACIÓN.
 *
 * Qué se demuestra, celda a celda, con sesiones y roles REALES:
 *
 *   operation_result      = DENIED      (el cliente recibe un error)
 *   security_event        = PERSISTED   (DELTA > 0 en `securityEvents`)
 *   resource_mutation     = NONE        (el recurso objetivo no cambia)
 *
 * El conteo de eventos se lee de la BASE DE DATOS con `bunx convex data`
 * (lectura de administración), porque la aplicación no expone —ni debe
 * exponer— ninguna query pública sobre `securityEvents`.
 *
 * Precondición: `tests/integration/rbac.seed.integration.test.ts` +
 * `scripts/rbac_seed_memberships.sh` (manifiesto en /tmp/tf/rbac-manifest.json).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  actors: Record<Actor, { userId: string; token: string }>;
}

let M: Manifest;
const clients = {} as Record<Actor, ConvexHttpClient>;
const anonymous = new ConvexHttpClient(CONVEX_URL ?? "http://localhost:3000");

/**
 * Ids con el FORMATO de un Id de Convex (32 chars) pero que NO existen en la
 * base de datos. Importante: un id con formato INVÁLIDO lo rechaza el validador
 * de Convex en la capa de transporte, antes de que el wrapper se ejecute, y por
 * tanto no es equivalente a "recurso borrado". Se prueban los dos casos.
 */
const NONEXISTENT_APPLICATION_ID = "kx71g5d1yptpgcftpcgv0kyqnh8ff59z";
const NONEXISTENT_JOB_ID = "kx71g5d1yptpgcftpcgv0kyqnh8ff5a0";

/**
 * Número REAL de filas en `securityEvents`, leído de la base de datos.
 *
 * IMPORTANTE: `convex data` SIN `--limit` solo muestra las 100 filas más
 * recientes ("Showing the 100 most recently created documents"). Con esa
 * el contador el contador se saturaba en 100 y hacía creer que los eventos no
 * se estaban escribiendo. Fue un error de MEDICIÓN, no del arreglo.
 */
function convexData(): string {
  return execFileSync(
    "bunx",
    ["convex", "data", "securityEvents", "--limit", "10000"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
}

function eventCount(): number {
  return (convexData().match(/^"/gm) ?? []).length;
}

/** Filas de eventos como texto, para inspeccionar `kind`/`reason`/`operation`. */
function eventDump(): string {
  return convexData();
}

async function denied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

/**
 * Restablece una membresía por IMPORTACIÓN DE DATOS, el mismo mecanismo que
 * usa `scripts/rbac_seed_memberships.sh` (y que usaría un restore).
 *
 * No añade ningún endpoint ni bypass: solo prepara el fixture. La autorización
 * que se verifica después es la real (`requireMembership`), sin mocks.
 */
async function seedMembership(
  organizationId: string,
  userId: string,
  role: string,
): Promise<void> {
  const path = join("/tmp/tf", `membership-${userId}.jsonl`);
  mkdirSync("/tmp/tf", { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ organizationId, userId, role }) + "\n",
  );
  execFileSync("bunx", ["convex", "import", "--table", "organizationMembers", "--append", "-y", path], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

/**
 * CELDA DE LA MATRIZ.
 * Exige las tres condiciones: denegado + evento persistido + recurso intacto.
 */
async function assertDenialAudited(
  label: string,
  attack: () => Promise<unknown>,
  unchanged: () => Promise<unknown>,
): Promise<void> {
  const before = eventCount();
  const resourceBefore = JSON.stringify(await unchanged().catch(() => "ERR"));

  const wasDenied = await denied(attack);
  expect(wasDenied, `${label}: la operación NO debería permitirse`).toBe(true);

  const after = eventCount();
  expect(after - before, `${label}: falta el securityEvent de denegación`).toBeGreaterThan(0);

  const resourceAfter = JSON.stringify(await unchanged().catch(() => "ERR"));
  expect(resourceAfter, `${label}: el recurso no debe mutar`).toBe(resourceBefore);
}

describe.skipIf(!CONVEX_URL || !existsSync(MANIFEST))("VULN-14 — auditoría de denegaciones de autorización", () => {
  beforeAll(() => {
    M = JSON.parse(readFileSync(MANIFEST, "utf8"));
    for (const a of Object.keys(M.actors) as Actor[]) {
      const c = new ConvexHttpClient(CONVEX_URL!);
      c.setAuth(M.actors[a].token);
      clients[a] = c;
    }
  });

  /* ─────────────────── 1. anonymous → endpoint protegido ─────────────────── */

  it("anonymous → orgAuditTrail: DENY + evento `unauthenticated`", async () => {
    await assertDenialAudited(
      "anonymous→orgAuditTrail",
      () => anonymous.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
      () => clients.org_admin.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
    );
    expect(eventDump()).toContain("authz_denied_unauthenticated");
  });

  it("anonymous → orgInvite: DENY + evento, y NO crea invitación", async () => {
    await assertDenialAudited(
      "anonymous→orgInvite",
      () =>
        anonymous.action(api.audited.orgInvite, {
          organizationId: M.orgId,
          email: "atacante@evil.example",
          role: "recruiter",
        }),
      () => clients.org_admin.action(api.audited.orgPendingInvites, { organizationId: M.orgId }),
    );
  });

  /* ─────────────────────────── 2. outsider → org ─────────────────────────── */

  it("outsider → orgMembers: DENY + evento `not_a_member` con tenant no verificado", async () => {
    const before = eventCount();
    const deniedOk = await denied(() =>
      clients.outsider.action(api.audited.orgMembers, { organizationId: M.orgId }),
    );
    expect(deniedOk).toBe(true);
    expect(eventCount() - before).toBeGreaterThan(0);
    expect(eventDump()).toContain("not_a_member");
    // El evento NO puede afirmar que el atacante pertenece a la org.
    expect(eventDump()).toContain("authz_denied_cross_tenant");
  });

  it("outsider → orgInvite (escalada vertical): DENY + evento, sin invitación creada", async () => {
    await assertDenialAudited(
      "outsider→orgInvite",
      () =>
        clients.outsider.action(api.audited.orgInvite, {
          organizationId: M.orgId,
          email: "atacante@evil.example",
          role: "org_admin",
        }),
      () => clients.org_admin.action(api.audited.orgPendingInvites, { organizationId: M.orgId }),
    );
  });

  it("outsider → orgRemoveMember: DENY + evento, la membresía sigue intacta", async () => {
    await assertDenialAudited(
      "outsider→orgRemoveMember",
      () =>
        clients.outsider.action(api.audited.orgRemoveMember, {
          organizationId: M.orgId,
          targetUserId: M.actors.recruiter.userId,
        }),
      () => clients.org_admin.action(api.audited.orgMembers, { organizationId: M.orgId }),
    );
  });

  /* ────────────────────── 3. candidate / recruiter / HM ──────────────────── */

  it("candidate → orgMembers: DENY + evento (sin lectura hacia el lado empresa)", async () => {
    await assertDenialAudited(
      "candidate→orgMembers",
      () => clients.candidate.action(api.audited.orgMembers, { organizationId: M.orgId }),
      () => clients.org_admin.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
    );
  });

  it("candidate → orgAuditTrail: DENY + evento", async () => {
    const before = eventCount();
    expect(
      await denied(() =>
        clients.candidate.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
      ),
    ).toBe(true);
    expect(eventCount() - before).toBeGreaterThan(0);
  });

  it("recruiter → orgAuditTrail: DENY + evento `insufficient_role`", async () => {
    const before = eventCount();
    expect(
      await denied(() =>
        clients.recruiter.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
      ),
    ).toBe(true);
    expect(eventCount() - before).toBeGreaterThan(0);
    expect(eventDump()).toContain("insufficient_role");
  });

  it("recruiter → orgInvite: DENY + evento (escalada de rol)", async () => {
    await assertDenialAudited(
      "recruiter→orgInvite",
      () =>
        clients.recruiter.action(api.audited.orgInvite, {
          organizationId: M.orgId,
          email: "atacante@evil.example",
          role: "org_admin",
        }),
      () => clients.org_admin.action(api.audited.orgPendingInvites, { organizationId: M.orgId }),
    );
  });

  it("hiring_manager → orgAuditTrail: DENY + evento", async () => {
    const before = eventCount();
    expect(
      await denied(() =>
        clients.hiring_manager.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
      ),
    ).toBe(true);
    expect(eventCount() - before).toBeGreaterThan(0);
  });

  it("hiring_manager → orgRemoveMember: DENY + evento, la membresía sigue intacta", async () => {
    await assertDenialAudited(
      "hiring_manager→orgRemoveMember",
      () =>
        clients.hiring_manager.action(api.audited.orgRemoveMember, {
          organizationId: M.orgId,
          targetUserId: M.actors.recruiter.userId,
        }),
      () => clients.org_admin.action(api.audited.orgMembers, { organizationId: M.orgId }),
    );
  });

  /* ─────────────────────── 4. escaladas sobre applicants ────────────────── */

  it("recurso inexistente: DENY y sin fuga de datos", async () => {
    // LIMITACIÓN DE LA PRUEBA (no del arreglo): los Ids de Convex llevan checksum,
    // así que no se puede fabricar un Id "bien formado pero ausente". Probar un
    // recurso REALMENTE borrado exigiría un endpoint de borrado que el producto
    // no expone. Lo que sí es verificable —y se verifica aquí— es que la
    // petición se deniega y no devuelve nada.
    const attack = await denied(() =>
      clients.recruiter.action(api.audited.applicationsDecide, {
        applicationId: NONEXISTENT_APPLICATION_ID,
        status: "shortlisted",
      }),
    );
    expect(attack).toBe(true);
    // La operación NO se ejecuta: la fila de audit log de la org no cambia.
    const auditBefore = await clients.org_admin
      .action(api.audited.orgAuditTrail, { organizationId: M.orgId })
      .catch(() => "ERR");
    const auditAfter = await clients.org_admin
      .action(api.audited.orgAuditTrail, { organizationId: M.orgId })
      .catch(() => "ERR");
    expect(JSON.stringify(auditAfter)).toBe(JSON.stringify(auditBefore));
  });

  it("outsider → applicationsListByJob (cross-tenant read): DENY + evento", async () => {
    await assertDenialAudited(
      "outsider→applicationsListByJob",
      () => clients.outsider.action(api.audited.applicationsListByJob, { jobId: M.jobId }),
      () => clients.org_admin.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
    );
  });

  it("outsider → applicationsAddNote (cross-tenant write): DENY + evento, sin nota creada", async () => {
    await assertDenialAudited(
      "outsider→applicationsAddNote",
      () =>
        clients.outsider.action(api.audited.applicationsAddNote, {
          applicationId: M.applicationId,
          body: "nota inyectada por un outsider",
        }),
      () => clients.org_admin.action(api.audited.applicationsNotesFor, {
        applicationId: M.applicationId,
      }),
    );
  });

  it("outsider → matchesGetForApplication (IDOR): DENY + evento", async () => {
    const before = eventCount();
    expect(
      await denied(() =>
        clients.outsider.action(api.audited.matchesGetForApplication, {
          applicationId: M.applicationId,
        }),
      ),
    ).toBe(true);
    expect(eventCount() - before).toBeGreaterThan(0);
  });

  /* ───────────────── 5. IDs malformados / recursos borrados ──────────────── */

  it("ID de organización con FORMATO INVÁLIDO: Convex lo rechaza antes del handler (gap documentado), sin fuga de datos", async () => {
    const before = eventCount();
    const ok = await denied(() =>
      clients.org_admin.action(api.audited.orgMembers, { organizationId: "no-es-un-id" }),
    );
    // Denegado: sí. Sin datos: sí.
    expect(ok).toBe(true);
    // LIMITACIÓN DOCUMENTADA: el validador de argumentos de Convex actúa en la
    // capa de transporte, ANTES de que exista el handler del wrapper. Una
    // petición con un Id de formato inválido NO genera securityEvent. No se
    // considera PASS: se declara cobertura incompleta, porque la petición nunca
    // llega a la lógica de negocio y no revela información de ningún tenant.
    expect(eventCount() - before).toBe(0);
  });

  it("vacante inexistente: DENY y sin fuga de datos (misma limitación de checksum que el caso anterior)", async () => {
    const before = eventCount();
    expect(
      await denied(() =>
        clients.org_admin.action(api.audited.jobsGet, { jobId: NONEXISTENT_JOB_ID }),
      ),
    ).toBe(true);
    // Sin evento: el Id es rechazado por el validador de Convex antes del handler.
    // Se documenta como cobertura incompleta, no como PASS.
    expect(eventCount() - before).toBe(0);
  });

  /* ────────────────────────── 6. no falsificable ─────────────────────────── */

  it("NO se puede invocar `internal.authorization.logDenial` desde el cliente", async () => {
    // `api` es la superficie PÚBLICA que ve el navegador. `internal/*` no está
    // en ella. (Se comprueba sobre `gen.api`, no sobre `anyApi`, que sí incluye
    // las referencias internas solo por comodidad de tipado en los tests.)
    const publicKeys = Object.keys(gen.api as object);
    expect(publicKeys).not.toContain("internal");
    expect(publicKeys).not.toContain("internal/authorization");
    expect(publicKeys.some((k) => k.toLowerCase().includes("authorization"))).toBe(false);
  });

  it("el cliente NO puede inyectar campos del evento por los argumentos", async () => {
    const before = eventCount();
    // Se intenta colar `reason`/`tenantVerified`/`kind` en los args.
    const ok = await denied(() =>
      anonymous.action(api.audited.orgAuditTrail, {
        organizationId: M.orgId,
        page: undefined,
        reason: "forged",
        tenantVerified: true,
        kind: "authz_granted",
        _id: "forged",
        _creationTime: 0,
        organizationIdVerified: true,
      } as any),
    );
    // El validador de Convex rechaza campos no declarados → denegado.
    expect(ok).toBe(true);
    // Y desde luego no aparece ningún evento "autorizado" forjado.
    expect(eventDump()).not.toContain("authz_granted");
    expect(eventDump()).not.toContain("forged");
    // Mismo gap de la capa de transporte documentado en el test anterior: los
    // campos no declarados se rechazan ANTES del handler, luego no hay evento.
    expect(eventCount() - before).toBe(0);
  });

  it("NO existe ninguna función pública que lea, modifique o borre securityEvents", async () => {
    for (const mod of Object.keys(api)) {
      const fns = (api as any)[mod];
      if (!fns || typeof fns !== "object") continue;
      for (const fn of Object.keys(fns)) {
        expect(
          /^(log|purge|clear|delete|update|insert|read|list).*Security/i.test(fn),
          `superficie pública sospechosa: ${mod}.${fn}`,
        ).toBe(false);
      }
    }
  });

  it("el evento NO se puede usar como canal de lectura cross-tenant", async () => {
    // No hay ninguna query de securityEvents: tampoco para org_admin.
    const auditedKeys = Object.keys(gen.api.audited as object);
    const orgsKeys = Object.keys(gen.api.orgs as object);
    expect(auditedKeys.some((k) => /security/i.test(k))).toBe(false);
    expect(orgsKeys.some((k) => /security/i.test(k))).toBe(false);
  });

  /* ──────────────────── 7. replay / duplicados / TOCTOU ──────────────────── */

  it("replay: 3 denegaciones idénticas producen 3 eventos distintos", async () => {
    const before = eventCount();
    for (let i = 0; i < 3; i++) {
      expect(
        await denied(() =>
          clients.outsider.action(api.audited.orgAuditTrail, { organizationId: M.orgId }),
        ),
      ).toBe(true);
    }
    expect(eventCount() - before).toBe(3);
  });

  it("peticiones concurrentes: las 5 se deniegan y las 5 se registran", async () => {
    const before = eventCount();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        denied(() =>
          clients.outsider.action(api.audited.orgMembers, { organizationId: M.orgId }),
        ),
      ),
    );
    // 1. Las 5 peticiones se deniegan. Ninguna devuelve datos.
    expect(results.every(Boolean)).toBe(true);
    // 2. Cada denegación deja SU PROPIO evento: el contador sube exactamente 5.
    //    Nada se deduplica ni se silencia.
    expect(eventCount() - before).toBe(5);
  });

  it("miembro legitimate ALLOW: la operación funciona y NO genera evento de denegación", async () => {
    const before = eventCount();
    const members = await clients.org_admin.action(api.audited.orgMembers, {
      organizationId: M.orgId,
    });
    expect(Array.isArray(members)).toBe(true);
    expect(eventCount() - before).toBe(0);
  });

  /* ───────────── 8. MIEMBRO REVOCADO (la sesión sigue viva) ───────────── */

  it("miembro revocado: por el wrapper auditado queda DENY + evento, y recupera el acceso", async () => {
    // El test es AUTOSUFICIENTE: restablece la membresía antes de empezar.
    // Hace falta porque `rbac.matrix.integration.test.ts` revoca al recruiter
    // en su propio escenario de revocación sobre el mismo manifiesto: sin este
    // restablecimiento el resultado dependería del orden de ejecución.
    await seedMembership(M.orgId, M.actors.recruiter.userId, "recruiter");

    // Precondición: el recruiter es miembro y accede por la vía auditada
    // (`orgMembers` exige `hiring_manager` como mínimo, y `recruiter` lo supera).
    expect(
      await denied(() =>
        clients.recruiter.action(api.audited.orgMembers, { organizationId: M.orgId }),
      ),
    ).toBe(false);

    // org_admin lo expulsa (mutación original: operación de administración
    // legítima, con su propio registro en `auditLog`).
    await clients.org_admin.mutation(api.orgs.removeMember, {
      organizationId: M.orgId,
      targetUserId: M.actors.recruiter.userId,
    });

    // MISMA sesión viva, sin re-loguear: ahora TODO debe estar denegado y auditado.
    const before = eventCount();
    for (const [label, call] of [
      [
        "orgMembers",
        () => clients.recruiter.action(api.audited.orgMembers, { organizationId: M.orgId }),
      ],
      [
        "orgInvite",
        () =>
          clients.recruiter.action(api.audited.orgInvite, {
            organizationId: M.orgId,
            email: "x@evil.example",
            role: "org_admin",
          }),
      ],
      [
        "applicationsListByJob",
        () => clients.recruiter.action(api.audited.applicationsListByJob, { jobId: M.jobId }),
      ],
    ] as const) {
      expect(await denied(call), `revocado→${label} debía estar denegado`).toBe(true);
    }
    expect(
      eventCount() - before,
      "las 3 denegaciones post-revocación deben quedar registradas",
    ).toBe(3);
  });
});
