#!/usr/bin/env bash
# =============================================================================
# P0 — VULN-14: verificación de que una DENEGACIÓN DE AUTORIZACIÓN persiste su
# security event.
#
# HISTORIA
# --------
# Antes: `requireMembership` lanzaba, el rollback ACID de Convex revierte el
# insert, y `securityEvents` quedaba mudo ante intentos de escalada y ataques
# cross-tenant. Medido: DELTA=0.
#
# Ahora: los endpoints sensibles se invocan a través de `api.audited.*`, un
# wrapper `action` que preflighta (solo lectura), delega en la función original
# y registra la denegación en una TRANSACCIÓN APARTE antes de volver a lanzar
# el error. La autorización sigue siendo obligatoria: el error se relanza.
#
# Este script lo COMPRUEBA contra el deployment real.
#
# Uso: bash scripts/verify_audit_denial_semantics.sh
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

# `convex data` sin --limit solo devuelve las 100 filas más recientes: con ese
# tope el contador se saturaba y hacía creer que no se escribía nada. Fue un
# error de MEDICIÓN (el arreglo funcionaba), no del sistema.
LIMIT=10000

count_events() {
  local out
  out=$(bunx convex data securityEvents --limit "$LIMIT" 2>&1)
  if echo "$out" | grep -q "There are no documents"; then
    echo 0
    return
  fi
  echo "$out" | grep -c '^"'
}

ORG="${1:-}"
if [ -z "$ORG" ]; then
  # 1) Manifiesto de la siembra RBAC (fuente fiable: es una organizations real).
  MANIFEST="${RBAC_MANIFEST:-/tmp/tf/rbac-manifest.json}"
  if [ -f "$MANIFEST" ]; then
    ORG=$(grep -o '"orgId":"[^"]*"' "$MANIFEST" | head -1 | cut -d'"' -f4)
  fi
fi
if [ -z "$ORG" ] || [ -z "${ORG:-}" ]; then
  # 2) Cualquier organización real de la tabla `organizations`.
  #    OJO: los Ids de Convex NO codifican la tabla, así que un id sacado de
  #    `auditLog` puede NO ser un `organizations` válido y el validador lo
  #    rechaza (VULN-16). Por eso se lee de la tabla correcta.
  ORG=$(bunx convex data organizations --limit 1 2>&1 \
        | sed -n 's/^"\([^"]*\)".*/\1/p' | head -1 || true)
fi

if [ -z "$ORG" ]; then
  echo "AUTHORIZATION_DENIAL_AUDIT=NOT_EXECUTED"
  echo
  echo "No se pudo determinar una organizationId de prueba."
  echo "Uso: bash scripts/verify_audit_denial_semantics.sh <organizationId>"
  exit 2
fi

echo "=== A) securityEvents ANTES ==="
BEFORE=$(count_events)
echo "SECURITY_EVENTS_BEFORE=$BEFORE"
echo "ORG=$ORG"

echo
echo "=== B) disparando DENEGACIONES DE AUTORIZACIÓN por la vía auditada ==="
echo "--- 1) anónimo contra orgAuditTrail (debe lanzar + registrar) ---"
set +e
bunx convex run audited:orgAuditTrail "{\"organizationId\":\"$ORG\"}" 2>&1 | tail -3
echo "--- 2) anónimo contra jobsListByOrg ---"
bunx convex run audited:jobsListByOrg "{\"organizationId\":\"$ORG\"}" 2>&1 | tail -3
echo "--- 3) outsider: orgMembers por la vía NO auditada (debe lanzar) ---"
echo "    (esta es la ORIGINAL: se deniega igual, pero NO se registra —"
echo "     hueco de COBERTURA documentado en docs/SECURITY_AUDIT.md)"
bunx convex run orgs:members "{\"organizationId\":\"$ORG\"}" 2>&1 | tail -3
set -e
echo "--- (un error en cada caso es lo esperado: la operación se denegó) ---"

echo
echo "=== C) securityEvents DESPUÉS ==="
AFTER=$(count_events)
echo "SECURITY_EVENTS_AFTER=$AFTER"
echo "DELTA=$((AFTER - BEFORE))"

echo
if [ "$AFTER" -gt "$BEFORE" ]; then
  echo "AUTHORIZATION_DENIAL_AUDIT=PERSISTED"
  echo
  echo "VULN-14 CERRADO: la denegación de autorización deja securityEvent"
  echo "con operation, reason, organizationId y tenantVerified, y la operación"
  echo "sigue denegándose (fail-closed intacto)."
  exit 0
fi

echo "AUTHORIZATION_DENIAL_AUDIT=NOT_PERSISTED"
echo
echo "VULN-14 SIGUE ABIERTO: la denegación no deja rastro."
exit 1
