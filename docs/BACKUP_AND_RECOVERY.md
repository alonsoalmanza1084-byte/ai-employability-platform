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

### 3-bis. Restore COMPLETO en deployment limpio — script preparado

`scripts/restore_full_drill.sh` implementa el paso que falta: export completo
(datos + binarios) → import de **todas** las tablas en un deployment de destino
vacío → re-export del destino y comparación **fila a fila y sha256 por tabla**.

No se puede ejecutar hoy (falta un deployment de destino: `convex deployment
create` no está permitido con deploy key), pero **el script no simula el
resultado**:

```
$ bash scripts/restore_full_drill.sh
RESTORE_FULL=BLOCKED_BY_PLATFORM       # exit 2, NUNCA un PASS
REASON=missing_restore_target
MISSING=RESTORE_TARGET_URL RESTORE_TARGET_ADMIN_KEY
UPSTREAM_BLOCK=convex_deployment_create_unsupported_with_deploy_key
```

Cuando el operador disponga de credenciales de PROYECTO:

```bash
RESTORE_TARGET_URL=https://<destino>.convex.cloud \
RESTORE_TARGET_ADMIN_KEY=<admin key> \
  bash scripts/restore_full_drill.sh     # 0 → RESTORE_FULL=PASS; 1 → FAIL
```

Códigos de salida: `0` PASS verificado · `2` BLOQUEADO por plataforma (nunca
PASS) · `1` el restore se intentó y **no** cuadró. Antes de importar comprueba
que el destino está vacío: un restore sobre datos existentes no probaría nada.

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
| **RPO** (dato máximo aceptable perdido) | **NO DEFINIDO** — falta el objetivo de negocio | Ninguna: no se inventa un número | No medido | **NOT_DEFINED** |
| **RTO** a nivel de **tabla**, mismo deployment | — | Ninguna | **17.071 ms** / **39.291 ms** (2.756 + 36.535) / **19.889 ms** (2026-10-02: 3.040 + 10.712 + 6.137) — dispersión 17 s–39 s | **MEASURED (ámbito limitado)** |
| **RTO** a nivel de **deployment completo** | **NO DEFINIDO** — falta el objetivo de negocio | "Un restore completo son minutos" — **NO VERIFICADO** | No medible | **NOT_MEASURED / BLOCKED_BY_PLATFORM** |

### Lo que sí está medido (ejecutado, no estimado)

```bash
bash scripts/backup_restore_drill.sh
```

```
BACKUP_SHA256=d83a9466dde5f7310d54036a551bc07d30c83cf60c852bbbdb7a3e628ca80ca0
RESTORE_ROWS=1406   # runs anteriores; 2026-10-02 → RESTORE_ROWS=1865
ID_SET_SHA256=(conjunto de IDs idéntico antes y después)
SCOPE=table_level_same_deployment
BACKUP_DURATION_MS=2756
RESTORE_DURATION_MS=36535
DRILL=PASS
```

**Medición más reciente (2026-10-01, cierre del gate):** `BACKUP_VERIFY=PASS`
(26 tablas, 452 binarios, 11/11 tests de integridad) y `DRILL=PASS` sobre 1.406
filas. El `RESTORE_DURATION_MS` varía entre ejecuciones (5.148 ms en el drill
anterior, 36.535 ms en este) porque incluye la importación vía CLI y la
re-ejecución del export; **la dispersión demuestra por qué no se puede
declarar un RTO con una sola medición.**

**Este número NO es el RTO de producción.** Es el tiempo de ciclo de una tabla
de 1.865 filas (2026-10-02) dentro del mismo deployment. Un restore completo incluye 26
tablas, 362 binarios, la reconstrucción del deployment y la reconfiguración de
secretos. Publicar 17 s como RTO sería una falsificación.

La **dispersión** de las mediciones (17.071 ms, 39.291 ms y 19.889 ms en tres
runs) es, por sí sola, la razón por la que no se puede declarar un RTO: sin
suficientes muestras y sin el ámbito completo, el dato no es un objetivo.

### Por qué el restore completo no se ha medido

`bunx convex deployment create` falla en este entorno:

```
isn't supported with a deploy key (CONVEX_DEPLOY_KEY)
```

Sin un deployment de destino no hay un restore completo que cronometrar.
Se necesita una **project key** (no una deploy key). Estado:
`BLOCKED_BY_PLATFORM`, no `PASS`.

### Nota operativa sobre el bloqueo de export

Durante esta sesión, `convex export` devolvió repetidamente:

```
ExportInProgress: There is already an export requested or in progress.
```

El servicio de export es **uno a la vez**: un export en curso bloquea el
siguiente, y el bloqueo persistió tras esperas de 45 s, 120 s, 150 s y 240 s.
Consecuencia operativa: **los backups automáticos no pueden solaparse** y
ningún proceso de restore debe empezar mientras otro export esté en vuelo.
El lock se liberó por sí solo y `backup_verify.sh` volvió a dar `PASS`.

---

## 6. Qué falta para cerrar este blocker

| # | Acción | Responsable | Bloquea |
|---|---|---|---|
| 1 | Backup **automático** programado (cron/Task) con retención definida y copia **fuera del proveedor** | Operaciones / Plataforma | **Sí** |
| 2 | Restauración completa probada en un deployment limpio (**requiere project key, no deploy key**: `convex deployment create` está bloqueado) | Plataforma | **Sí** |
| 3 | Gestión y rotación de secretos en el plan de recuperación (VULN-11 sigue sin rotar) | Seguridad | **Sí** |
| 4 | **RPO y RTO acordados con negocio** y medidos en un drill de deployment completo | Producto + Operaciones | **Sí** |
| 5 | Verificación periódica automática de los sha256 del backup | QA | No |
| 6 | Serializar los exports (el lock `ExportInProgress` impide backups solapados) | Operaciones | No |

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