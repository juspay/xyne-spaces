/**
 * Reader for the Zero catalog.
 *
 * Parses `apps/backend/src/zero/queries.ts` and `mutators.ts` into operation
 * names and their argument schemas. Two gates depend on this: the SDK's
 * `coverage.mjs`, which checks that every operation is exposed or excluded with
 * a reason, and `xyne-spaces-mcp`'s `check-operations.mjs`, which checks that
 * the operations its tools name still exist and still take the arguments those
 * tools send.
 *
 * Parsing rather than importing, because the catalog cannot be loaded outside
 * the backend's runtime: `queries.ts` pulls in `@rocicorp/zero` internals and a
 * live schema. Everything here is therefore character-scanning and
 * bracket-matching over source text, never a regex spanning a construct — four
 * separate bugs in this file came from regexes that looked right and matched
 * nothing.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const QUERIES = join(repoRoot, 'apps/backend/src/zero/queries.ts');
const MUTATORS = join(repoRoot, 'apps/backend/src/zero/mutators.ts');

/**
 * Index of the closing bracket matching the opener at `open`.
 *
 * Brace-balanced rather than regex: a zod schema nests objects and arrays freely,
 * and a lazy `[\s\S]*?` stops at the first `})` it sees, which is usually inside
 * the schema rather than at its end.
 */
export function matchBracket(src, open) {
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
 * Whether a field declaration is optional at its own level.
 *
 * Testing the raw text for `.optional()` is wrong, because a field's text
 * includes its nested schemas: `attachments: z.array(z.object({ width:
 * z.number().optional() }))` is **required**, but contains `.optional()` from a
 * property two levels down. Five catalog mutators are written that way, and each
 * read as optional — so the gate never checked that the SDK supplied them. It
 * happens that all five are supplied, which is luck rather than verification.
 *
 * Dropping the contents of every nested bracket group leaves only the field's own
 * modifier chain, which is what decides requiredness.
 */
export function isOptionalField(text) {
  let outer = '';
  let depth = 0;
  for (const ch of text) {
    if ('{[('.includes(ch)) {
      depth++;
      if (depth === 1) outer += ch;
      continue;
    }
    if ('}])'.includes(ch)) {
      depth--;
      if (depth === 0) outer += ch;
      continue;
    }
    if (depth === 0) outer += ch;
  }
  // `.default(x)` also makes an argument omissible on input, even without
  // `.optional()`.
  return /\.optional\(\)|\.default\(\)/.test(outer);
}

/** Calls whose callback shapes a *relation*, not the query being returned. */
const RELATION_CALLS = new Set(['related', 'exists', 'whereExists']);

/**
 * Whether a query returns a single row — `.one()` on the query it returns.
 *
 * Nesting is the whole difficulty. `applicationReleaseTicketsByReleaseId` returns
 * a list but calls `.one()` inside `.related('devTicket', q => q.one()…)` to
 * collapse a relation; testing the body for `.one()` anywhere reads that as a
 * single-row query and reports the SDK's correct `unknown[]` as a bug. Bracket
 * depth alone does not separate the two either, because a handler written
 * `({ ctx }) => { return … }` puts its statements one level deeper than one
 * written `({ ctx }) => zql.…`.
 *
 * So track which call each `.one()` sits inside: one enclosed by a relation
 * callback shapes that relation, and any other is the query's own.
 */
export function hasTopLevelOne(body) {
  const enclosing = [];
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('.one()', i)) {
      if (!enclosing.some((name) => RELATION_CALLS.has(name))) return true;
      i += 5;
      continue;
    }
    const ch = body[i];
    if (ch === '(') {
      const callee = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(body.slice(Math.max(0, i - 40), i));
      enclosing.push(callee ? callee[1] : '');
    } else if (ch === ')') {
      enclosing.pop();
    }
  }
  return false;
}

/** First index at or after `i` that is neither whitespace nor a comment. */
export function skipTrivia(src, i) {
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
    return i;
  }
}

