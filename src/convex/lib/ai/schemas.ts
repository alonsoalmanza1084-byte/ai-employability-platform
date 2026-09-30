import { z } from "zod";

/**
 * Validación estricta de la salida del LLM (AI_SECURITY.md §1.3).
 * Campos acotados en longitud; desconocidos rechazados.
 * Nada de esta salida entra a la BD sin pasar por aquí.
 */
export const skillSchema = z.object({
  name: z.string().min(1).max(60),
  level: z.number().min(1).max(5),
  evidence: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const experienceSchema = z.object({
  company: z.string().min(1).max(80),
  title: z.string().min(1).max(80),
  start: z.string().max(10),
  end: z.string().max(10).optional(),
  current: z.boolean().optional(),
  description: z.string().max(600),
  achievements: z.array(z.string().max(240)).max(8),
  evidence: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const educationSchema = z.object({
  institution: z.string().min(1).max(80),
  degree: z.string().min(1).max(80),
  field: z.string().max(80).optional(),
  startYear: z.number().int().min(1950).max(2100).optional(),
  endYear: z.number().int().min(1950).max(2100).optional(),
});

export const certificationSchema = z.object({
  name: z.string().min(1).max(80),
  issuer: z.string().max(80).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
});

export const cvExtractionSchema = z.object({
  fullName: z.string().max(100).optional(),
  headline: z.string().max(120).optional(),
  location: z.string().max(80).optional(),
  summary: z.string().max(800).optional(),
  yearsExperience: z.number().min(0).max(60).optional(),
  skills: z.array(skillSchema).max(40),
  experience: z.array(experienceSchema).max(15),
  education: z.array(educationSchema).max(10),
  certifications: z.array(certificationSchema).max(15),
});

export type CvExtraction = z.infer<typeof cvExtractionSchema>;

/** JSON Schema (draft) para structured outputs del proveedor. */
export const cvExtractionJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    fullName: { type: "string" },
    headline: { type: "string" },
    location: { type: "string" },
    summary: { type: "string" },
    yearsExperience: { type: "number" },
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          level: { type: "number" },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["name", "level"],
      },
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          current: { type: "boolean" },
          description: { type: "string" },
          achievements: { type: "array", items: { type: "string" } },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["company", "title", "start", "description", "achievements"],
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          startYear: { type: "number" },
          endYear: { type: "number" },
        },
        required: ["institution", "degree"],
      },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          issuer: { type: "string" },
          year: { type: "number" },
        },
        required: ["name"],
      },
    },
  },
  required: ["skills", "experience", "education", "certifications"],
};
