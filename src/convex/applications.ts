import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMembership } from "./lib/rbac";
import { audit, countUsage, recordUsage } from "./lib/audit";
import { DAY_MS, LIMITS } from "./lib/limits";
import { verifyExtractionAgainstSource } from "./lib/ai/evidence";
import {
  buildCvExtractUserContent,
  CV_EXTRACT_SYSTEM,
  PROMPT_VERSION,
} from "./lib/ai/prompts";
import { cvExtractionJsonSchema, cvExtractionSchema } from "./lib/ai/schemas";
import { detectMime, extractText, MAX_FILE_BYTES, toSafeCvErrorMessage } from "./lib/cv/parse";

import { computeMatch, type MatchRequirementInput } from "./lib/matching";
import { aiExtractionValidator, normalizeAiJson } from "./lib/ai/validators";

/* eslint-disable @typescript-eslint/no-explicit-any -- ctx loose y tipos de extracción ya validados con zod */
/**
 * Aplicaciones (CVs subidos por recruiters a una vacante).
 * Aislamiento: todas las lecturas resuelven la org del recurso y verifican
 * membresía del actor (nunca se confía en ids del cliente sin validar).
 */

/**
 * Paginación acotada (auditoría #2): ninguna lectura pública usa .collect()
 * sin límite — una vacante con miles de aplicantes no puede tumbar una
 * query (Convex limita lecturas por transacción; además limitamos latency).
 * V1: primera página (más recientes); paginación por cursor cuando exista UI.
 */
const APPLICATIONS_PAGE = 200;
const NOTES_PAGE = 200;

/** Paso 1: URL de subida directa (recruiter/org_admin, límite por org). */
export const initUpload = mutation({
  args: {
    jobId: v.id("jobs"),
    fileName: v.string(),
    fileSize: v.number(),
  },  handler: async (ctx, args) => {
    const job: any = await ctx.db.get(args.jobId);
    if (!job) throw new Error("NOT_FOUND");
    await requireMembership(ctx, job.organizationId, "recruiter");

    if (args.fileSize > MAX_FILE_BYTES) {
      throw new Error("El archivo supera 10 MB.");
    }
    if (!/\.(pdf|docx|txt)$/i.test(args.fileName)) {
      throw new Error("Formato no permitido. Usa PDF, DOCX o TXT.");
    }

    const used = await countUsage(ctx, {
      organizationId: job.organizationId,
      kind: "org.cv.upload",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.orgCvUploadPerDay) {
      throw new Error(
        `Límite de ${LIMITS.orgCvUploadPerDay} CVs por día para la organización.`,
      );
    }

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

/** Paso 2: asocia binario + crea application en estado uploaded. 🔍 */
export const finalizeUpload = mutation({
  args: {
    jobId: v.id("jobs"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    candidateName: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("NOT_FOUND");
    const { userId } = await requireMembership(ctx, job.organizationId, "recruiter");

    const name = args.candidateName.trim();
    if (name.length < 1 || name.length > 100) {
      throw new Error("El nombre del candidato debe tener entre 1 y 100 caracteres.");
    }

    // Re-verificación en finalize (el cliente podría enviar otro fileName que en init).
    if (!/\.(pdf|docx|txt)$/i.test(args.fileName)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Formato no permitido. Usa PDF, DOCX o TXT.");
    }

    const storageMeta = await ctx.db.system.get(args.storageId);
    if (!storageMeta) throw new Error("Archivo no encontrado en storage.");
    if ((storageMeta as any).size > MAX_FILE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("El archivo supera 10 MB.");
    }

    const applicationId = await ctx.db.insert("applications", {
      jobId: job._id,
      organizationId: job.organizationId,
      source: "recruiter_upload",
      status: "pending",
      fullName: name,
      fileName: args.fileName.replace(/[\\/]/g, "_").slice(0, 120),
      fileSize: (storageMeta as any).size ?? args.fileSize,
      mimeType: args.fileName.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : args.fileName.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain",
      storageId: args.storageId,
      extractStatus: "uploaded",
    });

    await audit(ctx, {
      actorUserId: userId,
      organizationId: job.organizationId,
      action: "cv.upload",
      targetType: "application",
      targetId: applicationId,
      metadata: { jobId: job._id },
    });
    await recordUsage(ctx, {
      userId,
      organizationId: job.organizationId,
      kind: "org.cv.upload",
      dedupeKey: `org.cv.upload:${applicationId}`,
    });

    return { applicationId };
  },
});

/**
 * Lectura interna para el action de ingest (verifica membresía).
 * INTERNAL: no invocable desde el cliente (audit A-01/A-02).
 */
export const getForIngest = internalQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) return null;
    await requireMembership(ctx, application.organizationId, "recruiter");
    return application;
  },
});

/** INTERNAL: solo el action del pipeline puede invocarla. */
export const markProcessing = internalMutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    await requireMembership(ctx, application.organizationId, "recruiter");
    await ctx.db.patch(args.applicationId, { extractStatus: "processing" });
  },
});

