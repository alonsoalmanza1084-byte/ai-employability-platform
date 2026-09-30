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
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
