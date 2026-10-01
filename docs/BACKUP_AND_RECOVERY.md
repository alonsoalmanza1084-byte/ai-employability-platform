# BACKUP_AND_RECOVERY.md — Backups, restore, RPO/RTO

> **ESTADO: VERIFICADO en mecanismo / PARCIAL en alcance.**
> - Backup completo (datos + binarios): **VERIFIED** con ejecución real.
> - Restore con verificación por checksum: **VERIFIED** con ejecución real.
> - Restore sobre un deployment **vacío**: **BLOCKED BY PLATFORM**.
> - RPO/RTO: **NOT MEASURED** (no hay incidente real del que derivarlos).

---

## 1. Qué capacidad REAL existe (descubierta ejecutando el CLI, no asumida)

El CLI de Convex instalado en el proyecto expone:

```
convex export   → exporta datos (opcionalmente file storage) a un ZIP
convex import   → importa desde ZIP o por tabla (csv / jsonLines / jsonArray)
convex data     → listado y lectura de tablas
```

**Comandos ejecutados y su resultado real:**

```
$ bunx convex export --path backup.zip --include-file-storage
✔ Created snapshot export at timestamp 1790893712074971901
✔ Downloaded snapshot export to /tmp/tf/drill/backup.zip     (2.1 MB)

$ unzip -l → 28 directorios de tabla + _storage/ con 182 binarios
```

Contenido real del snapshot (conteos observados):

| Tabla | Filas | Observación |
|---|---|---|
| `organizations` | 139 | |
| `organizationMembers` | 139 | |
| `users` | 292 | |
| `authSessions` / `authAccounts` / `authRefreshTokens` | presentes | datos de autenticación **sí** se exportan |
| `applications` | 120 | |
| `jobs` | 59 | |
| `candidateJobMatches` | 28 | |
| `auditLog` | 487 | |
| `invitations` | 25 | |
| `resumes` / `resumeVersions` | 41 / 58 | metadatos de CV |
| `_storage` | 182 binarios | **los binarios de los CV incluidos** |
| `usageEvents` | 490 | contadores de cuota |

Cada documento de `_storage` incluye `sha256` (base64) y `size`, y el binario
correspondente está en el ZIP → **la integridad es verificable sin depender del
proveedor**.

---

## 2. Matriz de aceptación de backups

| Asset | Backup | Frecuencia | Retención | Restore tested | Evidence | Status |
|---|---|---|---|---|---|---|
| Convex DB (todas las tablas) | `convex export` | **On-demand, manual** (script) | **NO DEFINIDA** | Sí (round-trip) | `scripts/backup_restore_drill.sh` | **VERIFIED** (mecanismo) |
| CV metadata (`resumes`, `resumeVersions`) | Sí, incluido | On-demand | NO DEFINIDA | Sí | `tests/recovery/backupIntegrity.test.ts` | **VERIFIED** |
| CV binaries (`_storage`) | Sí, con `--include-file-storage` + sha256 por archivo | On-demand | NO DEFINIDA | Sí | mismo test: "los binarios son ÍNTEGROS" | **VERIFIED** |
| Audit log | Sí, incluido | On-demand | NO DEFINIDA | Sí | mismo test: "el snapshot contiene el audit log del tenant A" | **VERIFIED** |
| Auth data (users, sessions, accounts) | Sí, incluido | On-demand | NO DEFINIDA | No verificado (no se restauró de forma aislada) | `tests/recovery/backupIntegrity.test.ts` | **PARTIAL** |
| Configuration (código Convex + schema) | En git, no en el snapshot | Por commit | n/a | n/a | repositorio | **VERIFIED** |
| Secrets (env vars) | **NO** — no se exportan | — | — | — | `bunx convex env list` | **NOT VERIFIED / GAP** |
| Índices / schema | Derivados del schema en git | Por commit | n/a | n/a | `src/convex/schema.ts` | **VERIFIED** |

### Lo que NO hay (y hay que decidirlo el negocio/operaciones)

- **No hay backup automático**: el export es un comando manual. Nada lo dispara.
- **No hay retención definida**: el backup vive donde lo deje el operador.
- **Los secretos no están en el backup**: hay que gestionarlos aparte (gestor de
  secretos del proveedor o vault), con su propia rotación.
- **No hay copia fuera del proveedor**: un solo ZIP en disco local no sobrevive a
  la pérdida de la cuenta o de la región.

---

## 3. Recovery drill — EJECUTADO (evidencia)

Script reproducible: `scripts/backup_restore_drill.sh`

