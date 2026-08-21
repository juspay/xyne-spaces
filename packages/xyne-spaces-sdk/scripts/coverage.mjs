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
 *   2. Every operation's arguments agree with its Zero schema: required ones are
 *      supplied, undeclared ones are not sent, and where the schema enumerates
 *      values the SDK's literal union lists exactly the same ones. Each of these
 *      fails validation server-side with no compile-time signal, because the
 *      registries reference operations by string.
 *   2c. A query's result shape (`.one()` vs a list) matches what the SDK declares.
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
import { matchBracket, readMutators, readQueries, skipTrivia } from './catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..');

const REGISTRY_DIR = join(sdkRoot, 'src/registry');
const EXCLUSIONS = join(sdkRoot, 'src/exclusions.json');

/** The SDK's shared type aliases, where most literal unions are declared. */
const sdkTypesSrc = readFileSync(join(sdkRoot, 'src/types/index.ts'), 'utf8');

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
 * The text between a registry entry's `<` and its matching `>`.
 *
 * Bracket-matched rather than regex-extracted. `info.generic` is the whole match,
 * which ends at the quoted operation name, so the `/<([\s\S]*)>\($/` this used to
 * rely on was anchored past the end of the generic and matched **0 of 458**
 * entries — silently disabling every check built on it.
 */
function genericText(info) {
  const open = info.generic.indexOf('<');
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < info.generic.length; i++) {
    const ch = info.generic[i];
    if (ch === '<') depth++;
    else if (ch === '>') {
      depth--;
      if (depth === 0) return info.generic.slice(open + 1, i);
    }
  }
  return null;
}

/** The first generic parameter of a registry entry — its SDK-facing input type. */
function inputTypeText(info) {
  const text = genericText(info);
  if (!text) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('<{[('.includes(ch)) depth++;
    else if ('>}])'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) return text.slice(0, i);
  }
  return text;
}

/**
 * The literal values an input type allows for `field`, or null when it does not
 * constrain them.
 *
 * Null covers `string`, `unknown`, and aliases that are not pure literal unions.
 * Those are looser than the server and so cannot be compared — a bare `string`
 * where the catalog enumerates is a latent version of this same bug, but it is a
 * design choice rather than a contradiction, so it is not failed here.
 */
function declaredValues(input, field, registrySrc) {
  const match = new RegExp(`(^|[{;\\n])\\s*${field}\\s*\\??\\s*:([^;\\n}]*)`).exec(input);
  if (!match) return null;
  const decl = match[2].trim().replace(/\[\]$/, '');

  const pure = (text) => {
    const values = [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const residue = text.replace(/'[^']*'/g, '').replace(/[|\s[\]]/g, '');
    return values.length > 0 && residue.length === 0 ? new Set(values) : null;
  };

  const inline = pure(decl);
  if (inline) return inline;

  const alias = /^([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(decl);
  if (!alias) return null;
  for (const src of [sdkTypesSrc, registrySrc]) {
    const aliasDecl = new RegExp(`export type ${alias[1]}\\s*=([^;]*);`).exec(src);
    if (aliasDecl) return pure(aliasDecl[1]);
  }
  return null;
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

/** Whether an entry reshapes its result, within its own call bounds. */
function hasMapResult(info) {
  if (info.argsEnd === -1) return false;
  return /\bmapResult\s*:/.test(info.src.slice(info.argsStart, info.argsEnd));
}

/** The declared result type — the generic's second parameter. */
function resultType(info) {
  const text = genericText(info);
  if (!text) return null;
  // Split on the top-level comma only; result types contain their own commas.
  let depth = 0;
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
  enums: queryEnums,
  single: singleRowQueries,
} = readQueries();
const {
  names: mutators,
  required: mutatorArgs,
  declared: mutatorDeclared,
  enums: mutatorEnums,
} = readMutators();

// One lookup for both kinds. Names cannot collide: mutators are namespaced.
const required = new Map([...queryArgs, ...mutatorArgs]);
const declaredArgs = new Map([...queryDeclared, ...mutatorDeclared]);
const enumeratedArgs = new Map([...queryEnums, ...mutatorEnums]);
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

// 2d. Where an argument enumerates its values, the SDK's literal union must list
//     exactly the same ones. A name can be spelled perfectly and still fail: the
//     server rejects an unrecognised enum value rather than ignoring it, the same
//     way it rejected `type: 'message'` in search. `StageRequestStatus` was
//     `'PENDING' | 'APPROVED' | 'REJECTED'` against a catalog enum of
//     `DRAFT | SUBMITTED | APPROVED | REJECTED`: `PENDING` always failed, and
//     raising a request at all was inexpressible.
let enumArgsChecked = 0;
for (const [name, info] of used) {
  const enums = enumeratedArgs.get(name);
  if (!enums) continue;
  const input = inputTypeText(info);
  if (!input) continue;

  for (const [field, allowed] of enums) {
    const sdkValues = declaredValues(input, field, info.src);
    if (!sdkValues) continue; // typed loosely or via a non-literal alias
    enumArgsChecked++;
    const extra = [...sdkValues].filter((v) => !allowed.has(v));
    const missing = [...allowed].filter((v) => !sdkValues.has(v));
    if (extra.length > 0) {
      problems.push(
        `${info.kind} "${name}" (registry/${info.file}) allows ${field}=${extra.join('|')}, ` +
          `which the catalog rejects (accepts ${[...allowed].join('|')})`
      );
    }
    if (missing.length > 0) {
      problems.push(
        `${info.kind} "${name}" (registry/${info.file}) cannot express ${field}=${missing.join('|')}, ` +
          `which the catalog accepts`
      );
    }
  }
}

// 2c. A query declared `.one()` returns a row or nothing; without it, a list.
//     The SDK states that in its result type, and a mismatch means every caller
//     is typed against the wrong shape. This check used a `$`-anchored regex to
//     read the result type, which matched 0 of 458 entries — so it silently passed
//     everything until the anchor was removed, at which point it found three
//     genuinely mis-shaped queries.
//
//     An entry with `mapResult` is exempt: reshaping is exactly what that hook is
//     for, so the declared type describes the mapped value, not the wire value.
let shapesChecked = 0;
for (const [name, info] of used) {
  if (info.kind !== 'query' || !queries.has(name)) continue;
  if (hasMapResult(info)) continue;
  const result = resultType(info);
  if (!result) continue;
  shapesChecked++;
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
console.log(
  `checked:  ${shapesChecked} result shapes, ${enumArgsChecked} enumerated arg value sets`
);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK — every catalog operation is exposed or excluded with a reason.');
