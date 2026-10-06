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

  // ─── Career Profile / Goal (R6, ADR-014) ───────────────────────────────
  maxCareerGoalsPerUser: 10,
  maxCareerGoalSkills: 12,

  // ─── Career Coach IA (Incremento 1: solo lectura) ──────────────────────
  // Cuotas CONSERVADORAS y fail-closed (decisión de producto): todo chequeo
  // ocurre en una mutación transaccional ANTES de llamar a la IA, y el uso se
  // consume igual aunque la llamada falle después. Si un chequeo lanza,
  // NUNCA se llama a la IA.
  coachMessagesPerHour: 6,
  coachMessagesPerDay: 30,
  coachConversationsPerDay: 3,
  // Techos estructurales: acotan las lecturas de borrado en cascada
  // (deleteAccount) y el historial que puede mandarse al modelo.
  maxCoachConversationsPerUser: 30,
  maxCoachMessagesPerConversation: 60,
  // Techo de llamadas (filas aiCoachCalls) por conversación: incluye fallos,
  // que no llenan mensajes pero sí consumen presupuesto.
  maxCoachCallsPerConversation: 100,
  coachUserMessageMaxChars: 1500,
  coachHistoryMessages: 10,
  coachHistoryTurnMaxChars: 500,
  coachProfileMaxChars: 7000,
  coachDiagnosisMaxChars: 3000,
  coachContextMaxChars: 12_000,
  coachMaxOutputTokens: 800,
} as const;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
