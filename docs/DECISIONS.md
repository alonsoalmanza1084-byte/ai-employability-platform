# DECISIONS.md — Registro de decisiones (ADRs)

Formato: **Decisión → Alternativas → Razón → Consecuencias.** Índice de ADRs al final.

## ADR-001 — Modular Monolith sobre Convex en lugar de microservicios
- **Decisión:** un solo backend Convex con módulos por carpeta y reglas de dependencia.
- **Alternativas:** microservicios (descartado: overhead operacional sin causa real a esta escala), monolito clásico sin módulos (descartado: deuda de acoplamiento).
- **Razón:** velocidad de MVP con límites claros; Convex ya resuelve escala, colas y storage; el parsing/IA ya es un boundary natural extraíble.
- **Consecuencias:** disciplina de módulos; extracción futura por módulo es barata.

## ADR-002 — Matching determinista, sin LLM en el scoring
- **Decisión:** el match score lo calcula código determinista auditable sobre datos extraídos; el LLM solo extrae/estructura.
- **Alternativas:** LLM que puntúe candidaturas (descartado: no explicable, sesgo, costo, variabilidad).
- **Razón:** el prompt exige explicabilidad y prohibición de características protegidas; un motor determinista garantiza reproducibilidad y auditoría.
- **Consecuencias:** la calidad del matching depende de la extracción; por eso evidence+confidence+edición humana.

## ADR-003 — Email OTP (sin contraseñas) en V1
- **Decisión:** auth por OTP de email + guest anónimo (heredado del template).
- **Alternativas:** email+password (hashing Argon2/bcrypt, recuperación, stuffing), OAuth social (dependencia de terceros + configuración).
- **Razón:** elimina de raíz la clase de ataques a contraseñas en V1; menos superficie; el template ya lo trae funcionando.
- **Consecuencias:** dependencia del email para entrar; MFA/passwords quedan en roadmap (fase 7) para admins.

## ADR-004 — Convex storage privado en lugar de S3
- **Decisión:** binarios en Convex fileStorage con URLs firmadas de vida corta emitidas server-side.
- **Alternativas:** S3+CloudFront (más control, más operación).
- **Razón:** aislamiento por diseño, cero configuración de buckets, sin claves públicas.
- **Consecuencias:** límites de tamaño de archivo del proveedor; migrable a S3 si se requiere (los storageIds se encapsulan en `lib/files`).

## ADR-005 — Extracción IA con salida validada y editable
- **Decisión:** la extracción produce JSON validado por zod + evidencia textual + confidence; todo es editable por el usuario.
- **Razón:** la IA se equivoca; el sistema debe tolerarlo por diseño (datos curados > datos crudos).
- **Consecuencias:** esquema de perfil con `source: ai|human` y post-check de evidencia.

## ADR-006 — Billing fuera de V1; límites de uso como sustituto
- **Decisión:** sin cobros en V1 (decisión explícita del usuario); límites diarios centralizados.
- **Razón:** el prompt exige no fijar precios sin costos reales; los límites ya modelan el plan Free.
- **Consecuencias:** `usageEvents` con dedupeKey ya prepara el metering futuro.

## ADR-007 — Sin garantías de resultados en copy y producto
- **Decisión:** el diagnóstico muestra oportunidades y rangos solo cuando hay datos suficientes; nunca promesas de aumento salarial o de éxito.
- **Razón:** requisito duro del prompt + honestidad del producto.
- **Consecuencias:** copy revisado; sin benchmarks inventados.

## ADR-008 — Datos del CV como "dato delimitado" contra prompt injection
- **Decisión:** contenido de usuario nunca entra como instrucciones; system prompt versionado declara ignorar instrucciones embebidas; salida estricta con zod; post-check de evidencia.
- **Razón:** el CV es superficie hostil por diseño.
- **Consecuencias:** suite anti-injection como test permanente.

## ADR-009 — Decisión humana explícita y obligatoria
- **Decisión:** la IA no setea estados; solo recruiter/org_admin cambia `pending|shortlisted|rejected`, con nota obligatoria al rechazar.
- **Razón:** herramienta de apoyo, no decisor (requisito del prompt).
- **Consecuencias:** ninguna automatización de rechazo; auditLog registra decisión con autor.

## ADR-010 — Proveedor IA seleccionado: OpenAI (primero), detrás de abstracción
- **Decisión:** `OpenAIProvider` con structured outputs como implementación inicial de la interfaz `AIProvider`; router por env var.
- **Alternativas:** Anthropic/Gemini (válidas, misma interfaz), self-host (costo/operación alto en V1).
- **Razón:** JSON mode/structured outputs maduro, latencia y costo razonables para extracción, SDK TS estable.
- **Consecuencias:** cambiar de proveedor = config; `aiExtractions` registra modelo real usado por si se compara calidad entre proveedores.

## ADR-011 — Career Coach sin herramientas (solo lectura sobre datos existentes)
- **Decisión:** el coach (incremento 1) solo LEE `candidateProfiles` + `computeDiagnosis` vía un Context Builder acotado; el módulo `coach.ts` no contiene ninguna ruta de escritura en el perfil ni herramientas para el modelo.
- **Alternativas:** dar herramientas de escritura al modelo (rechazada: amplía el impacto de una inyección a la BD).
- **Razón:** superficie mínima para el primer incremento; el estado solo lo cambia el usuario (coherente con ADR-005/009).
- **Consecuencias:** los cambios de perfil siguen siendo manuales («Mi CV»/«Diagnóstico»); el incremento 2 (propuestas) exige ADR-012.

## ADR-012 — Propuesta + confirmación humana para cualquier cambio (incremento 2)
- **Decisión:** cuando el coach proponga ediciones, serán sugerencias NO aplicadas hasta una confirmación humana explícita; la IA nunca escribe directamente en el perfil.
- **Razón:** coherencia con ADR-009 (decisión humana) y con el alcance read-only acordado.
- **Consecuencias:** schema/versionado de propuestas pendientes de diseño en el incremento 2; hoy `careerCoachResponseSchema` NO tiene campo de propuestas.

## ADR-013 — Versionado de prompts del Career Coach
- **Decisión:** `CAREER_COACH_PROMPT_VERSION` (`career_coach.v1.0`) vive junto al system prompt; cambiar el texto exige subir la versión y registrarlo en git (mismo régimen que PROMPT_VERSION, ADR-008).
- **Razón:** `aiCoachCalls.promptVersion` permite trazar qué versión generó cada respuesta.
- **Consecuencias:** la evaluación golden del coach se ejecuta por versión de prompt.

# ADRs índice
1. Modular Monolith sobre Convex — aceptado
2. Matching determinista — aceptado
3. Email OTP sin contraseñas — aceptado
4. Convex storage privado — aceptado
5. Extracción validada y editable — aceptado
6. Billing fuera de V1 — aceptado
7. Sin garantías de resultados — aceptado
8. Anti prompt-injection por diseño — aceptado
9. Decisión humana obligatoria — aceptado
10. OpenAI como primer proveedor — aceptado (requiere API key del usuario)
11. Career Coach sin herramientas (read-only) — aceptado
12. Propuesta + confirmación humana — aceptado (diseño en incremento 2)
13. Versionado de prompts del coach — aceptado
