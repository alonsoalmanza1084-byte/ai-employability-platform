/* eslint-disable no-control-regex -- quitamos caracteres de control a propósito */
/**
 * Parser de CVs — SOLO servidor ("use node"). Nunca se ejecuta el archivo:
 * solo lectura de bytes y extracción de texto (SECURITY.md §5).
 */
import mammoth from "mammoth";
import { extractPdfText as extractPdf } from "./pdfText";

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
 * Extrae texto de un PDF.
 *
 * POR QUÉ NO pdfjs/pdf-parse: pdfjs-dist sondea al cargar
 * `structuredClone(valor, { transfer: [valor] })`. El isolate de Convex
 * implementa `structuredClone` pero NO soporta `transfer`, y ese sondeo escapa
 * como error fatal que ABORTA la action aunque esté dentro de un try/catch
 * (verificado en el deployment real). Además pdfjs exige DOMMatrix, navigator
 * y un worker, que el isolate no tiene.
 *
 * Usamos nuestro propio lector de PDF (lib/cv/pdfText.ts), que solo descomprime
 * content streams e interpreta operadores de texto. Nunca ejecuta ni renderiza
 * el archivo (SECURITY.md §5).
 */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  try {
    return extractPdf(bytes);
  } catch (err) {
    throw new Error(
      `No pudimos procesar el PDF: ${
        err instanceof Error ? err.message : "formato no reconocido"
      }`,
    );
  }
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
