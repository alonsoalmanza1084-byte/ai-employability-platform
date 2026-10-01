/* eslint-disable no-control-regex -- limpieza de caracteres de control */
/**
 * Extractor de texto PDF — SOLO servidor, sin dependencias de navegador.
 *
 * POR QUÉ NO USAMOS pdfjs/pdf-parse: pdfjs-dist sondea al cargar
 * `structuredClone(valor, { transfer: [valor] })`. El runtime de Convex
 * implementa `structuredClone` pero NO soporta `transfer`, y ese sondeo escapa
 * como error fatal que aborta la action completa ("structuredClone with
 * transfer not supported"), aunque esté dentro de un try/catch. Además pdfjs
 * requiere DOMMatrix/navigator/process-Node, que el isolate no tiene.
 *
 * QUÉ HACEMOS EN SU LUGAR: un parser del subconjunto de PDF que se usa en CVs
 * digitales:
 *   1. Localiza objetos indirectos (`N G obj ... endobj`) y sus streams.
 *   2. Infla los streams con /FlateDecode (zlib) — con límites anti zip-bomb.
 *   3. Recorre las páginas (objetos /Type /Page) y sus /Contents.
 *   4. Interpreta los operadores de texto (Tj, TJ, ', ") decodificando las
 *      cadenas según la fuente: WinAnsi/Standard para fuentes simples y
 *      códigos de 2 bytes vía CMap /ToUnicode para fuentes CID (Identity-H),
 *      que es lo que generan Word, LibreOffice y LaTeX.
 *   5. Reconstruye espacios y saltos de línea a partir del posicionamiento.
 *
 * SEGURIDAD (SECURITY.md §5): nunca se ejecuta ni se renderiza nada del PDF.
 * Solo se descomprimen streams de contenido y se leen operadores de texto.
 * Los streams nunca se interpretan como código, y todo tiene techo de tamaño
 * para que un PDF hostil no agote memoria ni tiempo.
 */
import { inflate } from "./inflate";

/** Techo de texto descomprimido por PDF (anti zip-bomb / DoS de CPU). */
export const MAX_DECOMPRESSED_BYTES = 24 * 1024 * 1024; // 24 MB
/** Techo de ratio de compresión aceptado (un PDF real rara vez pasa de 200x). */
export const MAX_COMPRESSION_RATIO = 400;
/** Techo de objetos PDF examinados. */
const MAX_OBJECTS = 20_000;
/** Techo de páginas procesadas. */
const MAX_PAGES = 200;

/** Uint8Array → string latin1 (1 carácter por byte, conserva offsets). */
function toLatin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** string latin1 → Uint8Array. */
function fromLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

interface PdfObject {
  num: number;
  dict: string;
  /** Contenido del stream ya inflado, si el objeto tenía stream. */
  data: Uint8Array | null;
}

interface CMap {
  /** código (normalizado a string de bytes) → texto unicode. */
  map: Map<string, string>;
  /** número de bytes por código según / codespacerange. */
  codeBytes: 1 | 2;
}

/**
 * Indexa los objetos indirectos del PDF.
 * No interpreta bytecode: solo separa diccionario y stream.
 */
function indexObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const objs = new Map<number, PdfObject>();
  const src = toLatin1(bytes);
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(src)) !== null && count < MAX_OBJECTS) {
    count++;
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;

    // El diccionario va hasta "stream" o hasta "endobj".
    const streamIdx = src.indexOf("stream", bodyStart);
    let dictEnd = src.indexOf("endobj", bodyStart);
    const hasStream = streamIdx !== -1 && (dictEnd === -1 || streamIdx < dictEnd);

    if (!hasStream) {
      if (dictEnd === -1) dictEnd = Math.min(src.length, bodyStart + 20_000);
      objs.set(num, {
        num,
        dict: src.slice(bodyStart, dictEnd),
        data: null,
      });
      re.lastIndex = dictEnd;
      continue;
    }

    const dict = src.slice(bodyStart, streamIdx);
    // Tras la palabra "stream" viene EOL (CRLF, LF o CR) y luego los datos.
    let dataStart = streamIdx + "stream".length;
    if (src[dataStart] === "\r") dataStart++;
    if (src[dataStart] === "\n") dataStart++;
    const endIdx = src.indexOf("endstream", dataStart);
    if (endIdx === -1) {
      objs.set(num, { num, dict, data: null });
      continue;
    }
    let dataEnd = endIdx;
    // El EOL anterior a "endstream" no forma parte del stream.
    if (src[dataEnd - 1] === "\n") dataEnd--;
    if (src[dataEnd - 1] === "\r") dataEnd--;
    objs.set(num, { num, dict, data: bytes.subarray(dataStart, dataEnd) });
    re.lastIndex = endIdx;
  }
  return objs;
}

