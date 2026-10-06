/**
 * UI DE PROPOSALS (R3) — invariantes INV-UI-001..010 verificados estáticamente
 * sobre el código fuente REAL de `src/pages/Dashboard.tsx` (componente Coach)
 * y `src/convex/coach.ts`. Sin BD ni red: leen el código.
 *
 * Qué cubre (equivale a los escenarios pedidos en §9 con la infra existente):
 *   - render sin proposals (guard), render pending y rejected (badges exactos);
 *   - el botón de rechazo SOLO existe para pending;
 *   - reject exitoso → cierra el diálogo y la query reactiva refresca (sin
 *     optimistic update: la UI nunca escribe `status`);
 *   - reject fallido → error real en `role="alert"`, sin falso éxito;
 *   - doble click → guard `rejecting !== null` + `disabled` en la acción;
 *   - ownership: la UI solo envía `proposalId` (jamás userId) y usa exclusivamente
 *     la mutation pública aprobada `rejectProposalByOwner`;
 *   - ausencia de mutación de `candidateProfiles` desde el Coach;
 *   - invariantes pending | rejected: jamás `accepted`, jamás «aplicada».
 *
 * PENDIENTE (sin infra de rendering en el proyecto: no hay @testing-library/
 * jsdom en devDependencies): tests de DOM reales (click → diálogo → mutation).
 * No se inventa infraestructura; queda documentado como limitación.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const dashboard = readFileSync(join(ROOT, "src", "pages", "Dashboard.tsx"), "utf8");
const coach = readFileSync(join(ROOT, "src", "convex", "coach.ts"), "utf8");

/** Scope del componente Coach() (hasta el componente raíz). */
const coachScope = dashboard.slice(
  dashboard.indexOf("function Coach()"),
  dashboard.indexOf("export default function Dashboard"),
);

