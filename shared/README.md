# Temporary mirror of `packages/shared` — do not edit

This top-level `shared/` is a copy of `packages/shared` at tag
`v1.318.0-release-20260915.4` (`31feca08b`), for the private mobile app pilot,
which bootstraps `@xyne/shared` from a flat `shared/` with `npm ci`.

Differences from `packages/shared`:
- `prepare` uses `npm run build` (npm consumers have no pnpm).
- Dependency versions pinned exactly to what `pnpm-lock.yaml` resolves.
- Added `package-lock.json`.

Canonical source is `packages/shared`. Make changes there, never here.
