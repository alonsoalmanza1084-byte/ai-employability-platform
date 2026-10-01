/**
 * Tests estáticos de superficie de API y posturas de seguridad del código.
 * Fallan si alguien re-expone una función interna al cliente o introduce
 * logging/secretos en el servidor. Sin BD ni red: lee el código fuente real.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "src", "convex");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const allConvexSources = (): { file: string; code: string }[] =>
  (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !f.includes("_generated"))
    .map((f) => ({ file: f, code: read(f) }));

/** Extrae el kind de `export const NAME = (mutation|query|action|internalMutation|internalQuery)(...)`. */
function exportedFunctionKind(source: string, name: string): string | null {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*(mutation|query|action|internalMutation|internalQuery)\\s*\\(`,
  );
  const m = source.match(re);
  return m ? m[1] : null;
}

describe("superficie pública vs interna (auditoría A-01/A-02)", () => {
  const candidates = read("candidates.ts");
  const applications = read("applications.ts");

  it("candidates: las 4 funciones del pipeline de IA son INTERNAL (no invocables por el cliente)", () => {
    for (const fn of ["recordExtraction", "applyExtraction", "markProcessing", "markFailed"]) {
      expect(exportedFunctionKind(candidates, fn)).toBe("internalMutation");
    }
    expect(exportedFunctionKind(candidates, "getVersionForIngest")).toBe("internalQuery");
    expect(exportedFunctionKind(candidates, "countExtractionAttempts")).toBe("internalQuery");
  });

  it("applications: las 5 funciones del pipeline de IA son INTERNAL", () => {
    for (const fn of ["recordExtraction", "applyExtraction", "markProcessing", "markFailed"]) {
      expect(exportedFunctionKind(applications, fn)).toBe("internalMutation");
    }
    expect(exportedFunctionKind(applications, "getForIngest")).toBe("internalQuery");
    expect(exportedFunctionKind(applications, "countExtractionAttempts")).toBe("internalQuery");
  });

  it("los pipelines ya no llaman a la API pública: solo internal.* (cierre del bypass)", () => {
    for (const [file, code] of [
      ["candidates.ts", candidates],
      ["applications.ts", applications],
    ] as const) {
      const publicCalls = code.match(/run(Query|Mutation)\(\s*api\./g) ?? [];
      expect(publicCalls, `${file} aún usa ctx.run*() con api.*: ${publicCalls.length}`).toHaveLength(0);
      expect(code).toContain("internal.");
    }
  });

  it("los endpoints públicos restantes conservan su visibilidad (contrato con el frontend)", () => {
    const publicEndpoints: [string, string, string][] = [
      ["candidates.ts", "myProfile", "query"],
      ["candidates.ts", "myResumes", "query"],
      ["candidates.ts", "initUpload", "mutation"],
      ["candidates.ts", "finalizeUpload", "mutation"],
      ["candidates.ts", "ingestCv", "action"],
      ["candidates.ts", "setActiveVersion", "mutation"],
      ["candidates.ts", "updateProfile", "mutation"],
      ["applications.ts", "initUpload", "mutation"],
      ["applications.ts", "finalizeUpload", "mutation"],
      ["applications.ts", "ingestCv", "action"],
      ["applications.ts", "listByJob", "query"],
      ["applications.ts", "decide", "mutation"],
      ["applications.ts", "addNote", "mutation"],
      ["applications.ts", "notesFor", "query"],
      ["jobs.ts", "listByOrg", "query"],
      ["jobs.ts", "get", "query"],
      ["jobs.ts", "create", "mutation"],
      ["jobs.ts", "close", "mutation"],
      ["orgs.ts", "myOrgs", "query"],
      ["orgs.ts", "create", "mutation"],
      ["orgs.ts", "members", "query"],
      ["orgs.ts", "invite", "mutation"],
      ["orgs.ts", "acceptInvite", "mutation"],
      ["matches.ts", "getForApplication", "query"],
    ];
    for (const [file, fn, kind] of publicEndpoints) {
      expect(exportedFunctionKind(read(file), fn), `${file}.${fn}`).toBe(kind);
    }
  });
});

describe("defensa contra mass assignment (audit A-03)", () => {
  it("updateProfile no esparce args en el patch: construcción explícita de campos", () => {
    const code = read("candidates.ts");
    const updateProfile = code.slice(code.indexOf("export const updateProfile"));
    expect(updateProfile).not.toMatch(/\.\.\.args/);
    expect(updateProfile).toMatch(/if \(args\.fullName !== undefined\)/);
    // Nunca patchea userId/_id/diagnosis directamente.
    expect(updateProfile).not.toMatch(/patch\.(userId|_id|diagnosis)\s*=/);
    expect(updateProfile).not.toMatch(/userId:\s*args\.userId/);
  });

  it("los validadores no exponen userId/_id/diagnosis como campos seteables", () => {
    const code = read("candidates.ts");
    const patchDef = code.slice(code.indexOf("const profilePatch = v.object"));
    expect(patchDef).not.toContain("userId:");
    expect(patchDef).not.toContain("diagnosis:");
  });
});

describe("higiene de logging y secretos (DATA LEAKAGE)", () => {
  it("ningún módulo del servidor usa console.* (ni logs de CVs, tokens o claves)", () => {
    for (const { file, code } of allConvexSources()) {
      expect(code.match(/console\.(log|info|debug|warn|error)\s*\(/), `en ${file}`).toBeNull();
    }
  });

  it("ningún módulo imprime ni devuelve texto extraído de CVs vía audit metadata", () => {
    for (const { file, code } of allConvexSources()) {
      const audits = code.match(/audit\(ctx,[\s\S]*?\}\)/g) ?? [];
      for (const a of audits) {
        expect(a, `audit en ${file} incluye extractedText`).not.toContain("extractedText");
        expect(a, `audit en ${file} incluye texto del CV`).not.toContain("text");
      }
    }
  });

  it("las API keys solo se leen de process.env en el servidor y nunca se loguean", () => {
    const provider = read("lib/ai/openai_provider.ts");
    expect(provider).toContain("process.env.OPENAI_API_KEY");
    expect(provider).not.toMatch(/apiKey\s*[:=]\s*["']/);
    // Nada en el cliente importa el proveedor de IA.
    const clientSources = readdirSync(join(__dirname, "..", "..", "src"), { recursive: true }) as string[];
    for (const f of clientSources.filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("convex"))) {
      const code = readFileSync(join(__dirname, "..", "..", "src", f), "utf8");
      expect(code.includes("openai_provider"), `${f} importa el proveedor IA`).toBe(false);
    }
  });

  it("los tokens de invitación se guardan hasheados (nunca el token plano en BD)", () => {
    const orgs = read("orgs.ts");
    expect(orgs).toMatch(/hashToken\(token\)/);
    expect(orgs).not.toMatch(/token:\s*token\b/); // insertaría el plano
    expect(orgs).toContain("tokenHash");
  });
});

describe("rate limits y validación server-side", () => {
  it("decide y addNote ENFORZAN su límite (no solo lo cuentan)", () => {
    const applications = read("applications.ts");
    const decide = applications.slice(applications.indexOf("export const decide"));
    expect(decide).toMatch(/used\s*>=\s*LIMITS\.decisionsPerDay/);
    expect(decide).not.toMatch(/void used/);
    const addNote = applications.slice(applications.indexOf("export const addNote"));
    expect(addNote).toMatch(/LIMITS\.notesPerDay/);
  });

  it("ambos pipelines capan los intentos de IA por documento (anti burn de tokens)", () => {
    for (const file of ["candidates.ts", "applications.ts"] as const) {
      expect(read(file)).toMatch(/attempts\.length\s*>=\s*3/);
    }
  });

  it("el tamaño máximo de archivo se valida en ambos finalizeUpload", () => {
    for (const file of ["candidates.ts", "applications.ts"] as const) {
      const code = read(file);
      const finalize = code.slice(code.indexOf("export const finalizeUpload"));
      expect(finalize).toMatch(/MAX_FILE_BYTES/);
      expect(finalize).toMatch(/storage\.delete/); // limpia el binario huérfano
    }
  });

  it("la extensión se re-verifica en finalize (no solo en init)", () => {
    for (const file of ["candidates.ts", "applications.ts"] as const) {
      const code = read(file);
      const finalize = code.slice(code.indexOf("export const finalizeUpload"));
      expect(finalize).toContain("pdf|docx|txt"); // re-check de extensión
    }
  });
});

describe("multi-tenancy: toda función pública de org verifica membresía", () => {
  it("cada endpoint público de applications/jobs/matches llama a requireMembership", () => {
    const expectMembership: [string, string[]][] = [
      ["applications.ts", ["initUpload", "finalizeUpload", "listByJob", "decide", "addNote", "notesFor"]],
      ["jobs.ts", ["listByOrg", "get", "create", "close"]],
      ["matches.ts", ["getForApplication"]],
      ["orgs.ts", ["members", "invite", "pendingInvites"]],
    ];
    for (const [file, fns] of expectMembership) {
      const code = read(file);
      for (const fn of fns) {
        const body = code.slice(code.indexOf(`export const ${fn}`));
        const nextExport = body.indexOf("export const", 20);
        const scope = nextExport === -1 ? body : body.slice(0, nextExport);
        expect(scope, `${file}.${fn} no verifica membresía`).toContain("requireMembership");
      }
    }
  });

  it("el módulo candidato nunca acepta userId del cliente (ownership por sesión)", () => {
    const code = read("candidates.ts");
    // Ningún args de función pública incluye userId.
    expect(code).not.toMatch(/args:\s*\{[^}]*userId/);
    // Ownership verificado contra requireSelf / userId de sesión.
    expect(code).toContain("requireSelf");
  });

  it("el audit log no expone mutaciones públicas (solo se escribe server-side)", () => {
    // Ningún módulo exporta funciones sobre auditLog/securityEvents.
    for (const { file, code } of allConvexSources()) {
      if (file.startsWith("lib")) continue;
      expect(code, `${file} expone auditLog públicamente`).not.toMatch(/export const \w+ = (mutation|query)\(\{[\s\S]{0,400}?"auditLog"/);
      expect(code, `${file} expone securityEvents públicamente`).not.toMatch(/export const \w+ = (mutation|query)\(\{[\s\S]{0,400}?"securityEvents"/);
    }
  });
});
