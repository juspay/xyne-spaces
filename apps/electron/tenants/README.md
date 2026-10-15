# Tenant configuration

One JSON file per internal deployment domain. `scripts/select-tenant.mjs <name>`
bakes exactly one of them into a build; `make electron-build-* ELECTRON_TENANT=<name>`
is the entry point CI uses. See `docs/electron-distribution.md` §3.

**This repo carries only `example.json`.** Real tenant files live in the private
infra repo at the same path and arrive through the public overlay, which copies
in only files the private tree does not already have — so a private
`tenants/acme.json` is never shadowed by anything here.

## File shape

A flat object of `AppConfig` overrides (`src/app/config.ts`). State only what
differs from the channel default; every key is optional:

```json
{
  "BACKEND_URL": "https://app.spaces.acme.com",
  "CA_CERT_FILE": "ca.acme.cert",
  "window": { "title": "Acme Spaces" }
}
```

Validation is tsc's job. `select-tenant.mjs` writes `src/app/tenant.active.ts`
typed as `TenantConfig`, so a misspelled key (`BACKEND_UR`) or a wrong type
(`"enableMtls": "yes"`) fails the build, with `AppConfig` as the one definition
of the shape. No separate schema to keep in sync.

## What belongs here, and what does not

| Field | Owner | Why |
|---|---|---|
| `BACKEND_URL`, `MTLS_*`, `FRONTEND_URL`, `CLAW_AUTH_URL` | tenant | the deployment's hostnames |
| `UI_ZIP_URL`, `RELEASE_CONFIG_URL` | tenant | each deployment serves its own UI bundle |
| `CA_CERT_FILE` | tenant | an internal deployment sits behind its own private CA |
| `window.title`, `APP_NAME` | tenant | user-visible naming |
| `enableMtls`, `sendLogs`, `enableOtelMetrics` | tenant | per-deployment posture |
| `APP_ID`, `DEEP_LINK_PROTOCOL`, `USER_DATA_SUFFIX` | **channel** | inside the code signature and the MDM package identity; changing these per tenant breaks upgrades over an existing install |

A tenant that genuinely needs its own bundle identity is a separate build
config, not a tenant file.

## Adding a domain

1. Add `tenants/<domain>.json` **in the private repo**.
2. Add its private CA root at `certs/ca.<domain>.cert` in the private repo, and
   point `CA_CERT_FILE` at that basename. `certs` is already in the
   electron-builder `files` list, so it ships.
3. Run the pipeline with `ELECTRON_TENANT=<domain>`.

The name must match `^[a-z0-9][a-z0-9-]*$` — it is used as a filename.
