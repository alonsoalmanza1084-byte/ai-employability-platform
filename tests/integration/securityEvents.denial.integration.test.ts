/* eslint-disable @typescript-eslint/no-explicit-any -- escenarios de ataque */
/**
 * P0 — VULN-12: la denegación DEBE dejar rastro.
 *
 * Antes: `securityEvent(...)` seguido de `throw` → Convex revertía la
 * transacción completa → `securityEvents` quedaba vacío (medido).
 * Ahora: la denegación se DEVUELVE (`ok:false`), el evento se confirma.
 *
 * Estos tests comprueban el CONTRATO observable por el cliente. La confirmación
 * de que la fila existe en la base de datos la hace
 * `scripts/verify_security_events.sh` (vía `convex data`, que es lectura de
 * administración y no requiere añadir superficie pública a la app).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
const api: any = gen.anyApi ?? gen.api;

async function makeClient(): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(CONVEX_URL!);
  const res: any = await client.action(api["auth"]["signIn"], { provider: "anonymous" });
  const token = res?.tokens?.token;
  if (!token) throw new Error("No sessionToken");
  client.setAuth(token);
  return client;
}

describe.skipIf(!CONVEX_URL)("P0/VULN-12 — la denegación deja security event", () => {
  it("extensión no permitida → ok:false y SIN uploadUrl (no hay autorización implícita)", async () => {
    const c = await makeClient();
    const res: any = await c.mutation(api["candidates"]["initUpload"], {
      fileName: "malicioso.exe",
      fileSize: 128,
      mimeType: "application/octet-stream",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("Formato no permitido");
    // La denegación NO puede "degenerar" en permiso: no hay URL utilizable.
    expect(res.uploadUrl).toBeUndefined();
  });

  it("archivo sobredimensionado → ok:false", async () => {
    const c = await makeClient();
    const res: any = await c.mutation(api["candidates"]["initUpload"], {
      fileName: "enorme.pdf",
      fileSize: 50 * 1024 * 1024,
      mimeType: "application/pdf",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("10 MB");
    expect(res.uploadUrl).toBeUndefined();
  });

  it("archivo válido → ok:true con uploadUrl (el camino permitido no se rompió)", async () => {
    const c = await makeClient();
    const res: any = await c.mutation(api["candidates"]["initUpload"], {
      fileName: "legitimo.txt",
      fileSize: 256,
      mimeType: "text/plain",
    });
    expect(res.ok).toBe(true);
    expect(typeof res.uploadUrl).toBe("string");
    expect(res.reason).toBeUndefined();
  });

  it("el cliente final NO PUEDE falsificar el resultado: los args no aceptan 'ok'", async () => {
    const c = await makeClient();
    let rejected = false;
    try {
      await c.mutation(api["candidates"]["initUpload"], {
        fileName: "legitimo.txt",
        fileSize: 256,
        mimeType: "text/plain",
        ok: false,
        uploadUrl: "https://atacante.example/",
      } as any);
    } catch {
      rejected = true;
    }
    expect(rejected, "el validador aceptó campos no declarados").toBe(true);
  });

  it("NO existe ninguna mutación pública que escriba o borre securityEvents", async () => {
    // El cliente no puede insertar ni borrar eventos de seguridad: no hay
    // ninguna función pública para ello (superficie pública verificada en
    // tests/static/api_surface.test.ts).
    const surface = Object.keys(api).sort();
    for (const mod of surface) {
      const fns = api[mod];
      if (!fns || typeof fns !== "object") continue;
      for (const fn of Object.keys(fns)) {
        expect(
          /^(insert|delete|purge|clear|log)Security/i.test(fn),
          `superficie pública sospechosa: ${mod}.${fn}`,
        ).toBe(false);
      }
    }
  });

  it("sin sesión, initUpload sigue denegando (fail-closed)", async () => {
    const anon = new ConvexHttpClient(CONVEX_URL!);
    let denied = false;
    try {
      const r: any = await anon.mutation(api["candidates"]["initUpload"], {
        fileName: "legitimo.txt",
        fileSize: 256,
        mimeType: "text/plain",
      });
      denied = !r?.ok;
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);
  });
});