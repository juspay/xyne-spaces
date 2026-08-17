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

/**
 * Index of the closing bracket matching the opener at `open`.
 *
 * Brace-balanced rather than regex: a zod schema nests objects and arrays freely,
 * and a lazy `[\s\S]*?` stops at the first `})` it sees, which is usually inside
 * the schema rather than at its end.
 */
function matchBracket(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Required top-level argument names for a `defineQuery(` / `defineMutator(` whose
 * opening paren is at `open`.
 *
 * Returns null when the operation declares no inline `z.object({…})` schema — a
 * no-argument operation, or one built from a named schema constant. Those cannot be
 * checked here and must not be guessed at.
 *
 * Required means "not `.optional()`". The whole field span is inspected, not just
 * its first line, so a modifier chain broken across lines is still seen.
 */
function readRequiredArgs(src, open) {
  // Skip whitespace and comments between the paren and the schema.
  let i = open + 1;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('//', i)) {
      i = src.indexOf('\n', i) + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      i = src.indexOf('*/', i) + 2;
      continue;
    }
    break;
  }
  if (!src.startsWith('z.object(', i)) return null;

  const brace = src.indexOf('{', i);
  const end = matchBracket(src, brace);
  if (brace === -1 || end === -1) return null;

  /*
   * Split into top-level fields by scanning characters, not lines.
   *
   * A line-based split silently misses every field after the first on a shared
   * line — `z.object({ callId: z.string(), notesCanvasId: z.string() })` looked
   * like a one-field schema, which made the checks below report arguments as
   * unaccepted when they were declared perfectly well.
   */
  // Comments must go first: prose like `// pagination is optional: ...` contains
  // `word:` at depth 0 and would be read as a field name.
  const body = src
    .slice(brace + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const fields = [];
  let depth = 0;
  let fieldStart = 0;
  let name = null;

  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (i === body.length || (ch === ',' && depth === 0)) {
      if (name) fields.push({ name, text: body.slice(fieldStart, i) });
      name = null;
      fieldStart = i + 1;
      continue;
    }
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    else if (depth === 0 && name === null) {
      const rest = body.slice(i);
      const m = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/.exec(rest);
      if (m) {
        name = m[1];
        i += m[0].length - 1;
      }
    }
  }

  return {
    required: fields.filter((f) => !f.text.includes('.optional()')).map((f) => f.name),
    all: fields.map((f) => f.name),
  };
}

/**
 * Catalog query names, their arguments, and whether each returns a single row.
 *
 * `.one()` in the query body is what decides single-vs-list. The SDK declares that
 * as `X | null` or `X[]`, and nothing else verifies the two agree.
 */
