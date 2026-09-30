# TESTING.md — Estrategia de pruebas V1

## 1. Pirámide adaptada a Convex

| Nivel | Qué | Cómo |
|---|---|---|
| Unit | matcher determinista, diagnóstico, sanitización, límites | funciones puras en `convex/lib/*` — testeables sin BD |
| Integration | cada query/mutation con sus checks de auth/tenant/RBAC | runner de tests contra deployment de staging (fase 8; V1 verificado con escenarios manuales documentados) |
| Security suite | IDOR, cross-tenant, RBAC matrix, magic bytes, prompt injection | specs listados abajo; se automatizan contra staging |
| E2E | flujos felices: subir CV → diagnóstico; crear org/vacante → subir CVs → decidir | Playwright (fase 8) |
| Load | ingest concurrente de CVs, límites | k6 contra staging (fase 9) |

## 2. Suites prioritarias (lo que el prompt exige explícitamente)

| Suite | Escenarios clave | Estado V1 |
|---|---|---|
| IDOR / tenant isolation | tabla completa de MULTI_TENANCY.md §2 | especificado; automatización fase 8 |
| RBAC matrix | cada fila de RBAC.md §2 (allow + deny) | especificado; automatización fase 8 |
| File upload | PDF válido, DOCX válido, TXT válido, exe con .pdf, PDF con JS, docx gigante, archivo vacío, UTF-8 corrupto | parser + validador en `lib/cv/` (código testeado unit) |
| Prompt injection | casos 1–7 de AI_SECURITY.md §6 | casos en `lib/ai/prompt-injection-cases.ts` |
| Rate limiting | exceder límite → error claro, no crash | límites centralizados en `lib/limits.ts` |
| Auth | OTP válido/inválido/expirado, guest aislado | cubierto por Convex Auth + tests fase 8 |
| Billing/webhooks | firma, replay, idempotencia | fase 6 (diseño en BILLING.md) |
| Data deletion | eliminar cuenta borra CVs + anonimiza aplicaciones | fase 7 |

## 3. AI evaluation tests

- Golden set de 20 CVs sintéticos (varios formatos/idiomas) con extracción esperada; precisión ≥ 90% de campos clave antes de subir cambios de prompt (fase 8).
- Matcher: pares candidato-vacante con puntajes esperados (regresión determinista).

## 4. Criterios de fase

Cada fase termina con: typecheck ✓, suites unit ✓, revisión de seguridad contra THREAT_MODEL.md para las superficies nuevas, y actualización de esta lista.
