import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

/**
 * TalentFlow AI — schema V1 (multi-tenant).
 * Ver docs/DATABASE.md. Regla: toda tabla con datos de una organización lleva
 * organizationId y sus índices de lectura lo incluyen como prefijo.
 */

export const ROLES = {
  CANDIDATE: "candidate",
  RECRUITER: "recruiter",
  ORG_ADMIN: "org_admin",
  PLATFORM_ADMIN: "platform_admin",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.CANDIDATE),
  v.literal(ROLES.RECRUITER),
  v.literal(ROLES.ORG_ADMIN),
  v.literal(ROLES.PLATFORM_ADMIN),
);
export type Role = Infer<typeof roleValidator>;

export const orgRoleValidator = v.union(
  v.literal("org_admin"),
  v.literal("recruiter"),
  v.literal("hiring_manager"),
);
export type OrgRole = Infer<typeof orgRoleValidator>;

export const appStatusValidator = v.union(
  v.literal("pending"),
  v.literal("shortlisted"),
  v.literal("rejected"),
);

/** Estructuras del perfil (extraídas por IA o editadas por humanos). */
export const skillValidator = v.object({
  name: v.string(),
  level: v.number(), // 1..5
  source: v.union(v.literal("ai"), v.literal("human")),
  evidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
});

export const experienceValidator = v.object({
  company: v.string(),
  title: v.string(),
  start: v.string(), // "2021-03" | "2021"
  end: v.optional(v.string()),
  current: v.optional(v.boolean()),
  description: v.string(),
  achievements: v.array(v.string()),
  source: v.union(v.literal("ai"), v.literal("human")),
  evidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
});

export const educationValidator = v.object({
  institution: v.string(),
  degree: v.string(),
  field: v.optional(v.string()),
  startYear: v.optional(v.number()),
  endYear: v.optional(v.number()),
  source: v.union(v.literal("ai"), v.literal("human")),
});

export const certificationValidator = v.object({
  name: v.string(),
  issuer: v.optional(v.string()),
  year: v.optional(v.number()),
  source: v.union(v.literal("ai"), v.literal("human")),
});

