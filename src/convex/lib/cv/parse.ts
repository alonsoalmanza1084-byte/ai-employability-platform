/* eslint-disable no-control-regex -- quitamos caracteres de control a propósito */
/* eslint-disable @typescript-eslint/no-explicit-any -- parsers con tipos heterogéneos */
/**
 * Parser de CVs — SOLO servidor ("use node"). Nunca se ejecuta el archivo:
 * solo lectura de bytes y extracción de texto (SECURITY.md §5).
 */
import mammoth from "mammoth";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_CHARS = 24_000;
export const MIN_TEXT_CHARS = 40;

export type CvMime = "pdf" | "docx" | "txt";

export interface ParsedCv {
  mime: CvMime;
  text: string;
}

/** Detecta el tipo REAL por magic bytes (no por extensión/MIME declarado). */
export function detectMime(bytes: Uint8Array): CvMime | null {
  if (bytes.length < 8) return null;
  // %PDF-
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  // PK\x03\x04 — zip container (docx)
  if (
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    bytes[2] === 0x03 && bytes[3] === 0x04
  ) {
    return "docx";
  }
  // texto plano UTF-8 sin BOM raro: heurística — todos los primeros bytes imprimibles/whitespace
  const head = bytes.subarray(0, Math.min(bytes.length, 512));
  const isText = head.every(
    (b) =>
      b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b !== 0x7f) || b >= 0x80,
  );
  return isText ? "txt" : null;
}

