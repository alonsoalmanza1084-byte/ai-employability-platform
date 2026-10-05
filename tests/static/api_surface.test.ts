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

/** Código sin comentarios (para regexes que no deben coincidir con docstrings). */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

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
      ["orgs.ts", "pendingInvites", "query"],
      ["orgs.ts", "revokeInvite", "mutation"],
      ["orgs.ts", "removeMember", "mutation"],
      ["orgs.ts", "auditTrail", "query"],
      ["matches.ts", "getForApplication", "query"],
      ["coach.ts", "getConversation", "query"],
      ["coach.ts", "startConversation", "mutation"],
      ["coach.ts", "sendMessage", "action"],
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
      ["orgs.ts", ["members", "invite", "pendingInvites", "revokeInvite", "removeMember", "auditTrail"]],
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
    // Ningún módulo exporta MUTACIONES sobre auditLog/securityEvents.
    // Única excepción de LECTURA: orgs.auditTrail, gated a org_admin y paginado
    // (auditoría #3) — la escritura del trail sigue siendo exclusivamente server-side.
    const READ_ONLY_ALLOWED = new Set(["orgs.ts:auditTrail"]);
    for (const { file, code } of allConvexSources()) {
      if (file.startsWith("lib")) continue;
      const re = /export const (\w+)\s*=\s*(mutation|query|action|internalMutation|internalQuery)\s*\(\{[\s\S]{0,600}?"(auditLog|securityEvents)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const key = `${file}:${m[1]}`;
        if (READ_ONLY_ALLOWED.has(key)) {
          expect(m[2], `${key} debe ser lectura, nunca escritura`).toBe("query");
          continue;
        }
        throw new Error(`${key} expone la tabla ${m[3]} públicamente (${m[2]})`);
      }
    }
  });

  it("la única lectura pública del audit trail exige org_admin y pagina", () => {
    const orgs = read("orgs.ts");
    const body = orgs.slice(orgs.indexOf("export const auditTrail"));
    expect(body).toMatch(/requireMembership\(ctx, args\.organizationId, "org_admin"\)/);
    // No acepta userId/organizationId libre: el tenant sale de args validado por rol.
    expect(body).not.toMatch(/args\.userId/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// CAREER COACH IA — incremento 1 (solo lectura): guards del módulo nuevo.
// ───────────────────────────────────────────────────────────────────────

describe("career coach (incremento 1): solo lectura, cuotas y telemetría", () => {
  const coach = read("coach.ts");

  it("las 3 funciones públicas exigen requireSelf (ownership por sesión)", () => {
    for (const fn of ["getConversation", "startConversation", "sendMessage"]) {
      const start = coach.indexOf(`export const ${fn}`);
      expect(start, `coach.${fn} no existe`).toBeGreaterThanOrEqual(0);
      const next = coach.indexOf("export const ", start + 10);
      const scope = next === -1 ? coach.slice(start) : coach.slice(start, next);
      expect(scope, `coach.${fn} no verifica ownership`).toContain("requireSelf");
      // Ninguna función pública acepta userId del cliente.
      expect(scope, `coach.${fn} acepta userId del cliente`).not.toMatch(
        /args:\s*\{[^}]*userId/,
      );
    }
  });

  it("las cuotas se ENFORZAN antes de llamar a la IA (fail-closed)", () => {
    expect(coach).toMatch(/thisHour >= LIMITS\.coachMessagesPerHour/);
    expect(coach).toMatch(/today >= LIMITS\.coachMessagesPerDay/);
    expect(coach).toMatch(/created >= LIMITS\.coachConversationsPerDay/);
    // El consumo de cuota (recordUsage) ocurre ANTES del proveedor en el
    // fuente: un fallo posterior de la IA no devuelve presupuesto.
    const consume = coach.indexOf("dedupeKey: `coach.message:");
    const provider = coach.indexOf("getAIProvider");
    expect(consume).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(consume);
  });

  it("el coach NUNCA escribe en el perfil ni aplica extracciones", () => {
    expect(coach).not.toMatch(/(insert|patch)\(\s*"candidateProfiles"/);
    expect(coach).not.toContain("applyExtraction");
    expect(coach).not.toContain("updateProfile");
  });

  it("usa únicamente los eventos de auditoría previstos (sin contenido)", () => {
    const actions = [...coach.matchAll(/action: "(coach\.[a-z.]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(actions)).toEqual(
      new Set([
        "coach.session.start",
        "coach.message.create",
        "coach.ai.failed",
      ]),
    );
    // Los límites se registran como securityEvent (convención de cv.upload).
    expect(coach).toMatch(/kind: "rate_limited"/);
    // Telemetría: solo códigos cerrados, jamás el mensaje crudo del proveedor.
    expect(coach).toContain("AI_ERROR_CODES");
  });

  it("las lecturas están acotadas (.take, sin .collect()) y sin v.any()", () => {
    expect(stripComments(coach)).not.toMatch(/\.collect\(\)/);
    expect(stripComments(coach)).not.toMatch(/v\.any\(\)/);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AUDITORÍA #2 — hardening estructural verificado estáticamente.
// ───────────────────────────────────────────────────────────────────────

describe("auditoría #2: inventario exhaustivo de funciones públicas", () => {
  it("la lista pública declarada es EXACTAMENTE la superficie real (sin funciones sin clasificar)", () => {
    // Inventario autorizado: función → visibilidad esperada.
    // Cualquier función nueva SIN aparecer aquí rompe el test: obliga a
    // clasificarla (pública con auth, o internal) antes de fusionar.
    const INVENTORY: Record<string, string> = {
      // VULN-14 — auditoría de denegaciones. `internal/*` NO es alcanzable desde
      // el cliente. `classifyAuthorization` es SOLO LECTURA y no autoriza nada;
      // `logDenial` es la ÚNICA función del sistema que escribe securityEvents
      // por decisión de autorización, y todos sus campos se derivan en servidor.
      "internal/authorization.ts:classifyAuthorization": "internalQuery",
      "internal/authorization.ts:logDenial": "internalMutation",
      "internal/authorization.ts:_selfCheck": "internalQuery",
      // Wrappers auditados (VULN-14). Son `action` que delegan en las funciones
      // públicas originales; no añaden autorización ni la sustituyen.
      "audited.ts:orgMembers": "auditedAction",
      "audited.ts:orgInvite": "auditedAction",
      "audited.ts:orgPendingInvites": "auditedAction",
      "audited.ts:orgRevokeInvite": "auditedAction",
      "audited.ts:orgRemoveMember": "auditedAction",
      "audited.ts:orgAuditTrail": "auditedAction",
      "audited.ts:jobsListByOrg": "auditedAction",
      "audited.ts:jobsGet": "auditedAction",
      "audited.ts:jobsCreate": "auditedAction",
      "audited.ts:jobsClose": "auditedAction",
      "audited.ts:applicationsListByJob": "auditedAction",
      "audited.ts:applicationsDecide": "auditedAction",
      "audited.ts:applicationsAddNote": "auditedAction",
      "audited.ts:applicationsNotesFor": "auditedAction",
      "audited.ts:applicationsInitUpload": "auditedAction",
      "audited.ts:applicationsFinalizeUpload": "auditedAction",
      "audited.ts:matchesGetForApplication": "auditedAction",
      // users (template)
      "users.ts:currentUser": "query", // pública, devuelve null sin sesión (template, READ-ONLY)
      // candidates — candidata: requireSelf + ownership en cada recurso
      "candidates.ts:myProfile": "query",
      "candidates.ts:myResumes": "query",
      "candidates.ts:diagnosis": "query",
      "candidates.ts:initUpload": "mutation",
      "candidates.ts:finalizeUpload": "mutation",
      "candidates.ts:ingestCv": "action",
      "candidates.ts:setActiveVersion": "mutation",
      "candidates.ts:updateProfile": "mutation",
      "candidates.ts:getVersionForIngest": "internalQuery",
      "candidates.ts:countExtractionAttempts": "internalQuery",
      "candidates.ts:markProcessing": "internalMutation",
      "candidates.ts:markFailed": "internalMutation",
      "candidates.ts:recordExtraction": "internalMutation",
      "candidates.ts:applyExtraction": "internalMutation",
      // applications — org: requireMembership en cada recurso
      "applications.ts:initUpload": "mutation",
      "applications.ts:finalizeUpload": "mutation",
      "applications.ts:ingestCv": "action",
      "applications.ts:listByJob": "query",
      "applications.ts:decide": "mutation",
      "applications.ts:addNote": "mutation",
      "applications.ts:notesFor": "query",
      "applications.ts:getForIngest": "internalQuery",
      "applications.ts:countExtractionAttempts": "internalQuery",
      "applications.ts:markProcessing": "internalMutation",
      "applications.ts:markFailed": "internalMutation",
      "applications.ts:recordExtraction": "internalMutation",
      "applications.ts:applyExtraction": "internalMutation",
      // jobs / matches / orgs
      "jobs.ts:listByOrg": "query",
      "jobs.ts:get": "query",
      "jobs.ts:create": "mutation",
      "jobs.ts:close": "mutation",
      "matches.ts:getForApplication": "query",
      "orgs.ts:myOrgs": "query",
      "orgs.ts:create": "mutation",
      "orgs.ts:members": "query",
      "orgs.ts:invite": "mutation",
      "orgs.ts:acceptInvite": "mutation",
      "orgs.ts:pendingInvites": "query",
      "orgs.ts:revokeInvite": "mutation", // auditoría #3: revocación de invitación
      "orgs.ts:removeMember": "mutation", // auditoría #3: revocación de acceso (control, no feature)
      "orgs.ts:auditTrail": "query", // auditoría #3: trail de auditoría solo org_admin
      // account (privacidad, auditoría #2)
      "account.ts:deleteAccount": "mutation",
      // coach (Career Coach IA — incremento 1: SOLO LECTURA).
      // Públicas con requireSelf (ownership por sesión); las internals solo
      // son invocables desde el action sendMessage.
      "coach.ts:getConversation": "query",
      "coach.ts:startConversation": "mutation",
      "coach.ts:sendMessage": "action",
      "coach.ts:prepareSend": "internalMutation",
      "coach.ts:appendExchange": "internalMutation",
      "coach.ts:recordAiFailure": "internalMutation",
    };

    // 1) Todo lo exportado en el código real está en el inventario con la
    //    visibilidad correcta.
    const found = new Set<string>();
    for (const { file, code } of allConvexSources()) {
      if (file.startsWith("lib") || file.startsWith("auth") || file === "auth.ts" || file === "http.ts" || file === "schema.ts") continue;
      const re = /export const (\w+)\s*=\s*(mutation|query|action|internalMutation|internalQuery|auditedAction)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const key = `${file}:${m[1]}`;
        found.add(key);
        expect(INVENTORY, `${key} existe en código pero NO está clasificado en el inventario`).toHaveProperty(key);
        expect(m[2], `${key} visibilidad`).toBe(INVENTORY[key]);
      }
    }
    // 2) Todo el inventario existe en el código (sin entradas fantasma).
    for (const key of Object.keys(INVENTORY)) {
      expect(found.has(key), `${key} está en el inventario pero ya no existe en el código`).toBe(true);
    }
  });

  it("NO queda ningún v.any() en los módulos de Convex (args validados)", () => {
    for (const { file, code } of allConvexSources()) {
      expect(stripComments(code).match(/v\.any\(\)/), `${file} aún usa v.any()`).toBeNull();
    }
  });

  it("schemaValidation está ACTIVADO (no hay schemaValidation: false)", () => {
    const schema = read("schema.ts");
    expect(schema).not.toMatch(/schemaValidation\s*:\s*false/);
    // Los campos que rompían la validación siguen tipados:
    expect(schema).toMatch(/otpSendLog/); // tabla del throttle OTP
  });

  it("las lecturas públicas están acotadas: sin .collect() en queries/mutations de listado", () => {
    // whitelist: los .collect() permitidos (acciones internas con techo por
    // diseño o Lecturas que requieren el set completo; cada una acotada por
    // límites estructurales). Todo lo demás debe usar .take(N).
    const ALLOWED: [string, string][] = [
      ["account.ts", "deleteAccount"], // borrado en cascada acotado por take()s internos
    ];
    for (const { file, code } of allConvexSources()) {
      if (!/[a-z]\.ts$/.test(file) || file.startsWith("lib")) continue;
      if (ALLOWED.some(([f]) => f === file)) continue;
      expect(stripComments(code).match(/\.collect\(\)/), `${file} usa .collect() sin límite`).toBeNull();
    }
  });

  it("requireMembership niega roles desconocidos (fail-closed)", () => {
    const rbac = read("lib/rbac.ts");
    expect(rbac).toMatch(/memberRank === undefined/);
    expect(rbac).toMatch(/FORBIDDEN/);
  });

  it("countUsage acota su lectura (take, no collect)", () => {
    const auditCode = stripComments(read("lib/audit.ts"));
    expect(auditCode).toMatch(/COUNT_USAGE_MAX/);
    expect(auditCode).not.toMatch(/\.collect\(\)/);
  });

  it("el throttle de OTP existe y está cableado en el provider de email", () => {
    expect(read("auth/otpThrottle.ts")).toMatch(/otpSendsPerEmailPerHour/);
    const provider = read("auth/emailOtp.ts");
    expect(provider).toMatch(/verifyOtpSendLimit/);
    // El límite corre ANTES del envío HTTP (orden en el código fuente).
    expect(provider.indexOf("verifyOtpSendLimit")).toBeLessThan(provider.indexOf("axios.post"));
  });

  it("evidence post-check filtra educación/certificaciones no verificables", () => {
    const ev = read("lib/ai/evidence.ts");
    expect(ev).toMatch(/filteredEducation/);
    expect(ev).toMatch(/filteredCertifications/);
    // El filtro se aplica dentro de verifyExtractionAgainstSource (ambos mods)
    expect(ev).toMatch(/education\.filter/);
    expect(ev).toMatch(/certifications\.filter/);
  });

  it("los endpoints de control de la auditoría #3 exigen rol org_admin", () => {
    const orgs = read("orgs.ts");
    for (const fn of ["revokeInvite", "removeMember", "auditTrail"]) {
      const body = orgs.slice(orgs.indexOf(`export const ${fn}`));
      const next = body.indexOf("export const", 20);
      const scope = next === -1 ? body : body.slice(0, next);
      expect(scope, `${fn} debe exigir org_admin`).toContain('requireMembership');
      expect(scope, `${fn} debe exigir org_admin`).toMatch(/requireMembership\([\s\S]*?"org_admin"/);
    }
  });

  it("removeMember se niega a auto-borrarse y a remover a otro org_admin", () => {
    const orgs = read("orgs.ts");
    const start = orgs.indexOf("export const removeMember");
    // Alcance EXACTO de la función: hasta la siguiente exportación (si no, el
    // recorte se comería el resto del archivo y las aserciones serían vacuas).
    const end = orgs.indexOf("export const ", start + 10);
    const body = orgs.slice(start, end === -1 ? undefined : end);
    expect(body).toMatch(/targetUserId === actorId/);
    expect(body).toMatch(/membership\.role === "org_admin"/);
    expect(body).toMatch(/ctx\.db\.delete\(membership\._id\)/);
    // REFUERZO (auditoría #6): la revocación debe ser EXHAUSTIVA y acotada.
    // El índice `by_org_user` NO es único en Convex, de modo que un restore o
    // un import de fixtures pueden dejar filas DUPLICADAS para el mismo par
    // (org, usuario). Si el borrado fuera un único delete (como era), la fila
    // restante mantenía el acceso con la sesión viva: bypass de revocación
    // observado de verdad en esta suite. Exigimos:
    //  - bucle de borrado con techo (`REVOKE_MAX_ROWS`),
    //  - fallo explícito si el techo se alcanza (fail-closed: no un `ok: true`
    //    de una revocación incompleta),
    //  - NINGÚN `.collect()` (lectura acotada por índice, fila a fila).
    expect(body).toMatch(/REVOKE_MAX_ROWS/);
    expect(body).toMatch(/REVOCACION_INCOMPLETA/);
    // Sin comentarios: la propia nota de código menciona `.collect()`.
    expect(stripComments(body)).not.toMatch(/\.collect\(\)/);
  });

  it("auditTrail devuelve solo campos no sensibles y pagina la lectura", () => {
    const orgs = read("orgs.ts");
    const body = orgs.slice(orgs.indexOf("export const auditTrail"));
    expect(body).toMatch(/\.take\(\(page \+ 1\) \* PAGE\)/);
    // Orden descendente ANTES del corte: sin order("desc") el índice por_org
    // se recorre asc y take() devuelve los eventos MÁS ANTIGUOS (bugFixed).
    expect(body).toMatch(/\.order\("desc"\)\s*\n\s*\.take\(/);
    expect(body).toMatch(/desc\.slice\(page \* PAGE, page \* PAGE \+ PAGE\)/);
    // No debe filtrar contenido de CV ni emails.
    expect(body).not.toMatch(/extractedText|fullName|decisionNote/);
    for (const f of ["action", "targetType", "targetId", "actorUserId", "metadata"]) {
      expect(body).toContain(`${f}: e.${f}`);
    }
  });

  it("revokeInvite deja la invitación inutilizable (acceptInvite solo acepta pending)", () => {
    const orgs = read("orgs.ts");
    expect(orgs).toMatch(/status:\s*"revoked"/);
    expect(orgs).toMatch(/action:\s*"org\.invite\.revoke"/);
    expect(orgs).toMatch(/invitation\.status !== "pending"/);
  });

  it("evidence post-check ACOTA los años de experiencia (no los basta un empleador)", () => {
    const ev = read("lib/ai/evidence.ts");
    // El bug: "existe un empleador verificable" se usaba como coartada para
    // aceptar años inflados. Ahora el número se acota a la mención literal o a
    // la suma de rangos de fechas verificables.
    expect(ev).toMatch(/sumVerifiableExperienceYears/);
    expect(ev).toMatch(/literalYears/);
    expect(ev).not.toMatch(/!hasVerifiableEmployer &&/);
  });

  it("evidence post-check ACOTA el nivel de habilidad a lo que sustenta el texto", () => {
    const ev = read("lib/ai/evidence.ts");
    expect(ev).toMatch(/maxJustifiedSkillLevel/);
    expect(ev).toMatch(/inflatedSkillLevels/);
    // El techo debe aplicarse a TODA habilidad, no solo a las fantasma.
    expect(ev).toMatch(/if \(level > justifiedLevel\)/);
  });

  it("el PDF ya NO depende de pdfjs/pdf-parse (incompatible con el isolate)", () => {
    const parse = read("lib/cv/parse.ts");
    // pdf-parse/pdfjs ya no deben aparecer NINGÚNWhere en el flujo de parsing.
    // (No usamos un patrón laxo tipo `from "pdf` porque chocaría con el módulo
    // propio "./pdfText".)
    // Ignoramos comentarios: el archivo DOCUMENTA por qué ya no se usa pdfjs.
    const parseCode = stripComments(parse);
    expect(parseCode).not.toMatch(/pdf-parse|pdfjs/);
    expect(parseCode).not.toMatch(/require\(["']pdf/);
    expect(parseCode).not.toMatch(/import\(["']pdf/);
    expect(parse).toMatch(/extractPdf/);
    // El extractor propio debe tener techos anti zip-bomb.
    const pdf = read("lib/cv/pdfText.ts");
    expect(pdf).toMatch(/MAX_DECOMPRESSED_BYTES/);
    expect(pdf).toMatch(/MAX_COMPRESSION_RATIO/);
    expect(pdf).toMatch(/MAX_OBJECTS|MAX_PAGES/);
    // Y el inflate puro (Convex no expone zlib).
    expect(read("lib/cv/inflate.ts")).toMatch(/inflate/);
  });

  it("deleteAccount borra binarios de storage y sesiones (retención)", () => {
    const account = read("account.ts");
    expect(account).toMatch(/storage\.delete/);
    expect(account).toMatch(/authSessions/);
    expect(account).toMatch(/authAccounts/); // anti-resurrección OTP
    expect(account).toMatch(/organizationMembers/);
    expect(account).toMatch(/email: .+@deleted\.invalid/);
  });
});
