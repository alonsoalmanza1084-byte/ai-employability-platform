#!/usr/bin/env bash
# =============================================================================
# Cadena E2E completa de autorización con una ORG FRESCA por ejecución.
#
# Por qué existe:
#   1. `tests/integration/rbac.seed.integration.test.ts` crea una organización
#      NUEVA cada vez, con lo que los contadores de cuota de producción
#      (`LIMITS.jobCreatePerDay = 20` por usuario+org y día) vuelven a 0. Si se
#      re-ejecuta la matriz varias veces sobre el MISMO manifiesto, la cuota se
#      agota y `jobs.create` empieza a fallar para org_admin — es el límite de
#      producción haciendo su trabajo, NO una regresión de autorización.
#   2. Deja las membresías en un estado inicial conocido, de modo que la matriz
#      RBAC y el test VULN-14 sean independientes entre sí y del orden.
#
# Uso: bash scripts/rbac_e2e.sh
# Salida esperada: RBAC_E2E=PASS
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== fase 1: identidades + org fresca =="
bunx vitest run tests/integration/rbac.seed.integration.test.ts

echo "== fase 2: membresías (idempotente) =="
bash scripts/rbac_seed_memberships.sh

echo "== fase 3: matriz RBAC end-to-end (18) =="
bunx vitest run tests/integration/rbac.matrix.integration.test.ts

echo "== fase 4: auditoría de denegaciones VULN-14 (25) =="
bunx vitest run tests/integration/vuln14.denial.audit.integration.test.ts

echo "RBAC_E2E=PASS"
