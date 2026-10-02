# PRIVACY.md — Privacidad V1

> No es asesoría legal. Antes de operar con usuarios reales (especialmente UE/UK), un abogado debe revisar textos y bases legales.

## 1. Datos que tratamos

| Dato | Origen | Dónde |
|---|---|---|
| Email | registro OTP | users (Convex Auth) |
| CV binario | upload | storage privado |
| Texto extraído | parser | resumeVersions.extractedText / applications.extractedText |
| Datos estructurados del perfil | IA + edición humana | candidateProfiles |
| Matching y decisiones | motor determinista + recruiter | candidateJobMatches, applications |
| Notas del recruiter | input directo | recruiterNotes |
| Metadatos de auditoría | sistema | auditLog (sin contenido de documentos) |

## 2. Principios aplicados

- **Minimización:** solo pedimos lo necesario para el servicio. El diagnóstico usa datos del CV subido, nada más.
- **Propósito acotado:** el CV de un candidato subido por un recruiter se usa para evaluar esa vacante en esa org. No se comparte entre orgs ni se usa para otro fin.
- **No entrenamiento de modelos:** los datos de usuarios no se usan para entrenar modelos propios ni de terceros. Los prompts se envían al proveedor IA como procesamiento del servicio (DPA con el proveedor requerido antes de producción — revisión legal).
- **Separación guest/real:** cuentas anónimas viven aisladas hasta que el usuario decide crear cuenta.

## 3. Derechos del usuario (V1)

| Derecho | Implementación |
|---|---|
| Acceso/portabilidad | su perfil es visible/exportable (copia de los campos estructurados); export "JSON" en roadmap inmediato |
| Rectificación | todo el perfil es editable; edición humana prevalece sobre IA |
| Eliminación | "Eliminar cuenta" borra: perfil, resumes + versiones + binarios, y anonimiza aplicaciones donde aparece como candidato |
| Eliminación — **verificada** | `tests/integration/accountDeletion.integration.test.ts`: precondición y post-condición comprobadas contra la base de datos REAL (perfil, `resumes`, `resumeVersions`, `_storage`, `authAccounts`, `authSessions`, `organizationMembers`), sin sobre-borrado de otros usuarios y sin resurrección. Ver §6 |
| Retención | datos viven mientras la cuenta exista; CVs de aplicaciones se retienen mientras la vacante esté abierta + 12 meses (parametrizable); luego purga programada |
| Consentimiento | en el primer upload se muestra aviso claro de análisis por IA con evidencia y revisión humana (AI disclosure) |

## 4. Controles

- Sin trackers de terceros en el app autenticado.
- Logs sin contenido de documentos ni PII libre (ver OBSERVABILITY.md).
- Acceso interno: nadie en la plataforma edita perfiles; solo el usuario y su org (según rol) ven datos.

## 5-bis. Verificación de la eliminación (medida) y residual conocido

**Qué se verificó ejecutando (2026-10-02):**

- Precondición real: el usuario tenía fila de perfil, `resumes`,
  `resumeVersions`, binario en storage privado, `authAccounts`, `authSessions`
  y membresía de organización.
- Tras `account.deleteAccount`: **ninguna** de esas siete ubicaciones conserva el
  `userId` y el `storageId` desaparece de `_storage`. El binario (PII) se
  destruye de verdad, no solo se desreferencia.
- Anti-resurrección: la fila de `authAccounts` (la que casaría el
  `providerAccountId` de un OTP posterior) desaparece y la identidad queda
  anonimizada (`@deleted.invalid` + `[cuenta-eliminada]`).
- No sobre-borrado: los datos y la sesión de OTRO usuario siguen intactos.

**Residual conocido (VULN-17, LOW) — no ocultado:** el **JWT ya emitido** sigue
siendo aceptado hasta su expiración, porque la revocación de sesión se apoya en
borrar las filas de sesión y el token es autocontenido. Verificado que ese token
**no da acceso a ningún dato**: `myProfile → null`, `myResumes → []`,
`myOrgs → []`. Remediación: TTL corto de access token y/o validación de
`authSessions` por petición.

**No verificado / no definido:** la **retención programada** (purga de CVs de
vacantes cerradas + 12 meses) no está implementada como job; es una deuda
conocida de `PRODUCTION_READINESS.md` (blocker 11).

---

## 5. Pendiente de revisión legal (checklist)

- [ ] Privacy Policy y ToS finales (jurisdicción, base legal GDPR: consentimiento vs interés legítimo)
- [ ] DPA con proveedor IA y proveedor de email
- [ ] Registro de actividades de tratamiento (ROPA)
- [ ] Transferencias internacionales (SCCs si aplica)
- [ ] Política de cookies (V1: solo esenciales)
- [ ] Evaluación de impacto (DPIA) para tratamientos de datos de CV
- [ ] Reglas por país para retención de datos de reclutamiento (algunas jurisdicciones exigen plazos mínimos/máximos)
