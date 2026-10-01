#!/usr/bin/env bash
# =============================================================================
# BLOQUE B — Pipeline de verificación del BACKUP (reproducible).
#
#   1. Siembra datos sintéticos (tenants A/B, CVs, applications, notas,
#      invitaciones, eventos de auditoría) y escribe el manifiesto.
#   2. Exporta el deployment completo (datos + binarios de storage).
#   3. Verifica la integridad del snapshot contra el manifiesto.
#
# Debe ejecutarse como una unidad: el manifiesto identifica los IDs sembrados y
# el snapshot debe contenerlos.
#
# Uso: bash scripts/backup_verify.sh
# =============================================================================
set -euo pipefail

WORK="${WORK:-/tmp/tf}"
cd "$(dirname "$0")/.."

echo "=== 1. SIEMBRA de datos sintéticos ==="
bunx vitest run tests/integration/fixtures.seed.integration.test.ts 2>&1 | grep -E "SEED_MANIFEST|Tests " || true

echo
echo "=== 2. BACKUP (export completo) ==="
rm -f "$WORK/backup.zip"
bunx convex export --path "$WORK/backup.zip" --include-file-storage >/dev/null
rm -rf "$WORK/x" && mkdir -p "$WORK/x"
( cd "$WORK/x" && unzip -o -q "$WORK/backup.zip" )
echo "snapshot: $WORK/backup.zip ($(du -h "$WORK/backup.zip" | cut -f1))"
echo "tablas:   $(find "$WORK/x" -name documents.jsonl | wc -l)"
echo "binarios:$(find "$WORK/x/_storage" -type f ! -name documents.jsonl | wc -l)"

echo
echo "=== 3. VERIFICACIÓN de integridad ==="
SNAPSHOT_DIR="$WORK/x" MANIFEST_PATH="$WORK/manifest.json" \
  bunx vitest run tests/recovery/backupIntegrity.test.ts

echo
echo "BACKUP_VERIFY=PASS"