# RBAC_MATRIX.md — Matriz de permisos VERIFICADA end-to-end

> **ESTADO: VERIFIED (E2E con sesiones y roles reales).**
> Ejecución: `tests/integration/rbac.matrix.integration.test.ts` → **18/18 PASSED**
> Evidencia viva: objeto `RBAC_MATRIX` impreso por el propio test.

---

## 1. Cómo se verificó (sin mocks)

El flujo original de alta de un miembro (`invite` → `acceptInvite`) exige una
cuenta con **email verificado**; los usuarios de CI son anónimos y no pueden
recibir OTP, por lo que esa celda era inverificable end-to-end.

Se resolvió **sin tocar el código de producción**:

1. `tests/integration/rbac.seed.integration.test.ts` crea las 5 identidades
   sintéticas reales (`org_admin`, `recruiter`, `hiring_manager`, `candidate`,
   `outsider`) y una organización con vacante, applicant y CV.
2. `scripts/rbac_seed_memberships.sh` siembra las filas de `organizationMembers`
   **por importación de datos** (`convex import --table organizationMembers
   --append`), el mismo mecanismo que usa un restore. No añade ningún endpoint,
   bypass ni superpoder.
3. `tests/integration/rbac.matrix.integration.test.ts` ejecuta la matriz
   completa con los **tokens de sesión reales** sobre `requireMembership` real.

El flujo de invitación (`invite` → `acceptInvite` → `revokeInvite`) se verifica
**por separado** en `tests/unit/invitations.security.test.ts` (21 tests) y en
`tests/integration/security.integration.test.ts`.

---

## 2. Matriz de permisos (resultado real medido)

Leyenda: ✅ permitido · ❌ denegado server-side

| Acción | org_admin | recruiter | hiring_manager | candidate | outsider |
|---|---|---|---|---|---|
| Ver organización (`myOrgs` incluye la org) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver detalle de vacante (`jobs.get`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver miembros de la org (`orgs.members`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver vacantes (`jobs.listByOrg`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Crear vacante (`jobs.create`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Cerrar vacante (`jobs.close`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Subir CV de candidato (`applications.initUpload`/`finalizeUpload`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ver applicants (`applications.listByJob`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver match (`matches.getForApplication`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Añadir nota (`applications.addNote`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver notas (`applications.notesFor`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Decidir shortlist (`applications.decide`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Decidir reject (+ **nota obligatoria**) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Leer audit trail (`orgs.auditTrail`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Invitar miembro (`orgs.invite`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Listar invitaciones (`orgs.pendingInvites`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Revocar invitación (`orgs.revokeInvite`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Quitar miembro (`orgs.removeMember`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Quitar a sí mismo | ❌ | ❌ | ❌ | ❌ | ❌ |

**Notas de política (no son supuestos, son lo medido):**

- `orgs.members` usa `requireMembership(..., "hiring_manager")`: **los tres roles
  de la org pueden ver el listado de miembros**. Es coherente con `docs/RBAC.md`
  ("ver org/vacantes/aplicantes" para `hiring_manager`+). Si el negocio quiere
  restringirlo a `org_admin`, es un cambio de una línea + este mismo test.
- `hiring_manager` **no** decide (ni shortlist ni reject): la decisión humana es
  de `recruiter`/`org_admin`.
- `removeMember` de un **no miembro** falla para todos (fail-closed).
- `candidate` no tiene ninguna lectura hacia el lado empresa.

---

## 3. Evidencia de ejecución

```
RBAC_MATRIX {
  "org_admin":      {"ver_org":"ALLOW","ver_miembros":"ALLOW","ver_vacantes":"ALLOW","crear_vacante":"ALLOW","subir_cv":"ALLOW","ver_applicants":"ALLOW","anotar":"ALLOW","decidir":"ALLOW","audit_log":"ALLOW","invitar":"ALLOW"},
  "recruiter":      {"ver_org":"ALLOW","ver_miembros":"ALLOW","ver_vacantes":"ALLOW","crear_vacante":"ALLOW","subir_cv":"ALLOW","ver_applicants":"ALLOW","anotar":"ALLOW","decidir":"ALLOW","audit_log":"DENY","invitar":"DENY"},
  "hiring_manager": {"ver_org":"ALLOW","ver_miembros":"ALLOW","ver_vacantes":"ALLOW","crear_vacante":"DENY","subir_cv":"DENY","ver_applicants":"ALLOW","anotar":"ALLOW","decidir":"DENY","audit_log":"DENY","invitar":"DENY"},
  "candidate":      {"ver_org":"DENY","ver_miembros":"DENY","ver_vacantes":"DENY","crear_vacante":"DENY","subir_cv":"DENY","ver_applicants":"DENY","anotar":"DENY","decidir":"DENY","audit_log":"DENY","invitar":"DENY"},
  "outsider":       {"ver_org":"DENY","ver_miembros":"DENY","ver_vacantes":"DENY","crear_vacante":"DENY","subir_cv":"DENY","ver_applicants":"DENY","anotar":"DENY","decidir":"DENY","audit_log":"DENY","invitar":"DENY"}
}
Tests  18 passed (18)
```

---

## 4. Revocación de membresía (E2E, misma sesión)

Test: *"REVOCACIÓN: removeMember deja sin acceso a la MISMA sesión, sin cerrar
sesión"*.

Secuencia verificada:

```
sesión viva (recruiter) → accede a vacantes, applicants, match, notas   ✅
org_admin → removeMember(recruiter)                                     ✅
MISMO token, sin re-loguear:
  jobs.listByOrg            → DENY
  applications.listByJob    → DENY
  matches.getForApplication → DENY
  applications.addNote      → DENY
  applications.decide       → DENY
  jobs.create               → DENY
Cliente HTTP NUEVO con el mismo token → DENY (no es caché del cliente)
users.currentUser           → OK  (la sesión sigue viva)
```

**Documentación explícita de la distinción:**

| Concepto | Qué hace | Cómo se fuerza |
|---|---|---|
| **Organization access revocation** | La fila `organizationMembers` desaparece → `requireMembership` falla en **cada** función de la org | `orgs.removeMember` |
| **Session revocation** | La sesión de Convex Auth deja de ser válida | `account.deleteAccount` (borra sesiones) / logout |

`removeMember` **NO** invalida la sesión global: el usuario sigue autenticado y
conserva sus datos personales de candidato. Es el comportamiento correcto (un
empleado puede dejar la empresa y seguir usando el producto como candidato).

---

## 5. Cómo reproducir

```bash
bunx vitest run tests/integration/rbac.seed.integration.test.ts   # fase 1
bash scripts/rbac_seed_memberships.sh                            # fase 2
bunx vitest run tests/integration/rbac.matrix.integration.test.ts # fase 3
```

Los manifiestos viven en `/tmp` (fuera del repo) porque contienen tokens de
sesión sintéticos.