const schema = defineSchema(
  {
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      // Campos de authTables (@convex-dev/auth): deben declararse aunque la app
      // no use teléfono, o la validación del schema rechazaría documentos de
      // usuarios que Convex Auth escriba con esos campos.
      phone: v.optional(v.string()),
      phoneVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
    }).index("email", ["email"]),

    // ─── Candidato ────────────────────────────────────────────────────────

    candidateProfiles: defineTable({
      userId: v.id("users"),
      fullName: v.optional(v.string()),
      headline: v.optional(v.string()),
      location: v.optional(v.string()),
      summary: v.optional(v.string()),
      yearsExperience: v.optional(v.number()),
      skills: v.array(skillValidator),
      experience: v.array(experienceValidator),
      education: v.array(educationValidator),
      certifications: v.array(certificationValidator),
      // cache del diagnóstico determinista (ver convex/lib/diagnosis.ts)
      diagnosis: v.optional(
        v.object({
          completeness: v.number(),
          impact: v.number(),
          skills: v.number(),
          narrative: v.number(),
          opportunities: v.array(
            v.object({ dimension: v.string(), reason: v.string() }),
          ),
          hasSufficientData: v.boolean(),
          computedAt: v.number(),
        }),
      ),
      updatedAt: v.number(),
      deletedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"]),

    resumes: defineTable({
      userId: v.id("users"),
      activeVersionId: v.optional(v.id("resumeVersions")),
    }).index("by_user", ["userId"]),

    resumeVersions: defineTable({
      resumeId: v.id("resumes"),
      userId: v.id("users"),
      version: v.number(),
      fileName: v.string(),
      fileSize: v.number(),
      mimeType: v.string(),
      storageId: v.id("_storage"),
      extractedText: v.optional(v.string()),
      status: v.union(
        v.literal("uploaded"),
        v.literal("processing"),
        v.literal("ready"),
        v.literal("failed"),
      ),
      failureReason: v.optional(v.string()),
      isActive: v.boolean(),
      deletedAt: v.optional(v.number()),
    })
      .index("by_resume", ["resumeId"])
      .index("by_user", ["userId"]),

    // ─── Empresa / multi-tenant ──────────────────────────────────────────

    organizations: defineTable({
      name: v.string(),
      slug: v.string(),
      createdByUserId: v.id("users"),
    }).index("by_slug", ["slug"]),

    organizationMembers: defineTable({
      organizationId: v.id("organizations"),
      userId: v.id("users"),
      role: orgRoleValidator,
      invitedByEmail: v.optional(v.string()),
    })
      .index("by_org", ["organizationId"])
      .index("by_user", ["userId"])
      .index("by_org_user", ["organizationId", "userId"]),

    invitations: defineTable({
      organizationId: v.id("organizations"),
      email: v.string(),
      role: orgRoleValidator,
      tokenHash: v.string(),
      invitedByUserId: v.id("users"),
      expiresAt: v.number(),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("revoked"),
      ),
      acceptedByUserId: v.optional(v.id("users")),
    })
      .index("by_token", ["tokenHash"])
      .index("by_org_status", ["organizationId", "status"])
      .index("by_email", ["email"]),

    jobs: defineTable({
      organizationId: v.id("organizations"),
      createdByUserId: v.id("users"),
      title: v.string(),
      description: v.string(),
      location: v.optional(v.string()),
      seniority: v.optional(v.string()),
      status: v.union(v.literal("open"), v.literal("closed")),
    }).index("by_org", ["organizationId", "status"]),

    jobRequirements: defineTable({
      jobId: v.id("jobs"),
      type: v.union(
        v.literal("skill"),
        v.literal("experience_years"),
        v.literal("education"),
        v.literal("certification"),
      ),
      label: v.string(),
      minLevel: v.optional(v.number()), // skills 1..5
      minYears: v.optional(v.number()),
      weight: v.number(), // 0..1
      isMustHave: v.boolean(),
    }).index("by_job", ["jobId"]),

    applications: defineTable({
      jobId: v.id("jobs"),
      organizationId: v.id("organizations"),
      candidateProfileId: v.optional(v.id("candidateProfiles")),
      source: v.union(
        v.literal("recruiter_upload"),
        v.literal("candidate_application"),
      ),
      // El estado SOLO cambia por decisión humana explícita (RBAC.md).
      status: appStatusValidator,
      decidedByUserId: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
      fullName: v.string(),
      fileName: v.string(),
      fileSize: v.number(),
      mimeType: v.string(),
      storageId: v.id("_storage"),
      extractedText: v.optional(v.string()),
      structured: v.optional(
        v.object({
          headline: v.optional(v.string()),
          summary: v.optional(v.string()),
          yearsExperience: v.optional(v.number()),
          skills: v.array(skillValidator),
          experience: v.array(experienceValidator),
          education: v.array(educationValidator),
          certifications: v.array(certificationValidator),
        }),
      ),
      extractStatus: v.union(
        v.literal("uploaded"),
        v.literal("processing"),
        v.literal("ready"),
        v.literal("failed"),
      ),
      failureReason: v.optional(v.string()),
      deletedAt: v.optional(v.number()),
    })
      .index("by_job", ["jobId", "status"])
      .index("by_org", ["organizationId"]),

    candidateJobMatches: defineTable({
      applicationId: v.id("applications"),
      jobId: v.id("jobs"),
      organizationId: v.id("organizations"),
      overall: v.number(), // 0..100
      skills: v.number(),
      experience: v.number(),
      education: v.number(),
      requirements: v.array(
        v.object({
          requirementId: v.id("jobRequirements"),
          label: v.string(),
          met: v.boolean(),
          score: v.number(),
          evidence: v.string(),
          gap: v.optional(v.string()),
        }),
      ),
      engineVersion: v.string(),
    })
      .index("by_application", ["applicationId"])
      .index("by_job_overall", ["jobId", "overall"]),

    recruiterNotes: defineTable({
      applicationId: v.id("applications"),
      organizationId: v.id("organizations"),
      authorUserId: v.id("users"),
      body: v.string(),
    }).index("by_application", ["applicationId"]),

    // ─── IA (observabilidad y seguridad; sin contenido) ──────────────────

    aiExtractions: defineTable({
      resumeVersionId: v.optional(v.id("resumeVersions")),
      applicationId: v.optional(v.id("applications")),
      model: v.string(),
      promptVersion: v.string(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      durationMs: v.number(),
      ok: v.boolean(),
      error: v.optional(v.string()),
    })
      .index("by_version", ["resumeVersionId"])
      .index("by_application", ["applicationId"]),

    // ─── Observabilidad / seguridad ──────────────────────────────────────

    auditLog: defineTable({
      organizationId: v.optional(v.id("organizations")),
      actorUserId: v.optional(v.id("users")),
      action: v.string(),
      targetType: v.optional(v.string()),
      targetId: v.optional(v.string()),
      // Registros conocidos y acotados (con v.any() la validación de schema no
      // filtraría nada aquí; con el record tipado, cualquier clave imprevista
      // ROMPE el push — señal deseada: obliga a declarar la clave nueva).
      metadata: v.optional(
        v.record(
          v.string(),
          v.union(v.string(), v.number(), v.boolean()),
        ),
      ),
    })
      .index("by_org", ["organizationId"])
      .index("by_actor", ["actorUserId"]),

    securityEvents: defineTable({
      kind: v.string(),
      userId: v.optional(v.id("users")),
      detail: v.string(),
    }).index("by_kind", ["kind"]),

    notifications: defineTable({
      userId: v.id("users"),
      type: v.string(),
      payload: v.optional(
        v.record(
          v.string(),
          v.union(v.string(), v.number(), v.boolean()),
        ),
      ),
      readAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    usageEvents: defineTable({
      userId: v.optional(v.id("users")),
      organizationId: v.optional(v.id("organizations")),
      kind: v.string(),
      quantity: v.number(),
      dedupeKey: v.optional(v.string()),
    })
      .index("by_dedupe", ["dedupeKey"])
      .index("by_userId_and_kind", ["userId", "kind"])
      .index("by_organizationId_and_kind", ["organizationId", "kind"]),
  },
  // Validación de schema ACTIVADA (auditoría #2): Convex valida en runtime
  // que todo documento nuevo o modificado coincide con este schema.
  // Requisito previo (cumplido): metadata/payload tipados como record escalar,
  // y users incluye los campos phone de authTables.
  {},
);

export default schema;
