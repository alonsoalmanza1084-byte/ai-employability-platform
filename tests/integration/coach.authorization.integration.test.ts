/* eslint-disable @typescript-eslint/no-explicit-any -- cliente E2E contra BD real */
/**
 * CAREER COACH — INCREMENTO 1 (solo lectura): autorización y fail-closed
 * verificados contra la base de datos REAL (sin mocks, sin stubs del proveedor).
 *
 * Qué se verifica aquí:
 *
 *   1. AISLAMIENTO A→B: el usuario B no ve la conversación de A
 *      (`getConversation` → null) ni puede escribir en ella (`sendMessage` →
 *      NOT_FOUND). La denegación ocurre en `prepareSend`, ANTES de cualquier
 *      llamada a la IA, y deja la conversación de A intacta (0 mensajes).
 *   2. GATE SIN PERFIL: sin `candidateProfiles`, `sendMessage` devuelve
 *      NO_PROFILE sin llamar al proveedor y sin escribir mensajes parciales.
 *   3. VALIDACIÓN DE ENTRADA: mensaje vacío → VALIDATION, 0 escrituras.
 *   4. READ-ONLY REAL: con perfil sembrado (fixture por importación de datos,
 *      el mismo mecanismo documentado en accountDeletion/rbac), un envío real
 *      —vuelva o no el proveedor— NUNCA modifica `candidateProfiles`
 *      (se compara el documento completo antes/después).
 *      - Si la IA responde (ok:true): el intercambio se persiste completo
 *        (user + assistant) con `intent` dentro del enum cerrado.
 *      - Si falla (ok:false): código en el enum cerrado y CERO escrituras
 *        parciales (fail-closed). Ambos caminos son aserciones reales.
 *
 * Fixtures: las conversaciones se crean con la mutación de producción; el
 * perfil se siembra por `convex import --append` (no hay endpoint que cree un
 * perfil sin ejecutar una extracción con IA). Los usuarios son anónimos y
 * NUEVOS en cada ejecución, así que las cuotas arrancan a 0.
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

describe("career coach — autorización y fail-closed (BD real)", () => {
  it("aislamiento A→B: B no ve ni puede escribir en la conversación de A", async () => {
    const a = await newClient();
    const b = await newClient();

    const start: any = await a.client.mutation(api.coach.startConversation, {});
    expect(start.ok).toBe(true);

    const mine: any = await a.client.query(api.coach.getConversation, {});
    expect(mine?.conversation?._id).toBe(start.conversationId);
    expect(mine.messages).toHaveLength(0);

    // B: la query es ownership por sesión → nada que ver.
    const theirs: any = await b.client.query(api.coach.getConversation, {});
    expect(theirs).toBeNull();

    // B escribe en el hilo de A → denegado ANTES de la IA, sin escrituras.
    const res: any = await b.client.action(api.coach.sendMessage, {
      conversationId: start.conversationId,
      message: "intento cruzado",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("NOT_FOUND");

    const after: any = await a.client.query(api.coach.getConversation, {});
    expect(after.messages).toHaveLength(0);
    expect(after.conversation?._id).toBe(start.conversationId);
  });

  it("sin perfil el gate falla ANTES de la IA (NO_PROFILE, sin mensajes)", async () => {
    const c = await newClient();
    const start: any = await c.client.mutation(api.coach.startConversation, {});
    expect(start.ok).toBe(true);

    const res: any = await c.client.action(api.coach.sendMessage, {
      conversationId: start.conversationId,
      message: "¿Cómo voy en mi diagnóstico?",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("NO_PROFILE");

    const after: any = await c.client.query(api.coach.getConversation, {});
    expect(after.messages).toHaveLength(0);
  });

  it("validación de entrada: mensaje vacío denegado sin escribir nada", async () => {
    const c = await newClient();
    const start: any = await c.client.mutation(api.coach.startConversation, {});
    expect(start.ok).toBe(true);

    const res: any = await c.client.action(api.coach.sendMessage, {
      conversationId: start.conversationId,
      message: "    ",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("VALIDATION");

    const after: any = await c.client.query(api.coach.getConversation, {});
    expect(after.messages).toHaveLength(0);
  });

  it("read-only real: el envío NUNCA modifica candidateProfiles (cualquier camino)", async () => {
    const a = await newClient();
    // Fixture de perfil: importación de datos (mecanismo ya documentado).
    importRow("candidateProfiles", {
      userId: a.userId,
      fullName: "Ada Ejemplo",
      headline: "Analista de datos con 4 años en BI",
      summary:
        "Analista de datos centrada en reporting y automatización de indicadores.",
      yearsExperience: 4,
      skills: [
        { name: "SQL", level: 4, source: "human" },
        { name: "Python", level: 3, source: "human" },
        { name: "Power BI", level: 4, source: "human" },
      ],
      experience: [
        {
          company: "Ejemplo Data",
          title: "Analista de datos",
          start: "2021-03",
          end: "2025-01",
          description:
            "Construcción de cuadros de mando y pipelines de indicadores.",
          achievements: ["Automatización de 12 informes mensuales"],
          source: "human",
        },
      ],
      education: [],
      certifications: [],
      updatedAt: Date.now(),
    });

    const before: any = await a.client.query(api.candidates.myProfile, {});
    expect(before).not.toBeNull();

    const start: any = await a.client.mutation(api.coach.startConversation, {});
    expect(start.ok).toBe(true);

    const res: any = await a.client.action(api.coach.sendMessage, {
      conversationId: start.conversationId,
      message: "Explica mi diagnóstico: ¿por qué el impacto es lo más bajo?",
    });

    // INVARIANTE EN AMBOS CAMINOS: el perfil NO cambió jamás (solo lectura).
    const after: any = await a.client.query(api.candidates.myProfile, {});
    expect(after).toEqual(before);

    const conv: any = await a.client.query(api.coach.getConversation, {});
    if (res.ok) {
      // Camino con IA: intercambio completo y dentro del enum cerrado.
      expect(conv.messages).toHaveLength(2);
      expect(conv.messages[0].role).toBe("user");
      const last = conv.messages[conv.messages.length - 1];
      expect(last.role).toBe("assistant");
      expect([
        "explain_diagnosis",
        "ask_question",
        "discover_gap",
        "general",
      ]).toContain(last.intent);
      expect(last.observations.length).toBeLessThanOrEqual(8);
      expect(last.confidence).toBeGreaterThanOrEqual(0);
      expect(last.confidence).toBeLessThanOrEqual(1);
    } else {
      // Camino de fallo: código cerrado y CERO escrituras parciales.
      expect([
        "RATE_LIMITED",
        "TIMEOUT",
        "SCHEMA_INVALID",
        "PROVIDER_ERROR",
        "CONTENT_FILTERED",
        "INTERNAL",
        "CONVERSATION_FULL",
        "CONVERSATION_BUDGET",
        "DUPLICATE",
      ]).toContain(res.code);
      expect(conv.messages).toHaveLength(0);
    }
  });
});
