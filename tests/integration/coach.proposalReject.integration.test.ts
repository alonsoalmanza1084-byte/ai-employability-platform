/* eslint-disable @typescript-eslint/no-explicit-any -- cliente E2E contra BD real */
/**
 * UI DE PROPOSALS (R3) — flujo real contra la base de datos REAL:
 *   UI (cliente HTTP con sesión) → mutation pública `rejectProposalByOwner`
 *   → ownership → transición pending → rejected → audit → refresh (listProposals).
 *
 * El ConvexHttpClient invoca EXACTAMENTE la misma función pública que invoca
 * el componente Coach() de la UI (mismo args: solo proposalId, jamás userId).
 *
 * Fixtures: la conversación se crea con la mutación de producción; el perfil
 * y las filas de claims/proposals se siembran por `convex import --append`
 * (mismo mecanismo documentado en coach.authorization/accountDeletion: no hay
 * endpoint público que cree una proposal sin pasar por el LLM, que está
 * BLOCKED_BY_PROVIDER). Los usuarios son anónimos y NUEVOS en cada ejecución.
 *
 * Cubre los escenarios §9 que requieren BD: reject exitoso, reject fallido
 * (INVALID_STATE / NOT_FOUND / sin sesión), ownership (INV-UI-007),
 * ausencia de mutación de candidateProfiles (INV-UI-006), invariantes
 * pending | rejected (INV-UI-002/010) y auditoría `coach.proposal.reject`.
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

/** Siembra una fila por importación de datos (fixture, sin endpoint nuevo). */
function importRow(table: string, doc: Record<string, unknown>): void {
  mkdirSync("/tmp/tf", { recursive: true });
  const path = `/tmp/tf/${table}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`;
  writeFileSync(path, JSON.stringify(doc) + "\n");
  execFileSync(
    "bunx",
    ["convex", "import", "--table", table, "--append", "-y", path],
    { encoding: "utf8", stdio: "pipe" },
  );
}

