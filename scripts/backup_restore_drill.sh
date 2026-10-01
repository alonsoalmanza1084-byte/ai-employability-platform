#!/usr/bin/env bash
# =============================================================================
# BLOCKER C — RECOVERY DRILL (restore real, no simulado)
#
# Ejecuta un ciclo completo sobre la tabla SACRIFICIAL `usageEvents` (contadores
# de uso, datos regenerables). Ninguna tabla de negocio se toca: el drill
# demuestra la MECÁNICA backup -> pérdida -> restore -> verificación con sha256.
#
# Por qué `usageEvents`: perderla NO borra datos de negocio ni documentos de
# usuario; solo reincia contadores de cuota, y el drill los restaura en el acto
# desde el backup (el sha256 final lo demuestra). Es la superficie de menor
# riesgo para un restore destructivo controlado.
#
# LIMITACIÓN HONESTA: este drill valida el MECANISMO de export/import sobre una
# tabla. NO valida un restore completo de base de datos desde cero, porque el
# CLI de Convex con deploy key no permite crear un deployment de destino
# (`convex deployment create` → "isn't supported with a deploy key"). Eso queda
# documentado como BLOQUEADO en docs/BACKUP_AND_RECOVERY.md.
#
# Uso: bash scripts/backup_restore_drill.sh
# Salida: exit 0 si el ciclo completo verifica, != 0 si algo falla.
# =============================================================================
set -euo pipefail

WORK="${WORK:-/tmp/tf/drill}"
TABLE="usageEvents"
mkdir -p "$WORK"

say() { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'FALLO: %s\n' "$1"; exit 1; }
now_ms() { date +%s%3N; }
T0=$(now_ms)
T_BACKUP_END=0; T_LOSS_END=0; T_RESTORE_END=0

# ---------------------------------------------------------------------------
say "1. BACKUP — export completo (datos + binarios de storage)"
bunx convex export --path "$WORK/backup.zip" --include-file-storage >/dev/null
[ -s "$WORK/backup.zip" ] || fail "no se generó el snapshot"

rm -rf "$WORK/snap" && mkdir -p "$WORK/snap"
( cd "$WORK/snap" && unzip -o -q "$WORK/backup.zip" )

FULL="$WORK/$TABLE.full.jsonl"
cp "$WORK/snap/$TABLE/documents.jsonl" "$FULL"
FULL_N=$(wc -l < "$FULL" | tr -d ' ')
FULL_SHA=$(sha256sum "$FULL" | cut -d' ' -f1)
printf 'filas iniciales : %s\nsha256 backup   : %s\n' "$FULL_N" "$FULL_SHA"
[ "$FULL_N" -ge 1 ] || fail "la tabla $TABLE está vacía: el drill no probaría nada"
T_BACKUP_END=$(now_ms)
BACKUP_MS=$((T_BACKUP_END - T0))

# ---------------------------------------------------------------------------
say "2. RESTORE #1 — importar el snapshot desde el archivo (sin leer la BD)"
bunx convex import --table "$TABLE" --replace -y "$FULL" >/dev/null
say "   verificando con una NUEVA exportación"
bunx convex export --path "$WORK/after1.zip" >/dev/null
rm -rf "$WORK/a1" && mkdir -p "$WORK/a1"
( cd "$WORK/a1" && unzip -o -q "$WORK/after1.zip" )
N1=$(wc -l < "$WORK/a1/$TABLE/documents.jsonl" | tr -d ' ')
SHA1=$(sha256sum "$WORK/a1/$TABLE/documents.jsonl" | cut -d' ' -f1)
printf 'filas tras restore #1 : %s\nsha256             : %s\n' "$N1" "$SHA1"
[ "$N1" = "$FULL_N" ] || fail "restore #1 cambió el número de filas ($FULL_N -> $N1)"
[ "$SHA1" = "$FULL_SHA" ] || fail "restore #1 cambió el contenido (sha256 difiere)"
say "   OK: restore #1 es fiel y reproducible (mismo sha256)"