/**
 * Top-level fields of an object literal whose `{` is at `brace`.
 *
 * Split by scanning characters, not lines: a line-based split silently misses
 * every field after the first on a shared line — `z.object({ callId: z.string(),
 * notesCanvasId: z.string() })` looked like a one-field schema, which made the
 * checks below report arguments as unaccepted when they were declared fine.
 *
 * `spreads` collects `...identifier` entries so the caller can decide whether it
 * managed to resolve them; an unresolved spread means the field list is a subset
 * of the truth, not the truth.
 */
export function objectFields(src, brace) {
  const end = matchBracket(src, brace);
  if (end === -1) return null;

  // Comments must go first: prose like `// pagination is optional: ...` contains
  // `word:` at depth 0 and would be read as a field name.
  const body = src
    .slice(brace + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const fields = [];
  const spreads = [];
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
      const spread = /^\.\.\.\s*([a-zA-Z][a-zA-Z0-9_]*)/.exec(rest);
      if (spread) {
        spreads.push(spread[1]);
        i += spread[0].length - 1;
        continue;
      }
      const m = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/.exec(rest);
      if (m) {
        name = m[1];
        i += m[0].length - 1;
      }
    }
  }

  return { fields, spreads, end };
}

/**
 * Required top-level argument names for a `defineQuery(` / `defineMutator(` whose
 * opening paren is at `open`.
 *
 * Returns null when the operation declares no argument schema at all — the
 * handler follows the paren directly. Those are no-argument operations.
 *
 * A schema is resolved through three forms, because the catalog uses all three:
 *
 *   - `z.object({…})` inline, the common case;
 *   - a named constant in the same file (`kanbanTicketsPageV2ArgsSchema`);
 *   - `.extend({…})` chains on either of the above.
 *
 * Resolving named constants is not cosmetic. While this returned null for them,
 * `kanbanTicketsPageV2` — whose schema is a constant built by `.extend()` — was
 * skipped entirely, and the SDK shipped a `tickets.listKanban` that omitted two
 * required arguments and sent five that the schema does not declare. The gate
 * reported OK the whole time.
 *
 * `partial: true` marks a field list known to be incomplete: a spread or base
 * schema that could not be resolved (it lives in another module). A partial list
 * can only under-report, so requiredness is still worth checking against it,
 * while the "argument is not accepted" check must be skipped to avoid claiming a
 * field is undeclared when the checker simply never saw its declaration.
 *
 * Requiredness is decided by `isOptionalField`, which looks only at the field's
 * own modifier chain. The whole field span is inspected, not just its first line,
 * so a chain broken across lines is still seen.
 */
export function readRequiredArgs(src, open, depth = 0) {
  const schema = readSchemaFields(src, open, depth);
  if (!schema) return null;
  const { fields, partial } = schema;
  if (fields.length === 0 && !partial) return null;

  const enums = new Map();
  for (const f of fields) {
    const values = enumeratedValues(f.text);
    if (values) enums.set(f.name, values);
  }

  return {
    required: fields.filter((f) => !isOptionalField(f.text)).map((f) => f.name),
    all: fields.map((f) => f.name),
    enums,
    partial,
  };
}

/**
 * The resolved field list of the schema expression starting just past `open`.
 *
 * Returns `{ fields, partial }`, where each field carries its source text so the
 * caller can test `.optional()`. Recursion happens here rather than in
 * `readRequiredArgs` so an alias chain passes fields along, not just their names.
 */
