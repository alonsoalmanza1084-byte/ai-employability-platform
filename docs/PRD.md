# PRD — TalentFlow AI

**Versión:** 1.0 · **Fecha:** 2026-09-30 · **Estado:** V1 en implementación (scope congelado)

## 1. Problema

Los CVs subestiman a las personas: experiencia lograda pero mal narrada, logros cuantificados enterrados en texto plano, y aplicantes que no saben qué les falta para el puesto que quieren. Del otro lado, reclutadores leen cientos de CVs no estructurados y deciden por intuición, sin evidencia trazable de por qué avanzan o descartan a alguien.

## 2. Visión

Plataforma de empleabilidad y recruiting asistida por IA, de dos lados:

- **Candidatos:** suben su CV, la IA lo estructura, produce un **diagnóstico de empleabilidad** y recomendaciones de mejora posicionamiento.
- **Empresas/RH:** crean organizaciones y vacantes, suben CVs, obtienen **Match Scores explicables con evidencia** contra los requisitos de cada vacante.

La IA es **asistente de decisión humana**, nunca el decisor. Ninguna recomendación automática de contratar/rechazar. Ninguna garantía de resultado (no prometemos aumentos salariales, ni % de mejora).

## 3. Personas

| Persona | Necesidad principal |
|---|---|
| Candidato activo | Saber cómo se lee su CV y qué mejorar para el puesto que quiere |
| Reclutador | Priorizar una pila de CVs con criterio trazable, no intuición |
| Hiring manager | Entender por qué un candidato llegó a su mesa |
| Org admin | Controlar quiénes ven qué dentro de su organización |
| Platform admin | Operar, observar y auditar la plataforma |

## 4. Alcance V1 (congelado — decidido por el usuario)

> "¿Qué lado debe funcionar primero? **Ambos pero mínimo.** ¿Qué debe mostrar la pantalla principal? **Mi CV y diagnóstico.**"

### Incluido en V1

**Lado candidato (mínimo)**
1. Cuenta (email OTP + guest anónimo, heredado del template de auth).
2. Subir CV (PDF/DOCX/TXT) → parsing real del archivo → extracción estructurada con IA (experiencia, educación, habilidades, certificaciones, logros).
3. Pantalla principal: **Mi CV** (versión estructurada, editable) y **Diagnóstico** (puntajes por dimensión + oportunidades de mejora).
4. Edición manual del perfil (por si la IA se equivoca — siempre editable).
5. Historial de versiones del CV (cada nueva subida crea una versión; se puede activar una versión anterior).

**Lado empresa (mínimo)**
6. Crear organización + invitación de miembros por email.
7. Crear vacante con requisitos (must-have / nice-to-have, con nivel mínimo 1–5).
8. Subir múltiples CVs a la vacante → parsing + extracción IA.
9. **Matching determinista y explicable** (motor determinista sobre datos extraídos por IA; sin LLM en el scoring) → `overall`, `skills`, `experience`, `education`, por-requisito, cada uno con **evidencia citada**.
10. **Decisión humana explícita** por candidato: `shortlist`, `reject`, `pending` — con nota obligatoria al rechazar. La IA nunca setea estado.
11. Notas del reclutador sobre cada candidato en la vacante.

### Explícitamente FUERA de V1

- Career Coach chatbot, práctica de entrevistas, coaching de negociación (→ Fase 3+).
- Adaptación/reescribir CV a una vacante (→ Fase 3).
- Schedule de entrevistas y pipeline de estados avanzado (→ Fase 4).
- Billing real, planes pagos, invoices (→ Fase 6; V1 es free con límites de uso).
- Document generation (PDF del CV), email transaccional custom, OAuth social, MFA (→ fases posteriores; documentado en DECISIONS.md).
- Parsing masivo, búsqueda semántica, embeddings.

## 5. Requisitos funcionales detallados

### 5.1 Candidato

