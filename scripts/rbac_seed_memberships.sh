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
# Uso: bash scripts/rbac_seed_memberships.sh
# ============================================================================
set -euo pipefail

MANIFEST="${MANIFEST:-/tmp/tf/rbac-manifest.json}"
OUT="${OUT:-/tmp/tf/organizationMembers.seed.jsonl}"

[ -f "$MANIFEST" ] || { echo "FALLO: falta el manifiesto $MANIFEST"; exit 1; }

ORG_ID=$(node -e 'const m=require(process.argv[1]);console.log(m.orgId)' "$MANIFEST")
RECRUITER=$(node -e 'const m=require(process.argv[1]);console.log(m.actors.recruiter.userId)' "$MANIFEST")
MANAGER=$(node -e 'const m=require(process.argv[1]);console.log(m.actors.hiring_manager.userId)' "$MANIFEST")

echo "sembrando membresías en la organización $ORG_ID"

cat > "$OUT" <<EOF
{"organizationId":"$ORG_ID","userId":"$RECRUITER","role":"recruiter"}
{"organizationId":"$ORG_ID","userId":"$MANAGER","role":"hiring_manager"}
EOF

echo "--- $OUT ---"
cat "$OUT"

bunx convex import --table organizationMembers --append -y "$OUT"

echo "MEMBERSHIPS_SEEDED=2"