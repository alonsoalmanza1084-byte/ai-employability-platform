# MULTI_TENANCY.md — Aislamiento entre organizaciones

Modelo: **tenancy compartida con `organizationId` en cada fila** + autorización a nivel de servicio (cada función) + almacenamiento privado. Postgres RLS no aplica (Convex), así que la defensa es: índices con prefijo tenant + re-verificación en cada transacción + tests.

## 1. Reglas

1. **Toda tabla de datos de org** (`organizations, organizationMembers, invitations, jobs, jobRequirements, applications, candidateJobMatches, recruiterNotes`) lleva `organizationId`.
2. **Toda lectura** de datos de org hace query por índice cuyo primer componente es el `organizationId` **resuelto desde la membresía del actor** (jamás desde el payload sin verificar).
3. **Toda escritura** re-lee el recurso destino y compara su `organizationId` con la membresía del actor en la misma transacción.
4. **Datos personales** (`candidateProfiles, resumes, resumeVersions`) llevan `userId` y solo son accesibles por ese userId — no hay shared reads.
5. **Archivos**: los CVs subidos por recruiters pertenecen a la org vía `applications.organizationId`; el binario en storage se accede solo mediante URL firmada emitida tras verificar la membresía.
6. **Índices diseñados anti-filtración**: p.ej. `applications.by_job (jobId, status)` — jobId solo se obtiene tras verificar que la vacante es de una org del actor; no existe query "dame todas las applications" sin tenant.
7. **Jobs de fondo** (actions/scheduler) reciben ids explícitos y re-verifican tenancy al inicio del handler.

## 2. Escenarios de prueba explícitos (TESTING.md)

| Escenario | Expectativa |
|---|---|
| Candidato A lee versión de CV de B | NOT_FOUND |
| Usuario de org 1 lista vacantes con orgId=2 en payload | NOT_FOUND (se resuelve por membresía, no por payload) |
| Recruiter org 1 lee application de org 2 por id | NOT_FOUND |
| Recruiter org 1 pide match de application de org 2 | NOT_FOUND |
| Recruiter org 1 decide sobre application de org 2 | FORBIDDEN/NOT_FOUND |
| Guest intenta leer cualquier org | NOT_FOUND |
| Action de ingest re-ingestando version de otra org | FORBIDDEN (re-verifica) |
| URL firmada de CV de org 1 pedida por miembro de org 2 | denegado en emisión |

## 3. Defensa en profundidad

- Capa 1: índices con tenant prefijo (no hay query global).
- Capa 2: helpers únicos (`requireMembership`) — sin lógica de auth inline dispersa.
- Capa 3: tests automatizados de cada escenario (arriba) en CI.
- Capa 4: auditLog registra accesos denegados sensibles en securityEvents.
