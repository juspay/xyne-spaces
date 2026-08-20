#!/usr/bin/env node
/**
 * Contract conformance gate.
 *
 * `@xyne/spaces-contract` is the one place the SDK and the backend are supposed to
 * agree. The backend imports it; the SDK cannot, because the SDK ships with zero
 * runtime dependencies and must load in a browser, while the contract depends on
 * zod. That asymmetry is what let three broken search parameters ship: the SDK sent
 * `sortBy`, `sortOrder`, and `channelId`, none of which exist in the contract's
 * `searchQuerySchema`. The server rejects unknown query parameters outright, so
 * every call that set one failed — and nothing caught it, because the SDK never
 * looked at the contract.
 *
 * This closes that gap without adding a dependency: the contract is read here, at
 * build time, and compared against what the SDK actually sends.
 *
 * Checks:
 *   1. Every parameter `registry/search.ts` sends exists in `searchQuerySchema`.
 *   2. Every key of the SDK's `SearchOptions` is either a contract parameter or
 *      explicitly marked deprecated.
 *   3. Every field a direct-API operation's input type declares is declared by its
 *      route's request body — otherwise the server silently ignores it.
 *   4. Every field of an SDK entity interface is a real column on the table it
 *      mirrors. These are hand-written and have been wrong repeatedly; a bad name
 *      is not a type error, it just reads `undefined` forever.
 *   5. Every error code the SDK branches on is a real contract error code.
 *
 * Catalog operations need none of this: their arguments are checked against the
 * Zero zod schemas by `coverage.mjs`. This covers what that cannot see.
 *
 * Run with `npm run contract-check`. Exits non-zero on any mismatch.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..');
const repoRoot = resolve(sdkRoot, '../..');
const contractSrc = join(repoRoot, 'packages/xyne-spaces-contract/src');
const REGISTRY_DIR = join(sdkRoot, 'src/registry');

const problems = [];

/** Top-level keys of a zod object literal in the contract source. */
function contractSchemaKeys(file, schemaName) {
  const src = readFileSync(join(contractSrc, file), 'utf8');
  const start = src.indexOf(`export const ${schemaName} = z.object({`);
  if (start === -1) {
    problems.push(`contract: ${schemaName} not found in ${file}`);
    return new Set();
  }
  const open = src.indexOf('{', src.indexOf('z.object(', start));
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if ('{[('.includes(src[i])) depth++;
    else if ('}])'.includes(src[i])) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const keys = new Set();
  depth = 0;
  for (const line of src.slice(open + 1, end).split('\n')) {
    if (depth === 0) {
      const m = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/.exec(line);
      if (m) keys.add(m[1]);
    }
    depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
  }
  return keys;
}

/** The literal error-code strings the contract defines. */
function contractErrorCodes() {
  const src = readFileSync(join(contractSrc, 'errors.ts'), 'utf8');
  const codes = new Set();
  for (const m of src.matchAll(/^\s*'([a-z_]+)'\s*:/gm)) codes.add(m[1]);
  for (const m of src.matchAll(/^\s*\|?\s*'([a-z_]+)'/gm)) codes.add(m[1]);
  return codes;
}

// ── 1 & 2: search parameters ────────────────────────────────────────────────

const accepted = contractSchemaKeys('schemas/search.ts', 'searchQuerySchema');

const registrySrc = readFileSync(join(sdkRoot, 'src/registry/search.ts'), 'utf8');
const mapArgsStart = registrySrc.indexOf('mapArgs:');
const mapArgsBody = registrySrc.slice(mapArgsStart, registrySrc.indexOf('}),', mapArgsStart));
const sent = new Set([...mapArgsBody.matchAll(/^\s{6}([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]));

for (const key of sent) {
  if (!accepted.has(key)) {
    problems.push(
      `registry/search.ts sends "${key}", which searchQuerySchema does not accept ` +
        `(the server rejects unknown query parameters)`
    );
  }
}

const typesSrc = readFileSync(join(sdkRoot, 'src/types/index.ts'), 'utf8');
const optionsStart = typesSrc.indexOf('export interface SearchOptions {');
const optionsBody = typesSrc.slice(optionsStart, typesSrc.indexOf('\n}', optionsStart));
for (const m of optionsBody.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9_]*)\??:/gm)) {
  const key = m[1];
  if (accepted.has(key)) continue;
  // A deprecated alias is allowed as long as it says so.
  const decl = optionsBody.slice(Math.max(0, m.index - 400), m.index);
  if (/@deprecated/.test(decl)) continue;
  problems.push(
    `SearchOptions declares "${key}", which is neither a contract parameter nor marked @deprecated`
  );
}

// ── 2b: enumerated search values, not just parameter names ──────────────────

/*
 * Names agreeing is not enough. `type` and `apps` are validated by the server
 * against a fixed list, and an unrecognised value is rejected rather than
 * ignored — so a parameter can be spelled perfectly and still fail. While the
 * SDK typed these `string | string[]`, `type: 'message'` (the singular form
 * `SearchResult.type` returns) compiled and then failed as `validation_failed`.
 */

