/* eslint-disable @typescript-eslint/no-explicit-any -- diagnóstico temporal */
/** ACTION TEMPORAL de diagnóstico del entorno para pdfjs. Se borra al terminar. */
import { action } from "./_generated/server";

export const debugEnv = action({
  args: {},
  handler: async () => {
    const g = globalThis as any;
    const info: Record<string, string> = {};
    const probe = (name: string, fn: () => unknown) => {
      try {
        info[name] = String(fn());
      } catch (e: any) {
        info[name] = `ERR:${e?.message ?? e}`;
      }
    };
    probe("processType", () => typeof g.process);
    probe("processString", () => (g.process ? `${g.process}` : "none"));
    probe("versions", () => JSON.stringify(g.process?.versions ?? null));
    probe("DOMMatrix", () => typeof g.DOMMatrix);
    probe("navigator", () => typeof g.navigator);
    probe("structuredClone", () => typeof g.structuredClone);
    probe("Buffer", () => typeof g.Buffer);
    probe("crypto", () => typeof g.crypto);

    // ¿Es el global realmente asignable?
    try {
      const orig = g.structuredClone;
      g.structuredClone = (v: any) => orig(v);
      probe("assignStructuredClone", () => "ok");
      probe(
        "patchedProbe",
        () => {
          try {
            const buf = new ArrayBuffer(8);
            g.structuredClone(buf, { transfer: [buf] });
            return "sin error (transfer ignorado)";
          } catch (e: any) {
            return `ERR:${e?.message ?? e}`;
          }
        },
      );
      g.structuredClone = orig;
    } catch (e: any) {
      probe("assignStructuredClone", () => `ERR:${e?.message ?? e}`);
    }

    let imported: string;
    try {
      const mod: any = await import("pdf-parse");
      imported = `ok:${typeof mod.PDFParse}`;
    } catch (e: any) {
      imported = `ERR:${e?.message ?? e}`;
    }
    return { info, imported };
  },
});
