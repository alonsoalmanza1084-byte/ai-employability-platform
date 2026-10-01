#!/usr/bin/env bash
# =============================================================================
# P0 — VULN-12: verificación de que una DENEGACIÓN persiste su security event.
#
# Convex es ACID: una mutación que registra y después lanza revierte el insert.
# Este script comprueba, contra el deployment real, que el contrato v2
# (`ok:false` en vez de `throw`) hace que el evento quede CONFIRMADO.
#
# Uso: bash scripts/verify_security_events.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== securityEvents ANTES ==="
bunx convex data securityEvents 2>&1 | tail -n +1 | head -3

echo
echo "=== disparando denegaciones reales (extensión no permitida / oversized) ==="
bunx vitest run tests/integration/securityEvents.denial.integration.test.ts 2>&1 \
  | grep -E "Tests |×|✓" || true

echo
echo "=== securityEvents DESPUÉS ==="
OUT=$(bunx convex data securityEvents 2>&1)
echo "$OUT" | head -20

if echo "$OUT" | grep -q "There are no documents"; then
  echo
  echo "SECURITY_EVENTS=STILL_EMPTY  (VULN-12 NO corregido)"
  exit 1
fi
if echo "$OUT" | grep -q "upload_rejected\|rate_limited"; then
  echo
  echo "SECURITY_EVENTS=PERSISTED  (VULN-12 corregido: la denegación deja rastro)"
  exit 0
fi

echo
echo "SECURITY_EVENTS=UNEXPECTED_CONTENT"
exit 1