/**
 * GATE E — Data leakage.
 *
 * Barrido estático sobre TODO el código (servidor y cliente) buscando:
 * secretos en código/logs, PII innecesaria, texto completo de CV en logs o
 * respuestas, prompts completos, respuestas crudas del LLM y metadatos de
 * auditoría con datos personales.
 *
 * Complementa a los tests estáticos ya existentes: aquí se cubre también el
 * código no-Convex (hooks, páginas, componentes), los propios fixtures de test
 * y el bundle cliente.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const TESTS = join(ROOT, "tests");
const DOCS = join(ROOT, "docs");

function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const CODE = [
  ...walk(SRC, (f) => /\.(ts|tsx)$/.test(f)),
  ...walk(TESTS, (f) => /\.(ts|tsx)$/.test(f)),
];
const CONVEX_SRC = CODE.filter((f) => f.includes(join("src", "convex")));
const CLIENT_SRC = CODE.filter(
  (f) => f.includes(join("src")) && !f.includes(join("src", "convex")),
);

/** Patrones de secretos "en duro" (no leídos de process.env). */
const SECRET_LITERALS = [
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  // Credenciales de servicios de plataforma con prefijo fijo (hallazgo #5:
  // la clave del servicio de correo estaba escrita como literal en el repo).
  /\bfb_[A-Za-z0-9]{16,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/,
];

/** PII que nunca debe aparecer como literal en el código ni en los fixtures. */
const PII_LITERALS = [
  /\b\d{3}-\d{3}-\d{4}\b/, // teléfono
  /\b[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo)\.[a-z]{2,}\b/i, // correo personal real
  /\b\d{13}\b/, // posible tarjeta
];
  it("ningún archivo contiene un secreto literal", () => {
    for (const f of [...CODE, ...walk(DOCS, (x) => /\.(md|ts|tsx)$/.test(x))]) {
      const code = readFileSync(f, "utf8");
      for (const re of SECRET_LITERALS) {
        expect(re.test(code), `secreto literal (${re}) en ${f}`).toBe(false);
      }
    }
  });

  it("ninguna cabecera de autenticación lleva un valor literal", () => {
    const offenders: string[] = [];
    for (const f of CODE) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const cab = new RegExp(
        "[\"'`][A-Za-z0-9-]*(api[-_]?key|authorization|token|secret|x-api-key)[\"'`]\\s*:\\s*[\"'`][^\"'`]{8,}[\"'`]",
        "gi",
      );
      if (cab.test(code)) offenders.push(f + " (cabecera de auth con valor literal)");
      const asg = new RegExp(
        "(apiKey|api_key|secretKey|accessToken)\\s*[:=]\\s*[\"'`][^\"'`]{8,}[\"'`]",
        "g",
      );
      if (asg.test(code)) offenders.push(f + " (secreto asignado a variable)");
    }
    expect(offenders).toEqual([]);
  });

  it("ningún archivo contiene PII real como literal", () => {
    for (const f of [...CODE, ...walk(DOCS, (x) => /\.(md|ts|tsx)$/.test(x))]) {
      const code = readFileSync(f, "utf8");
      for (const re of PII_LITERALS) {
        expect(re.test(code), `PII literal (${re}) en ${f}`).toBe(false);
      }
    }
  });

  it("el servidor nunca usa console.* (ni en actions, ni en mutaciones)", () => {
    for (const f of CONVEX_SRC) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, `console.* en ${f}`).not.toMatch(/\bconsole\.(log|warn|error|info|debug|trace)\b/);
    }
  });

  it("el cliente tampoco registra datos sensibles de la sesión", () => {
    for (const f of CLIENT_SRC) {
      const code = readFileSync(f, "utf8");
      // Prohibido volcar objetos de error de autenticación en la consola del
      // navegador (pueden contener el token de sesión y el email).
      expect(code, `volcado de error de auth en ${f}`).not.toMatch(
        /console\.(error|log|warn|info)\([^)]*JSON\.stringify\(error/i,
      );
      expect(code, `console.* de sesión en ${f}`).not.toMatch(
        /\bconsole\.(log|warn|error|info|debug)\(.*(token|sessionToken|profile|organization|email)/i,
      );
    }
  });

  it("ningún módulo cliente importa el proveedor de IA ni lee claves de servidor", () => {
    for (const f of CLIENT_SRC) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, `el cliente importa el proveedor IA: ${f}`).not.toContain("openai_provider");
      expect(code, `el cliente lee OPENAI_API_KEY: ${f}`).not.toContain("OPENAI_API_KEY");
      expect(code, `el cliente lee JWT_PRIVATE_KEY: ${f}`).not.toContain("JWT_PRIVATE_KEY");
      // El token de despliegue de la plataforma: además de no leerse, el
      // cliente no debe contener NINGÚN módulo que lo索取 (hallazgo #4).
      expect(code, `el cliente lee VLY_INTEGRATION_KEY: ${f}`).not.toContain(
        "process.env.VLY_INTEGRATION_KEY",
      );
    }
    // El guard de integraciones falla cerrado si alguien lo usa en el cliente.
    const guard = readFileSync(join(SRC, "lib", "vly-integrations.ts"), "utf8");
    expect(guard).not.toContain("@vly-ai/integrations");
  });

  /**
 * Elimina comentarios y literales de cadena: lo que queda es código real.
 * Sirve para comprobar que un nombre de clave solo aparece como lectura de
 * `process.env` y nunca, por ejemplo, en una interpolación o concatenación.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

describe("GATE E — data leakage", () => {
  it("las claves solo se leen con process.env en el servidor", () => {
    const offenders: string[] = [];
    for (const f of CONVEX_SRC) {
      const code = codeOnly(readFileSync(f, "utf8"));
      for (const key of ["OPENAI_API_KEY", "VLY_INTEGRATION_KEY", "JWT_PRIVATE_KEY"]) {
        const re = new RegExp(key, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
          const before = code.slice(Math.max(0, m.index - 20), m.index);
          if (!before.endsWith("process.env.")) offenders.push(f + " :: " + key);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("el texto completo del CV nunca entra en un log ni en el audit log", () => {
    for (const f of CONVEX_SRC) {
      const code = readFileSync(f, "utf8");
      const auditCalls = code.match(/audit\(ctx,[\s\S]*?\n {4}\}\);/g) ?? [];
      for (const a of auditCalls) {
        expect(a, `audit con extractedText en ${f}`).not.toContain("extractedText");
        expect(a, `audit con rawText en ${f}`).not.toContain("rawText");
      }
    }
  });

  it("la respuesta CRUDA del LLM no se persiste (solo la extracción validada)", () => {
    for (const f of CONVEX_SRC) {
      const code = readFileSync(f, "utf8");
      const persistCalls = code.match(/ctx\.db\.(insert|patch)\([^)]*\)/g) ?? [];
      for (const p of persistCalls) {
        expect(p, `posible persistencia de la salida cruda en ${f}`).not.toContain("raw");
      }
    }
    // El provider solo devuelve la extracción YA VALIDADA por el `parse` del
    // llamador; el texto crudo se queda en memoria y muere con la petición.
    const provider = readFileSync(
      join(SRC, "convex", "lib", "ai", "vly_provider.ts"),
      "utf8",
    );
    expect(provider).not.toMatch(/[,{]\s*raw(Text|Response|Output)?\s*[:,]/);
  });

  it("el prompt del sistema no se persiste ni se devuelve al cliente", () => {
    // El prompt vive solo en lib/ai/prompts.ts; los demás módulos lo IMPORTAN
    // para construir la llamada, pero nunca lo escriben en la BD.
    for (const f of CONVEX_SRC) {
      if (f.endsWith(join("lib", "ai", "prompts.ts"))) continue;
      const code = readFileSync(f, "utf8");
      const persistCalls = code.match(/ctx\.db\.(insert|patch)\([^)]*\)/g) ?? [];
      for (const p of persistCalls) {
        expect(p, `${f} persiste el system prompt`).not.toContain("CV_EXTRACT_SYSTEM");
      }
    }
    const clientBundleRefs = CLIENT_SRC.filter((f) =>
      readFileSync(f, "utf8").includes("CV_EXTRACT_SYSTEM"),
    );
    expect(clientBundleRefs).toEqual([]);
  });

  it("los fixtures de test no contienen datos de personas reales", () => {
    const corpus = readFileSync(
      join(SRC, "convex", "lib", "ai", "golden_corpus.ts"),
      "utf8",
    );
    expect(corpus).toContain("SINTÉTICOS");
    expect(corpus).toContain("Ana Prueba");
    // Todos los CV del corpus son el mismo CV honesto + payload: no hay
    // nombres ni datos de personas reales.
    expect(corpus).not.toMatch(/\b\d{3}-\d{3}-\d{4}\b/);
    expect(corpus).not.toMatch(/@(gmail|hotmail|outlook|yahoo)\./i);
  });

  it("los mensajes de error al usuario no filtran detalles internos", async () => {
    const { toSafeCvErrorMessage } = await import("../../src/convex/lib/cv/parse");
    const internals = [
      "Buffer is not defined",
      "TypeError: Cannot read properties of undefined",
      "OPENAI_API_KEY is missing",
      "at Object.<anonymous> (/src/convex/lib/ai/vly_provider.ts:42:15)",
    ];
    for (const raw of internals) {
      expect(toSafeCvErrorMessage(new Error(raw))).not.toContain(raw);
    }
    // Un mensaje declarado seguro sí pasa intacto.
    expect(toSafeCvErrorMessage(new Error("El archivo supera el tamaño máximo de 10 MB."))).toBe(
      "El archivo supera el tamaño máximo de 10 MB.",
    );
  });
});