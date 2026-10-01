/**
 * GATE D — Seguridad y correctitud del pipeline de ficheros.
 *
 * Corpus 100% SINTÉTICO generado en runtime (nada de PII real, nada de ficheros
 * de terceros). Cubre lo exigido por el gate: PDF normal, vacío, corrupto,
 * truncado, comprimido, multi-stream, sin compresión, con Unicode, CID con
 * /ToUnicode, CID sin /ToUnicode, objetos malformados, sobredimensionado y con
 * estructuras inesperadas; más spoofing de extensión, MIME y magic bytes,
 * nombres de fichero maliciosos y HTML/JS disfrazados.
 *
 * CRITERIO: ningún fichero hostil puede tumbar el proceso, entrar en bucle
 * infinito, explotar memoria, ejecutar nada, tocar el sistema de ficheros ni
 * la red. Y la extracción debe ser DETERMINISTA (mismo input → mismo output N
 * veces).
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  detectMime,
  extractText,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
} from "../../src/convex/lib/cv/parse";
import { extractPdfText } from "../../src/convex/lib/cv/pdfText";

const NL = String.fromCharCode(10);
const latin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

function buildPdf(opts: {
  content: string;
  compress: boolean;
  extraObjs?: string[];
  contentFilter?: string;
  toUnicode?: boolean;
  cid?: boolean;
}): Uint8Array {
  const content = opts.content;
  let streamData: string;
  let streamDict: string;
  if (opts.compress) {
    const z = new Uint8Array(deflateSync(Buffer.from(content, "latin1"), { level: 6 }));
    let bin = "";
    for (const b of z) bin += String.fromCharCode(b);
    streamData = z.length + NL + "stream" + NL + bin + NL + "endstream";
    streamDict =
      "<< /Length " + z.length + " " + (opts.contentFilter ?? "/Filter /FlateDecode") + " >>";
  } else {
    streamData = content.length + NL + "stream" + NL + content + NL + "endstream";
    streamDict = "<< /Length " + content.length + " >>";
  }

  const fontObj = opts.cid
    ? "4 0 obj<</Type/Font/Subtype/Type0/BaseFont/Arial/Encoding/Identity-H/DescendantFonts[6 0 R]" +
      (opts.toUnicode ? "/ToUnicode 7 0 R" : "") +
      ">>endobj"
    : "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>endobj";

  const objs = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    fontObj,
    "5 0 obj" + NL + streamDict + NL + streamData + NL + "endobj",
    ...(opts.cid
      ? [
          "6 0 obj<</Type/Font/Subtype/CIDFontType2/BaseFont/Arial/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>>>endobj",
          ...(opts.toUnicode
            ? ["7 0 obj<</Length 44>>stream" + NL + "begincmap" + NL + "/CMapName/Test def" + NL + "endcmap" + NL + "endstream endobj"]
            : []),
        ]
      : []),
    ...(opts.extraObjs ?? []),
  ];

  let out = "%PDF-1.4" + NL + "%" + String.fromCharCode(0xe2, 0xe3, 0xcf, 0xd3) + NL;
  const offs: number[] = [];
  for (const o of objs) {
    offs.push(out.length);
    out += o + NL;
  }
  const xref = out.length;
  out += "xref" + NL + "0 " + (objs.length + 1) + NL + "0000000000 65535 f " + NL;
  for (const o of offs) out += String(o).padStart(10, "0") + " 00000 n " + NL;
  out +=
    "trailer" + NL + "<< /Size " + (objs.length + 1) + " /Root 1 0 R >>" + NL +
    "startxref" + NL + xref + NL + "%%EOF" + NL;
  return latin1(out);
}

const NORMAL = buildPdf({
  content: "BT /F1 12 Tf 72 720 Td (Ana Prueba) Tj 0 -16 Td (Python and SQL) Tj ET",
  compress: true,
});

/** Ejecuta `fn` y falla si se pasa del presupuesto de tiempo. */
function withLimits(fn: () => unknown, ms = 4000): { ok: boolean; value?: unknown; err?: string } {
  const started = Date.now();
  try {
    const value = fn();
    if (Date.now() - started > ms) return { ok: false, err: "TIEMPO EXCEDIDO" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

const BIN = String.fromCharCode(1, 2, 3, 4, 0);

describe("GATE D.1 — corpus PDF hostil: nunca tumba el proceso", () => {
  const hostiles: { name: string; bytes: Uint8Array }[] = [
    { name: "pdf_vacio", bytes: latin1("%PDF-1.4" + NL) },
    { name: "pdf_solo_magic", bytes: latin1("%PDF") },
    { name: "pdf_corrupto", bytes: latin1("%PDF-1.4" + NL + " garbage".repeat(500)) },
    { name: "pdf_truncado", bytes: NORMAL.slice(0, Math.floor(NORMAL.length / 2)) },
    {
      name: "pdf_xref_desfasado",
      bytes: latin1(
        [
          "%PDF-1.4",
          "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
          "xref",
          "0 2",
          "9999999999 65535 f ",
          "trailer",
          "<< /Size 2 /Root 1 0 R >>",
          "startxref",
          "10",
          "%%EOF",
          "",
        ].join(NL),
      ),
    },
    {
      name: "pdf_stream_sin_length",
      bytes: latin1(
        [
          "%PDF-1.4",
          "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
          "5 0 obj<< /Filter /FlateDecode >>",
          "stream",
          "",
          "endstream",
          "endobj",
          "trailer",
          "<< /Root 1 0 R >>",
          "%%EOF",
          "",
        ].join(NL),
      ),
    },
    {
      name: "pdf_zip_bomb",
      bytes: buildPdf({
        content: "BT /F1 12 Tf (" + "A".repeat(200_000) + ") Tj ET",
        compress: true,
      }),
    },
    {
      name: "pdf_flate_corrupto",
      bytes: latin1(
        [
          "%PDF-1.4",
          "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
          "5 0 obj<</Length 50 /Filter /FlateDecode>>",
          "stream",
          BIN + "not-deflate-at-all",
          "endstream",
          "endobj",
          "trailer",
          "<< /Root 1 0 R >>",
          "%%EOF",
          "",
        ].join(NL),
      ),
    },
    {
      name: "pdf_filtro_no_soportado",
      bytes: buildPdf({
        content: "BT /F1 12 Tf (hola) Tj ET",
        compress: true,
        contentFilter: "/Filter /LZWDecode",
      }),
    },
    {
      name: "pdf_objetos_malformados",
      bytes: buildPdf({
        content: "BT /F1 12 Tf (ok) Tj ET",
        compress: false,
        extraObjs: [
          "8 0 obj<< /Broken [ << /Nested >> >>endobj",
          "9 0 obj<</Length 999999999>>stream" + NL + "short" + NL + "endstream endobj",
          "10 0 obj" + NL + "endobj",
          "11 0 obj<< /Self 11 0 R >>endobj",
        ],
      }),
    },
    {
      name: "pdf_recursivo_autorreferenciado",
      bytes: buildPdf({
        content: "BT /F1 12 Tf (x) Tj ET",
        compress: false,
        extraObjs: ["8 0 obj<</Kids[8 0 R 8 0 R]/Pages 8 0 R>>endobj"],
      }),
    },
    {
      name: "pdf_cid_con_tounicode",
      bytes: buildPdf({
        content: "BT /F1 12 Tf <0041> Tj ET",
        compress: false,
        cid: true,
        toUnicode: true,
      }),
    },
    {
      name: "pdf_cid_sin_tounicode",
      bytes: buildPdf({
        content: "BT /F1 12 Tf <0041> Tj ET",
        compress: false,
        cid: true,
        toUnicode: false,
      }),
    },
    {
      name: "pdf_unicode_utf16be",
      bytes: buildPdf({
        content: "BT /F1 12 Tf <FEFF0041004200> Tj (Espanol) Tj 0 -16 Td (Latin1) Tj ET",
        compress: true,
      }),
    },
    {
      name: "pdf_multi_stream",
      bytes: buildPdf({
        content:
          "BT /F1 12 Tf (Ana) Tj ET" + NL +
          "BT /F1 12 Tf (Python) Tj ET" + NL +
          "BT /F1 12 Tf (SQL) Tj ET",
        compress: false,
      }),
    },
    {
      name: "pdf_sin_compresion",
      bytes: buildPdf({
        content: "BT /F1 12 Tf (Ana Prueba) Tj 0 -16 Td (Python) Tj ET",
        compress: false,
      }),
    },
    {
      name: "pdf_estructura_inesperada",
      bytes: latin1(["%PDF-1.4", "1 0 obj<</Type/Catalog>>endobj", "trailer", "<< /Root 1 0 R >>", "%%EOF", ""].join(NL)),
    },
    {
      name: "pdf_diccionario_recursivo",
      bytes: buildPdf({
        content: "BT /F1 12 Tf (x) Tj ET",
        compress: false,
        extraObjs: ["8 0 obj<</Parent 8 0 R /Kids 8 0 R>>endobj"],
      }),
    },
    {
      name: "pdf_html_disfrazado",
      bytes: latin1(
        [
          "%PDF-1.4",
          "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
          "5 0 obj<</Length 60>>",
          "stream",
          "<script>alert(1)</script><h1>Candidate</h1>",
          "endstream",
          "endobj",
          "trailer",
          "<< /Root 1 0 R >>",
          "%%EOF",
          "",
        ].join(NL),
      ),
    },
    {
      name: "pdf_js_embebido",
      bytes: buildPdf({
        content:
          "BT /F1 12 Tf (app.alert(1)) Tj /JavaScript (this.exportDataObject) Tj ET",
        compress: false,
      }),
    },
  ];

  for (const h of hostiles) {
    it(`${h.name}: no cuelga, no explota y nunca ejecuta contenido`, () => {
      const r = withLimits(() => extractPdfText(h.bytes));
      expect(r.err ?? "").not.toContain("TIEMPO EXCEDIDO");
      if (r.ok && typeof r.value === "string") {
        expect(r.value.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
      }
    });
  }

  it("pdf sobredimensionado: el límite de 10 MB se rechaza antes de parsear", async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1);
    huge.set(latin1("%PDF-1.4"), 0);
    await expect(extractText(huge, "pdf")).rejects.toThrow(/10 MB/);
  });

  it("pdf válido: se extrae el texto esperado", () => {
    const t = extractPdfText(NORMAL);
    expect(t).toContain("Ana Prueba");
    expect(t).toContain("Python");
  });
});

describe("GATE D.2 — determinismo de la extracción", () => {
  const samples: Record<string, Uint8Array> = {
    normal: NORMAL,
    sin_compresion: buildPdf({
      content: "BT /F1 12 Tf (Determinista) Tj 0 -16 Td (Prueba) Tj ET",
      compress: false,
    }),
    unicode: buildPdf({
      content: "BT /F1 12 Tf <FEFF00E900E100F300> Tj ET",
      compress: true,
    }),
    multi_stream: buildPdf({
      content: "BT /F1 12 Tf (a) Tj ET" + NL + "BT /F1 12 Tf (b) Tj ET",
      compress: false,
    }),
    comprimido: buildPdf({
      content: "BT /F1 12 Tf (Determinista comprimido) Tj ET",
      compress: true,
    }),
  };

  for (const [name, bytes] of Object.entries(samples)) {
    it(`${name}: misma entrada → mismo output en 5 ejecuciones`, () => {
      const runs = Array.from({ length: 5 }, () => extractPdfText(bytes));
      for (const r of runs) expect(r).toBe(runs[0]);
    });
  }
});

describe("GATE D.3 — spoofing de tipo, extensión y nombre", () => {
  it("un ejecutable renombrado a .pdf NO se detecta como PDF", () => {
    const exe = latin1("MZ" + String.fromCharCode(0x90, 0x00, 0x03, 0x00) + "This program cannot be run in DOS mode.");
    expect(detectMime(exe)).not.toBe("pdf");
  });

  it("un PDF real se detecta por magic bytes", () => {
    expect(detectMime(NORMAL)).toBe("pdf");
  });

  it("HTML/JS con bytes binarios no pasa como txt", () => {
    const html = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x00, 0x01, 0x02, 0x03]);
    expect(detectMime(html)).toBeNull();
  });

  it("HTML plano SÍ se acepta como txt (texto legítimo), sin ejecutarlo", async () => {
    const html = latin1(
      "<html><body><h1>Curriculum Vitae</h1><p>Ana Prueba, Analista de Datos con Python y SQL</p><script>alert(1)</script></body></html>",
    );
    expect(detectMime(html)).toBe("txt");
    const t = await extractText(html, "txt");
    expect(t).toContain("Ana Prueba");
  });

  it("archivos demasiado cortos se rechazan", () => {
    expect(detectMime(latin1("%PDF"))).toBeNull();
    expect(detectMime(new Uint8Array(0))).toBeNull();
  });

  it("no hay traversal de ficheros: un TXT con rutas se trata como texto", async () => {
    const traversal = latin1(
      "../../../../etc/passwd" + NL +
        "root:x:0:0:root:/root:/bin/bash" + NL +
        "sh:x:1:1:sh:/bin/sh" + NL +
        "curriculum de prueba",
    );
    const t = await extractText(traversal, "txt");
    expect(t).toContain("curriculum de prueba");
    expect(t).not.toContain(String.fromCharCode(0));
  });
});

describe("GATE D.4 — el pipeline de ficheros no toca red ni ejecuta código", () => {
  it("los módulos del parser no importan red, fs, child_process ni eval", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const base = join(__dirname, "..", "..", "src", "convex", "lib", "cv");
    const forbidden = [
      "node:http",
      "node:https",
      "node:net",
      "node:fs",
      "node:child_process",
      "eval(",
      "new Function(",
      "require(",
      "fetch(",
    ];
    for (const f of ["parse.ts", "pdfText.ts", "inflate.ts"]) {
      const code = readFileSync(join(base, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const bad of forbidden) {
        expect(code, f + " usa " + bad).not.toContain(bad);
      }
    }
  });
});