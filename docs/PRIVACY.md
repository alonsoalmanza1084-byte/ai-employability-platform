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
| Retención | datos viven mientras la cuenta exista; CVs de aplicaciones se retienen mientras la vacante esté abierta + 12 meses (parametrizable); luego purga programada |
| Consentimiento | en el primer upload se muestra aviso claro de análisis por IA con evidencia y revisión humana (AI disclosure) |

## 4. Controles

- Sin trackers de terceros en el app autenticado.
- Logs sin contenido de documentos ni PII libre (ver OBSERVABILITY.md).
- Acceso interno: nadie en la plataforma edita perfiles; solo el usuario y su org (según rol) ven datos.

## 5. Pendiente de revisión legal (checklist)

- [ ] Privacy Policy y ToS finales (jurisdicción, base legal GDPR: consentimiento vs interés legítimo)
- [ ] DPA con proveedor IA y proveedor de email
- [ ] Registro de actividades de tratamiento (ROPA)
- [ ] Transferencias internacionales (SCCs si aplica)
- [ ] Política de cookies (V1: solo esenciales)
- [ ] Evaluación de impacto (DPIA) para tratamientos de datos de CV
- [ ] Reglas por país para retención de datos de reclutamiento (algunas jurisdicciones exigen plazos mínimos/máximos)
