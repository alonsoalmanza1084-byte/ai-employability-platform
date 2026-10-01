/**
 * GATE A — CONTRATO DEL EDGE (pre-auth abuse).
 *
 * Estos tests NO son "tests que existen para dar verde": son la especificación
 * ejecutable del control que debe vivir en el edge. Mientras no exista un
 * deployment con WAF delante, el archivo REPORTA EL BLOQUEO y FALLA, de modo
 * que nadie pueda declarar el gate cerrado por descuido.
 *
 * Cómo se ejecuta cuando exista el edge:
 *   EDGE_BASE_URL=https://talentflow.example.com bunx vitest run tests/edge/rateLimit.contract.test.ts
 *   (el WAF debe proteger *.convex.cloud/api/* y *.convex.site/api/auth/*)
 */
import { describe, expect, it } from "vitest";

const EDGE = process.env.EDGE_BASE_URL;
const READY = typeof EDGE === "string" && EDGE.length > 0;

interface Probe {
  status: number;
  retryAfter: string | null;
}

async function probe(path: string, init: RequestInit = {}): Promise<Probe> {
  const res = await fetch(`${EDGE}${path}`, init);
  return { status: res.status, retryAfter: res.headers.get("retry-after") };
}

describe("GATE A — contrato de rate limiting en el edge", () => {
  it.skipIf(READY)(
    "BLOQUEO: no hay EDGE_BASE_URL ⇒ el rate limiting por IP NO está verificado",
    () => {
      expect(
        EDGE,
        "PRE-AUTH ABUSE = NOT EXECUTED. Define EDGE_BASE_URL apuntando al deployment " +
          "protegido por WAF/CDN para ejecutar el contrato E-1..E-7.",
      ).toBeTruthy();
    },
  );

  it.skipIf(!READY)("E-3: una IP no puede martillear /api/auth/* (429 + Retry-After)", async () => {
    let limited = 0;
    for (let i = 0; i < 30; i++) {
      const r = await probe("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "email-otp", email: `e${i}@example.test` }),
      });
      if (r.status === 429) {
        limited++;
        expect(r.retryAfter, "429 sin Retry-After").toBeTruthy();
      }
    }
    expect(limited, "el edge no limitó ninguna petición").toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(!READY)("E-4: X-Forwarded-For falsificado NO evade el límite", async () => {
    // Se agotan primero las peticiones normales…
    for (let i = 0; i < 40; i++) {
      await probe("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "email-otp", email: `f${i}@example.test` }),
      });
    }
    // …y luego se intenta con una IP distinta por cabecera.
    const spoofed = await probe("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "9.9.9.9",
      },
      body: JSON.stringify({ provider: "email-otp", email: "spoof@example.test" }),
    });
    expect(spoofed.status, "el spoofing de IP evadió el límite").toBe(429);
  }, 60_000);

  it.skipIf(!READY)("E-5: tráfico legítimo no produce falsos positivos", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await probe("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "email-otp", email: `legit${i}@example.test` }),
      });
      expect([200, 400, 429].includes(r.status)).toBe(true);
      // 429 solo es aceptable si el límite por email ya se alcanzó; con emails
      // distintos y pocas peticiones no debería saltar.
      expect(r.status, "falso positivo del edge").not.toBe(429);
    }
  }, 60_000);
});