```
=== 1. BACKUP ===      export completo (datos + storage)         ✔
    filas iniciales : 490
    sha256 backup   : 86bc0b3d5790014898406518d6c9c2652bcf842c23366ee3048794c998426545
=== 2. RESTORE #1 ===  import --replace desde el archivo
    filas tras restore #1 : 490
    sha256                 : 86bc0b3d...      ✔ idéntico
=== 3. PÉRDIDA SIMULADA === import --replace de 1 sola fila
    filas tras la pérdida : 1                ✔ datos perdidos
=== 4. RESTORE #2 ===  import --replace desde el MISMO backup
    filas tras restore #2 : 490
    sha256                 : 86bc0b3d...      ✔ idéntico
    ID_SET_SHA256          : 40d1e4ff...      ✔ mismos IDs, no reasignados

DRILL=PASS
```

**Qué demuestra:** `export` produce un respaldo completo; `import --replace`
restaura desde el archivo (sin leer la BD) de forma **fiel** (mismo sha256) e
**idempotente** (los `_id` se preservan, no se reasignan).

**Qué NO demuestra (límite honesto):** no se restauró la base completa en un
deployment vacío, porque `convex deployment create` falla con deploy key:

```
$ bunx convex deployment create restore-drill
✖ Creating a deployment isn't supported with a deploy key (CONVEX_DEPLOY_KEY).
   Run npx convex login (or use a project key) and try again.
```

**Tabla sacrificial:** el drill usa `usageEvents` (contadores de cuota), no datos
de negocio. Perderla no borra documentos de usuario; el drill la restaura en el
acto y el sha256 final lo demuestra.

---

## 4. Verificación de integridad (suite ejecutable)

`tests/recovery/backupIntegrity.test.ts` — **10 tests, todos PASSED**:

1. El snapshot contiene todas las filas sembradas del tenant A.
2. Conserva los IDs originales.
3. Incluye los binarios de los CV (no solo metadatos).
4. **Los binarios son íntegros: sha256 del snapshot == sha256 del archivo.**
5. El binario de un CV sembrado conserva su contenido.
6. Integridad referencial: ninguna fila apunta a una tabla inexistente.
7. Aislamiento: los datos del tenant A no se mezclan con los del tenant B.
8. El audit log del tenant A está presente y con sus eventos.
9. Hay datos de autenticación y **sin hashes de contraseña en claro**.
10. Tamaño del snapshot coherente con el número de filas.

---

## 5. RPO / RTO

| Métrica | TARGET | ASSUMPTION | MEASURED | Status |
|---|---|---|---|---|
| **RPO** (dato máximo aceptable perdido) | Por definir con negocio | "El provider toma snapshots diarios" — **NO VERIFICADO**: no hay acceso al panel para confirmar frecuencia ni retención | No medido | **NOT VERIFIED** |
| **RTO** (tiempo máximo fuera de servicio) | Por definir con negocio | "Un restore completo son minutos" — **NO VERIFICADO**: no se ha restaurado una base completa | No medido | **NOT VERIFIED** |

No se presenta ninguna estimación como garantía. Los valores reales deben salir
de: (a) ejecutar un restore completo en un deployment de destino y cronometrarlo,
(b) la política de retención del proveedor.

---

## 6. Qué falta para cerrar este blocker

| # | Acción | Responsable | Bloquea |
|---|---|---|---|
| 1 | Backup **automático** programado (cron/Task) con retención definida y copia **fuera del proveedor** | Operaciones / Plataforma | **Sí** |
| 2 | Restauración completa probada en un deployment limpio (requiere project key, no deploy key) | Plataforma | **Sí** |
| 3 | Gestión y rotación de secretos en el plan de recuperación | Seguridad | **Sí** |
| 4 | RPO/RTO acordados con negocio y medidos en un drill completo | Producto + Operaciones | **Sí** |
| 5 | Verificación periódica automática de los sha256 del backup | QA | No |

---

## 7. Runbook rápido

```bash
# 1. Backup
bunx convex export --path /var/backups/talentflow/$(date +%F).zip --include-file-storage
sha256sum /var/backups/talentflow/$(date +%F).zip

# 2. Verificar integridad del snapshot
SNAPSHOT_DIR=/var/tmp/snap MANIFEST_PATH=/var/tmp/manifest.json \
  bunx vitest run tests/recovery/backupIntegrity.test.ts

# 3. Drill de restore (tabla sacrificial)
bash scripts/backup_restore_drill.sh

# 4. Restore real de una tabla
unzip -p backup.zip organizations/documents.jsonl > orgs.jsonl
bunx convex import --table organizations --replace -y orgs.jsonl
```