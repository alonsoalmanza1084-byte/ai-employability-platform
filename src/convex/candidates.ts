import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import {
  skillValidator,
  experienceValidator,
  educationValidator,
  certificationValidator,
} from "./schema";
import { api } from "./_generated/api";
import { requireSelf } from "./lib/rbac";
import {
  audit,
  countUsage,
  recordUsage,
  requireUser,
  securityEvent,
} from "./lib/audit";
import { DAY_MS, LIMITS } from "./lib/limits";
import { computeDiagnosis, type ProfileData } from "./lib/diagnosis";
import {
  buildCvExtractUserContent,
  CV_EXTRACT_SYSTEM,
  PROMPT_VERSION,
} from "./lib/ai/prompts";
import { cvExtractionJsonSchema, cvExtractionSchema } from "./lib/ai/schemas";
import { detectMime, extractText, MAX_FILE_BYTES } from "./lib/cv/parse";

/** Perfil del usuario autenticado (o null si aún no tiene). */
export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return profile;
  },
});

/** Resumes + versiones del usuario (historial de CVs). */
export const myResumes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);
    const resumes = await ctx.db
      .query("resumes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const r of resumes) {
      const versions = await ctx.db
        .query("resumeVersions")
        .withIndex("by_resume", (q) => q.eq("resumeId", r._id))
        .collect();
      versions.sort((a, b) => b.version - a.version);
      out.push({ resume: r, versions });
    }
    return out;
  },
});

/**
 * Paso 1 de subida: valida formato y límites, devuelve URL de subida directa
 * al storage privado. 🔍 (audit ocurre en finalizeUpload, cuando hay id)
 */
