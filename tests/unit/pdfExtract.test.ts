/**
 * Tests del extractor de PDF propio (lib/cv/pdfText.ts) y del inflate
 * (lib/cv/inflate.ts).
 *
 * El inflate se valida contra `zlib` de Node como ORÁCULO: para una muestra de
 * entradas (texto, datos aleatorios, streams de un PDF real) comprobamos que
 * nuestra salida es byte-idéntica a la de zlib. Esto es lo que garantiza que
 * no introducimos un parser de PDF divergente.
 *
 * Todo el material es SINTÉTICO: no se usa ningún CV ni dato real de personas.
 */
import { randomBytes } from "node:crypto";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { inflate } from "../../src/convex/lib/cv/inflate";
import { extractPdfText } from "../../src/convex/lib/cv/pdfText";
import { extractText, MAX_TEXT_CHARS } from "../../src/convex/lib/cv/parse";

/** Comprime con zlib (nivel 9) y con nivel 1 para forzar bloques distintos. */
function deflate(data: Uint8Array, level: number): Uint8Array {
  return new Uint8Array(zlib.deflateSync(Buffer.from(data), { level }));
}

/** Genera un PDF 1.4 mínimo con un content stream (comprimido o no). */
function makePdf(content: string, compress: boolean): Uint8Array {
  let streamData: string;
  let streamDict: string;
  if (compress) {
    const bytes = new Uint8Array(Buffer.from(content, "latin1"));
    const z = deflate(bytes, 6);
    let bin = "";
    for (const b of z) bin += String.fromCharCode(b);
    streamData = z.length + "\nstream\n" + bin + "\nendstream";
    streamDict = "<< /Length " + z.length + " /Filter /FlateDecode >>";
  } else {
    const bytes = Buffer.from(content, "latin1");
    streamData = bytes.length + "\nstream\n" + content + "\nendstream";
    streamDict = "<< /Length " + bytes.length + " >>";
  }
  const objs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>endobj",
    "5 0 obj\n" + streamDict + "\n" + streamData + "\nendobj",
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
  const buf = Buffer.from(out, "latin1");
  return new Uint8Array(buf);
}

describe("inflate propio == zlib de Node (oráculo)", () => {
  const cases: { name: string; data: Uint8Array }[] = [
    {
      name: "texto repetible (comprime bien)",
      data: new TextEncoder().encode("Analista de datos. ".repeat(400)),
    },
    {
      name: "texto corto",
      data: new TextEncoder().encode("Ana Perez Data Engineer"),
    },
    {
      name: "datos aleatorios (incompresible)",
      data: new Uint8Array(randomBytes(64 * 1024)),
    },
    {
      name: "bytes con runs (patrón LZ77)",
      data: new Uint8Array(randomBytes(32 * 1024).map((b) => b % 3)),
    },
  ];

  for (const c of cases) {
    for (const level of [1, 6, 9]) {
      it(`${c.name} @ nivel ${level}: byte-idéntico a zlib`, () => {
        const compressed = deflate(c.data, level);
        const mine = inflate(compressed, 64 * 1024 * 1024);
        const theirs = new Uint8Array(zlib.inflateSync(Buffer.from(compressed)));
        expect(mine.truncated).toBe(false);
        expect(mine.data.length).toBe(theirs.length);
        expect(Buffer.from(mine.data).equals(Buffer.from(theirs))).toBe(true);
      });
    }
  }

  it("respeta maxBytes y marca truncated (anti zip-bomb)", () => {
    // 100k de ceros comprimen a unos pocos bytes: al pedir solo 100 de salida
    // el descompresor DEBE detenerse y marcar truncado (si no, un PDF hostil
    // podría agotar la memoria de la action).
    const bomb = deflate(new Uint8Array(100_000), 9);
    expect(bomb.length).toBeLessThan(200);
    const res = inflate(bomb, 100);
    expect(res.data.length).toBeLessThanOrEqual(100);
    expect(res.truncated).toBe(true);
  });

  it("rechaza basura sin lanzar fuera del tipo esperado", () => {
    const junk = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => inflate(junk, 1024)).toThrow();
  });
});

describe("extractor de PDF (material sintético)", () => {
  const CV_TEXT = [
    "Ana Perez Data Engineer",
    "Python SQL Docker Kubernetes",
    "Experiencia 6 anos en backend",
    "Educacion: Sistemas",
  ].join("\n");

  it("extrae texto de un PDF SIN comprimir", () => {
    const content = "BT /F1 12 Tf 72 720 Td 14 TL\n" +
      CV_TEXT.split("\n").map((l) => `(${l}) Tj T*`).join("\n") + "\nET";
    const text = extractPdfText(makePdf(content, false));
    expect(text).toContain("Ana Perez Data Engineer");
    expect(text).toContain("Python SQL Docker Kubernetes");
  });

  it("extrae texto de un PDF COMPRIMIDO (FlateDecode)", () => {
    const content = "BT /F1 12 Tf 72 720 Td 14 TL\n" +
      CV_TEXT.split("\n").map((l) => `(${l}) Tj T*`).join("\n") + "\nET";
    const text = extractPdfText(makePdf(content, true));
    expect(text).toContain("Ana Perez Data Engineer");
    expect(text).toContain("Educacion: Sistemas");
  });

  it("decodifica escapes y hexadecimales de cadenas PDF", () => {
    const content = "BT /F1 12 Tf (Ana \\(Perez\\) Data) Tj (L\\303\\237nea 2) Tj ET";
    const text = extractPdfText(makePdf(content, false));
    expect(text).toContain("Ana (Perez) Data");
  });

  it("extractText() acepta el PDF y devuelve texto usable del CV", async () => {
    const content = "BT /F1 12 Tf 72 720 Td 14 TL\n" +
      CV_TEXT.split("\n").map((l) => `(${l}) Tj T*`).join("\n") + "\nET";
    const text = await extractText(makePdf(content, true), "pdf");
    expect(text).toContain("Ana Perez Data Engineer");
    expect(text.length).toBeGreaterThan(40);
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });

  it("PDF sin texto extraíble (escaneo) → texto vacío, y extractText lo rechaza", async () => {
    const content = ""; // stream vacío
    const text = extractPdfText(makePdf(content, false));
    expect(text.trim().length).toBeLessThan(40);
    await expect(extractText(makePdf(content, false), "pdf")).rejects.toThrow();
  });

  it("PDF corrupto NO lanza error fatal: devuelve vacío (fail-safe)", () => {
    const corrupt = new Uint8Array(Buffer.from("%PDF-1.4\nbasura sin xref\n%%EOF", "latin1"));
    expect(() => extractPdfText(corrupt)).not.toThrow();
    expect(extractPdfText(corrupt).length).toBe(0);
  });
});
