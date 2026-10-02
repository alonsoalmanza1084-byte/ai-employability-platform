/**
 * VULN-14 — SUPERFICIE AUDITADA.
 *
 * Wrappers `action` que delegan en las funciones públicas ya verificadas
 * (`orgs`, `jobs`, `applications`, `matches`) y registran la denegación en una
 * transacción aparte.
 *
 * POR QUÉ NO SE MODIFICAN LAS ORIGINALES
 * --------------------------------------
 * `orgs.invite`, `jobs.create`, etc. llevan `requireMembership` y están
 * VERIFICADAS. Reescribirlas para devolver `{ok:false}` obligaría a auditar en
 * cada call site que el retorno se comprueba, y un solo olvido sería un bypass
 * real. El wrapper no toca ese código: lo rodea.
 *
 * CADA WRAPPER ES ADITIVO Y NO PUEDE DEBILITAR LA AUTORIZACIÓN:
 *   · el error se vuelve a lanzar SIEMPRE  → fail-closed idéntico.
 *   · el objetivo sigue siendo el mismo y se sigue invocando de una en una.
 *   · el preflight solo puede DENEGAR, jamás autorizar.
 *
 * Los endpoints dirigidos por `jobId`/`applicationId` NO llevan preflight: la
 * organización solo se resuelve dentro de la función real. Su denegación se
 * registra igual, en el `catch`, que es el mecanismo universal.
 *
 * Para invocar una acción auditada desde el cliente: `api.audited.<nombre>`.
 */
import { v } from "convex/values";
import { api } from "./_generated/api";
import { auditedAction } from "./lib/audited";

/* ─────────────────────────── organización ─────────────────────────── */

export const orgMembers = auditedAction(
  { organizationId: v.id("organizations") },
  { operation: "orgs.members", kind: "query", target: api.orgs.members, orgArg: "organizationId", minRole: "hiring_manager" },
);

export const orgInvite = auditedAction(
  {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("org_admin"),
      v.literal("recruiter"),
      v.literal("hiring_manager"),
    ),
  },
  { operation: "orgs.invite", kind: "mutation", target: api.orgs.invite, orgArg: "organizationId", minRole: "org_admin" },
);

export const orgPendingInvites = auditedAction(
  { organizationId: v.id("organizations") },
  { operation: "orgs.pendingInvites", kind: "query", target: api.orgs.pendingInvites, orgArg: "organizationId", minRole: "org_admin" },
);

export const orgRevokeInvite = auditedAction(
  { organizationId: v.id("organizations"), invitationId: v.id("invitations") },
  { operation: "orgs.revokeInvite", kind: "mutation", target: api.orgs.revokeInvite, orgArg: "organizationId", minRole: "org_admin" },
);

export const orgRemoveMember = auditedAction(
  { organizationId: v.id("organizations"), targetUserId: v.id("users") },
  { operation: "orgs.removeMember", kind: "mutation", target: api.orgs.removeMember, orgArg: "organizationId", minRole: "org_admin" },
);

export const orgAuditTrail = auditedAction(
  { organizationId: v.id("organizations"), page: v.optional(v.number()) },
  { operation: "orgs.auditTrail", kind: "query", target: api.orgs.auditTrail, orgArg: "organizationId", minRole: "org_admin" },
);

/* ─────────────────────────────── vacantes ────────────────────────── */

export const jobsListByOrg = auditedAction(
  { organizationId: v.id("organizations") },
  { operation: "jobs.listByOrg", kind: "query", target: api.jobs.listByOrg, orgArg: "organizationId", minRole: "hiring_manager" },
);

export const jobsGet = auditedAction(
  { jobId: v.id("jobs") },
  { operation: "jobs.get", kind: "query", target: api.jobs.get },
);

export const jobsCreate = auditedAction(
  {
    organizationId: v.id("organizations"),
    title: v.string(),
    description: v.string(),
    location: v.optional(v.string()),
    seniority: v.optional(v.string()),
    requirements: v.array(
      v.object({
        type: v.union(
          v.literal("skill"),
          v.literal("experience_years"),
          v.literal("education"),
          v.literal("certification"),
        ),
        label: v.string(),
        minLevel: v.optional(v.number()),
        minYears: v.optional(v.number()),
        weight: v.number(),
        isMustHave: v.optional(v.boolean()),
      }),
    ),
  },
  { operation: "jobs.create", kind: "mutation", target: api.jobs.create, orgArg: "organizationId", minRole: "hiring_manager" },
);

export const jobsClose = auditedAction(
  { jobId: v.id("jobs") },
  { operation: "jobs.close", kind: "mutation", target: api.jobs.close },
);

/* ──────────────────────────── applicants ──────────────────────────── */

export const applicationsListByJob = auditedAction(
  { jobId: v.id("jobs") },
  { operation: "applications.listByJob", kind: "query", target: api.applications.listByJob },
);

export const applicationsDecide = auditedAction(
  {
    applicationId: v.id("applications"),
    status: v.union(v.literal("pending"), v.literal("shortlisted"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  { operation: "applications.decide", kind: "mutation", target: api.applications.decide },
);

export const applicationsAddNote = auditedAction(
  { applicationId: v.id("applications"), body: v.string() },
  { operation: "applications.addNote", kind: "mutation", target: api.applications.addNote },
);

export const applicationsNotesFor = auditedAction(
  { applicationId: v.id("applications") },
  { operation: "applications.notesFor", kind: "query", target: api.applications.notesFor },
);

export const applicationsInitUpload = auditedAction(
  { jobId: v.id("jobs"), fileName: v.string(), fileSize: v.number() },
  { operation: "applications.initUpload", kind: "mutation", target: api.applications.initUpload },
);

export const applicationsFinalizeUpload = auditedAction(
  {
    jobId: v.id("jobs"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    candidateName: v.string(),
  },
  { operation: "applications.finalizeUpload", kind: "mutation", target: api.applications.finalizeUpload },
);

/* ─────────────────────────────── matches ──────────────────────────── */

export const matchesGetForApplication = auditedAction(
  { applicationId: v.id("applications") },
  { operation: "matches.getForApplication", kind: "query", target: api.matches.getForApplication },
);
