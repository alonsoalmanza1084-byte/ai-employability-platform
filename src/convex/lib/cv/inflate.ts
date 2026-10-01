/* eslint-disable no-bitwise -- el algoritmo DEFLATE es bit-level por definición */
/**
 * Inflate (RFC 1951) + zlib wrapper (RFC 1950) en TypeScript puro.
 *
 * POR QUÉ: el isolate de Convex no expone `zlib` (ni `node:zlib`) a las
 * actions. Los content streams de un PDF están comprimidos con FlateDecode, así
 * que sin descompresor no hay extracción de texto. Implementar el algoritmo
 * aquí evita (a) meter una dependencia nativa y (b) usar pdfjs, que además es
 * incompatible con el runtime (ver lib/cv/pdfText.ts).
 *
 * Es una transcripción del algoritmo de referencia ("puff"), con las mismas
 * tablas canónicas: no ejecuta nada del archivo, solo desreferencia longitudes
 * y copia bytes.
 */

/** Tabla de longitudes/distancias canónicas de DEFLATE (RFC 1951 §3.2.5). */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5,
  5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];
/** Orden de códigos de longitud literal/longitud (RFC 1951 §3.2.6). */
const CLEN_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/** Resultado de la descompresión, con el límite aplicado. */
export interface InflateResult {
  data: Uint8Array;
  /** true si se alcanzó maxBytes y se truncó la salida. */
  truncated: boolean;
}

class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;
  private readonly src: Uint8Array;

  constructor(src: Uint8Array) {
    this.src = src;
  }

  /** Bits del stream, least-significant-first. */
  bits(need: number): number {
    let val = this.bitBuf;
    while (this.bitCnt < need) {
      if (this.pos >= this.src.length) throw new Error("inflate: stream truncado");
      val |= this.src[this.pos++] << this.bitCnt;
      this.bitCnt += 8;
    }
    this.bitBuf = val >>> need;
    this.bitCnt -= need;
    return val & ((1 << need) - 1);
  }

  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  get bytePos(): number {
    return this.pos;
  }

  set bytePos(p: number) {
    this.pos = p;
  }
}

/** Construye el decodificador canónico de Huffman desde longitudes de códigos. */
function buildHuffman(lengths: Uint8Array, n: number): {
  counts: Int32Array;
  symbols: Int32Array;
} {
  const counts = new Int32Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Int32Array(16);
  for (let len = 1; len < 16; len++) offsets[len] = offsets[len - 1] + counts[len - 1];
  const symbols = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  }
  return { counts, symbols };
}

/** Decodifica un símbolo usando el decodificador canónico. */
function decodeSymbol(
  br: BitReader,
  h: { counts: Int32Array; symbols: Int32Array },
): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len < 16; len++) {
    code |= br.bits(1);
    const count = h.counts[len];
    if (code - first < count) return h.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error("inflate: código Huffman inválido");
}

/**
 * Descomprime un stream DEFLATE (raw) o zlib (con cabecera) hasta `maxBytes`.
 * Lanza Error si el stream es inválido.
 */
