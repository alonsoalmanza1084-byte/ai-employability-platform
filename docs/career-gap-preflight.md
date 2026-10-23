# Career Gap preflight

## Verification

- Base: `main` at `33a1eea4b2cb9fc808c3a0a333198c238ea2840a`
- Node.js: `v24.21.0`
- npm: `11.19.0`
- Vitest: `5.0.3`
- TypeScript: `5.9.3`
- `npx --no-install vitest run tests/unit/career_gap.test.ts`: passed, 22/22 tests
- `npx --no-install tsc --noEmit -p .`: passed

## Schema compatibility

`gapAnalyses.inputFingerprint` is an optional string. Existing records without
the field remain valid, so no migration is required. An absent fingerprint
identifies a stale cache entry; the analysis is regenerated. The unit tests
cover recalculation for historical records without a fingerprint.