/** Descomprime un stream si su dict declara /FlateDecode; con topes de ratio. */
function decodeStream(obj: PdfObject): string | null {
  if (!obj.data) return null;
  const raw = obj.data;
  const isFlate = /\/FlateDecode/.test(obj.dict);
  if (!isFlate) {
    return toLatin1(raw.subarray(0, MAX_DECOMPRESSED_BYTES));
  }
  try {
    const out = zlib.inflateSync(Buffer.from(raw), {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    });
    //(zip-bomb: ratio absurdo con datos legítimos).
    if (raw.length > 0 && out.length / raw.length > MAX_COMPRESSION_RATIO) {
      return null;
    }
    return toLatin1(new Uint8Array(out));
  } catch {
    // Algunos Producers emiten streams Flate con datos truncados: probamos
    // inflate parcial antes de rendirlos.
    try {
      const out = zlib.inflateSync(Buffer.from(raw), {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
        maxOutputLength: MAX_DECOMPRESSED_BYTES,
      });
      if (raw.length > 0 && out.length / raw.length > MAX_COMPRESSION_RATIO) {
        return null;
      }
      return toLatin1(new Uint8Array(out));
    } catch {
      return null;
    }
  }
}

/** Resuelve una referencia "N G R" (o "N G") a su número de objeto. */
function refNum(dicts: string, key: string): number | null {
  const re = new RegExp(`/${key}\\s+(\\d+)(?:\\s+\\d+\\s+R)?`);
  const m = dicts.match(re);
  return m ? Number(m[1]) : null;
}

/** Lee una entrada del diccionario de la página (/Contents, /Resources). */
function dictEntry(dict: string, key: string): string | null {
  const re = new RegExp(`/${key}\\s*(\\d+)\\s+\\d+\\s+R`);
  const m = dict.match(re);
  if (m) return `${m[1]} 0 R`;
  // Valor inline (no referencia): hasta el siguiente /Key o fin de dict.
  const inline = new RegExp(`/${key}\\s*(<<[\\s\\S]*?>>|\\/[^\\s/>]+)`);
  const m2 = dict.match(inline);
  return m2 ? m2[1] : null;
}

/** Extrae CMaps /ToUnicode (mapea códigos de fuente a unicode). */
function parseToUnicode(cmapText: string): CMap {
  const map = new Map<string, string>();
  let codeBytes: 1 | 2 = 2;

  // /codespacerange fija el ancho de código (00 → 1 byte, 0000 → 2 bytes).
  const csr = cmapText.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (csr) {
    const first = csr[1].match(/<([0-9A-Fa-f]+)>/);
    if (first) codeBytes = Math.max(1, Math.min(2, Math.ceil(first[1].length / 2))) as 1 | 2;
  }

  const hexToStr = (hex: string): string => {
    let out = "";
    // Une UTF-16BE (las CMaps usan UTF-16BE, a veces con BOM).
    const clean = hex.length % 2 === 0 ? hex : hex + "0";
    for (let i = 0; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (!Number.isNaN(code) && code > 0) out += String.fromCharCode(code);
    }
    return out;
  };

  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(normalizeCode(pair[1], codeBytes), hexToStr(pair[2]));
    }
  }
  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g,
    )) {
      const lo = parseInt(range[1], 16);
      const hi = parseInt(range[2], 16);
      if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo) continue;
      // Techo de rango: una fuente hostil podría declarar 0..2^32.
      const span = Math.min(hi - lo, 65_535);
      if (range[3]) {
        const base = range[3];
        for (let k = 0; k <= span; k++) {
          const shifted = shiftHex(base, k);
          map.set(
            normalizeCode((lo + k).toString(16), codeBytes),
            hexToStr(shifted),
          );
        }
      } else if (range[4]) {
        const items = [...range[4].matchAll(/<([0-9A-Fa-f]+)>/g)];
        for (let k = 0; k <= span && k < items.length; k++) {
          map.set(
            normalizeCode((lo + k).toString(16), codeBytes),
            hexToStr(items[k][1]),
          );
        }
      }
    }
  }
  return { map, codeBytes };
}

/** Suma k al final de una cadena hex (para bfrange con destino incremental). */
function shiftHex(hex: string, delta: number): string {
  const width = hex.length;
  const value = parseInt(hex, 16) + delta;
  return value.toString(16).toUpperCase().padStart(width, "0");
}

