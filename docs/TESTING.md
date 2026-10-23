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

### Carga de CV: límites y autenticación

- Se aceptan archivos con extensión PDF, DOCX o TXT, hasta 10 MiB
	(`10 * 1024 * 1024` bytes). El backend vuelve a comprobar tamaño y extensión;
	el parser identifica el formato a partir del contenido, no confía en el MIME
	declarado por el navegador.
- La carga de candidato limita a 10 CV por usuario al día. La carga para una
	organización limita a 50 CV al día y además requiere membresía de recruiter.
- Convex Auth incluye el proveedor Anonymous. Una sesión creada con ese
	proveedor es un usuario autenticado y puede usar la carga propia; una petición
	sin sesión sigue denegada. No se debe relajar `requireUser` para solucionar
	errores de red.
- El flujo del navegador obtiene una URL firmada de Convex y envía el archivo
	directamente al storage de Convex. Un 502 del puerto de Vite no indica por sí
	mismo que el límite de archivo haya provocado un fallo del servidor.

## 3. AI evaluation tests

- Golden set de 20 CVs sintéticos (varios formatos/idiomas) con extracción esperada; precisión ≥ 90% de campos clave antes de subir cambios de prompt (fase 8).
- Matcher: pares candidato-vacante con puntajes esperados (regresión determinista).

## 4. Criterios de fase

Cada fase termina con: typecheck ✓, suites unit ✓, revisión de seguridad contra THREAT_MODEL.md para las superficies nuevas, y actualización de esta lista.

## 5. Career Gap — verificación en Convex staging

**Estado actual: BLOCKED; no hay una prueba de integración Career Gap en el
repositorio ni se ha identificado un deployment staging autorizado que coincida
con el destino configurado localmente.** `tests/unit/career_gap.test.ts` llama a
los handlers con una DB en memoria: no verifica Web Crypto, índices, atomicidad
ni persistencia del runtime Convex. No ejecutar `scripts/ci_gate.sh` para esta
comprobación: incluye `convex dev --once`, pruebas de integración y lecturas de
datos del deployment.

### Precondiciones y aborto

1. Un operador identifica el deployment desde la consola del proyecto y confirma
	por un canal independiente que es staging y no producción. La configuración
	`CONVEX_DEPLOYMENT` y `VITE_CONVEX_URL` debe corresponder a ese mismo destino;
	no cambiar variables para hacerlas coincidir. Abortar ante ausencia o
	discrepancia de cualquier identificador.
2. El deployment debe tener el schema opcional `gapAnalyses.inputFingerprint` y
	las funciones de Career Gap publicadas por el proceso de release autorizado.
	Esta prueba no publica schema ni funciones.
3. El operador confirma que el deployment está dedicado a datos sintéticos de
	esta ejecución. No continuar en un staging compartido con datos de usuarios:
	`convex data gapAnalyses --limit 10000` lee la tabla completa y no ofrece
	aquí un filtro por usuario/objetivo.
4. Obtener aprobación para crear dos identidades anónimas y sembrar perfiles y
	filas de análisis sintéticos mediante el mecanismo `convex import --append`
	que ya usa `tests/integration/coach.authorization.integration.test.ts`.
	Abortar si la importación no puede limitarse a los IDs creados en esta prueba.
5. Aprobar expresamente el residuo de limpieza: `account.deleteAccount` borra el
	perfil, los objetivos y los análisis de la identidad autenticada, pero deja
	`auditLog` y una fila `users` anonimizada. Si ese residuo no está permitido,
	no comenzar; no borrar manualmente filas fuera de las creadas por la prueba.

### Secuencia manual requerida

Implementar y revisar una prueba dedicada de integración antes de ejecutarla;
no existe actualmente un archivo o comando Career Gap de integración. Reutilizar
el patrón local de `ConvexHttpClient`, `auth.signIn` anónimo y fixture por
importación, pero hacer que la prueba falle antes de conectarse si el deployment
no se ha confirmado explícitamente. Nunca imprimir tokens, URLs, filas ajenas ni
contenido de perfiles.

1. Crear identidades A y B nuevas y conservar sus IDs localmente. Sembrar para
	ambas un `candidateProfiles` sintético mínimo (`skills`, `experience`,
	`education`, `certifications`, `updatedAt`); crear un objetivo de A con
	`career.setCareerGoal`.
2. Llamar `career.regenerateGapAnalysis` para A. Esto ejercita
	`crypto.subtle.digest` en el runtime real y debe devolver éxito. Consultar
	`career.myGapAnalysis`: debe corresponder al mismo objetivo y requisitos.
3. Guardar una vista previa local de la fila sintética de `gapAnalyses`. Cambiar
	los requisitos con `setCareerGoal` sin modificar el perfil; luego llamar
	`myGapAnalysis`. Debe reflejar los requisitos nuevos. Comparar la fila
	persistida antes/después mediante `convex data gapAnalyses --limit 10000`,
	filtrando localmente solo el ID del objetivo sintético: la lectura no debe
	añadir ni actualizar el análisis. No conservar ni mostrar la salida completa.
4. Cambiar las skills del perfil A con `candidates.updateProfile` y repetir el
	paso anterior. La respuesta debe reflejar las skills actuales y la fila
	persistida debe seguir igual hasta la regeneración explícita.
5. Llamar `regenerateGapAnalysis` de nuevo. La fila sintética debe contener el
	análisis para las entradas actuales y un `inputFingerprint`; una consulta
	posterior debe reutilizar esa fila sin modificarla.
6. Sembrar para B una caché histórica sintética válida según el schema pero sin
	`inputFingerprint`. `myGapAnalysis` debe calcular el resultado actual en
	memoria y dejar intacta la fila. `regenerateGapAnalysis` debe completar la
	huella. A no debe consultar el objetivo de B y B no debe consultar el de A;
	ambas operaciones cruzadas deben denegarse sin devolver análisis.
7. En un bloque `finally`, llamar `account.deleteAccount` con cada sesión de
	prueba aún autenticada. Verificar, consultando solo IDs sintéticos, que sus
	perfiles, objetivos y análisis ya no existen y que las sesiones se
	invalidaron. Registrar que permanecen el tombstone de cada usuario y los
	eventos `auditLog` previstos; no intentar borrar esos registros.

### Evidencia y límites

Guardar únicamente: categoría/identificador aprobado del deployment, versión
publicada de schema/funciones, resultado de cada operación, IDs sintéticos
necesarios para comprobar persistencia y confirmación de limpieza. Redactar
tokens, endpoint, perfiles y resultados completos. Abortar ante error de auth,
schema, hash, lectura ambigua, dato no sintético o limpieza parcial. Hasta que
exista esa prueba dedicada y staging autorizado, el runtime Web Crypto, la
persistencia real, la semántica del índice y el aislamiento E2E siguen sin
verificarse.
