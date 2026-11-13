/**
 * Stable addressing for author citations into a step's `config`.
 *
 * Citations are a documentation overlay stored on the step
 * (`StepConfigBase.citations`), keyed by a **CitationPath** — a dotted path into
 * `config` where array elements are addressed by a *stable* key (their `id`, else
 * `name`), never by numeric index. This keeps citations attached across reorders
 * and renames.
 *
 *   reason
 *   form.fields[acha]
 *   display[sec_amt].value
 *
 * This module is the single source of truth for the CitationPath grammar — the
 * contract between the builder (writer) and the reviewer/validator (readers) —
 * sitting beside the `{{ref}}` grammar in `variable-ref.ts`.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Stable key for an array element: its `id`, else `name`. Undefined if neither. */
function stableKey(el: unknown): string | undefined {
  if (!isPlainObject(el)) return undefined;
  const id = el['id'];
  if (typeof id === 'string' && id.length > 0) return id;
  const name = el['name'];
  if (typeof name === 'string' && name.length > 0) return name;
  return undefined;
}

function defaultIdGen(): string {
  return `c_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Convert a builder field path (dotted, array-index based — e.g. `display.0.value`)
 * into a stable {@link CitationPath} (e.g. `display[sec_amt].value`).
 *
 * Array elements are keyed by their `id`/`name`; if a cited element has neither, a
 * stable `id` is **stamped onto it** (mutating `config`) via `idGen`. Used by the
 * builder at authoring time. Returns `null` if the field path doesn't resolve.
 *
 * Contract for step authors: any array field whose elements may be cited must
 * declare an `id` (or already carry a `name`) in its config schema. Otherwise the
 * stamped `id` is an undeclared key that Zod strips on parse (or rejects under
 * `.strict()`), breaking the citation link. Builtin example: WAIT's display rows
 * declare `id?: string` precisely for this.
 */
function buildPath(
  config: Record<string, unknown>,
  fieldPath: string,
  idGen: (() => string) | null,
): string | null {
  const segments = fieldPath.split('.').filter((s) => s.length > 0);
  let node: unknown = config;
  let path = '';

  for (const seg of segments) {
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) return null;
      const el = node[idx];
      let key = stableKey(el);
      if (key === undefined) {
        if (idGen === null) return null; // read-only: no stable key available
        if (!isPlainObject(el)) return null; // can't stamp a scalar array element
        key = idGen();
        el['id'] = key;
      }
      path += `[${key}]`;
      node = el;
    } else if (isPlainObject(node)) {
      if (!(seg in node)) return null;
      path += path === '' ? seg : `.${seg}`;
      node = node[seg];
    } else {
      return null;
    }
  }

  return path;
}

export function ensureCitationPath(
  config: Record<string, unknown>,
  fieldPath: string,
  idGen: () => string = defaultIdGen,
): string | null {
  return buildPath(config, fieldPath, idGen);
}

/**
 * Read-only counterpart of {@link ensureCitationPath}: compute the stable path
 * using *existing* `id`/`name` keys only — never mutates. Returns `null` if an
 * array element along the path has no stable key yet (i.e. nothing was cited there).
 * Used at render time to look up a field's citations.
 */
export function tryCitationPath(
  config: Record<string, unknown>,
  fieldPath: string,
): string | null {
  return buildPath(config, fieldPath, null);
}

interface PathToken {
  kind: 'key' | 'elem';
  value: string;
}

const PATH_TOKEN_REGEX = /([^.[\]]+)|\[([^\]]+)\]/g;

/** Parse a CitationPath into ordered tokens (object keys + array-element ids). */
export function parseCitationPath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  PATH_TOKEN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_REGEX.exec(path)) !== null) {
    if (m[2] !== undefined) tokens.push({ kind: 'elem', value: m[2] });
    else if (m[1] !== undefined) tokens.push({ kind: 'key', value: m[1] });
  }
  return tokens;
}

/**
 * Resolve a {@link CitationPath} against a step `config`, returning the addressed
 * node (or `undefined` if it no longer exists). Read-only — used by the reviewer
 * and validator. Robust to reorder because array elements are matched by stable key.
 */
export function resolveCitationPath(config: Record<string, unknown>, path: string): unknown {
  let node: unknown = config;
  for (const tok of parseCitationPath(path)) {
    if (node === null || node === undefined) return undefined;
    if (tok.kind === 'key') {
      if (!isPlainObject(node)) return undefined;
      node = node[tok.value];
    } else {
      if (!Array.isArray(node)) return undefined;
      node = node.find((el) => stableKey(el) === tok.value);
    }
  }
  return node;
}
