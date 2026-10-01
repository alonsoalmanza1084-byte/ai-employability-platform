/**
 * Límites de uso V1 (sustituyen al billing; ver docs/BILLING.md).
 * Configuración centralizada: cambiar aquí afecta a toda la app.
 */
export const LIMITS = {
  cvUploadPerDay: 10, // candidato
  orgCvUploadPerDay: 50, // por organización
  jobCreatePerDay: 20,
  invitePerDay: 20,
  decisionsPerDay: 100,
  notesPerDay: 100,
  // Techo estructural: versiones de CV por resume (evita crecimiento sin cota
  // de resumeVersions y de los .collect() que las leen — auditoría #2).
  maxCvVersionsPerResume: 50,
  // Envío de códigos OTP por email (protección pre-auth contra email bombing).
  otpSendsPerEmailPerHour: 5,
  // Techo de requisitos por vacante (jobs.create ya valida 1..20; este es el
  // techo de lectura en applyExtraction — auditoría #2).
  maxRequirementsPerJob: 20,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
