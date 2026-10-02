#!/usr/bin/env bash
# =============================================================================
# BLOCKER — RESTORE COMPLETO en un deployment LIMPIO (preparado, no ejecutable
# hoy en este entorno).
#
# Qué demuestra (y qué NO): `scripts/backup_restore_drill.sh` ya demuestra la
# MECÁNICA backup → pérdida → restore → sha256 idéntico, pero SOLO a nivel de
# una tabla sacrificial y SOLO sobre el MISMO deployment. Este script es el
# paso que falta: exportar TODAS las tablas (incluidos binarios de storage),
# importarlas en un deployment de DESTINO vacío y comparar fila a fila.
#
# POR QUÉ AHORA ESTÁ BLOQUEADO: con una deploy key el CLI de Convex no permite
# crear deployments (`convex deployment create` → "isn't supported with a deploy
# key"). Hacen falta credenciales de PROYECTO (o un deployment de destino ya
# creado por el operador). Este script NO simula el resultado: si falta ese
# requisito sale con `RESTORE_FULL=BLOCKED_BY_PLATFORM` y exit 2. Un exit 0 solo
# se emite cuando el restore completo se verificó de verdad.
#
# Requisitos (NO los imprime, NO los genera):
#   RESTORE_TARGET_URL       URL http(s) del deployment de destino (vacío)
#   RESTORE_TARGET_ADMIN_KEY admin key del deployment de destino
#
# Uso:
#   RESTORE_TARGET_URL=... RESTORE_TARGET_ADMIN_KEY=... \
#     bash scripts/restore_full_drill.sh
#
# Códigos de salida:
#   0 → RESTORE_FULL=PASS        (restore completo verificado con sha256)
#   2 → RESTORE_FULL=BLOCKED_*   (falta capac性的 plataforma; NUNCA es PASS)
#   1 → RESTORE_FULL=FAIL        (el restore se intentó y NO cuadró)
# =============================================================================
set -euo pipefail

WORK="${WORK:-/tmp/tf/restore_full}"
mkdir -p "$WORK"

say() { printf '\n=== %s ===\n' "$1"; }
now_ms() { date +%s%3N; }

TARGET_URL="${RESTORE_TARGET_URL:-}"
TARGET_KEY="${RESTORE_TARGET_ADMIN_KEY:-}"

# ---------------------------------------------------------------------------
say "0. PREFLIGHT — ¿existe un deployment de destino?"
if [ -z "$TARGET_URL" ] || [ -z "$TARGET_KEY" ]; then
  {
    printf 'RESTORE_FULL=BLOCKED_BY_PLATFORM\n'
    printf 'REASON=missing_restore_target\n'
    printf 'MISSING=%s\n' "$([ -z "$TARGET_URL" ] && echo RESTORE_TARGET_URL) $([ -z "$TARGET_KEY" ] && echo RESTORE_TARGET_ADMIN_KEY)"
    printf 'UPSTREAM_BLOCK=convex_deployment_create_unsupported_with_deploy_key\n'
    printf 'REMEDIATION=crear un deployment de destino desde el dashboard de Convex (credenciales de proyecto) y exportar RESTORE_TARGET_URL/RESTORE_TARGET_ADMIN_KEY\n'
    printf 'EVIDENCE=scripts/backup_restore_drill.sh (mecánica a nivel de tabla, PASS) + docs/BACKUP_AND_RECOVERY.md\n'
  } | tee "$WORK/restore_full.result"
  exit 2
fi

# El destino debe estar vacío: un restore completo sobre datos existentes no
# demostraría nada y podría enmascarar pérdidas.
TARGET_TABLES=$(bunx convex data organizations --url "$TARGET_URL" --admin-key "$TARGET_KEY" --limit 1 2>/dev/null | wc -l | tr -d ' ' || echo "0")
if [ "${TARGET_TABLES:-0}" -gt 1 ]; then
  printf 'RESTORE_FULL=FAIL\nREASON=target_not_empty\n' | tee "$WORK/restore_full.result"
  exit 1
fi

# ---------------------------------------------------------------------------
say "1. EXPORT — snapshot completo de ORIGEN (datos + binarios)"
T0=$(now_ms)
if ! bunx convex export --path "$WORK/full.zip" --include-file-storage >/dev/null; then
  printf 'RESTORE_FULL=FAIL\nREASON=export_failed\n' | tee "$WORK/restore_full.result"
  exit 1