function readQueries() {
  const src = readFileSync(QUERIES, 'utf8');
  const names = new Set();
  const required = new Map();
  const declared = new Map();
  const single = new Set();

  const matches = [...src.matchAll(/^ {2}([a-zA-Z0-9_]+): defineQuery\(/gm)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    names.add(m[1]);
    const args = readRequiredArgs(src, m.index + m[0].length - 1);
    if (args) {
      required.set(m[1], args.required);
      declared.set(m[1], new Set(args.all));
    }
    // Body runs to the start of the next operation.
    const bodyEnd = matches[i + 1]?.index ?? src.length;
    if (/\.one\(\)/.test(src.slice(m.index, bodyEnd))) single.add(m[1]);
  }
  return { names, required, declared, single };
}

/** Catalog mutator names and their required arguments. */
function readMutators() {
  const src = readFileSync(MUTATORS, 'utf8');
  const offset = src.indexOf('return defineMutators({');
  const body = src.slice(offset);
  const lines = body.split('\n');

  const names = new Set();
  const required = new Map();
  const declared = new Map();
  let namespace = null;
  let cursor = 0; // char offset of the current line within `body`

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ns = /^ {4}([a-zA-Z][a-zA-Z0-9]*): \{/.exec(line);
    if (ns) namespace = ns[1];

    const mut = /^\s{5,8}([a-zA-Z][a-zA-Z0-9]*): defineMutator\(/.exec(line);
    if (mut && namespace) {
      const full = `${namespace}.${mut[1]}`;
      names.add(full);
      const args = readRequiredArgs(body, cursor + mut[0].length - 1);
      if (args) {
        required.set(full, args.required);
        declared.set(full, new Set(args.all));
      }
    }
    cursor += line.length + 1;
  }
  return { names, required, declared };
}

/** Operation names referenced by the registries, with their source positions. */
function readRegistryUsage() {
  const used = new Map();
  for (const file of readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.ts'))) {
    if (file === 'types.ts') continue;
    const src = readFileSync(join(REGISTRY_DIR, file), 'utf8');
    for (const m of src.matchAll(/\b(query|mutator)<[\s\S]*?>\(\s*\n?\s*'([^']+)'/g)) {
      // Bound each entry to its own call. Without this, an entry with no `mapArgs`
      // reads the `mapArgs` of whichever operation happens to follow it.
      const callOpen = m.index + m[0].lastIndexOf('(');
      used.set(m[2], {
        file,
        kind: m[1],
        src,
        index: m.index,
        generic: m[0],
        argsStart: m.index + m[0].length,
        argsEnd: matchBracket(src, callOpen),
      });
    }
  }
  return used;
}

/**
 * The argument names an entry actually sends, or null when that cannot be decided.
 *
 * This looks at the `mapArgs` return object specifically, rather than searching the
 * surrounding text for the field name. Searching text passes as soon as the name
 * appears anywhere — including in the TypeScript generic and in JSDoc — so an entry
 * that declares `direction?: 'forward'` in its type but forgets it in `mapArgs`
 * would look fine while failing at runtime.
 *
 * With no `mapArgs`, args are forwarded verbatim, so the entry's own type is the
 * contract and its declared property names are what gets sent.
 */
function suppliedArgs(info) {
  if (info.argsEnd === -1) return null;
  const tail = info.src.slice(info.argsStart, info.argsEnd);

  const mapArgs = /mapArgs:\s*\([^)]*\)\s*=>\s*\(?\s*\{/.exec(tail);
  if (mapArgs) {
    const brace = info.argsStart + mapArgs.index + mapArgs[0].length - 1;
    const end = matchBracket(info.src, brace);
    if (end === -1) return null;
    const body = info.src.slice(brace + 1, end);

    // A bare `...args` forwards everything, so nothing can be proven missing.
    if (/\.\.\.\s*args\b/.test(body)) return null;

    // Character scan, for the same reason the declared-field parser uses one: a
    // line-based pass reads `updates: { role: … }` as supplying `role` at the top
    // level, and then reports a correctly-nested argument as unaccepted.
    return topLevelKeys(body);
  }

  // No mapArgs: args are forwarded verbatim, so the entry's own generic is the
  // contract. Read it from the matched text, which is exactly this entry.
  const generic = /<([\s\S]*)>\(/.exec(info.generic);
  if (!generic) return null;
  const keys = new Set();
  for (const k of generic[1].matchAll(/([a-zA-Z][a-zA-Z0-9_]*)\s*\??\s*:/g)) keys.add(k[1]);
  return keys;
}


/**
 * Keys at the top level of an object literal body, ignoring nested ones.
 *
 * Also recognises `...(args.foo ? { foo } : {})`, which supplies `foo`
 * conditionally, and bails on nothing — callers decide what a missing key means.
 */
function topLevelKeys(body) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const keys = new Set();
  let depth = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    else if (depth === 0) {
      const m = /^([a-zA-Z][a-zA-Z0-9_]*)\s*:/.exec(clean.slice(i));
      if (m && !/[a-zA-Z0-9_.]/.test(clean[i - 1] ?? '')) {
        keys.add(m[1]);
        i += m[0].length - 1;
      }
    }
  }
  // Conditional spreads live one level down but do supply their key.
  for (const m of clean.matchAll(/\?\s*\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*[:}]/g)) keys.add(m[1]);
  return keys;
}

/** The declared result type — the generic's second parameter. */
function resultType(info) {
  const generic = /<([\s\S]*)>\($/.exec(info.generic);
  if (!generic) return null;
  // Split on the top-level comma only; result types contain their own commas.
  let depth = 0;
  const text = generic[1];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('<{[('.includes(ch)) depth++;
    else if ('>}])'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) return text.slice(i + 1).trim();
  }
  return null;
}

const {
  names: queries,
  required: queryArgs,
  declared: queryDeclared,
  single: singleRowQueries,
} = readQueries();
const { names: mutators, required: mutatorArgs, declared: mutatorDeclared } = readMutators();

// One lookup for both kinds. Names cannot collide: mutators are namespaced.
const required = new Map([...queryArgs, ...mutatorArgs]);
const declaredArgs = new Map([...queryDeclared, ...mutatorDeclared]);
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

// 2. Required arguments must be supplied — for queries as well as mutators. A
//    missing one fails zod validation server-side with no compile-time signal,
//    since the registries reference operations by string.
for (const [name, info] of used) {
  if (!required.has(name)) continue;
  const supplied = suppliedArgs(info);
  if (!supplied) continue; // opaque entry — cannot decide, so do not guess
  const missing = required.get(name).filter((field) => !supplied.has(field));
  if (missing.length > 0) {
    problems.push(
      `${info.kind} "${name}" (registry/${info.file}) never supplies required arg(s): ${missing.join(', ')}`
    );
  }
}

// 2b. Nothing may send an argument the operation does not declare.
//     Zod strips unknown keys silently, so a removed or renamed backend argument
//     leaves the SDK sending a field that is quietly discarded — the call still
//     "succeeds" while doing less than the caller asked for.
for (const [name, info] of used) {
  const accepts = declaredArgs.get(name);
  if (!accepts) continue;
  const supplied = suppliedArgs(info);
  if (!supplied) continue;
  const extra = [...supplied].filter((field) => !accepts.has(field));
  if (extra.length > 0) {
    problems.push(
      `${info.kind} "${name}" (registry/${info.file}) sends arg(s) it does not accept: ` +
        `${extra.join(', ')}`
    );
  }
}

// 2c. A query declared `.one()` returns a row or nothing; without it, a list.
//     The SDK states that in its result type, and a mismatch means every caller
//     is typed against the wrong shape.
for (const [name, info] of used) {
  if (info.kind !== 'query' || !queries.has(name)) continue;
  const result = resultType(info);
  if (!result) continue;
  const isSingle = singleRowQueries.has(name);
  const looksList = /\[\]\s*$/.test(result);
  const looksNullable = /\|\s*(null|undefined)\s*$/.test(result);

  if (isSingle && looksList) {
    problems.push(
      `query "${name}" (registry/${info.file}) returns one row (.one()) but the SDK ` +
        `declares "${result}"`
    );
  } else if (!isSingle && looksNullable && !looksList) {
    problems.push(
      `query "${name}" (registry/${info.file}) returns a list but the SDK declares ` +
        `"${result}"`
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