export function inflate(input: Uint8Array, maxBytes: number): InflateResult {
  const br = new BitReader(input);
  // Cabecera zlib (RFC 1950): CMF/FLG con check de checksum.
  let zlibWrapped = false;
  if (input.length >= 2) {
    const cmf = input[0];
    const flg = input[1];
    if ((cmf & 0x0f) === 8 && ((cmf << 8) + flg) % 31 === 0) {
      zlibWrapped = true;
      br.bytePos = 2;
    }
  }

  // Buffer de salida con crecimiento por duplicado y capacidad inicial razonable.
  let out = new Uint8Array(Math.min(Math.max(input.length * 4, 1024), maxBytes));
  let outLen = 0;
  let truncated = false;

  const ensure = (extra: number) => {
    if (outLen + extra <= out.length) return;
    let cap = out.length * 2;
    while (cap < outLen + extra) cap *= 2;
    cap = Math.min(cap, maxBytes);
    const next = new Uint8Array(cap);
    next.set(out.subarray(0, outLen));
    out = next;
  };

  const fixedLit = () => {
    const lengths = new Uint8Array(288);
    for (let i = 0; i < 144; i++) lengths[i] = 8;
    for (let i = 144; i < 256; i++) lengths[i] = 9;
    for (let i = 256; i < 280; i++) lengths[i] = 7;
    for (let i = 280; i < 288; i++) lengths[i] = 8;
    return buildHuffman(lengths, 288);
  };

  for (;;) {
    const last = br.bits(1);
    const type = br.bits(2);

    if (type === 0) {
      // Bloque almacenado: LEN/NLEN en little-endian + datos.
      br.alignToByte();
      const len = input[br.bytePos] | (input[br.bytePos + 1] << 8);
      br.bytePos += 4; // LEN + NLEN
      if (outLen + len > maxBytes) {
        truncated = true;
        break;
      }
      ensure(len);
      out.set(input.subarray(br.bytePos, br.bytePos + len), outLen);
      outLen += len;
      br.bytePos += len;
    } else if (type === 1 || type === 2) {
      let lit: { counts: Int32Array; symbols: Int32Array };
      let dist: { counts: Int32Array; symbols: Int32Array };
      if (type === 1) {
        lit = fixedLit();
        const dl = new Uint8Array(30).fill(5);
        dist = buildHuffman(dl, 30);
      } else {
        // Bloque dinámico: HLIT/HDIST/HCLEN + longitudes.
        const nlen = br.bits(5) + 257;
        const ndist = br.bits(5) + 1;
        const ncode = br.bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new Error("inflate: cabeceras inválidas");
        const clens = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) clens[CLEN_ORDER[i]] = br.bits(3);
        const clHuff = buildHuffman(clens, 19);
        const lengths = new Uint8Array(nlen + ndist);
        let i = 0;
        while (i < lengths.length) {
          const sym = decodeSymbol(br, clHuff);
          if (sym < 16) {
            lengths[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new Error("inflate: repeat sin previo");
            const prev = lengths[i - 1];
            let rep = 3 + br.bits(2);
            while (rep-- > 0 && i < lengths.length) lengths[i++] = prev;
          } else if (sym === 17) {
            let rep = 3 + br.bits(3);
            while (rep-- > 0 && i < lengths.length) lengths[i++] = 0;
          } else {
            let rep = 11 + br.bits(7);
            while (rep-- > 0 && i < lengths.length) lengths[i++] = 0;
          }
        }
        lit = buildHuffman(lengths.subarray(0, nlen), nlen);
        dist = buildHuffman(lengths.subarray(nlen), ndist);
      }

      for (;;) {
        const sym = decodeSymbol(br, lit);
        if (sym < 256) {
          if (outLen + 1 > maxBytes) {
            truncated = true;
            break;
          }
          ensure(1);
          out[outLen++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw new Error("inflate: longitud inválida");
          const length = LENGTH_BASE[li] + br.bits(LENGTH_EXTRA[li]);
          const dsym = decodeSymbol(br, dist);
          if (dsym >= DIST_BASE.length) throw new Error("inflate: distancia inválida");
          const distance = DIST_BASE[dsym] + br.bits(DIST_EXTRA[dsym]);
          if (distance > outLen) throw new Error("inflate: distancia fuera de rango");
          if (outLen + length > maxBytes) {
            truncated = true;
            break;
          }
          ensure(length);
          // Copia con solapamiento (LZ77): byte a byte.
          let src = outLen - distance;
          for (let k = 0; k < length; k++) out[outLen++] = out[src++];
        }
        if (truncated) break;
      }
    } else {
      throw new Error("inflate: tipo de bloque inválido");
    }
    if (last || truncated) break;
  }

  void zlibWrapped;
  return { data: out.subarray(0, outLen), truncated };
}
