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

## 2-bis. Identidad `anonymous` (sin sesión, sin token)

Verificado explícitamente porque el prompt exige separar `candidate`,
`outsider` y `anonymous`:

| Endpoint | `anonymous` |
|---|---|
| `jobs.get` (vacante) | ❌ DENY |
| `orgs.members` | ❌ DENY |
| `jobs.listByOrg` | ❌ DENY |
| `jobs.create` | ❌ DENY |
| `jobs.close` | ❌ DENY |
| `applications.initUpload` | ❌ DENY |
| `applications.listByJob` | ❌ DENY |
| `matches.getForApplication` | ❌ DENY |
| `applications.addNote` | ❌ DENY |
| `applications.decide` | ❌ DENY |
| `orgs.auditTrail` | ❌ DENY |
| `orgs.invite` | ❌ DENY |
| `orgs.removeMember` | ❌ DENY |
| `candidates.initUpload` (propio) | ❌ DENY |
| `candidates.myResumes` (propio) | ❌ DENY |

```
RBAC_ANONYMOUS {"ver_vacante":"DENY","ver_miembros":"DENY","ver_vacantes":"DENY",
"crear_vacante":"DENY","cerrar_vacante":"DENY","subir_cv":"DENY","ver_applicants":"DENY",
"ver_match":"DENY","anotar":"DENY","decidir":"DENY","audit_log":"DENY","invitar":"DENY",
"quitar_miembro":"DENY","cv_propio":"DENY","mis_resumes":"DENY"}
→ 15/15 DENY
```

## 2-ter. Auditoría de denegaciones (VULN-14)

Cada denegación de la tabla anterior deja ahora un `securityEvent` cuando se
invoca por la vía auditada `api.audited.*`. Matriz completa con identidad real,
evento persistido y recurso intacto:
`tests/integration/vuln14.denial.audit.integration.test.ts` → **25/25**.

La autorización de esta matriz **no cambió**: se sigue denegando exactamente lo
mismo. Lo que se añadió es el rastro. Ver `docs/SECURITY_AUDIT.md` §8-bis.

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
# CADENA COMPLETA (recomendado): org FRESCA por ejecución.
bash scripts/rbac_e2e.sh
#   fase 1  rbac.seed            → 1/1   (identidades + org nueva)
#   fase 2  rbac_seed_memberships→ MEMBERSHIPS_SEEDED=2 (idempotente)
#   fase 3  rbac.matrix          → 18/18
#   fase 4  vuln14.denial.audit  → 25/25
#   salida: RBAC_E2E=PASS
```

**Por qué una org fresca y no reutilizar el manifiesto:** `LIMITS.jobCreatePerDay
= 20` (por usuario y organización y día) es una cuota de PRODUCCIÓN. Repetir la
matriz muchas veces sobre la misma org la agota y `jobs.create` empieza a fallar
para `org_admin`. Eso NO es un fallo de autorización: es el límite funcionando.
`rbac_e2e.sh` siembra una org nueva (contadores a 0) en cada ejecución.

**Independencia entre suites (verificada):** la matriz RBAC y el test VULN-14 se
ejecutan sobre el mismo manifiesto y ambos revocan/restablecen membresías. Las dos
suites son autosuficientes: la matriz restablece en su `beforeAll` y VULN-14 antes
de su escenario de revocación. Comprobado en los dos órdenes:
`43 passed (43)` ejecutando ambos ficheros (matriz→V14 y V14→matriz).

**Revocación exhaustiva (VULN-18):** `orgs.removeMember` borra **todas** las
filas de membresía del par (org, usuario), no solo la primera. El índice
`by_org_user` no es único en Convex, así que un restore puede dejar duplicados;
con un único `delete` el usuario conservaba acceso (bypass observado en la
matriz). La siembra de fixtures es idempotente para no crear ese estado.

Los manifiestos viven en `/tmp` (fuera del repo) porque contienen tokens de
sesión sintéticos.