/** Cuenta intentos de extracción de una aplicación (cap anti-abuso). INTERNAL. */
export const countExtractionAttempts = internalQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiExtractions")
      .withIndex("by_application", (q) =>
        q.eq("applicationId", args.applicationId),
      )
      .take(10);
  },
});

/** INTERNAL: solo el action del pipeline puede invocarla. */
export const markFailed = internalMutation({
  args: { applicationId: v.id("applications"), reason: v.string() },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    await requireMembership(ctx, application.organizationId, "recruiter");
    await ctx.db.patch(args.applicationId, {
      extractStatus: "failed",
      failureReason: args.reason.slice(0, 300),
    });
  },
});

/** INTERNAL: solo el action del pipeline puede invocarla. */
export const recordExtraction = internalMutation({
  args: {
    applicationId: v.id("applications"),
    ok: v.boolean(),
    model: v.string(),
    promptVersion: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    durationMs: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiExtractions", {
      applicationId: args.applicationId,
      model: args.model,
      promptVersion: args.promptVersion,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      durationMs: args.durationMs,
      ok: args.ok,
      error: args.error,
    });
  },
});

/**
 * Paso 3 (action "use node"): pipeline de archivo→texto→IA→validación→
 * matching determinista. Todos los efectos pasan por mutations con checks.
 */
export const ingestCv = action({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    // El actor debe ser recruiter de la org dueña de la application.
    const application: any = await ctx.runQuery(
      internal.applications.getForIngest,
      { applicationId: args.applicationId },
    );
    if (!application) throw new Error("NOT_FOUND");
    if (application.extractStatus === "processing") {
      return { status: "processing" as const };
    }
    if (application.extractStatus === "ready") {
      return { status: "ready" as const };
    }

    // Cap de intentos de extracción (anti abuso de tokens IA): máx 3 por CV.
    const attempts: any[] = await ctx.runQuery(
      internal.applications.countExtractionAttempts,
      { applicationId: args.applicationId },
    );
    if (attempts.length >= 3) {
      await ctx.runMutation(internal.applications.markFailed, {
        applicationId: args.applicationId,
        reason:
          "Demasiados intentos de análisis para este CV. Contacta a soporte si necesitas reintentar.",
      });
      return { status: "failed" as const };
    }

    await ctx.runMutation(internal.applications.markProcessing, {
      applicationId: args.applicationId,
    });

    try {
      const blob = await ctx.storage.get(application.storageId);
      if (!blob) throw new Error("Archivo no disponible en storage.");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const mime = detectMime(bytes);
      if (!mime) {
        throw new Error(
          "El contenido del archivo no corresponde a PDF, DOCX o TXT válido.",
        );
      }
      const text = await extractText(bytes, mime);

      const provider = await (await import("./lib/ai/openai_provider")).getAIProvider();
      const aiResult = await provider.complete(
        {
          task: "cv_extract",
          system: CV_EXTRACT_SYSTEM,
          userContent: buildCvExtractUserContent(text, cvExtractionJsonSchema),
          maxOutputTokens: 4000,
          temperature: 0,
          responseJsonSchema: cvExtractionJsonSchema,
        },
        (raw) => cvExtractionSchema.parse(normalizeAiJson(JSON.parse(raw))),
      );

      await ctx.runMutation(internal.applications.recordExtraction, {
        applicationId: args.applicationId,
        ok: aiResult.ok,
        model: aiResult.model,
        promptVersion: PROMPT_VERSION,
        inputTokens: aiResult.usage?.inputTokens ?? 0,
        outputTokens: aiResult.usage?.outputTokens ?? 0,
        durationMs: aiResult.durationMs,
        error: aiResult.ok ? undefined : aiResult.error.message.slice(0, 200),
      });

      if (!aiResult.ok) {
        await ctx.runMutation(internal.applications.markFailed, {
          applicationId: args.applicationId,
          reason:
            aiResult.error.code === "SCHEMA_INVALID"
              ? "La IA devolvió un formato inesperado. Puedes reintentar."
              : aiResult.error.code === "CONTENT_FILTERED"
                ? "El contenido del CV fue bloqueado por el filtro de seguridad del proveedor de IA."
                : "El proveedor de IA no respondió correctamente. Reintenta en unos minutos.",
        });
        return { status: "failed" as const };
      }

      // Post-check determinista de evidencia (anti alucinación/inyección):
      // la evidencia citada debe existir en el texto real del CV.
      const checked = verifyExtractionAgainstSource(text, aiResult.data);
      await ctx.runMutation(internal.applications.applyExtraction, {
        applicationId: args.applicationId,
        extractedText: text,
        extraction: checked.extraction,
      });

      return { status: "ready" as const };
    } catch (err) {
      // Nunca persistir el mensaje crudo de una excepción interna (ver
      // toSafeCvErrorMessage): ese campo es visible para el usuario.
      const message = toSafeCvErrorMessage(err);
      await ctx.runMutation(internal.applications.markFailed, {
        applicationId: args.applicationId,
        reason: message.slice(0, 300),
      });
      return { status: "failed" as const, reason: message };
    }
  },
});

