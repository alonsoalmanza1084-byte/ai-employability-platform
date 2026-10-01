#!/usr/bin/env bash
# =============================================================================
# P0 — VULN-14: semántica de auditoría de DENEGACIONES DE AUTORIZACIÓN.
#
# VULN-12 se corrigió haciendo que las denegaciones de VALIDACIÓN DE ARCHIVO
# se devuelvan (`ok:false`) en vez de lanzar, para que el `securityEvent`
# quede confirmado (Convex es ACID: insert + throw revierte todo).
#
# Pero las denegaciones de AUTORIZACIÓN (`requireMembership` → `throw`) siguen
# lanzando. Este script LO DEMUESTRA contra el deployment real en vez de
# suponerlo:
#
#   A) conteo de securityEvents
#   B) se provoca una denegación de autorización (mutación que lanza)
#   C) se vuelve a contar
#
#   → si el conteo NO cambia, la denegación de autorización NO deja rastro.
#
# Uso: bash scripts/verify_audit_denial_semantics.sh
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

count_events() {
  local out
  out=$(bunx convex data securityEvents 2>&1)
  if echo "$out" | grep -q "There are no documents"; then
    echo 0
    return
  fi
  # 2 líneas de cabecera + N filas
  echo "$out" | grep -c '^"'
}

echo "=== A) securityEvents ANTES ==="
BEFORE=$(count_events)
echo "SECURITY_EVENTS_BEFORE=$BEFORE"

echo
echo "=== B) disparando una DENEGACIÓN DE AUTORIZACIÓN (requireMembership -> throw) ==="
# `candidates:initUpload` llama a `requireUser` primero. Sin sesión, el throw
# revierte la transacción completa.
set +e
bunx convex run candidates:initUpload \
  '{"fileName":"legitimo.txt","fileSize":256,"mimeType":"text/plain"}' 2>&1 | tail -4
set -e
echo "--- (un error aquí es lo esperado: la operación se denegó) ---"

echo
echo "=== C) securityEvents DESPUÉS ==="
AFTER=$(count_events)
echo "SECURITY_EVENTS_AFTER=$AFTER"
echo "DELTA=$((AFTER - BEFORE))"

echo
if [ "$AFTER" -eq "$BEFORE" ]; then
  echo "AUTHORIZATION_DENIAL_AUDIT=NOT_PERSISTED"
  echo
  echo "VULN-14 CONFIRMADO: una denegación de autorización NO deja securityEvent."
  echo "Motivo: Convex es ACID; requireMembership lanza, y el rollback revierte"
  echo "cualquier insert previo en la misma transacción."
  echo "Esto NO se convierte en PASS. Es un hallazgo OPEN (ver docs/SECURITY_AUDIT.md)."
  exit 1
fi

echo "AUTHORIZATION_DENIAL_AUDIT=PERSISTED"
exit 0