/** Normaliza un código a su clave canónica (ancho fijo en hex, minúsculas). */
function normalizeCode(hex: string, codeBytes: 1 | 2): string {
  const width = codeBytes * 2;
  return hex.toLowerCase().padStart(width, "0");
}

/** Decodifica una cadena literal PDF "(...)" con sus escapes. */
function decodeLiteral(src: string, start: number): { text: string; end: number } | null {
  let out = "";
  let i = start;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      const next = src[i + 1];
      i++;
      switch (next) {
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "(": out += "("; break;
        case ")": out += ")"; break;
        case "\\": out += "\\"; break;
        case "\n": break; // continuación de línea
        case "\r": if (src[i + 1] === "\n") i++; break;
        default:
          if (next && /[0-7]/.test(next)) {
            // Octal de hasta 3 dígitos.
            let oct = next;
            while (oct.length < 3 && /[0-7]/.test(src[i + 1] ?? "")) {
              oct += src[++i];
            }
            out += String.fromCharCode(parseInt(oct, 8));
          } else if (next !== undefined) {
            out += next; // escape desconocido: literal
          }
      }
      continue;
    }
    if (ch === "(") {
      depth++;
      if (depth > 1) out += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) return { text: out, end: i + 1 };
      out += ch;
      continue;
    }
    out += ch;
  }
  return null;
}

/** Decodifica una cadena hexadecimal PDF "<...>". */
function decodeHex(src: string, start: number): { hex: string; end: number } | null {
  const close = src.indexOf(">", start);
  if (close === -1) return null;
  const hex = src.slice(start + 1, close).replace(/[^0-9A-Fa-f]/g, "");
  return { hex, end: close + 1 };
}

/** Convierte códigos de fuente (hex) a texto usando el CMap o WinAnsi. */
function codesToText(hex: string, font: FontInfo): string {
  const width = font.cid ? font.cmap?.codeBytes ?? 2 : 1;
  let out = "";
  const padded = hex.length % (width * 2) === 0 ? hex : hex + "0";
  for (let i = 0; i < padded.length; i += width * 2) {
    const code = padded.slice(i, i + width * 2);
    if (font.cmap) {
      const mapped = font.cmap.map.get(normalizeCode(code, font.cmap.codeBytes));
      out += mapped ?? "";
    } else {
      // Fuente simple sin ToUnicode: byte = carácter (WinAnsi ≈ latin1).
      const b = parseInt(code, 16);
      if (!Number.isNaN(b)) out += String.fromCharCode(b);
    }
  }
  return out;
}

interface FontInfo {
  cid: boolean;
  cmap: CMap | null;
}

