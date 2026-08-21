/**
 * Build-time guard on everything this package hardcodes about the backend.
 *
 * The MCP server speaks HTTP to `/api/sdk` and takes no workspace dependency, so
 * nothing about it is type-checked against the server: catalog operation names
 * are strings, and the arguments sent with them are object literals. This script
 * is what makes that safe. It reads the real catalog and the real route table
 * and asserts four things:
 *
 *   1. every catalog operation a tool names still exists;
 *   2. every argument that operation *requires* is one the tool actually sends —
 *      `.nullable()` counts as required, `.optional()` and `.default()` do not;
 *   3. every direct route a tool calls is still mounted at that method and path;
 *   4. the search enums match the contract the server validates against.
 *
 * Check 2 is the one that earns its keep. Zero's optimistic-write model makes
 * operations demand arguments no human caller would think of — a required
 * `isMember`, a `start` that must be explicitly null, a caller-generated
 * `messageId` and `timestamp`. Getting one wrong produces
 * "Validation failed: Required, Required" at run time, naming neither the
 * operation nor the argument. This turns that into a build failure that names
 * both.
 *
 * The catalog parser is the SDK's, imported rather than copied: it has had four
 * separate bugs found in it, and a second copy would re-earn all of them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMutators, readQueries } from '../../xyne-spaces-sdk/scripts/catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');

const DIRECT_ROUTES = join(repoRoot, 'apps/backend/src/api/sdk/direct.ts');
const CONTRACT_SEARCH = join(repoRoot, 'packages/xyne-spaces-contract/src/schemas/search.ts');
const DIST = join(pkgRoot, 'dist/tools/index.js');

const problems = [];

// ── The tools, as they will actually run ────────────────────────────────────

let allTools;
try {
  ({ allTools } = await import(DIST));
} catch (err) {
  console.error(
    `Could not load ${DIST}.\n` +
      `Compile first: \`npx tsc\`, or run \`npm run build\`, which compiles and then checks.\n` +
      `(${err instanceof Error ? err.message : String(err)})`
  );
  process.exit(1);
}

// ── 1 & 2: catalog operations and their required arguments ──────────────────

const queries = readQueries();
const mutators = readMutators();

const knownNames = new Set([...queries.names, ...mutators.names]);
const requiredArgs = new Map([...queries.required, ...mutators.required]);

let operationsChecked = 0;

for (const tool of allTools) {
  for (const op of tool.catalog ?? []) {
    operationsChecked += 1;
    if (!knownNames.has(op.name)) {
      problems.push(`${tool.name}: catalog operation "${op.name}" does not exist in the Zero catalog`);
      continue;
    }
    const required = requiredArgs.get(op.name) ?? [];
    const sent = new Set(op.sends);
    const missing = required.filter((arg) => !sent.has(arg));
    if (missing.length > 0) {
      problems.push(
        `${tool.name}: "${op.name}" requires ${missing.map((m) => `\`${m}\``).join(', ')}, ` +
          `which the tool does not send (it sends: ${op.sends.length > 0 ? op.sends.join(', ') : 'nothing'})`
      );
    }
  }
}

// ── 3: direct routes ────────────────────────────────────────────────────────

/**
 * Route table entries in `direct.ts`, as `get /me`, `post /tickets`, …
 *
 * `method:` and `path:` are adjacent literal properties on every entry, so a
 * pairwise scan is enough; there is no nesting to get wrong.
 */
function readDirectRoutes() {
  const src = readFileSync(DIRECT_ROUTES, 'utf8');
  const routes = new Set();
  const methods = [...src.matchAll(/^\s*method:\s*'(get|post)',\s*$/gm)];
  for (const m of methods) {
    const after = src.slice(m.index + m[0].length);
    const path = /^\s*path:\s*'([^']+)',\s*$/m.exec(after.slice(0, 200));
    if (path) routes.add(`${m[1]} ${path[1]}`);
  }
  return routes;
}

const directRoutes = readDirectRoutes();
if (directRoutes.size === 0) {
  problems.push(`no routes could be read from ${DIRECT_ROUTES} — the route table's shape has changed`);
}

let routesChecked = 0;
for (const tool of allTools) {
  for (const route of tool.direct ?? []) {
    routesChecked += 1;
    const key = `${route.method} ${route.path}`;
    if (!directRoutes.has(key)) {
      problems.push(`${tool.name}: no direct route \`${key}\` is mounted in api/sdk/direct.ts`);
    }
  }
}

// ── 4: search enums against the contract ────────────────────────────────────

/** The string members of a `const NAME = [...] as const` array in the contract. */
function contractValues(src, name) {
  const decl = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(src);
  if (!decl) return null;
  return new Set([...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

const contractSrc = readFileSync(CONTRACT_SEARCH, 'utf8');
const searchTool = allTools.find((t) => t.name === 'spaces_search');

let enumsChecked = 0;
if (searchTool) {
  const enumChecks = [
    ['type', 'TYPES'],
    ['apps', 'APPS'],
  ];
  for (const [property, constName] of enumChecks) {
    const expected = contractValues(contractSrc, constName);
    if (!expected) {
      problems.push(`could not read \`${constName}\` from the contract's search schema`);
      continue;
    }
    const declared = searchTool.inputSchema?.properties?.[property]?.items?.enum;
    if (!Array.isArray(declared)) {
      problems.push(`spaces_search.${property} does not declare an enum — the server rejects unknown values`);
      continue;
    }
    enumsChecked += 1;
    const extra = declared.filter((v) => !expected.has(v));
    const absent = [...expected].filter((v) => !declared.includes(v));
    if (extra.length > 0) problems.push(`spaces_search.${property} offers ${extra.join(', ')}, which the server rejects`);
    if (absent.length > 0) problems.push(`spaces_search.${property} is missing ${absent.join(', ')}, which the server accepts`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`tools:      ${allTools.length}`);
console.log(`catalog:    ${operationsChecked} operation call(s) checked against ${knownNames.size} catalog operations`);
console.log(`direct:     ${routesChecked} route call(s) checked against ${directRoutes.size} mounted routes`);
console.log(`enums:      ${enumsChecked} search value set(s) compared with the contract`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK — every backend operation these tools name exists and accepts what they send.');