export function readSchemaFields(src, open, depth = 0) {
  if (depth > 8) return null; // cyclic or pathological alias chain
  let i = skipTrivia(src, open + 1);

  let partial = false;
  const seen = new Map();

  const absorb = (list) => {
    for (const f of list) seen.set(f.name, f); // later wins: `.extend()` overrides
  };

  if (src.startsWith('z.object(', i)) {
    const brace = src.indexOf('{', i);
    const parsed = objectFields(src, brace);
    if (!parsed) return null;
    absorb(parsed.fields);
    for (const name of parsed.spreads) {
      const resolved = resolveShapeConst(src, name, depth + 1);
      if (resolved) absorb(resolved);
      else partial = true;
    }
    i = parsed.end + 1;
  } else {
    const ident = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(src.slice(i));
    if (!ident) return null;
    const base = resolveSchemaConst(src, ident[1], depth + 1);
    if (!base) return null;
    absorb(base.fields);
    partial = partial || base.partial;
    i += ident[1].length;
  }

  // Walk any `.extend({…})` / `.merge(X)` chain. Method calls that can remove or
  // relax fields (`.partial`, `.omit`, `.pick`) are not modelled, so seeing one
  // means the field list is no longer trustworthy as an exact set.
  for (;;) {
    i = skipTrivia(src, i);
    const call = /^\.\s*([a-zA-Z]+)\s*\(/.exec(src.slice(i));
    if (!call) break;
    const method = call[1];
    const paren = i + call[0].length - 1;
    const close = matchBracket(src, paren);
    if (close === -1) break;

    if (method === 'extend') {
      const brace = src.indexOf('{', paren);
      if (brace !== -1 && brace < close) {
        const parsed = objectFields(src, brace);
        if (parsed) {
          absorb(parsed.fields);
          for (const name of parsed.spreads) {
            const resolved = resolveShapeConst(src, name, depth + 1);
            if (resolved) absorb(resolved);
            else partial = true;
          }
        } else partial = true;
      } else partial = true;
    } else if (method === 'strict' || method === 'passthrough' || method === 'strip') {
      // Unknown-key policy only; the field set is unchanged.
    } else {
      partial = true;
    }
    i = close + 1;
  }

  return { fields: [...seen.values()], partial };
}

/** Resolve `const <name> = <schema expression>` in the same file. */
export function resolveSchemaConst(src, name, depth) {
  const decl = new RegExp(`^const ${name}(?::[^=]+)? =`, 'm').exec(src);
  if (!decl) return null;
  // readSchemaFields expects to start just past an opening paren, so hand it the
  // index of the `=` and let its skipTrivia land on the expression.
  const eq = src.indexOf('=', decl.index);
  return readSchemaFields(src, eq, depth);
}

/**
 * Every `.ts` file under `packages/shared/src`, read once and cached.
 *
 * Spread shapes such as `flowStepVisibilitySchemaShape` arrive through the
 * `@xyne/shared` barrel, so there is no import specifier to follow to a file.
 * Scanning the package is cruder than real module resolution but it is honest:
 * either the declaration is found and the field list is exact, or it is not and
 * the caller marks the schema partial.
 */
let sharedSources = null;
export function readSharedSources() {
  if (sharedSources) return sharedSources;
  sharedSources = [];
  const root = join(repoRoot, 'packages/shared/src');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) sharedSources.push(readFileSync(full, 'utf8'));
    }
  };
  try {
    walk(root);
  } catch {
    sharedSources = []; // package absent; every spread stays partial
  }
  return sharedSources;
}

/**
 * Resolve a spread source (`...flowStepVisibilitySchemaShape`) to its fields.
 *
 * These are plain object literals of zod types, not zod schemas, so they are
 * parsed directly rather than through `readSchemaFields`. Looks in the file
 * itself first, then in `packages/shared`. Returns null when the constant is
 * nowhere to be found, and the caller must then treat the field list as partial
 * rather than assume the fields do not exist.
 */
export function resolveShapeConst(src, name, depth) {
  if (depth > 8) return null;
  const pattern = new RegExp(`^(?:export )?const ${name}(?::[^=]+)? = \\{`, 'm');
  if (!pattern.test(src)) {
    for (const shared of readSharedSources()) {
      if (pattern.test(shared)) return resolveShapeConst(shared, name, depth + 1);
    }
  }
  const decl = pattern.exec(src);
  if (!decl) return null;
  const brace = src.indexOf('{', decl.index);
  const parsed = objectFields(src, brace);
  if (!parsed) return null;
  const out = [...parsed.fields];
  for (const nested of parsed.spreads) {
    const resolved = resolveShapeConst(src, nested, depth + 1);
    if (!resolved) return null; // unresolvable nested spread poisons the whole shape
    out.push(...resolved);
  }
  return out;
}