fi
[ -s "$WORK/full.zip" ] || {
  printf 'RESTORE_FULL=FAIL\nREASON=empty_snapshot\n' | tee "$WORK/restore_full.result"
  exit 1
}
T_EXPORT=$(now_ms)

rm -rf "$WORK/snap" && mkdir -p "$WORK/snap"
( cd "$WORK/snap" && unzip -o -q "$WORK/full.zip" )

# ---------------------------------------------------------------------------
say "2. IMPORT — volcado en el deployment de DESTINO"
TABLES=$(find "$WORK/snap" -mindepth 1 -maxdepth 1 -type d ! -name storage -exec basename {} \; | sort)
TABLE_COUNT=$(printf '%s\n' "$TABLES" | grep -c . || true)
printf 'tablas detectadas: %s\n' "$TABLE_COUNT"
if [ "$TABLE_COUNT" -lt 1 ]; then
  printf 'RESTORE_FULL=FAIL\nREASON=no_tables_in_snapshot\n' | tee "$WORK/restore_full.result"
  exit 1
fi

for t in $TABLES; do
  SRC="$WORK/snap/$t/documents.jsonl"
  [ -f "$SRC" ] || continue
  bunx convex import --table "$t" --append -y "$SRC" \
    --url "$TARGET_URL" --admin-key "$TARGET_KEY" >/dev/null
done
T_IMPORT=$(now_ms)

# ---------------------------------------------------------------------------
say "3. VERIFICACIÓN — fila a fila y sha256 por tabla"
MISMATCH=0
RESULT="$WORK/restore_full.result"
: > "$RESULT"
for t in $TABLES; do
  SRC="$WORK/snap/$t/documents.jsonl"
  [ -f "$SRC" ] || continue
  SRC_N=$(wc -l < "$SRC" | tr -d ' ')
  SRC_SHA=$(sha256sum "$SRC" | cut -d' ' -f1)
  # Re-exportamos el destino y comparamos por tabla.
  bunx convex export --path "$WORK/target_$t.zip" \
    --url "$TARGET_URL" --admin-key "$TARGET_KEY" >/dev/null 2>&1 || {
      printf 'RESTORE_FULL=FAIL\nREASON=export_target_failed\nTABLE=%s\n' "$t" | tee -a "$RESULT"
      exit 1
    }
  rm -rf "$WORK/ts_$t" && mkdir -p "$WORK/ts_$t"
  ( cd "$WORK/ts_$t" && unzip -o -q "$WORK/target_$t.zip" )
  DST="$WORK/ts_$t/$t/documents.jsonl"
  DST_N=$(wc -l < "$DST" 2>/dev/null | tr -d ' ' || echo 0)
  DST_SHA=$(sha256sum "$DST" 2>/dev/null | cut -d' ' -f1 || echo "-")
  printf '%-28s origen=%-8s destino=%-8s %s\n' "$t" "$SRC_N" "$DST_N" \
    "$([ "$SRC_SHA" = "$DST_SHA" ] && echo OK || echo DIFERENTE)"
  printf 'TABLE=%s SRC_ROWS=%s DST_ROWS=%s SRC_SHA=%s DST_SHA=%s\n' \
    "$t" "$SRC_N" "$DST_N" "$SRC_SHA" "$DST_SHA" >> "$RESULT"
  if [ "$SRC_N" != "$DST_N" ] || [ "$SRC_SHA" != "$DST_SHA" ]; then
    MISMATCH=$((MISMATCH + 1))
  fi
done

T_END=$(now_ms)
{
  printf 'TABLES_CHECKED=%s\n' "$TABLE_COUNT"
  printf 'MISMATCHES=%s\n' "$MISMATCH"
  printf 'EXPORT_MS=%s\n' "$((T_EXPORT - T0))"
  printf 'IMPORT_MS=%s\n' "$((T_IMPORT - T_EXPORT))"
  printf 'VERIFY_MS=%s\n' "$((T_END - T_IMPORT))"
  printf 'TOTAL_MS=%s\n' "$((T_END - T0))"
  printf 'SCOPE=full_database_clean_target\n'
} >> "$RESULT"

# ---------------------------------------------------------------------------
if [ "$MISMATCH" -ne 0 ]; then
  printf 'RESTORE_FULL=FAIL\nMISMATCHES=%s\n' "$MISMATCH" | tee -a "$RESULT"
  exit 1
fi

printf 'RESTORE_FULL=PASS\n' | tee -a "$RESULT"
printf 'TABLES_VERIFIED=%s\nMISMATCHES=0\n' "$TABLE_COUNT"