/**
 * Aplica extracción + calcula y persiste el match determinista.
 * INTERNAL: solo el action del pipeline puede invocarla (audit A-02).
 */
export const applyExtraction = internalMutation({
  args: {
    applicationId: v.id("applications"),
    extractedText: v.string(),
    // Validación estricta en el borde (antes v.any() — auditoría #2);
    // el contenido ya pasó por zod + post-check de evidencia en el action.
    extraction: aiExtractionValidator,
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    const { userId } = await requireMembership(
      ctx,
      application.organizationId,
      "recruiter",
    );

    const e = args.extraction;
    await ctx.db.patch(args.applicationId, {
      extractedText: args.extractedText,
      extractStatus: "ready",
      structured: {
        headline: e.headline,
        summary: e.summary,
        yearsExperience: e.yearsExperience,
        skills: e.skills.map((s: any) => ({ ...s, source: "ai" })),
        experience: e.experience.map((x: any) => ({ ...x, source: "ai" })),
        education: e.education.map((x: any) => ({ ...x, source: "ai" })),
        certifications: e.certifications.map((c: any) => ({ ...c, source: "ai" })),
      },
    });

    // Matching determinista contra los requisitos de la vacante.
    const requirements: any[] = await ctx.db
      .query("jobRequirements")
      .withIndex("by_job", (q) => q.eq("jobId", (application as any).jobId))
      .take(LIMITS.maxRequirementsPerJob);

    const matchInputs: MatchRequirementInput[] = requirements.map((r: any) => ({
      id: r._id,
      type: r.type,
      label: r.label,
      minLevel: r.minLevel,
      minYears: r.minYears,
      weight: r.weight,
      isMustHave: r.isMustHave,
    }));
    const match = computeMatch(e, matchInputs);

    const existing = await ctx.db
      .query("candidateJobMatches")
      .withIndex("by_application", (q) =>
        q.eq("applicationId", args.applicationId),
      )
      .first();
    const matchDoc: any = {
      applicationId: args.applicationId,
      jobId: application.jobId,
      organizationId: application.organizationId,
      overall: match.overall,
      skills: match.skills,
      experience: match.experience,
      education: match.education,
      requirements: match.requirements.map((r) => ({
        requirementId: r.requirementId,
        label: r.label,
        met: r.met,
        score: r.score,
        evidence: r.evidence,
        gap: r.gap,
      })),
      engineVersion: match.engineVersion,
    };
    if (existing) {
      await ctx.db.patch(existing._id, matchDoc);
    } else {
      await ctx.db.insert("candidateJobMatches", matchDoc);
    }

    await audit(ctx, {
      actorUserId: userId,
      organizationId: application.organizationId,
      action: "match.create",
      targetType: "application",
      targetId: args.applicationId,
      metadata: { overall: match.overall, engine: match.engineVersion },
    });
    await recordUsage(ctx, {
      userId,
      organizationId: application.organizationId,
      kind: "match.create",
      dedupeKey: `match.create:${args.applicationId}`,
    });

    return { ok: true };
  },
});

/**
 * Lista de aplicantes de una vacante con su match resumido.
 * Solo miembros de la org (hiring_manager puede ver).
 */