export const initUpload = mutation({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.fileSize > MAX_FILE_BYTES) {
      await securityEvent(ctx, {
        kind: "upload_rejected",
        userId: user._id,
        detail: `file too large: ${args.fileSize}`,
      });
      throw new Error("El archivo supera 10 MB.");
    }
    if (!/\.(pdf|docx|txt)$/i.test(args.fileName)) {
      await securityEvent(ctx, {
        kind: "upload_rejected",
        userId: user._id,
        detail: `bad extension: ${args.fileName.slice(-20)}`,
      });
      throw new Error("Formato no permitido. Usa PDF, DOCX o TXT.");
    }

    const used = await countUsage(ctx, {
      userId: user._id,
      kind: "cv.upload",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.cvUploadPerDay) {
      await securityEvent(ctx, {
        kind: "rate_limited",
        userId: user._id,
        detail: "cv.upload daily limit",
      });
      throw new Error(
        `Alcanzaste el límite de ${LIMITS.cvUploadPerDay} CVs por día.`,
      );
    }

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

/**
 * Paso 2: tras la subida directa del navegador, asocia el storageId real,
 * crea resume + resumeVersion (v1) y registra audit/uso. Verifica tamaño
 * REAL contra los metadatos del storage (no solo lo que dice el cliente).
 */
export const finalizeUpload = mutation({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const storageMeta = await ctx.db.system.get(args.storageId);
    if (!storageMeta) throw new Error("Archivo no encontrado en storage.");
    if ((storageMeta as any).size > MAX_FILE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("El archivo supera 10 MB.");
    }

    const used = await countUsage(ctx, {
      userId: user._id,
      kind: "cv.upload",
      sinceMs: DAY_MS,
    });
    if (used >= LIMITS.cvUploadPerDay) {
      await ctx.storage.delete(args.storageId);
      throw new Error(
        `Alcanzaste el límite de ${LIMITS.cvUploadPerDay} CVs por día.`,
      );
    }

    let resume = await ctx.db
      .query("resumes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!resume) {
      const resumeId = await ctx.db.insert("resumes", { userId: user._id });
      resume = await ctx.db.get(resumeId);
    }

    const siblings = await ctx.db
      .query("resumeVersions")
      .withIndex("by_resume", (q) => q.eq("resumeId", resume!._id))
      .collect();
    const version = siblings.length + 1;

    const resumeVersionId = await ctx.db.insert("resumeVersions", {
      resumeId: resume!._id,
      userId: user._id,
      version,
      fileName: args.fileName.slice(0, 120),
      fileSize: (storageMeta as any).size ?? args.fileSize,
      mimeType: args.mimeType.slice(0, 60),
      storageId: args.storageId,
      status: "uploaded",
      isActive: false,
    });

    await audit(ctx, {
      actorUserId: user._id,
      action: "cv.upload",
      targetType: "resumeVersion",
      targetId: resumeVersionId,
      metadata: { size: args.fileSize },
    });
    await recordUsage(ctx, {
      userId: user._id,
      kind: "cv.upload",
      dedupeKey: `cv.upload:${resumeVersionId}`,
    });

    return { resumeVersionId, resumeId: resume!._id };
  },
});

/**
 * Paso 3 (action "use node"): descarga el archivo, valida magic bytes,
 * extrae texto, llama a la IA con salida validada, calcula diagnóstico y
 * escribe resultados. Todos los efectos de BD ocurren aquí vía runMutation.
 */
export const ingestCv = action({
  args: { resumeVersionId: v.id("resumeVersions") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);

    // El action verifica estado y marca "processing" (mutation transaccional).
    const rv: any = await ctx.runQuery(api.candidates.getVersionForIngest, {
      resumeVersionId: args.resumeVersionId,
    });
    if (!rv || rv.userId !== userId) throw new Error("NOT_FOUND");
    if (rv.status === "processing") return { status: "processing" as const };

    await ctx.runMutation(api.candidates.markProcessing, {
      resumeVersionId: args.resumeVersionId,
    });

    const startedAt = Date.now();
    try {
      // 1. Descargar binario (storage privado, acceso server-side).
      const blob = await ctx.storage.get(rv.storageId);
      if (!blob) throw new Error("Archivo no disponible en storage.");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // 2. Validar tipo REAL y extraer texto (nunca ejecutar el archivo).
      const mime = detectMime(bytes);
      if (!mime) {
        throw new Error(
          "El contenido del archivo no corresponde a PDF, DOCX o TXT válido.",
        );
      }
      const text = await extractText(bytes, mime);

      // 3. IA: extracción con salida validada por schema estricto.
      const provider = (await import("./lib/ai/openai_provider")).getAIProvider();
      const aiResult = await provider.complete(
        {
          task: "cv_extract",
          system: CV_EXTRACT_SYSTEM,
          userContent: buildCvExtractUserContent(text),
          maxOutputTokens: 4000,
          temperature: 0,
          responseJsonSchema: cvExtractionJsonSchema,
        },
        (raw) => {
          const json = JSON.parse(raw);
          return cvExtractionSchema.parse(json);
        },
      );

      if (!aiResult.ok) {
        await ctx.runMutation(api.candidates.markFailed, {
          resumeVersionId: args.resumeVersionId,
          reason:
            aiResult.error.code === "SCHEMA_INVALID"
              ? "La IA devolvió un formato inesperado. Puedes reintentar."
              : "El proveedor de IA no respondió correctamente. Reintenta en unos minutos.",
        });
        return { status: "failed" as const };
      }

      await ctx.runMutation(api.candidates.recordExtraction, {
        resumeVersionId: args.resumeVersionId,
        ok: aiResult.ok,
        model: aiResult.model,
        promptVersion: PROMPT_VERSION,
        inputTokens: aiResult.usage?.inputTokens ?? 0,
        outputTokens: aiResult.usage?.outputTokens ?? 0,
        durationMs: aiResult.durationMs,
      });

      // 4. Escribir resultados + diagnóstico determinista (transaccional).
      const extracted = aiResult.data;
      const profileData: ProfileData = {
        fullName: extracted.fullName,
        headline: extracted.headline,
        location: extracted.location,
        summary: extracted.summary,
        yearsExperience: extracted.yearsExperience,
        skills: extracted.skills.map((s) => ({ ...s, source: "ai" as const })),
        experience: extracted.experience.map((e) => ({ ...e, source: "ai" as const })),
        education: extracted.education.map((e) => ({ ...e, source: "ai" as const })),
        certifications: extracted.certifications.map((c) => ({
          ...c,
          source: "ai" as const,
        })),
      };
      const diagnosis = computeDiagnosis(profileData);

      await ctx.runMutation(api.candidates.applyExtraction, {
        resumeVersionId: args.resumeVersionId,
        extractedText: text,
        extraction: extracted,
        diagnosis,
      });

      void startedAt;
      return { status: "ready" as const };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido al procesar el CV.";
      await ctx.runMutation(api.candidates.markFailed, {
        resumeVersionId: args.resumeVersionId,
        reason: message.slice(0, 300),
      });
      return { status: "failed" as const, reason: message };
    }
  },
});

