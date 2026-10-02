#!/usr/bin/env bash
# =============================================================================
# BLOCKER D (fase 2) — Siembra de membresías por IMPORTACIÓN DE DATOS.
#
# `acceptInvite` exige una cuenta con email verificado, imposible de crear en CI
# (los usuarios de test son anónimos). Para poder ejecutar la matriz RBAC
# END-TO-END con sesiones reales, sembramos las filas de `organizationMembers`
# directamente en la base de datos — el mismo mecanismo que usa un restore.
#
# Esto NO añade ningún endpoint, bypass ni SuperPoder al código de producción:
# es preparación de fixtures, equivalente a lo que hace `seed` en cualquier
# plataforma. La autorización que se verifica después (`requireMembership`) es
# exactamente la que corre en producción, sin mocks.
#
# El flujo de invitación (`invite` → `acceptInvite`) se verifica por SEPARADO en
# tests/unit/invitations.security.test.ts y en security.integration.test.ts.
#
# IDEMPOTENTE: el índice `by_org_user` no es único en Convex, así que un import
# a ciegas sobre una org que YA tiene membresías crearía filas duplicadas para
# el mismo par (org, usuario). Con duplicados, `removeMember` históricamente
# borraba solo la primera fila y la revocación quedaba incompleta: la siembra
# no debe ser capaz de provocar ese estado.
#
# Uso: bash scripts/rbac_seed_memberships.sh
# =============================================================================
set -euo pipefail

MANIFEST="${MANIFEST:-/tmp/tf/rbac-manifest.json}"
OUT="${OUT:-/tmp/tf/organizationMembers.seed.jsonl}"

[ -f "$MANIFEST" ] || { echo "FALLO: falta el manifiesto $MANIFEST"; exit 1; }

ORG_ID=$(node -e 'const m=require(process.argv[1]);console.log(m.orgId)' "$MANIFEST")
RECRUITER=$(node -e 'const m=require(process.argv[1]);console.log(m.actors.recruiter.userId)' "$MANIFEST")
MANAGER=$(node -e 'const m=require(process.argv[1]);console.log(m.actors.hiring_manager.userId)' "$MANIFEST")

echo "sembrando membresías en la organización $ORG_ID"

# Se lee con --limit 10000 porque sin él `convex data` solo devuelve las 100
# filas más recientes (trampa de medición ya documentada en OPERATIONS §6).
EXISTING=$(bunx convex data organizationMembers --limit 10000 2>/dev/null || true)

has_row() {
  printf '%s\n' "$EXISTING" | grep -F "$ORG_ID" | grep -F "$1" >/dev/null 2>&1
}

: > "$OUT"
SEEDED=0
for spec in "$RECRUITER:recruiter" "$MANAGER:hiring_manager"; do
  MEMBER_ID=${spec%%:*}
  MEMBER_ROLE=${spec##*:}
  if has_row "$MEMBER_ID"; then
    echo "ya existe membresía $MEMBER_ROLE para $MEMBER_ID (se omite)"
    continue
  fi
  printf '{"organizationId":"%s","userId":"%s","role":"%s"}\n' \
    "$ORG_ID" "$MEMBER_ID" "$MEMBER_ROLE" >> "$OUT"
  SEEDED=$((SEEDED + 1))
done

if [ "$SEEDED" -eq 0 ]; then
  echo "MEMBERSHIPS_SEEDED=0 (ya estaban sembradas)"
  exit 0
fi

echo "--- $OUT ---"
cat "$OUT"

bunx convex import --table organizationMembers --append -y "$OUT"

echo "MEMBERSHIPS_SEEDED=$SEEDED"