| ID | Requisito |
|---|---|
| C-01 | El candidato puede subir un archivo CV (PDF, DOCX, TXT; máx 10 MB). El sistema valida tipo real (magic bytes), tamaño y texto extraíble. |
| C-02 | El texto extraído se analiza con IA para producir JSON estructurado: `summary, experience[], education[], skills[], certifications[], achievements[]`. |
| C-03 | Cada elemento extraído guarda `evidence` (cita textual del CV) y `confidence` (0–1) de la IA. |
| C-04 | El candidato ve y **edita** todo lo extraído. El dato editado por humano prevalece (`source: "human"` vs `"ai"`). |
| C-05 | El diagnóstico de empleabilidad calcula: completitud del perfil, impacto/medición de logros, profundidad de skills, narrativa. Cada dimensión: puntaje 0–100 + razones accionables. |
| C-06 | El diagnóstico usa heurísticas deterministas sobre los datos (no inventa; si no hay datos suficientes lo dice). |
| C-07 | Cada subida crea una `ResumeVersion` inmutable; el candidato puede re-activar versiones previas. |
| C-08 | Sin CV → estado vacío con CTA de subida. Error de parseo → mensaje accionable, nunca crash. |

### 5.2 Empresa / RH

| ID | Requisito |
|---|---|
| R-01 | Un usuario crea una organización y queda como `owner`. |
| R-02 | Invita miembros por email con rol `recruiter`, `hiring_manager` u `org_admin`. La invitación otorga membresía al crear cuenta con ese email (en V1: si el usuario ya existe, entra directo; si no, al registrarse con ese email). |
| R-03 | Solo miembros de la org ven vacantes, candidatos y matching de ESA org. Verificación server-side en cada query/mutation (multi-tenancy, ver SECURITY.md). |
| R-04 | La vacante tiene: título, descripción, ubicación, seniority, y requisitos tipados (`skill | experience_years | education | certification`) con `weight` y `minLevel`. |
| R-05 | Subida multi-archivo a la vacante: mismo pipeline de parsing/extracción del lado candidato, pero generando `CandidateProfile` + `Application` (fuente `recruiter_upload`). |
| R-06 | Matching se ejecuta tras la extracción: puntajes por dimensión + por requisito, con evidencia textual citada de cada candidato. |
| R-07 | La UI de matching muestra el desglose: qué requisito cumple, con qué evidencia, qué falta. Sin puntaje "mágico". |
| R-08 | Estado del candidato: `pending | shortlisted | rejected` — cambio **solo manual** por `recruiter`+; rechazo exige nota. |
| R-09 | Notas por candidato/vacante, con autor y timestamp. |

### 5.3 No funcionales (V1)

- Cualquier CV subido se procesa en < 30 s p95 (extracción IA incluida).
- Todo el texto de CV es private-by-default: nunca visible entre organizaciones.
- Todo evento sensible queda en `auditLog` (subida, extracción, match, cambio de estado, invitación).
- Rate limits en todas las acciones (subidas, IA, matching).
- Mobile responsive, estados loading/error/empty en todas las pantallas, HTML semántico accesible.

## 6. Métricas de éxito V1

- % de CVs subidos que producen extracción útil (≥ 80%).
- % de candidatos que editan su perfil tras ver el diagnóstico (proxy de valor).
- % de vacantes con ≥ 1 decisión humana registrada (proxy de uso del matching).

## 7. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Extracción IA incorrecta | Todo editable, `evidence` + `confidence` visibles, matcher determinista sobre datos curados |
| Sesgo/alucinación en matching | Motor determinista auditable, sin LLM en scoring; solo señales relevantes al puesto |
| Prompt injection vía CV | Datos tratados como datos (no instrucciones), salida validada con zod, ver AI_SECURITY.md |
| Filtración cross-tenant | tenant check en cada función + tests de aislamiento |
| Costo de IA descontrolado | Metering por evento + límites + tracking de tokens |
| Expectativa de "garantía" | Copy sin promesas de resultados; rangos e indicadores solo con datos suficientes |

## 8. Cumplimiento y disclosures (no es consejo legal)

- **AI disclosure:** la UI declara que el análisis es asistido por IA y revisable por humanos.
- **Sin decisiones automatistas con efecto legal:** el matching es una recomendación; la decisión final es humana y registrada.
- **Privacidad:** ver PRIVACY.md. El borrado de cuenta elimina CVs y datos derivados.
- **Pendiente de revisión legal profesional:** Privacy Policy, ToS, DPA, base legal por jurisdicción, retención por país.
