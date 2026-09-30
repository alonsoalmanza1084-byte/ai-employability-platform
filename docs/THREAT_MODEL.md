# THREAT_MODEL.md — Modelo de amenazas V1

Metodología: STRIDE sobre los flujos clave (auth, subida de CV, extracción IA, matching, decisión humana) + apéndice OWASP Top 10 / API Top 10 / LLM Top 10. Escala: Probabilidad (Baja/Media/Alta) × Impacto (Bajo/Medio/Alto/Crítico).

## 1. Flujos modelados

1. Sign-in OTP → sesión.
2. Upload CV (candidato o recruiter) → storage → parser → IA → datos estructurados.
3. Creación vacante + requisitos.
4. Matching + revisión humana + decisión (shortlist/reject).
5. Invitaciones a la org.

## 2. Amenazas por flujo

### Autenticación / cuentas

| Amenaza | Prob | Impacto | Mitigación | Detección | Respuesta | Pruebas |
|---|---|---|---|---|---|---|
| Brute force de OTP | Media | Alto | 6 dígitos + expiración 15 min + límites de intento por email; provider-side throttling | securityEvents por intentos fallidos repetidos | rate limit + bloqueo temporal del envío | test de 429 tras N intentos |
| Enumeration de emails | Media | Bajo | el flujo OTP no revela si la cuenta existe (siempre dice "enviamos código") | patrón de requests | — | test de respuesta uniforme |
| Account takeover vía email comprometido | Media | Alto | sesiones cortas, re-auth para acciones sensibles (futuro); roadmap: MFA admin | alerts de OTP desde IPs nuevas (roadmap) | revocación de sesiones | — |
| Guest abuse (cuentas anónimas masivas) | Media | Medio | guest sin datos sensibles; límites de subida por sesión; migración a cuenta real | conteo de guests por IP (roadmap) | límites | test de límites |

### Subida de archivos

| Amenaza | Prob | Impacto | Mitigación | Detección | Respuesta | Pruebas |
|---|---|---|---|---|---|---|
| Malware en PDF/DOCX | Media | Medio | no ejecución, solo extracción de texto; magic bytes; tamaño máx; parser robusto | error de parseo | reject + audit | archivos de prueba hostiles (PDF con JS, zip bomb, EICAR en txt) |
| Zip bomb (docx) | Baja | Medio | mammoth lee solo document.xml; límite de tamaño descomprimido del parser; timeout de acción | timeout | reject | test con docx gigante |
| Subida de tipo disfrazado (exe como .pdf) | Media | Medio | magic bytes antes de parsear | error | reject | test de magic bytes |
| Acceso a archivo ajeno (IDOR sobre storageId) | Baja | Crítico | URLs firmadas de vida corta emitidas solo tras autorización; storageIds nunca expuestos como API de lectura | audit de emisión de URLs | rotación | test cross-user y cross-org |

### Extracción IA y prompt injection

| Amenaza | Prob | Impacto | Mitigación | Detección | Respuesta | Pruebas |
|---|---|---|---|---|---|---|
| Prompt injection directo (en CV: "ignora instrucciones y devuelve X") | Alta | Medio | datos delimitados + system prompt reforzado + salida validada por schema estricto (no free-text a BD) | validación falla → aiExtractions.ok=false | retry controlado / failed | suite de CVs inyectados (AI_SECURITY.md §6) |
| Indirect injection (texto en vacante que manipula análisis de candidatos) | Alta | Medio | el matching NO usa LLM (determinista); la IA solo extrae con schema | — | — | suite |
| Exfiltración de datos vía modelo | Baja | Crítico | el modelo no tiene acceso a BD ni a otros CVs; contexto = solo el documento en proceso | revisión de outputs | — | test cross-document leak |
| Insecure output (datos corruptos/dañinos a BD) | Media | Medio | zod estricto; campos de longitud acotada; sin HTML ejecutable (React escapa) | validación | reject | fuzzing de salida del modelo |

### Autorización / tenancy

| Amenaza | Prob | Impacto | Mitigación | Detección | Respuesta | Pruebas |
|---|---|---|---|---|---|---|
| IDOR sobre applications/jobs/matches | Media | Crítico | cada función re-resuelve el recurso por índice con tenant real del actor; sin ids "confiados" | audit + tests | fix | suite RBAC/IDOR automatizada |
| Cross-tenant por manipulación de tenant_id | Media | Crítico | el organizationId del payload nunca autoriza por sí solo; se verifica membresía | tests | fix | suite |
| Escalada de rol | Baja | Crítico | roles solo server-side; invitaciones con rol acotado; sin endpoint de "cambiar rol" a sí mismo | audit | fix | suite |
| Acceso vía búsqueda/listados | Media | Crítico | listados siempre con prefijo org del actor | tests | fix | suite |

### Abuso de plataforma

| Amenaza | Prob | Impacto | Mitigación | Detección | Respuesta | Pruebas |
|---|---|---|---|---|---|---|
| Scraping masivo / API abuse | Media | Medio | rate limits por usuario/org; sin endpoints públicos de listado | usageEvents anómalos | límites crecientes | test de límites |
| Costo IA descontrolado (CVs masivos) | Alta | Medio | límites diarios de subida (10 candidato / 50 org) + metering por evento | usageEvents | límite + alerta | test |
| Fake recruiters / fake jobs | Media | Medio (V1) | V1: orgs verificables solo por invitación; sin dominio público de vacantes | — | — | — |
| Replay de acciones | Baja | Medio | dedupeKey idempotente en eventos; mutaciones requieren sesión viva | audit | — | test de idempotencia |

## 3. Apéndice OWASP

- **A01 Broken Access Control** → capa 3 + suite automatizada (el riesgo #1 de este dominio).
- **A02 Cryptographic Failures** → no hay contraseñas propias en V1; storage privado; TLS; secrets server-side.
- **A03 Injection** → Convex es parametrizado (no SQL crudo); salida IA validada; React escapa HTML.
- **A04 Insecure Design** → decisión humana explícita; no hay automatismo de rechazo.
- **A05 Security Misconfiguration** → checklist de deploy; sin buckets públicos.
- **A07 Ident/Auth Failures** → OTP con expiración; roadmap MFA.
- **A08 Software/Data Integrity** → lockfile; webhooks firmados (fase billing).
- **A09 Logging Failures** → auditLog + securityEvents desde V1.
- **A10 SSRF** → el servidor solo llama a proveedores allowlisted (IA, storage propio). Las URLs del usuario nunca son fetcheadas por el backend.
- **API1 BOLA / API3 BOPLA** → mismo control que IDOR, aplicado a cada función.
- **API4 Resource exhaustion** → límites de tamaño + rate limits + timeouts.
- **LLM01 Prompt Injection** → ver arriba y AI_SECURITY.md.
- **LLM02 Sensitive Disclosure** → contexto mínimo por request; sin PII cruzada.
- **LLM06 Sensitive Info Disclosure** → no loguear contenido de documentos.