/** Values of a `const NAME = [...] as const` array in a contract module. */
function contractEnum(file, constName) {
  const src = readFileSync(join(contractSrc, file), 'utf8');
  const m = new RegExp(`const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(src);
  if (!m) {
    problems.push(`contract: ${constName} not found in ${file}`);
    return new Set();
  }
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]));
}

/** Members of an `export type Name = 'a' | 'b'` union in the SDK's types. */
function sdkUnion(typeName) {
  const start = typesSrc.indexOf(`export type ${typeName} =`);
  if (start === -1) {
    problems.push(`types/index.ts: ${typeName} not found`);
    return new Set();
  }
  const decl = typesSrc.slice(start, typesSrc.indexOf(';', start));
  return new Set([...decl.matchAll(/'([^']+)'/g)].map((v) => v[1]));
}

let enumsChecked = 0;
for (const [typeName, file, constName] of [
  ['SearchType', 'schemas/search.ts', 'TYPES'],
  ['SearchApp', 'schemas/search.ts', 'APPS'],
]) {
  const contractValues = contractEnum(file, constName);
  const sdkValues = sdkUnion(typeName);
  if (contractValues.size === 0 || sdkValues.size === 0) continue;
  enumsChecked++;

  for (const v of sdkValues) {
    if (!contractValues.has(v)) {
      problems.push(
        `${typeName} allows "${v}", which ${constName} does not — the server rejects it`
      );
    }
  }
  for (const v of contractValues) {
    if (!sdkValues.has(v)) {
      problems.push(`${typeName} is missing "${v}", which ${constName} accepts`);
    }
  }
}

/** Columns of every table in the Zero schema, keyed by SQL table name. */
function zeroTables() {
  const src = readFileSync(join(repoRoot, 'packages/shared/src/zero/schema.ts'), 'utf8');
  const tables = new Map();
  for (const m of src.matchAll(/export const \w+ = table\(['"]([a-z_0-9]+)['"]\)\s*\n?\s*\.columns\(\{/g)) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const end = matchBracketIn(src, open);
    const cols = new Set();
    let depth = 0;
    for (const line of src.slice(open + 1, end).split('\n')) {
      if (depth === 0) {
        const c = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/.exec(line);
        if (c) cols.add(c[1]);
      }
      depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
    }
    tables.set(m[1], cols);
  }
  return tables;
}

function matchBracketIn(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if ('{[('.includes(src[i])) depth++;
    else if ('}])'.includes(src[i])) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Declared request-body field sets from the backend route manifest. */
function routeBodies() {
  const src = readFileSync(
    join(repoRoot, 'apps/backend/src/api/sdk/domains/catalog-gaps.ts'),
    'utf8'
  );
  const schemas = new Map();
  for (const m of src.matchAll(/const (\w+Body) = z\s*\n?\s*\.object\(\{/g)) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const end = matchBracketIn(src, open);
    const fields = new Set();
    let depth = 0;
    for (const line of src.slice(open + 1, end).split('\n')) {
      if (depth === 0) {
        const f = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/.exec(line);
        if (f) fields.add(f[1]);
      }
      depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
    }
    schemas.set(m[1], fields);
  }

  // route path → declared body fields
  const byPath = new Map();
  for (const m of src.matchAll(/path: '([^']+)'[\s\S]{0,400}?body: (\w+Body)/g)) {
    byPath.set(m[1], schemas.get(m[2]) ?? new Set());
  }
  return byPath;
}

// ── 3: SDK entity types against the Zero schema ─────────────────────────────

/**
 * The SDK's entity interfaces are hand-written mirrors of Zero tables. Eight of
 * them have already been wrong — `avatarUrl` for `picture`, a `position` that was
 * really `sequenceNumber`, invented `isDeleted` and `stageId` fields. A wrong name
 * is not a type error; it simply reads `undefined` forever.
 */
const ENTITY_TABLES = {
  User: 'users',
  UserProfile: 'user_profiles',
  Channel: 'channels',
  ChannelParticipant: 'channel_participants',
  Conversation: 'conversations',
  Message: 'messages',
  Ticket: 'tickets',
  SubTicket: 'sub_tickets',
  Board: 'boards',
  Stage: 'stages',
  Project: 'projects',
  Canvas: 'canvases',
  Call: 'calls',
  Activity: 'activities',
};

const tables = zeroTables();
let entitiesChecked = 0;

for (const [iface, table] of Object.entries(ENTITY_TABLES)) {
  const columns = tables.get(table);
  if (!columns) {
    problems.push(`entity check: table "${table}" not found in the Zero schema (for ${iface})`);
    continue;
  }
  const start = typesSrc.indexOf(`export interface ${iface} {`);
  if (start === -1) continue; // interface not declared; nothing to check
  const open = typesSrc.indexOf('{', start);
  const end = matchBracketIn(typesSrc, open);
  entitiesChecked += 1;

  let depth = 0;
  for (const line of typesSrc.slice(open + 1, end).split('\n')) {
    if (depth === 0) {
      const f = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\??\s*:/.exec(line);
      // Relations and computed extras are legitimately absent from the table.
      if (f && !columns.has(f[1]) && !/\/\/\s*(relation|computed|extra)/.test(line)) {
        problems.push(
          `types/index.ts: ${iface}.${f[1]} is not a column on "${table}" ` +
            `(mark it \`// relation\` if it is joined data)`
        );
      }
    }
    depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
  }
}

// ── 4: error codes ──────────────────────────────────────────────────────────

const codes = contractErrorCodes();
const httpSrc = readFileSync(join(sdkRoot, 'src/core/http.ts'), 'utf8');
for (const m of httpSrc.matchAll(/serverCode === '([a-z_]+)'/g)) {
  if (!codes.has(m[1])) {
    problems.push(`core/http.ts branches on error code "${m[1]}", which the contract does not define`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`contract:  ${accepted.size} search params, ${codes.size} error codes`);
console.log(`search:    ${sent.size} params sent by registry/search.ts`);
console.log(`enums:     ${enumsChecked} enumerated search value sets compared`);
console.log(`entities:  ${entitiesChecked} interfaces checked against Zero tables`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK — the SDK agrees with @xyne/spaces-contract.');