/** Lectura interna para el action (verifica ownership). */
export const getVersionForIngest = query({
  args: { resumeVersionId: v.id("resumeVersions") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const rv = await ctx.db.get(args.resumeVersionId);
    if (!rv || rv.userId !== userId) return null;
    return rv;
  },
});

export const markProcessing = mutation({
  args: { resumeVersionId: v.id("resumeVersions") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const rv = await ctx.db.get(args.resumeVersionId);
    if (!rv || rv.userId !== userId) throw new Error("NOT_FOUND");
    await ctx.db.patch(args.resumeVersionId, { status: "processing" });
  },
});

export const markFailed = mutation({
  args: { resumeVersionId: v.id("resumeVersions"), reason: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const rv = await ctx.db.get(args.resumeVersionId);
    if (!rv || rv.userId !== userId) throw new Error("NOT_FOUND");
    await ctx.db.patch(args.resumeVersionId, {
      status: "failed",
      failureReason: args.reason,
    });
  },
});

export const recordExtraction = mutation({
  args: {
    resumeVersionId: v.id("resumeVersions"),
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
      resumeVersionId: args.resumeVersionId,
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

/** Aplica la extracción validada: versión ready + perfil + diagnóstico + audit. */
export const applyExtraction = mutation({
  args: {
    resumeVersionId: v.id("resumeVersions"),
    extractedText: v.string(),
    extraction: v.any(), // ya validado por zod en el action
    diagnosis: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const rv = await ctx.db.get(args.resumeVersionId);
    if (!rv || rv.userId !== userId) throw new Error("NOT_FOUND");

    await ctx.db.patch(args.resumeVersionId, {
      status: "ready",
      extractedText: args.extractedText,
    });

    await recordUsage(ctx, {
      userId,
      kind: "cv.extract",
      dedupeKey: `cv.extract:${args.resumeVersionId}`,
    });

    // Activar versión y desactivar hermanas.
    const siblings = await ctx.db
      .query("resumeVersions")
      .withIndex("by_resume", (q) => q.eq("resumeId", rv.resumeId))
      .collect();
    for (const s of siblings) {
      if (s.isActive && s._id !== args.resumeVersionId) {
        await ctx.db.patch(s._id, { isActive: false });
      }
    }
    await ctx.db.patch(args.resumeVersionId, { isActive: true });
    await ctx.db.patch(rv.resumeId, { activeVersionId: args.resumeVersionId });

    const e = args.extraction;
    const existing = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const profileFields = {
      fullName: e.fullName,
      headline: e.headline,
      location: e.location,
      summary: e.summary,
      yearsExperience: e.yearsExperience,
      skills: e.skills.map((s: any) => ({ ...s, source: "ai" })),
      experience: e.experience.map((x: any) => ({ ...x, source: "ai" })),
      education: e.education.map((x: any) => ({ ...x, source: "ai" })),
      certifications: e.certifications.map((c: any) => ({ ...c, source: "ai" })),
      diagnosis: args.diagnosis,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, profileFields);
    } else {
      await ctx.db.insert("candidateProfiles", { userId, ...profileFields });
    }

    await audit(ctx, {
      actorUserId: userId,
      action: "cv.extract",
      targetType: "resumeVersion",
      targetId: args.resumeVersionId,
      metadata: { skills: e.skills.length, experience: e.experience.length },
    });

    return { ok: true };
  },
});

/** Activar una versión anterior del CV (y su texto ya extraído). */
export const setActiveVersion = mutation({
  args: { resumeVersionId: v.id("resumeVersions") },
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const rv = await ctx.db.get(args.resumeVersionId);
    if (!rv || rv.userId !== userId) throw new Error("NOT_FOUND");
    if (rv.status !== "ready") {
      throw new Error("Solo puedes activar versiones procesadas correctamente.");
    }

    const siblings = await ctx.db
      .query("resumeVersions")
      .withIndex("by_resume", (q) => q.eq("resumeId", rv.resumeId))
      .collect();
    for (const s of siblings) {
      await ctx.db.patch(s._id, { isActive: s._id === args.resumeVersionId });
    }
    await ctx.db.patch(rv.resumeId, { activeVersionId: args.resumeVersionId });

    await audit(ctx, {
      actorUserId: userId,
      action: "cv.activate",
      targetType: "resumeVersion",
      targetId: args.resumeVersionId,
    });
    return { ok: true };
  },
});

const profilePatch = v.object({
  fullName: v.optional(v.string()),
  headline: v.optional(v.string()),
  location: v.optional(v.string()),
  summary: v.optional(v.string()),
  yearsExperience: v.optional(v.number()),
  skills: v.optional(v.array(skillValidator)),
  experience: v.optional(v.array(experienceValidator)),
  education: v.optional(v.array(educationValidator)),
  certifications: v.optional(v.array(certificationValidator)),
});

/** Edición humana del perfil (fuente "human"; recalcula diagnóstico). */
export const updateProfile = mutation({
  args: profilePatch,
  handler: async (ctx, args) => {
    const userId = await requireSelf(ctx);
    const existing = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!existing) {
      throw new Error("Sube tu CV primero para crear el perfil.");
    }

    // Validación de longitudes (los validadores Convex no acotan strings).
    const limits: Record<string, number> = {
      fullName: 100,
      headline: 120,
      location: 80,
      summary: 800,
    };
    for (const [field, max] of Object.entries(limits)) {
      const value = (args as any)[field];
      if (value && value.length > max) {
        throw new Error(`El campo ${field} no puede superar ${max} caracteres.`);
      }
    }
    if (args.yearsExperience !== undefined && (args.yearsExperience < 0 || args.yearsExperience > 60)) {
      throw new Error("Años de experiencia fuera de rango (0–60).");
    }
    if (args.skills && args.skills.length > 40) {
      throw new Error("Máximo 40 skills.");
    }
    if (args.experience && args.experience.length > 15) {
      throw new Error("Máximo 15 experiencias.");
    }
    for (const s of args.skills ?? []) {
      if (!s.name.trim() || s.name.length > 60) {
        throw new Error("Cada skill necesita un nombre de 1–60 caracteres.");
      }
      if (s.level < 1 || s.level > 5) {
        throw new Error("El nivel de skill debe estar entre 1 y 5.");
      }
    }

    const merged = { ...existing, ...args };
    const diagnosis = computeDiagnosis(merged as ProfileData);

    await ctx.db.patch(existing._id, { ...args, diagnosis, updatedAt: Date.now() });
    await audit(ctx, {
      actorUserId: userId,
      action: "profile.update",
      targetType: "candidateProfile",
      targetId: existing._id,
    });
    return { ok: true };
  },
});

/** Diagnóstico computado on-the-fly desde el perfil actual. */
export const diagnosis = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSelf(ctx);
    const profile = await ctx.db
      .query("candidateProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!profile) return null;
    return computeDiagnosis(profile as unknown as ProfileData);
  },
});
