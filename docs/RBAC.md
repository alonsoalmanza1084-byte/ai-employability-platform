# RBAC.md — Roles y permisos V1

## 1. Roles

| Rol | Ámbito | Puede |
|---|---|---|
| `candidate` | sus propios datos | subir CV, ver/editar su perfil, ver diagnóstico, activar versiones |
| `recruiter` | su organización | ver org, crear vacantes, subir CVs, ver matching, decidir (shortlist/reject+nota), anotar |
| `hiring_manager` | su organización | igual que recruiter menos decidir ni subir (solo ver + notas en V1 si se necesita; V1 los creamos pero con permisos de lectura+notas) |
| `org_admin` | su organización | todo lo de recruiter + invitar miembros + cerrar vacantes |
| `platform_admin` | plataforma | gestión y auditoría global (panel en fase posterior; V1 solo el rol existe) |

Nota: el usuario invitado como hiring manager tiene lectura + notas; no cambia estados (la decisión es de recruiter/org_admin).

## 2. Matriz V1

| Operación | candidate | hiring_manager | recruiter | org_admin | platform_admin |
|---|---|---|---|---|---|
| Subir/activar CV propio | ✅ | — | — | — | — |
| Editar perfil propio | ✅ | — | — | — | — |
| Ver diagnóstico propio | ✅ | — | — | — | — |
| Crear organización | ✅ (cualquiera puede crear) | — | — | — | — |
| Ver org/vacantes/aplicantes | — | ✅ (member) | ✅ (member) | ✅ (member) | — |
| Crear vacante | — | — | ✅ | ✅ | — |
| Subir CVs a vacante | — | — | ✅ | ✅ | — |
| Ver matching con evidencia | — | ✅ | ✅ | ✅ | — |
| Añadir nota | — | ✅ | ✅ | ✅ | — |
| Decidir (shortlist/reject) | — | — | ✅ | ✅ | — |
| Invitar miembros | — | — | — | ✅ | — |
| Cerrar vacante | — | — | — | ✅ | — |

## 3. Enforcement

- Server-side, en cada función Convex (nunca el frontend). Helper único: `requireMembership(ctx, organizationId, minRole)`.
- `minRole` ordena jerárquicamente: `hiring_manager < recruiter < org_admin`.
- El rol del usuario **dentro de una org** vive en `organizationMembers.role` (un usuario puede ser recruiter en org A y admin en org B). El rol `users.role` es el contexto de la app (candidate vs recruiter-side).
- Toda denegación es `FORBIDDEN` o `NOT_FOUND` (sin filtrar existencia); las acciones denegadas sensibles quedan en `securityEvents`.

## 4. Ownership personal

`candidate` solo accede a recursos con `userId == actor`. Ninguna función del módulo candidato acepta `userId` como argumento.

## 5. Pruebas automatizadas (TESTING.md §RBAC)

- Cada fila de la matriz = un test que debe pasar (allow) y sus celdas vacías = tests que deben fallar (deny).
- Escalada: recruiter intenta invitarse admin; hiring_manager intenta decidir; candidate intenta leer applications → todos deben denegar.