export const listByJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("NOT_FOUND");
    await requireMembership(ctx, job.organizationId, "hiring_manager");

    const applications = await ctx.db
      .query("applications")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(APPLICATIONS_PAGE);
    applications.sort((a, b) => b._creationTime - a._creationTime);

    const out = [];
    for (const app of applications) {
      const match = await ctx.db
        .query("candidateJobMatches")
        .withIndex("by_application", (q) => q.eq("applicationId", app._id))
        .first();
      out.push({ application: app, match });
    }
    return out;
  },
});

/**
 * DECISIÓN HUMANA EXPLÍCITA (ADR-009): solo recruiter/org_admin cambia el
 * estado. Rechazar exige nota. La IA nunca llama a esta función. 🔍
 */
export const decide = mutation({
  args: {
    applicationId: v.id("applications"),
    status: v.union(
      v.literal("pending"),
      v.literal("shortlisted"),
      v.literal("rejected"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    const { userId } = await requireMembership(
      ctx,
      application.organizationId,
      "recruiter",
    );

    if (args.status === "rejected" && !args.note?.trim()) {
      throw new Error(
        "Para rechazar debes registrar una nota con el motivo (transparencia del proceso).",
      );
    }
    if (args.note && args.note.length > 1000) {
      throw new Error("La nota no puede superar 1000 caracteres.");
    }

    // Rate limit ENFORZADO antes de escribir (no solo contado).
    const used = await countUsage(ctx, {
      userId,
      organizationId: application.organizationId,
      kind: "application.decide",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.decisionsPerDay) {
      throw new Error(
        `Límite de ${LIMITS.decisionsPerDay} decisiones por día alcanzado.`,
      );
    }

    await ctx.db.patch(args.applicationId, {
      status: args.status,
      decidedByUserId: userId,
      decidedAt: Date.now(),
      decisionNote: args.note?.trim(),
    });

    await audit(ctx, {
      actorUserId: userId,
      organizationId: application.organizationId,
      action: "application.decide",
      targetType: "application",
      targetId: args.applicationId,
      metadata: { status: args.status },
    });
    await recordUsage(ctx, {
      userId,
      organizationId: application.organizationId,
      kind: "application.decide",
      dedupeKey: `application.decide:${args.applicationId}:${Date.now()}`,
    });

    return { ok: true };
  },
});

/** Notas del recruiter sobre un aplicante. 🔍 */
export const addNote = mutation({
  args: {
    applicationId: v.id("applications"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    const { userId } = await requireMembership(
      ctx,
      application.organizationId,
      "hiring_manager",
    );
    const body = args.body.trim();
    if (body.length < 1 || body.length > 2000) {
      throw new Error("La nota debe tener entre 1 y 2000 caracteres.");
    }

    // Rate limit por organización/día (LIMITS.notesPerDay).
    const used = await countUsage(ctx, {
      userId,
      organizationId: application.organizationId,
      kind: "note.create",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.notesPerDay) {
      throw new Error(
        `Límite de ${LIMITS.notesPerDay} notas por día alcanzado.`,
      );
    }

    const noteId = await ctx.db.insert("recruiterNotes", {
      applicationId: args.applicationId,
      organizationId: application.organizationId,
      authorUserId: userId,
      body: args.body.trim(),
    });

    await audit(ctx, {
      actorUserId: userId,
      organizationId: application.organizationId,
      action: "note.create",
      targetType: "recruiterNote",
      targetId: noteId,
    });
    await recordUsage(ctx, {
      userId,
      organizationId: application.organizationId,
      kind: "note.create",
      dedupeKey: `note.create:${noteId}`,
    });
    return { noteId };
  },
});

/** Notas de una application (miembros). */
export const notesFor = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const application = await ctx.db.get(args.applicationId);
    if (!application) throw new Error("NOT_FOUND");
    await requireMembership(ctx, application.organizationId, "hiring_manager");
    const notes = await ctx.db
      .query("recruiterNotes")
      .withIndex("by_application", (q) =>
        q.eq("applicationId", args.applicationId),
      )
      .take(NOTES_PAGE);
    notes.sort((a, b) => b._creationTime - a._creationTime);
    const withAuthors = [];
    for (const n of notes) {
      const author = await ctx.db.get(n.authorUserId);
      withAuthors.push({
        _id: n._id,
        body: n.body,
        authorName: author?.name ?? "Miembro",
        createdAt: n._creationTime,
      });
    }
    return withAuthors;
  },
});
