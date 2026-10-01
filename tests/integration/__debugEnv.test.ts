/* eslint-disable @typescript-eslint/no-explicit-any -- diagnóstico temporal */
/** Test TEMPORAL de diagnóstico: imprime el entorno del isolate de Convex. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConvexHttpClient } from "convex/browser";

describe("diagnóstico entorno Convex", () => {
  it("imprime el probe", async () => {
    const env = readFileSync(
      join(__dirname, "..", "..", ".env.local"),
      "utf8",
    );
    const url = env
      .split("\n")
      .find((l) => l.startsWith("VITE_CONVEX_URL="))
      ?.split("=")
      .slice(1)
      .join("=")
      .trim();
    const gen: any = await import("../../src/convex/_generated/api");
    const api: any = gen.anyApi ?? gen.api;
    const c = new ConvexHttpClient(url!);
    const r: any = await c.action(api["__debugPdf"]["debugEnv"], {});
    // eslint-disable-next-line no-console
    console.log("DEBUG_ENV:", JSON.stringify(r, null, 2));
    expect(r).toBeTruthy();
  });
});
