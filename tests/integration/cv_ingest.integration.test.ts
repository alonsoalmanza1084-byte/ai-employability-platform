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

/**
 * PDF 1.4 mínimo y válido, generado sintéticamente (sin datos reales).
 * Contiene texto legible para que extractText supere MIN_TEXT_CHARS.
 */
const SYNTHETIC_PDF_B64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+" +
  "ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+P" +
  "mVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4+" +
  "ZW5kb2JqCjMgMCBvYmo8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAg" +
  "MCA2MTIgNzkyXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAwIFI+Pj4+PC9Gb250Pjwv" +
  "Q29udGVudHMgNSAwIFI+PmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTM2ID4+CnN0" +
  "cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIDE0IFRMCkphbmEgUGVyZXogRGF0YSBF" +
  "bmdpbmVlcgoKUHl0aG9uIFNRTCBEb2NrZXIgS3ViZXJuZXRlcyBUagpUKkV4cGVyaWVu" +
  "Y2lhIDYgYW5vcyBlbiBiYWNrZW5kCmomZWR1Y2FjaW9uOiBTeXN0ZW1hcwpDZXJ0aWZp" +
  "Y2FjaW9uIEFXUyBTb2x1dGlvbnMgQXJjaGl0ZWN0CioqZW5kb2JqCjQgMCBvYmo8PC9U" +
  "eXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2EvRW5jb2Rpbmcv" +
  "V2luQW5zaUVuY29kaW5nPj4+ZW5kb2JqCjUgMCBvYmoKPDwgL0xlbmd0aCAxMzYgPj4K" +
  "c3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgMTQgVEwKKEFuYSBQZXJleiBEYXRhIEVu" +
  "Z2luZWVyClQoUHl0aG9uIFNRTCBEb2NrZXIgS3ViZXJuZXRlcyBUagpUKkV4cGVyaWVu" +
  "Y2lhIDYgYW5vcyBlbiBiYWNrZW5kCmotZWR1Y2FjaW9uOiBTeXN0ZW1hcwpDZXJ0aWZp" +
  "Y2FjaW9uIEFXUyBTb2x1dGlvbnMgQXJjaGl0ZWN0CioqZW5kb2JqCnhyZWYKMDAwMDAw" +
  "MDAwMCA2NTUzNSBmIAowMDAwMDAwMDU1IDAwMDAwIG4gCjAwMDAwMDAxMDYgMDAwMCBuIAow" +
  "MDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMTA3IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMCBuIAow" +
  "MDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDUzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1Np" +
  "emUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDA0CiUlRU9GCg==";

function syntheticPdf(): Uint8Array {
  return new Uint8Array(Buffer.from(SYNTHETIC_PDF_B64, "base64"));
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

  it("el PDF sintético pasa la validación de magic bytes como PDF", () => {
    const bytes = syntheticPdf();
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
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