describe("UI de proposals — fuente de datos y envío (R3)", () => {
  it("el envío usa sendMessageWithProposals (nunca el action simple sendMessage)", () => {
    expect(dashboard).toMatch(/useAction\(api\.coach\.sendMessageWithProposals\)/);
    expect(dashboard).not.toMatch(/api\.coach\.sendMessage\b/);
  });

  it("la lista se carga con listProposals(conversationId) como única fuente (sin getProposal por elemento)", () => {
    expect(dashboard).toMatch(/useQuery\(\s*api\.coach\.listProposals,/);
    expect(dashboard).toContain("state.conversation._id");
    // Sin requests innecesarios: getProposal NO se usa en la UI.
    expect(dashboard).not.toMatch(/api\.coach\.getProposal\b/);
    // Sin conversación aún → skip (ninguna llamada huérfana).
    expect(dashboard).toMatch(/: "skip"/);
  });

  it("el rechazo invoca EXCLUSIVAMENTE la mutation pública con proposalId (INV-UI-005: sin userId)", () => {
    expect(dashboard).toMatch(/useMutation\(api\.coach\.rejectProposalByOwner\)/);
    expect(dashboard).toMatch(
      /rejectProposalByOwner\(\{\s*proposalId:\s*rejectTarget\s*\}\)/,
    );
    expect(dashboard).not.toMatch(/rejectProposalByOwner\(\{[^}]*userId/);
    // La interna `rejectProposal` NO es invocable desde el cliente: la UI no la referencia.
    expect(dashboard).not.toMatch(/api\.coach\.rejectProposal\b/);
  });
});

describe("UI de proposals — render de estados (INV-UI-001/002/003/009/010)", () => {
  it("render sin proposals: la sección existe solo con elementos (guard explícito)", () => {
    expect(dashboard).toMatch(/proposals && proposals\.proposals\.length > 0/);
  });

  it("render pending: badge exacto «Pendiente de confirmación» sobre «Propuesta de mejora»", () => {
    expect(dashboard).toContain("Propuesta de mejora");
    expect(dashboard).toContain("Pendiente de confirmación");
    expect(dashboard).toMatch(/p\.status === "pending" \?/);
  });

  it("render rejected: badge exacto «Rechazada» (único estado alternativo)", () => {
    expect(dashboard).toContain("Rechazada");
    expect(dashboard).toMatch(/p\.status === "pending" \?[\s\S]*?Rechazada/);
  });

  it("INV-UI-002/009/010: jamás accepted, jamás «aplicada/verificada» como estado de propuesta", () => {
    // Ni como identificador, ni como copy, ni como rama de estado.
    expect(dashboard).not.toMatch(/accepted/i);
    expect(dashboard).not.toMatch(/aceptada/i);
    // La UI nunca construye/escribe estados: solo renderiza lo que llega del servidor.
    expect(dashboard).not.toMatch(/status:\s*"(pending|rejected)"/);
    expect(dashboard).not.toMatch(/setProposals/);
    // El copy explicita que la propuesta NO se aplica sola (INV-UI-001).
    expect(coachScope).toMatch(/nunca se aplica sola/);
    expect(coachScope).toMatch(/nunca se aplican a tu\s*perfil/);
  });

  it("INV-UI-009: la evidencia se comunica como base de la propuesta, sin construirla en frontend", () => {
    expect(coachScope).toMatch(/evidencia de tu\s*perfil\s*validada en el servidor/);
    // El frontend no fabrica excerpt/evidence: esos campos solo viven en el backend.
    expect(dashboard).not.toMatch(/excerpt:/);
    expect(dashboard).not.toMatch(/sourceId:/);
  });
});

describe("UI de proposals — rechazo (INV-UI-003/004/007/008)", () => {
  it("el rechazo exige confirmación en AlertDialog (flujo UI → confirmación → mutation)", () => {
    expect(dashboard).toMatch(/<AlertDialog\b/);
    expect(dashboard).toContain("¿Rechazar esta propuesta?");
    expect(dashboard).toMatch(/onClick=\{\(\) => void confirmReject\(\)\}/);
  });

  it("el botón de rechazo SOLO se renderiza para pending (INV-UI-004)", () => {
    expect(dashboard).toMatch(/p\.status === "pending" && \([\s\S]{0,400}?Rechazar/);
  });

  it("sin optimistic update: éxito → cierra diálogo y la query reactiva refresca", () => {
    const start = dashboard.indexOf("async function confirmReject");
    expect(start).toBeGreaterThan(-1);
    const scope = dashboard.slice(start, dashboard.indexOf("\n  }", start));
    expect(scope).toMatch(/if \(res\.ok\)/);
    expect(scope).toMatch(/setRejectTarget\(null\)/);
    // Éxito real implica refresco por reactividad de listProposals, no estado local.
    expect(scope).not.toMatch(/status:/);
  });

  it("error real del backend → role=\"alert\" con res.reason; sin falso éxito (INV-UI-008)", () => {
    const start = dashboard.indexOf("async function confirmReject");
    const scope = dashboard.slice(start, dashboard.indexOf("\n  }", start));
    expect(scope).toMatch(/else \{\s*\/\/[^\n]*\n\s*setProposalError\(res\.reason\)/);
    expect(scope).toMatch(/catch \{[\s\S]*?setProposalError\(/);
    // El error se anuncia accesiblemente junto a la lista y dentro del diálogo.
    expect(coachScope.match(/role="alert"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("doble click / reintento: guard de mutación en curso + botones deshabilitados", () => {
    const start = dashboard.indexOf("async function confirmReject");
    const scope = dashboard.slice(start, dashboard.indexOf("\n  }", start));
    expect(scope).toMatch(/if \(!rejectTarget \|\| rejecting !== null\) return;/);
    // Tanto el disparador como la acción del diálogo quedan deshabilitados.
    expect(dashboard.match(/disabled=\{rejecting !== null\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(scope).toMatch(/finally \{\s*setRejecting\(null\)/);
  });

  it("INV-UI-007/006: el Coach no envía identidad del usuario ni muta candidateProfiles", () => {
    expect(coachScope).not.toMatch(/api\.candidates\./);
    expect(coachScope).not.toMatch(/updateProfile/);
    expect(coachScope).not.toMatch(/userId/);
  });

  it("backend: el wrapper público conserva las garantías (requireSelf, ownership, pending→rejected, audit)", () => {
    const start = coach.indexOf("export const rejectProposalByOwner");
    expect(start).toBeGreaterThan(-1);
    const next = coach.indexOf("export const ", start + 10);
    const scope = next === -1 ? coach.slice(start) : coach.slice(start, next);
    expect(scope).toMatch(/requireSelf/);
    expect(scope).toMatch(/proposal\.userId !== userId/);
    expect(scope).toMatch(/status !== "pending"/);
    expect(scope).toMatch(/status: "rejected"/);
    expect(scope).toMatch(/coach\.proposal\.reject/);
    expect(scope).not.toMatch(/(insert|patch|replace|delete)\(\s*"candidateProfiles"/);
    expect(coach).not.toMatch(/"accepted"/);
  });
});