/**
 * Catalog query names, their arguments, and whether each returns a single row.
 *
 * `.one()` in the query body is what decides single-vs-list. The SDK declares that
 * as `X | null` or `X[]`, and nothing else verifies the two agree.
 */
export function readQueries() {
  const src = readFileSync(QUERIES, 'utf8');
  const names = new Set();
  const required = new Map();
  const declared = new Map();
  const enums = new Map();
  const single = new Set();

  const matches = [...src.matchAll(/^ {2}([a-zA-Z0-9_]+): defineQuery\(/gm)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    names.add(m[1]);
    const args = readRequiredArgs(src, m.index + m[0].length - 1);
    if (args) {
      required.set(m[1], args.required);
      // A partial field list is a subset of the truth, so it cannot support
      // "this argument is not accepted" — only requiredness.
      if (!args.partial) declared.set(m[1], new Set(args.all));
      if (args.enums.size > 0) enums.set(m[1], args.enums);
    }
    // Body runs to the start of the next operation.
    const bodyEnd = matches[i + 1]?.index ?? src.length;
    if (hasTopLevelOne(src.slice(m.index, bodyEnd))) single.add(m[1]);
  }
  return { names, required, declared, enums, single };
}

/** Catalog mutator names and their required arguments. */
export function readMutators() {
  const src = readFileSync(MUTATORS, 'utf8');
  const offset = src.indexOf('return defineMutators({');
  const lines = src.slice(offset).split('\n');

  const names = new Set();
  const required = new Map();
  const declared = new Map();
  const enums = new Map();
  let namespace = null;
  // Char offset of the current line within `src`. Offsets stay whole-file so a
  // named schema declared above `defineMutators` is still resolvable.
  let cursor = offset;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ns = /^ {4}([a-zA-Z][a-zA-Z0-9]*): \{/.exec(line);
    if (ns) namespace = ns[1];

    const mut = /^\s{5,8}([a-zA-Z][a-zA-Z0-9]*): defineMutator\(/.exec(line);
    if (mut && namespace) {
      const full = `${namespace}.${mut[1]}`;
      names.add(full);
      const args = readRequiredArgs(src, cursor + mut[0].length - 1);
      if (args) {
        required.set(full, args.required);
        if (!args.partial) declared.set(full, new Set(args.all));
        if (args.enums.size > 0) enums.set(full, args.enums);
      }
    }
    cursor += line.length + 1;
  }
  return { names, required, declared, enums };
}


/**
 * Members of an enum-like declaration, or null when it is not one.
 *
 * Handles the three forms the catalog uses: `z.enum([…])`, a chain of
 * `z.literal('a')`, and `z.nativeEnum(SomeEnum)` — the last resolved from
 * `packages/shared`, where the Prisma-mirroring enums live.
 */
export function enumeratedValues(fieldText) {
  const asEnum = /z\.enum\(\[([^\]]*)\]\)/.exec(fieldText);
  if (asEnum) {
    const values = [...asEnum[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    return values.length > 0 ? new Set(values) : null;
  }
  const native = /z\.nativeEnum\(([A-Za-z_][A-Za-z0-9_]*)\)/.exec(fieldText);
  if (native) return sharedEnumValues(native[1]);
  const literals = [...fieldText.matchAll(/z\.literal\('([^']+)'\)/g)].map((m) => m[1]);
  return literals.length > 0 ? new Set(literals) : null;
}

/** String values of `export enum X { … }` declared anywhere in `packages/shared`. */
export function sharedEnumValues(name) {
  for (const src of readSharedSources()) {
    const decl = new RegExp(`export enum ${name}\\s*\\{`).exec(src);
    if (!decl) continue;
    const brace = src.indexOf('{', decl.index);
    const end = matchBracket(src, brace);
    if (end === -1) return null;
    const body = src.slice(brace + 1, end);
    const values = [...body.matchAll(/=\s*'([^']+)'/g)].map((m) => m[1]);
    return values.length > 0 ? new Set(values) : null;
  }
  return null;
}
