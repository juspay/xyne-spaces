#!/usr/bin/env node
/**
 * Catalog coverage gate.
 *
 * The SDK's job is to expose the Zero operation catalog. This checks three
 * things that keep that claim honest:
 *
 *   1. Every operation the SDK references actually exists in the catalog.
 *      A typo here is a runtime failure that nothing else would catch — the
 *      registries are plain strings, so TypeScript cannot help.
 *   2. Every required argument of a mutator is supplied, either by its
 *      `mapArgs` or by the SDK-facing type. A missing one fails validation
 *      server-side, again with no compile-time signal.
 *   3. Every catalog operation is either referenced or listed in
 *      exclusions.json with a reason. This is what makes "complete" verifiable
 *      rather than aspirational: a new backend operation fails the build until
 *      someone decides to expose or exclude it.
 *
 * Run with `npm run coverage`. Exits non-zero on any failure.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..');
const repoRoot = resolve(sdkRoot, '../..');

const QUERIES = join(repoRoot, 'apps/backend/src/zero/queries.ts');
const MUTATORS = join(repoRoot, 'apps/backend/src/zero/mutators.ts');
const REGISTRY_DIR = join(sdkRoot, 'src/registry');
const EXCLUSIONS = join(sdkRoot, 'src/exclusions.json');

/** Catalog query names. */
function readQueries() {
  const src = readFileSync(QUERIES, 'utf8');
  return new Set([...src.matchAll(/^ {2}([a-zA-Z0-9_]+): defineQuery\(/gm)].map((m) => m[1]));
}

/**
 * Catalog mutator names and their required arguments.
 *
 * Required means "declared without .optional()" at the top level of the
 * mutator's zod object — nested object fields are the mutator's own business.
 */
function readMutators() {
  const src = readFileSync(MUTATORS, 'utf8');
  const body = src.slice(src.indexOf('return defineMutators({'));
  const lines = body.split('\n');

  const names = new Set();
  const required = new Map();
  let namespace = null;

  for (let i = 0; i < lines.length; i++) {
    const ns = /^ {4}([a-zA-Z][a-zA-Z0-9]*): \{/.exec(lines[i]);
    if (ns) {
      namespace = ns[1];
      continue;
    }
    const mut = /^\s{5,8}([a-zA-Z][a-zA-Z0-9]*): defineMutator\(/.exec(lines[i]);
    if (!mut || !namespace) continue;

    const full = `${namespace}.${mut[1]}`;
    names.add(full);

    // A comment may sit between the schema and the handler.
    const window = lines.slice(i, i + 50).join('\n');
    const schema = /z\.object\(\{([\s\S]*?)\}\)\s*,\s*(?:\/\/[^\n]*\n\s*)*async/.exec(window);
    if (!schema) continue;

    const fields = [];
    let depth = 0;
    for (const line of schema[1].split('\n')) {
      const field = /^([a-zA-Z][a-zA-Z0-9]*):/.exec(line.trim());
      if (field && depth === 0 && !line.includes('.optional()')) fields.push(field[1]);
      depth +=
        (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
    }
    required.set(full, fields);
  }
  return { names, required };
}

/** Operation names referenced by the registries, with their source positions. */
function readRegistryUsage() {
  const used = new Map();
  for (const file of readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.ts'))) {
    if (file === 'types.ts') continue;
    const src = readFileSync(join(REGISTRY_DIR, file), 'utf8');
    for (const m of src.matchAll(/\b(query|mutator)<[\s\S]*?>\(\s*\n?\s*'([^']+)'/g)) {
      used.set(m[2], { file, kind: m[1], src, index: m.index });
    }
  }
  return used;
}

const queries = readQueries();
const { names: mutators, required } = readMutators();
const used = readRegistryUsage();
const excluded = new Map(
  JSON.parse(readFileSync(EXCLUSIONS, 'utf8')).exclusions.map((e) => [e.name, e])
);

const problems = [];

// 1. Referenced operations must exist.
for (const [name, info] of used) {
  const pool = info.kind === 'query' ? queries : mutators;
  if (!pool.has(name)) {
    problems.push(`unknown ${info.kind} "${name}" referenced in registry/${info.file}`);
  }
}

// 2. Required mutator arguments must be supplied.
for (const [name, info] of used) {
  if (info.kind !== 'mutator' || !required.has(name)) continue;
  // Look at the generic parameters before the name and the mapArgs after it.
  const window = info.src
    .slice(Math.max(0, info.index - 700), info.index + 1400)
    .split('\n  },')[0];
  const missing = required
    .get(name)
    .filter((field) => !new RegExp(`\\b${field}\\b`).test(window));
  if (missing.length > 0) {
    problems.push(
      `mutator "${name}" (registry/${info.file}) never supplies required arg(s): ${missing.join(', ')}`
    );
  }
}

// 3. Every catalog operation is either used or excluded with a reason.
const unmapped = [];
for (const name of [...queries, ...mutators]) {
  if (used.has(name) || excluded.has(name)) continue;
  unmapped.push(name);
}
for (const name of unmapped) {
  problems.push(
    `catalog operation "${name}" is neither exposed nor listed in exclusions.json`
  );
}

// Exclusions must stay meaningful: no stale entries, no missing reasons.
for (const [name, entry] of excluded) {
  if (used.has(name)) {
    problems.push(`"${name}" is both exposed and excluded — remove it from exclusions.json`);
  } else if (!queries.has(name) && !mutators.has(name)) {
    problems.push(`"${name}" is excluded but no longer exists in the catalog`);
  } else if (!entry.reason || entry.reason === 'unclassified') {
    problems.push(`"${name}" is excluded without a reason`);
  }
}

const total = queries.size + mutators.size;
const exposed = [...used.keys()].filter((n) => queries.has(n) || mutators.has(n)).length;

console.log(`catalog:  ${queries.size} queries, ${mutators.size} mutators (${total} total)`);
console.log(`exposed:  ${exposed}`);
console.log(`excluded: ${excluded.size}`);
console.log(`accounted for: ${exposed + excluded.size}/${total}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK — every catalog operation is exposed or excluded with a reason.');