/**
 * Extrae texto de un PDF con pdf-parse v2 (pdfjs-dist).
 *
 * WORKAROUND pdfjs + Convex: al cargar el módulo, pdfjs sondea si el runtime soporta
 * `structuredClone(valor, { transfer: [valor] })`. El runtime de Convex implementa
 * `structuredClone` pero NO soporta `transfer`, y ese sondeo escapa como error fatal
 * ("structuredClone with transfer not supported") que aborta la action.
 *
 * Solución: envolvemos temporalmente `globalThis.structuredClone` con una versión que
 * ignora la opción `transfer` (clon por copia en vez de por transferencia). Con eso pdfjs
 * detecta "sin transfer" y usa su ruta de copia, que es funcionalmente equivalente.
 * El patch se hace ANTES del import dinámico porque pdfjs captura la referencia al
 * cargar el módulo, y se restaura al terminar para no afectar al resto de la action.
 *
 * Además pdfjs construye `new DOMMatrix()` al cargarse, lee `navigator` y decide su
 * estrategia de worker según cómo se stringifica `process` (Convex no tiene DOM ni
 * Worker), así que también inyectamos shims mínimos mientras dura el parseo. No afecta
 * a la seguridad: la extracción de texto no ejecuta ni renderiza nada del PDF.
 */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  /* eslint-disable @typescript-eslint/no-explicit-any -- tipos de pdf-parse v2 heterogéneos */
  const g = globalThis as any;
  // El isolate de Convex puede congelar parte de globalThis: cada patch se
  // aplica y se revierte de forma defensiva (nunca debe abortar la action).
  const restore = installPdfRuntimeShims(g);
  try {
    const mod: any = await import("pdf-parse");
    const PDFParse = mod.PDFParse as new (o: { data: Uint8Array }) => {
      getText: () => Promise<{ text: string }>;
      destroy: () => Promise<void>;
    };
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    await parser.destroy();
    return result?.text ?? "";
  } catch (err) {
    throw new Error(
      `No pudimos procesar el PDF: ${
        err instanceof Error ? err.message : "formato no reconocido"
      }`,
    );
  } finally {
    restore();
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Aplica los shims de entorno que pdfjs necesita para cargar y parsear en el
 * isolate de Convex. Devuelve una función de reversión idempotente y a prueba
 * de fallos: si un global no se puede parchear (congelado), se ignora.
 */
function installPdfRuntimeShims(g: any): () => void {
  /* eslint-disable @typescript-eslint/no-explicit-any -- parche de globals */
  const undo: (() => void)[] = [];

  const patch = (key: string, makeValue: (previous: unknown) => unknown) => {
    const had = key in g;
    const previous = g[key];
    try {
      g[key] = makeValue(previous);
      if (had) undo.push(() => { g[key] = previous; });
      else undo.push(() => { delete g[key]; });
    } catch {
      // Global congelado: seguimos sin el shim (el import fallará con un error
      // claro más abajo, nunca con datos corruptos).
    }
  };

  // 1. structuredClone sin `transfer` (pdfjs lo sondea al cargar).
  if (typeof g.structuredClone === "function") {
    patch("structuredClone", (prev) => {
      const clone = prev as (value: any) => any;
      return (value: any) => clone(value);
    });
  }

  // 2. DOMMatrix: pdfjs hace `new DOMMatrix()` a nivel de módulo.
  patch("DOMMatrix", () => makeDomMatrixShim());

  // 3. navigator: pdfjs lo consulta para detectar el entorno.
  patch("navigator", () => ({
    userAgent: "ConvexNode",
    language: "en-US",
    languages: ["en-US"],
    platform: "node",
    hardwareConcurrency: 1,
    maxTouchPoints: 0,
    sendBeacon: () => false,
  }));

  // 4. process: pdfjs decide su estrategia de worker con
  //    `process + "" === "[object process]"`. El shim de Convex no se stringify
  //    así, así que pdfjs cree estar en un navegador e intenta cargar
  //    pdf.worker.mjs ("No GlobalWorkerOptions.workerSrc specified"). Lo
  //    exponemos como Node para que use su fake worker en el hilo principal
  //    (igual que en Node, sin Structured Clone con transfer).
  patch("process", (prev) => {
    if (!prev || typeof prev !== "object") return prev;
    if (`${prev}` === "[object process]") return prev;
    const target = prev as any;
    // No sustituimos el objeto: solo definimos toString/Symbol.toPrimitive
    // (lo que pdfjs usa para detectar Node) y un `versions` vacío si falta.
    // Reemplazar `globalThis.process` por un Proxy rompe al propio runtime de
    // Convex, que también lee process.
    const added: string[] = [];
    for (const key of [Symbol.toPrimitive, "toString", "versions"]) {
      if (Object.prototype.hasOwnProperty.call(target, key)) continue;
      added.push(String(key));
      try {
        Object.defineProperty(target, key, {
          configurable: true,
          writable: true,
          value:
            key === Symbol.toPrimitive
              ? () => "[object process]"
              : key === "toString"
                ? () => "[object process]"
                : {},
        });
      } catch {
        // Global congelado: seguimos sin el shim.
      }
    }
    return target;
  });

  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const fn of undo.reverse()) {
      try {
        fn();
      } catch {
        // Ignoramos fallos de reversión: no pueden afectar la correctness.
      }
    }
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** DOMMatrix mínimo (matriz 2D afín). Suficiente para que pdfjs cargue. */
function makeDomMatrixShim(): unknown {
  /* eslint-disable @typescript-eslint/no-explicit-any -- constructorduck-typed */
  return class DomMatrixShim {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: any) {
      if (Array.isArray(init)) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init && typeof init === "object") {
        const src = init as Record<string, unknown>;
        const self = this as unknown as Record<string, unknown>;
        for (const k of ["a", "b", "c", "d", "e", "f"]) {
          if (typeof src[k] === "number") self[k] = src[k];
        }
      }
    }
    multiplySelf(): this {
      return this;
    }
    translate(): this {
      return this;
    }
    scale(): this {
      return this;
    }
    rotate(): this {
      return this;
    }
    skewX(): this {
      return this;
    }
    skewY(): this {
      return this;
    }
    invertSelf(): this {
      return this;
    }
    preMultiplySelf(): this {
      return this;
    }
    multiply(): this {
      return this;
    }
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Extrae texto del archivo. Cada formato por su parser; límites duros. */
export async function extractText(
  bytes: Uint8Array,
  mime: CvMime,
): Promise<string> {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error("El archivo supera el tamaño máximo de 10 MB.");
  }

  let raw = "";
  if (mime === "pdf") {
    raw = await extractPdfText(bytes);
  } else if (mime === "docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    raw = result?.value ?? "";
  } else {
    raw = Buffer.from(bytes).toString("utf8");
  }

  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  if (text.length < MIN_TEXT_CHARS) {
    throw new Error(
      "No pudimos leer texto suficiente de este archivo (¿es un escaneo o una imagen?). Prueba con un PDF/DOCX generado digitalmente.",
    );
  }
  return text;
}
