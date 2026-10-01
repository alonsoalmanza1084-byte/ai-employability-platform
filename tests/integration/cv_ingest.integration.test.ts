/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Convex sin tipar */
/**
 * Regresión del pipeline de ingesta de CV contra el deployment real.
 *
 * Incidente (auditoría #3): `pdf-parse` v2 (pdfjs-dist) sondea al cargar
 * `structuredClone(x, { transfer: [x] })`. El runtime de Convex implementa
 * `structuredClone` pero NO soporta `transfer`, y el sondeo escapaba como error
 * fatal del servidor: TODA ingesta de PDF real fallaba con
 * "structuredClone with transfer not supported", tanto en la aplicación del
 * candidato como en la del recruiter.
 *
 * Este test sube un PDF sintético VÁLIDO al storage privado y ejecuta
 * `candidates.ingestCv` contra el deployment. El contrato que verifica es
 * binario:
 *  1. El parser de PDF YA NO lanza el error de `structuredClone`/transfer.
 *  2. El pipeline avanza más allá de la extracción de texto.
 *
 * Sobre el resultado final: `ingestCv` continúa con la llamada al proveedor
 * de IA. Sin `OPENAI_API_KEY` en el deployment el resultado esperado es
 * `failed` (fallo controlado y visible, nunca datos corruptos); con clave, el
 * resultado sería `ready`. El test acepta ambos y solo falla si el error es el
 * del incidente o cualquier otro error de servidor — es decir, verifica que el
 * pipeline es FUNCIONAL, no que la IA esté configurada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { extractPdfText } from "../../src/convex/lib/cv/pdfText";

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

/**
 * PDF 1.4 mínimo y válido, generado en tiempo de ejecución (sin datos reales).
 * Contiene texto legible para que extractText supere MIN_TEXT_CHARS.
 *
 * Se construye aquí (y no como literal base64) porque los offsets del xref
 * deben ser correctos: un literal transcrito a mano introducía offsets
 * truncados y el PDF no era parseable.
 */
function syntheticPdf(): Uint8Array {
  const lines = [
    "Ana Perez Data Engineer",
    "Python SQL Docker Kubernetes",
    "Experiencia 6 anos en backend",
    "Educacion: Sistemas",
  ];
  const content =
    "BT /F1 12 Tf 72 720 Td 14 TL\n" +
    lines.map((l) => `(${l}) Tj T*`).join("\n") +
    "\nET";
  const compressed = new Uint8Array(
    zlib.deflateSync(Buffer.from(content, "latin1"), { level: 6 }),
  );
  let bin = "";
  for (const b of compressed) bin += String.fromCharCode(b);
  const objs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>endobj",
    `5 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${bin}\nendstream\nendobj`,
  ];
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offs: number[] = [];
  for (const o of objs) {
    offs.push(out.length);
    out += o + "\n";
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += String(o).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

describe.skipIf(!CONVEX_URL)("pipeline de ingesta de CV (deployment real)", () => {
  let client: ConvexHttpClient;

  beforeAll(async () => {
    client = new ConvexHttpClient(CONVEX_URL!);
    const res: any = await client.action(anyApi["auth"]["signIn"], {
      provider: "anonymous",
    });
    client.setAuth(res?.tokens?.token);
  });

  afterAll(() => {
    client?.clearAuth();
  });

  it("el PDF sintético pasa la validación de magic bytes y es parseable", () => {
    const bytes = syntheticPdf();
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
    // Guarda contra regresiones del propio fixture: si el PDF no fuera
    // parseable, el test de ingestCv fallaría por una razón falsa.
    const local = extractPdfText(bytes);
    expect(local).toContain("Ana Perez Data Engineer");
    expect(local).toContain("Python SQL Docker Kubernetes");
  });

  it("ingestCv con un PDF real YA NO falla con structuredClone/transfer (regresión del incidente)", async () => {
    const bytes = syntheticPdf();
    const { uploadUrl }: { uploadUrl: string } = await client.mutation(
      anyApi["candidates"]["initUpload"],
      {
        fileName: "cv-sintetico.pdf",
        fileSize: bytes.length,
        mimeType: "application/pdf",
      },
    );
    const up = await fetch(uploadUrl, {
      method: "POST",
      body: new Blob([bytes], { type: "application/pdf" }),
    });
    const { storageId } = (await up.json()) as { storageId: string };
    const fin: any = await client.mutation(anyApi["candidates"]["finalizeUpload"], {
      fileName: "cv-sintetico.pdf",
      fileSize: bytes.length,
      mimeType: "application/pdf",
      storageId,
    });

    // La acción ya NO debe lanzar. Si el proveedor de IA no está configurado,
    // devuelve { status: "failed" } (fallo controlado); con clave, "ready".
    let result: any;
    try {
      result = await client.action(anyApi["candidates"]["ingestCv"], {
        resumeVersionId: String(fin.resumeVersionId),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // Este es EXACTAMENTE el incidente que se cierra aquí.
      expect(
        msg,
        "sigue ocurriendo el fallo de structuredClone con transfer en el runtime de Convex",
      ).not.toMatch(/structuredClone|transfer not supported/i);
      throw new Error(`ingestCv lanzó: ${msg}`);
    }

    expect(["ready", "failed"]).toContain(result?.status);
    // Si falló, la razón NO puede ser el parser: debe ser el proveedor de IA.
    const versions: any[] = await client.query(anyApi["candidates"]["myResumes"]);
    const version = versions
      .flatMap((r: any) => r.versions)
      .find((v: any) => String(v._id) === String(fin.resumeVersionId));
    expect(version).toBeTruthy();
    if (version.status === "failed") {
      expect(String(version.failureReason ?? "")).not.toMatch(
        /structuredClone|PDF|pdf/i,
      );
    }
  });
});
