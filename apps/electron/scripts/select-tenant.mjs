#!/usr/bin/env node
/**
 * Bake one tenant's configuration into the build.
 *
 *   node scripts/select-tenant.mjs            # untenanted: channel defaults only
 *   node scripts/select-tenant.mjs acme       # overlay tenants/acme.json
 *
 * Reads `tenants/<name>.json` and writes `src/app/tenant.active.ts`, which
 * src/app/config.ts picks up as the middle layer of its precedence chain
 * (channel default -> tenant -> environment).
 *
 * The generated module is git-ignored and holds exactly one tenant, so no
 * artifact ever carries another deployment's hostnames. Validation is
 * deliberately left to tsc: the generated file is typed `TenantConfig`, derived
 * from `AppConfig`, so a misspelled or wrongly typed key fails the compile with
 * the interface as the single source of truth. This script only checks what a
 * type cannot see — that the file exists, parses, and is a flat JSON object.
 *
 * Real tenant files live in the private repo and arrive through the public
 * overlay; this repo carries only tenants/example.json. See
 * docs/electron-distribution.md §3.
 */

import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tenantsDir = join(appDir, 'tenants');
const generatedFile = join(appDir, 'src', 'app', 'tenant.active.ts');

// tsc never deletes output for a source file that has gone away, so clearing
// only the .ts would leave dist/app/tenant.active.js behind and config.js would
// keep requiring it — an "untenanted" rebuild in a reused workspace would
// silently ship the previous tenant's hostnames. Clear the emitted files too,
// on every run, and let tsc re-emit them when a tenant is selected.
const emittedFiles = ['js', 'js.map', 'd.ts', 'd.ts.map'].map((ext) =>
  join(appDir, 'dist', 'app', `tenant.active.${ext}`),
);

function clearGenerated() {
  for (const file of [generatedFile, ...emittedFiles]) {
    rmSync(file, { force: true });
  }
}

/** Tenant names are used as filenames and must not escape tenantsDir. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`[select-tenant] ${message}`);
  process.exit(1);
}

function availableTenants() {
  if (!existsSync(tenantsDir)) return [];
  return readdirSync(tenantsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

const name = (process.argv[2] ?? '').trim();

if (!name) {
  // Untenanted build. Remove rather than stub out: config.ts treats a missing
  // module as "no tenant", and removing it also clears a selection left behind
  // by a previous build in the same workspace.
  clearGenerated();
  console.log('[select-tenant] no tenant selected — using channel defaults from src/app/config.ts');
  process.exit(0);
}

if (!NAME_PATTERN.test(name)) {
  fail(`invalid tenant name '${name}' — expected lowercase letters, digits and hyphens`);
}

const tenantFile = join(tenantsDir, `${name}.json`);
if (!existsSync(tenantFile)) {
  const available = availableTenants();
  fail(
    `no such tenant '${name}' (looked for ${tenantFile})\n` +
      (available.length
        ? `              available: ${available.join(', ')}`
        : '              this tree carries no tenant files; real ones come from the private overlay'),
  );
}

let overrides;
try {
  overrides = JSON.parse(readFileSync(tenantFile, 'utf8'));
} catch (error) {
  fail(`${tenantFile} is not valid JSON: ${error.message}`);
}

if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
  fail(`${tenantFile} must contain a JSON object of AppConfig overrides`);
}
if (Object.keys(overrides).length === 0) {
  fail(`${tenantFile} is empty — remove it, or omit the tenant name for a default build`);
}

const banner = [
  '// GENERATED FILE — DO NOT EDIT, DO NOT COMMIT.',
  `// Written by apps/electron/scripts/select-tenant.mjs from tenants/${name}.json.`,
  '//',
  '// Consumed by src/app/config.ts, which overlays these values on the channel',
  '// defaults. Typed as TenantConfig so tsc validates the tenant data against the',
  '// AppConfig interface.',
].join('\n');

const body = [
  banner,
  '',
  "import type { TenantConfig } from './config';",
  '',
  `export const tenantName = ${JSON.stringify(name)};`,
  '',
  `export const tenant: TenantConfig = ${JSON.stringify(overrides, null, 2)};`,
  '',
].join('\n');

clearGenerated();
writeFileSync(generatedFile, body);
console.log(
  `[select-tenant] tenant '${name}' baked in — ${Object.keys(overrides).length} override(s) ` +
    `from tenants/${name}.json`,
);