/** Carga la fuente /F desde el contenido y su CMap si existe. */
function loadFont(resources: string, fontRes: string, objs: Map<number, PdfObject>): FontInfo {
  // resources: "<</Font<</F1 5 0 R>> ...>>"
  const fontDictRef = resources.match(/\/Font\s*<<([\s\S]*?)>>/);
  const inlineFontDict =
    (fontDictRef && fontDictRef[1]) ??
    (() => {
      const ref = resources.match(/\/Font\s+(\d+)\s+\d+\s+R/);
      if (!ref) return null;
      const fontObj = objs.get(Number(ref[1]));
      return fontObj ? fontObj.dict : null;
    })();
  const entry = fontRes.match(/[A-Za-z0-9#._-]+/)?.[0];
  if (!fontDictDict) return { cid: false, cmap: null };
  if (!entry) return { cid: false, cmap: null };
  const fontRef = new RegExp(`/${escapeRe(entry)}\\s+(\\d+)\\s+\\d+\\s+R`).exec(
    fontDictDict,
  );
  const fontObj = fontRef ? objs.get(Number(fontRef[1])) : null;
  if (!fontObj) return { cid: false, cmap: null };

  const isCid = /\/Type0|\/Identity-H|\/Identity-V/.test(fontObj.dict);
  let cmap: CMap | null = null;
  const tuRef = refNum(fontObj.dict, "ToUnicode");
  if (tuRef !== null) {
    const tuObj = objs.get(tuRef);
    if (tuObj) {
      const text = decodeStream(tuObj);
      if (text) cmap = parseToUnicode(text);
    }
  }
  return { cid: isCid, cmap };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Interpreta los operadores de texto de un content stream y devuelve texto.
 */
function extractFromContent(content: string, resources: string, objs: Map<number, PdfObject>): string {
  let out = "";
  let font: FontInfo = { cid: false, cmap: null };
  // Última posición Y conocida para detectar saltos de línea.
  let lastY: number | null = null;
  const MAX_TEXT = 200_000;

  for (let i = 0; i < content.length && out.length < MAX_TEXT; ) {
    const ch = content[i];

    // --- Cadenas literales: (texto) Tj | ' | "
    if (ch === "(") {
      const lit = decodeLiteral(content, i + 1);
      if (lit) {
        out += lit.text;
        i = lit.end;
        continue;
      }
      i++;
      continue;
    }

    // --- Cadenas hex: <ABCD> Tj
    if (ch === "<") {
      const hex = decodeHex(content, i + 1);
      if (hex) {
        out += codesToText(hex.hex, font);
        i = hex.end;
        continue;
      }
      i++;
      continue;
    }

    // --- Números y operadores clave.
    if (/[A-Za-z*'"]/.test(ch)) {
      // Buscamos el operador (puede venir precedido de argumentos).
      const opMatch = /^(T\*|Tj|TJ|Td|TD|Tf|Tm|TL|BT|ET|'|")/.exec(content.slice(i));
      if (opMatch) {
        const op = opMatch[0];
        // Cambio de fuente: /F1 12 Tf → identificador anterior en la línea.
        if (op === "Tf") {
          const before = content.slice(Math.max(0, i - 24), i);
          const res = before.match(/([A-Za-z0-9#._-]+)\s+[\d.]+\s*$/);
          if (res) font = loadFont(resources, res[1], objs);
        }
        // Salto de línea explícito.
        if (op === "T*") out += "\n";
        // Td/TD/Tm con salto vertical grande → nueva línea.
        if (op === "Td" || op === "TD" || op === "Tm") {
          const nums = [...content.slice(Math.max(0, i - 40), i).matchAll(/-?[\d.]+/g)]
            .map((m) => Number(m[0]))
            .filter((n) => !Number.isNaN(n));
          const y = nums.length >= 2 ? nums[nums.length - 1] : null;
          if (y !== null && lastY !== null && Math.abs(y - lastY) > 1.5) out += "\n";
          if (y !== null) lastY = y;
        }
        // Operador de avance de línea con show: ' y "
        if (op === "'" || op === '"') out += "\n";
        i += op.length;
        continue;
      }
      i++;
      continue;
    }

    // --- Kerning dentro de TJ: números negativos grandes implican espacio.
    if (/[,\]]/.test(ch)) {
      const gap = /(-?\d+(?:\.\d+)?)\s*[,\]]/.exec(content.slice(i));
      if (gap && Number(gap[1]) <= -120) out += " ";
      i++;
      continue;
    }

    i++;
  }
  return out;
}

/**
 * Extrae el texto de un PDF. Devuelve "" si el PDF no contiene texto
 * extraíble (escaneos/imágenes), para que el llamador pueda fallar.
 */
export function extractPdfText(bytes: Uint8Array): string {
  const objs = indexObjects(bytes);
  if (objs.size === 0) return "";

  // Páginas: objetos /Type /Page (los /Pages son contenedores).
  const pages: PdfObject[] = [];
  for (const obj of objs.values()) {
    if (/\/Type\s*\/Page[^s]/.test(obj.dict) && pages.length < MAX_PAGES) {
      pages.push(obj);
    }
  }
  // Si el PDF usa un árbol de páginas con streams comprimidos (/Type /Pages),
  // el fallback recorre todos los streams con operadores de texto.
  const candidates = pages.length > 0 ? pages : [];

  let text = "";
  if (candidates.length > 0) {
    for (const page of candidates) {
      const contents = dictEntry(page.dict, "Contents");
      if (!contents) continue;
      const refs = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
      if (refs.length === 0) {
        // /Contents puede ser un stream directo (inline).
        continue;
      }
      const resourcesRef = dictEntry(page.dict, "Resources");
      const resourcesObj = resourcesRef
        ? objs.get(Number(resourcesRef.match(/(\d+)/)?.[1] ?? -1))
        : null;
      const resources = resourcesObj?.dict ?? "";
      for (const ref of refs) {
        const streamObj = objs.get(ref);
        if (!streamObj) continue;
        const content = decodeStream(streamObj);
        if (!content) continue;
        text += extractFromContent(content, resources, objs) + "\n";
        if (text.length > 200_000) break;
      }
      if (text.length > 200_000) break;
    }
  }

  // Fallback: PDFs sin árbol de páginas reconocible. Buscamos streams que
  // contengan operadores de texto. Solo se leen streams ya inflados y acotados.
  if (text.trim().length < 40) {
    for (const obj of objs.values()) {
      if (!obj.data) continue;
      const content = decodeStream(obj);
      if (!content || !/\bT[jJ]\b|\bTJ\b/.test(content)) continue;
      text += extractFromContent(content, "", objs) + "\n";
      if (text.length > 200_000) break;
    }
  }

  return text;
}