/** Filas de una tabla como JSON (lectura acotada explícita). */
function readRows(table: string): any[] {
  const out = execFileSync(
    "bunx",
    ["convex", "data", table, "--format", "json", "--limit", "2000"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  return JSON.parse(out.slice(start, end + 1)) as any[];
}

/** Identidad anónima NUEVA por cada llamada (cuotas propias, a 0). */
async function newClient(): Promise<{ client: ConvexHttpClient; userId: string }> {
  const client = new ConvexHttpClient(CONVEX_URL!);
  const session: any = await client.action(api["auth"]["signIn"], {
    provider: "anonymous",
  });
  const token = session?.tokens?.token;
  if (!token) throw new Error("sin sesión anónima");
  client.setAuth(token);
  const user: any = await client.query(api["users"]["currentUser"]);
  return { client, userId: String(user._id) };
}

const marker = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Siembra claim + proposal pendiente de `owner` y devuelve los ids reales. */
function seedProposal(opts: {
  owner: { userId: string };
  conversationId: string;
  claimText: string;
  proposedText: string;
}): { claimId: string; proposalId: string } {
  importRow("coachClaims", {
    userId: opts.owner.userId,
    conversationId: opts.conversationId,
    claimText: opts.claimText,
    status: "verified",
    confidence: 0.8,
    promptVersion: "career_coach.v1.2",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const claim = readRows("coachClaims").find(
    (c) => c.claimText === opts.claimText,
  );
  if (!claim) throw new Error("fixture de claim no encontrada");

  importRow("coachProposals", {
    userId: opts.owner.userId,
    claimId: claim._id,
    conversationId: opts.conversationId,
    proposedText: opts.proposedText,
    status: "pending",
    confidence: 0.8,
    promptVersion: "career_coach.v1.2",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const proposal = readRows("coachProposals").find(
    (p) => p.proposedText === opts.proposedText,
  );
  if (!proposal) throw new Error("fixture de proposal no encontrada");
  return { claimId: String(claim._id), proposalId: String(proposal._id) };
}

describe("career coach — rechazo de proposals (BD real, flujo UI→mutación→audit)", () => {
  it("flujo del dueño: pending → rejected, audit, refresh y perfil intacto (INV-UI-006)", async () => {
    const a = await newClient();

    // Perfil fixture (mismo mecanismo documentado en coach.authorization).
    importRow("candidateProfiles", {
      userId: a.userId,
      fullName: "Ada Ejemplo",
      headline: "Analista de datos con 4 años en BI",
      summary: "Perfil de prueba para el flujo de rechazo de propuestas.",
      yearsExperience: 4,
      skills: [{ name: "SQL", level: 4, source: "human" }],
      experience: [],
      education: [],
      certifications: [],
      updatedAt: Date.now(),
    });

    const start: any = await a.client.mutation(api.coach.startConversation, {});
    expect(start.ok).toBe(true);
    const conversationId = String(start.conversationId);

    const m = marker();
    const { proposalId } = seedProposal({
      owner: a,
      conversationId,
      claimText: `claim-fixture-${m}`,
      proposedText: `propuesta-fixture-${m}`,
    });

    // La UI carga la lista ANTES del rechazo (mismo args que Coach()).
    const before: any = await a.client.query(api.coach.listProposals, {
      conversationId,
    });
    const target = before.proposals.find((p: any) => p._id === proposalId);
    expect(target?.status).toBe("pending");
    const profileBefore: any = await a.client.query(api.candidates.myProfile, {});
    expect(profileBefore).not.toBeNull();

    // UI → confirmación → mutation pública (solo proposalId, jamás userId).
    const res: any = await a.client.mutation(api.coach.rejectProposalByOwner, {
      proposalId,
    });
    expect(res).toEqual({ ok: true });

    // REFRESH: lo que la query reactiva de la UI pinta tras el commit.
    const after: any = await a.client.query(api.coach.listProposals, {
      conversationId,
    });
    const rejected = after.proposals.find((p: any) => p._id === proposalId);
    expect(rejected?.status).toBe("rejected");
    // INV-UI-002/010: solo pending | rejected; jamás accepted.
    for (const p of after.proposals) {
      expect(["pending", "rejected"]).toContain(p.status);
    }

    // Auditoría real: la acción cerrada coach.proposal.reject del dueño.
    const auditRows = readRows("auditLog").filter(
      (r) =>
        r.action === "coach.proposal.reject" && String(r.actorUserId) === a.userId,
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(String(auditRows[0].targetId)).toBe(conversationId);

    // INV-UI-006: el rechazo NUNCA modifica candidateProfiles.
    const profileAfter: any = await a.client.query(api.candidates.myProfile, {});
    expect(profileAfter).toEqual(profileBefore);

    // Reintento/doble click sobre una rejected → error real, sin cambio ni falso éxito.
    const again: any = await a.client.mutation(api.coach.rejectProposalByOwner, {
      proposalId,
    });
    expect(again.ok).toBe(false);
    expect(again.code).toBe("INVALID_STATE");
    expect(typeof again.reason).toBe("string");
    const finalList: any = await a.client.query(api.coach.listProposals, {
      conversationId,
    });
    expect(
      finalList.proposals.find((p: any) => p._id === proposalId)?.status,
    ).toBe("rejected");
  }, 120_000);

  it("ownership (INV-UI-007): B no rechaza ni ve proposals de A", async () => {
    const a = await newClient();
    const b = await newClient();

    const start: any = await a.client.mutation(api.coach.startConversation, {});
    expect(start.ok).toBe(true);
    const conversationId = String(start.conversationId);

    const m = marker();
    const { proposalId } = seedProposal({
      owner: a,
      conversationId,
      claimText: `claim-own-${m}`,
      proposedText: `propuesta-own-${m}`,
    });

    // B rechaza la proposal de A → NOT_FOUND (sin filtrar existencia), sin escrituras.
    const res: any = await b.client.mutation(api.coach.rejectProposalByOwner, {
      proposalId,
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("NOT_FOUND");

    // A la sigue viendo PENDING (la tentación de B no cambió nada).
    const mine: any = await a.client.query(api.coach.listProposals, {
      conversationId,
    });
    expect(
      mine.proposals.find((p: any) => p._id === proposalId)?.status,
    ).toBe("pending");

    // B no ve las proposals de A en su propia lista (la query es ownership por sesión).
    const theirs: any = await b.client.query(api.coach.listProposals, {
      conversationId,
    });
    expect(theirs.proposals).toHaveLength(0);

    // Ninguna auditoría cruzada: el audit del dueño no existe para la acción de B.
    const bAudit = readRows("auditLog").filter(
      (r) =>
        r.action === "coach.proposal.reject" && String(r.actorUserId) === b.userId,
    );
    expect(bAudit).toHaveLength(0);
  }, 120_000);

  it("sin sesión la mutation pública es inaccesible (UNAUTHENTICATED) y los ids malformados no alcanzan el handler", async () => {
    const a = await newClient();
    const start: any = await a.client.mutation(api.coach.startConversation, {});
    const m = marker();
    const { proposalId } = seedProposal({
      owner: a,
      conversationId: String(start.conversationId),
      claimText: `claim-anon-${m}`,
      proposedText: `propuesta-anon-${m}`,
    });

    const anon = new ConvexHttpClient(CONVEX_URL!);
    const noSession = await anon
      .mutation(api.coach.rejectProposalByOwner, { proposalId })
      .then(() => "ok", (e: unknown) => String(e));
    expect(noSession).not.toBe("ok");
    expect(noSession).toContain("UNAUTHENTICATED");

    // Id malformado → Convex rechaza el args ANTES del handler.
    await expect(
      a.client.mutation(api.coach.rejectProposalByOwner, {
        proposalId: "fake-proposal-id",
      }),
    ).rejects.toThrow();

    // La propuesta sigue intacta tras ambos intentos.
    const mine: any = await a.client.query(api.coach.listProposals, {
      conversationId: String(start.conversationId),
    });
    expect(
      mine.proposals.find((p: any) => p._id === proposalId)?.status,
    ).toBe("pending");
  }, 120_000);
});