# ---------------------------------------------------------------------------
say "3. PÉRDIDA SIMULADA — importar solo 1 fila con --replace (se borra el resto)"
head -n 1 "$FULL" > "$WORK/$TABLE.lost.jsonl"
bunx convex import --table "$TABLE" --replace -y "$WORK/$TABLE.lost.jsonl" >/dev/null
bunx convex export --path "$WORK/after2.zip" >/dev/null
rm -rf "$WORK/a2" && mkdir -p "$WORK/a2"
( cd "$WORK/a2" && unzip -o -q "$WORK/after2.zip" )
N2=$(wc -l < "$WORK/a2/$TABLE/documents.jsonl" | tr -d ' ')
printf 'filas tras la pérdida : %s\n' "$N2"
[ "$N2" -lt "$FULL_N" ] || fail "la pérdida simulada no redujo los datos ($N2 >= $FULL_N)"
say "   OK: datos perdidos ($FULL_N -> $N2)"
T_LOSS_END=$(now_ms)
LOSS_MS=$((T_LOSS_END - T_BACKUP_END))

# ---------------------------------------------------------------------------
say "4. RESTORE #2 — recuperar desde el MISMO backup"
bunx convex import --table "$TABLE" --replace -y "$FULL" >/dev/null
bunx convex export --path "$WORK/after3.zip" >/dev/null
rm -rf "$WORK/a3" && mkdir -p "$WORK/a3"
( cd "$WORK/a3" && unzip -o -q "$WORK/after3.zip" )
N3=$(wc -l < "$WORK/a3/$TABLE/documents.jsonl" | tr -d ' ')
SHA3=$(sha256sum "$WORK/a3/$TABLE/documents.jsonl" | cut -d' ' -f1)
printf 'filas tras restore #2 : %s\nsha256                : %s\n' "$N3" "$SHA3"
[ "$N3" = "$FULL_N" ] || fail "restore #2 no recuperó todas las filas ($N3 != $FULL_N)"
[ "$SHA3" = "$FULL_SHA" ] || fail "restore #2 no recuperó el contenido exacto"

# Comprobación de IDENTIDAD: los _id deben ser los mismos, no reasignados.
IDX_FULL=$(grep -o '"_id":"[^"]*"' "$FULL" | sort | sha256sum | cut -d' ' -f1)
IDX_A3=$(grep -o '"_id":"[^"]*"' "$WORK/a3/$TABLE/documents.jsonl" | sort | sha256sum | cut -d' ' -f1)
[ "$IDX_FULL" = "$IDX_A3" ] || fail "los _id NO se preservaron en el restore"
say "   OK: mismos IDs, mismo contenido, mismo sha256"
T_RESTORE_END=$(now_ms)
RESTORE_MS=$((T_RESTORE_END - T_LOSS_END))
TOTAL_MS=$((T_RESTORE_END - T0))

# ---------------------------------------------------------------------------
say "RESULTADO"
printf 'BACKUP_SHA256=%s\nRESTORE_ROWS=%s\nID_SET_SHA256=%s\n' \
  "$FULL_SHA" "$N3" "$IDX_FULL"
# ── MEDICIONES (base para un RTO, NO una promesa de RTO) ───────────────────
# Alcance: RESTORE DE UNA TABLA sobre el MISMO deployment. NO es un restore de
# base de datos completa en un deployment vacío (bloqueado por deploy key).
printf 'SCOPE=table_level_same_deployment\n'
printf 'BACKUP_DURATION_MS=%s\n' "$BACKUP_MS"
printf 'LOSS_SIMULATION_MS=%s\n' "$LOSS_MS"
printf 'RESTORE_DURATION_MS=%s\n' "$RESTORE_MS"
printf 'TOTAL_RECOVERY_TIME_MS=%s\n' "$TOTAL_MS"
printf 'DRILL=PASS\n'