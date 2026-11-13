/**
 * Cited-agent-output plumbing — the two halves of making an agent cite its work:
 *
 * 1. **Into the prompt**: {@link labelSources} wraps each resolved `{{ref}}` in a
 *    `[source: <ref>]` block. The executor resolves config to bare values before
 *    the step runs, so without this the agent would see the OCR text but have no
 *    idea it came from `steps.ocr.output.results.0.pages.2.text` — nothing to cite.
 * 2. **Out of the response**: {@link splitCitedResponse} unwraps the
 *    `{ value, citation }` object the model returns.
 *
 * Pure functions (no ctx, no I/O) so the tricky parts are directly unit-testable.
 */

import {
  CitationRefSchema,
  isCitationRefArray,
  splitCitedRef,
} from '../common/citation-ref.js';
import type { CitationMap, CitationRef } from '../common/citation-ref.js';
import type { WorkflowContext } from '../types/context.js';
import { resolvePath } from '../engine/variable-resolver.js';
import { tokenize, extractRefPath } from '../util/variable-ref.js';

/** The slice of `ctx.log` this module needs. Agent output must never throw. */
interface Warn {
  warn(msg: string): void;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ─── Prompt side ───

function stringifyForPrompt(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function sourceBlock(
  ref: string,
  value: unknown,
  at?: string,
  /**
   * The value's OWN citation, when it has one — i.e. an upstream agent already
   * recorded where this came from. Sent with the value so a downstream agent can
   * copy it verbatim instead of citing the step it passed through.
   */
  cited?: CitationRef[],
): string {
  const head = at ? `${ref} | ${at}` : ref;
  const from = cited?.length ? `\n[cited-from: ${JSON.stringify(cited)}]` : '';
  return `\n[source: ${head}]\n${stringifyForPrompt(value)}${from}\n[/source]\n`;
}

/** An array of records — a list of independently-citable things. */
function isRecordArray(v: unknown): v is Record<string, unknown>[] {
  return (
    Array.isArray(v)
    && v.length > 0
    && v.every((el) => el !== null && typeof el === 'object' && !Array.isArray(el))
  );
}

/** Structural check for an Attachment — the same three fields the SDK guards on. */
function isAttachmentLike(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    typeof v['name'] === 'string'
    && typeof v['mimeType'] === 'string'
    && typeof v['handle'] === 'string'
  );
}

/**
 * The document a record was derived from, if it carries one.
 *
 * Producer convention: a step that turns a document into data emits the
 * `Attachment` beside the data (OCR's `results[i].source`). One level only — the
 * document is a *sibling* of the text it produced, so a deeper scan could only
 * surface something unrelated.
 */
function documentFieldOf(record: Record<string, unknown>): string | undefined {
  for (const [k, v] of Object.entries(record)) {
    if (isAttachmentLike(v)) return k;
  }
  return undefined;
}

/** A human-readable address for a record that carries one — shown in the label. */
function addressOf(record: Record<string, unknown>): string | undefined {
  if (typeof record['page'] === 'number') return `page ${String(record['page'])}`;
  const row = record['row'];
  const col = record['col'];
  if (typeof row === 'number' && (typeof col === 'string' || typeof col === 'number')) {
    const sheet = typeof record['sheet'] === 'string' ? `${record['sheet']}!` : '';
    return `cell ${sheet}${String(col)}${String(row)}`;
  }
  if (typeof record['line'] === 'number') return `line ${String(record['line'])}`;
  return undefined;
}

/** Walk an object by path segments; undefined the moment the path leaves it. */
function at(node: unknown, path: readonly string[]): unknown {
  let cur = node;
  for (const seg of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Every cited leaf under a mirror node, with the field path it belongs to. */
function citedLeaves(
  node: unknown,
  path: string[] = [],
  out: { path: string[]; refs: CitationRef[] }[] = [],
): { path: string[]; refs: CitationRef[] }[] {
  if (isCitationRefArray(node)) {
    out.push({ path, refs: node });
    return out;
  }
  if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) citedLeaves(v, [...path, k], out);
  }
  return out;
}

/**
 * A cited upstream value, labelled so each field arrives WITH its own citation.
 *
 * Without this, a downstream agent shown `{{…output.response.value}}` sees one
 * block for a whole section and can only cite the section — which is true but
 * useless: the reader lands on the intermediate step instead of the document.
 * Real runs bore this out, 107 of 107 citations stopping at the bare `.value`.
 *
 * The fix is to give the agent something to COPY rather than something to build.
 * Since the upstream agent already recorded where each field came from, we send
 * that citation alongside the field, and the downstream agent adopts it verbatim —
 * so its citation points straight at the source document, however deeply nested
 * the producing step was.
 *
 * Emitted per field rather than as one blob plus a separate citation map: pairing
 * is then structural. Handing over 42 values and 42 citations to be matched up
 * invites a mis-pair, and a citation attached to the wrong source is worse than
 * the coarse one it replaces.
 *
 * Bounded by the mirror — only fields the upstream agent actually cited are
 * expanded, since an uncited field has nothing to attach. Returns undefined when
 * the ref isn't a cited value at all, leaving every other kind of source
 * (documents, trigger data, vars, scalars) to label exactly as before.
 */
function citedValueBlocks(
  path: string,
  value: unknown,
  workflow: WorkflowContext,
): string | undefined {
  const split = splitCitedRef(path);
  if (!split) return undefined;

  const mirror = resolvePath(
    workflow,
    [split.base, 'output', split.envelope, 'citation'].join('.'),
  );
  if (mirror === undefined) return undefined;

  const node = at(mirror, split.field);

  // The ref names a single cited field — send it with its own citation.
  if (isCitationRefArray(node)) return sourceBlock(path, value, undefined, node);

  // The ref names an object — one block per cited field beneath it.
  let out = '';
  for (const leaf of citedLeaves(node)) {
    const fieldValue = at(value, leaf.path);
    if (fieldValue === undefined) continue;
    out += sourceBlock(`${path}.${leaf.path.join('.')}`, fieldValue, undefined, leaf.refs);
  }
  return out || undefined;
}

/**
 * Expand one record into labelled blocks, naming the **document** it came from
 * rather than the internal path its text happens to live at.
 *
 * A record like `{ source: <Attachment>, pages: [{page,text}, …] }` becomes one
 * block per page, each labelled `<…>.source | page N` — so the agent cites a
 * document plus an address, both copied verbatim. Without this the agent could
 * only cite a text path, leaving the reader to reconstruct the document by
 * climbing the tree, and coupling every citation to the producer's output shape.
 */
function expandRecord(basePath: string, record: Record<string, unknown>): string {
  const docField = documentFieldOf(record);
  if (!docField) return sourceBlock(basePath, record);

  const docRef = `${basePath}.${docField}`;
  let out = '';
  let emitted = false;

  for (const [key, value] of Object.entries(record)) {
    if (key === docField) continue;
    if (isRecordArray(value)) {
      // e.g. `pages: [{page, text}, …]` — one citable block per entry.
      for (const entry of value) {
        out += sourceBlock(docRef, entry, addressOf(entry));
        emitted = true;
      }
    }
  }

  // No per-entry data (or nothing but the document) — cite the document itself.
  return emitted ? out : sourceBlock(docRef, record);
}

/**
 * Re-render a *raw* (pre-resolution) message so every `{{ref}}` becomes a
 * labelled block naming the source its content came from:
 *
 *   "Analyse: {{steps.ocr.output.results}}"
 *     →  "Analyse:
 *         [source: steps.ocr.output.results.0.source | page 1]
 *         <text of page 1…>
 *         [/source]
 *         [source: steps.ocr.output.results.0.source | page 2]
 *         <text of page 2…>
 *         [/source]"
 *
 * The content is identical to what the resolver would have interpolated — only
 * the provenance label is added, which is the thing the agent cites.
 * Returns the input unchanged when it holds no refs.
 *
 * Two rules do the work, and both exist so the agent only ever **copies** a
 * label rather than composing one:
 *
 * 1. A ref onto an **array of records** (several OCR'd documents, a set of rows)
 *    expands to one block per element. A single `[source: …results]` label would
 *    leave no way to say *which* document a value came from.
 * 2. A record carrying a **document** beside its data is labelled with that
 *    document's ref plus a readable address (`| page 2`). So a citation names
 *    something openable, not an internal text path — which keeps citations
 *    decoupled from the producer's output shape (when `data` was removed from the
 *    OCR step, every ref pointing at it broke).
 *
 * Composing is exactly what models get wrong: asked to build `…results.1.text`
 * itself, one would plausibly emit `results[1].text`, and the ref grammar is
 * dot-only (see resolvePath).
 */
export function labelSources(rawMessage: string, workflow: WorkflowContext): string {
  const tokens = tokenize(rawMessage);
  if (!tokens.some((t) => t.kind === 'ref')) return rawMessage;

  let out = '';
  for (const tok of tokens) {
    if (tok.kind === 'literal') {
      out += tok.text;
      continue;
    }
    const value = resolvePath(workflow, tok.path);
    // A value that already carries provenance travels with it, so the agent can
    // adopt the original source rather than citing the step it came through.
    const cited = citedValueBlocks(tok.path, value, workflow);
    if (cited) {
      out += cited;
      continue;
    }
    if (isRecordArray(value)) {
      for (let i = 0; i < value.length; i++) {
        out += expandRecord(`${tok.path}.${String(i)}`, value[i]!);
      }
      continue;
    }
    if (isPlainObject(value)) {
      out += expandRecord(tok.path, value);
      continue;
    }
    out += sourceBlock(tok.path, value);
  }
  return out;
}

/**
 * The ref the `attachments` field was bound to, e.g. `"{{trigger.documents}}"` →
 * `"trigger.documents"`. Mounted file *i* is then citable as `<base>.i`, since
 * the mounted order mirrors the resolved array. Undefined when attachments were
 * bound to a literal rather than a ref (nothing citable to name).
 */
export function attachmentRefBase(rawAttachments: unknown): string | undefined {
  if (typeof rawAttachments !== 'string') return undefined;
  return extractRefPath(rawAttachments) ?? undefined;
}

/** The system-prompt instruction that tells the agent how to cite. */
export function citationSystemNote(outputType: 'string' | 'json'): string {
  const common =
    `\n\nCITATIONS: every value you output must say where it came from. `
    + `Each source above is labelled "[source: <ref> | <address>]". `
    + `Copy the <ref> verbatim — never build one yourself, and never invent one. `
    + `When the label shows an address, copy it as "locator": `
    + `"| page 2" becomes {"at":"page","page":2}, `
    + `"| cell Sheet1!B14" becomes {"at":"cell","sheet":"Sheet1","col":"B","row":14}, `
    + `"| line 42" becomes {"at":"line","from":42}. `
    + `A label with no address has nothing to locate — omit "locator". `
    + `Always add "quote": the exact text you took the value from, so the reader can be `
    + `shown the passage. For something you read on the web, cite {"kind":"url"} instead.`;

  if (outputType === 'json') {
    return (
      common
      + `\n\nReturn JSON with exactly two top-level keys: "value" and "citation". `
      + `"value" is the requested output. "citation" MIRRORS the structure of "value", `
      + `but every leaf is an array of sources: `
      + `{"kind":"ref","ref":"<a ref shown above>","locator":<the address shown>,"quote":"<exact text>"} `
      + `or {"kind":"url","url":"https://…","quote":"<exact text>"}. `
      + `Example: {"value":{"total":"5000"},"citation":{"total":[{"kind":"ref","ref":"steps.ocr.output.results.0.source","locator":{"at":"page","page":2},"quote":"TOTAL DUE 5000"}]}}. `
      + `Omit a leaf from "citation" only when you genuinely cannot source it.`
      // A value that arrives already sourced should keep its ORIGINAL source.
      // Citing the block instead names the step it passed through — true, but it
      // dead-ends the reader at an intermediate result instead of the document.
      + `\n\nWhen a [source: ...] block ends with [cited-from: ...], that value's own `
      + `source is already known. If you use that value, copy the [cited-from] citation `
      + `EXACTLY as your own — do not cite the block's ref instead, and do not rewrite `
      + `its ref, locator or quote.`
      // Only json mode gets this: a prose agent rarely computes structured values,
      // and every extra instruction is a chance for the model to comply less well
      // with the ones that matter.
      + `\n\nIf you CALCULATED a value instead of reading it (a total, a ratio, a `
      + `growth rate), do not quote it — it appears nowhere in the source. Cite it as `
      + `{"kind":"derived","label":"Debt Service Coverage Ratio","expression":"(#2 - #1) / #1",`
      + `"inputs":[<the sources you combined, in order>]}, where #1 is the first input, `
      + `#2 the second. Keep "expression" to + - * / ( ) and numbers so a reader can follow `
      + `it. List every input you used — the positions must line up with the expression. `
      + `ALWAYS include "label": a short plain-language name of what the value represents `
      + `(e.g. "Debt Service Coverage Ratio", "Year-on-year revenue growth") — never leave `
      + `it out, because the expression alone tells a reader nothing about what was computed.`
    );
  }
  return (
    common
    + `\n\nWrap every sourced statement in a citation directive:\n`
    + `:::citation{ref="<a ref shown above>" page=2 quote="<exact text>"}\n`
    + `the statement\n`
    + `:::\n`
    + `or :::citation{url="https://…"} … :::. Use only these attributes: ref, page, url, quote, title.`
    // `labelSources` attaches [cited-from] in BOTH output modes, so prose agents
    // see it too and must be told what it is — otherwise it is unexplained noise
    // in the prompt. The directive is flat, so the citation's fields are mapped
    // onto attributes rather than copied wholesale as in json mode.
    + `\n\nWhen a [source: ...] block ends with [cited-from: {...}], that value's own `
    + `source is already known — use it instead of citing the block. Map its fields `
    + `onto the directive: "ref" → ref, "quote" → quote, "url" → url, and `
    + `"locator":{"at":"page","page":N} → page=N. Copy each value exactly; if it has `
    + `a locator that is not a page, give ref and quote and omit page.`
  );
}

// ─── Response side ───

/** Does this look like a citation leaf entry (rather than a mirror branch)? */
function isCitationLike(v: unknown): boolean {
  return isPlainObject(v) && typeof v['kind'] === 'string';
}

/**
 * Walk the citation mirror, keeping only well-formed {@link CitationRef} leaves.
 *
 * Why filter rather than trust: the renderers treat a leaf as citations only if
 * *every* entry is valid, so a single hallucinated entry would silently suppress
 * the good ones sitting beside it. Dropping the bad entry preserves the rest.
 *
 * An array is a leaf if anything in it looks citation-like (`kind`); otherwise
 * it's a branch mirroring an array of values, and we recurse. Scalars are noise.
 */
function sanitizeNode(node: unknown, log: Warn): unknown {
  if (Array.isArray(node)) {
    if (node.some(isCitationLike)) {
      const kept = node.filter((el) => {
        if (CitationRefSchema.safeParse(el).success) return true;
        log.warn(`dropping malformed citation: ${JSON.stringify(el)}`);
        return false;
      });
      return kept.length > 0 ? kept : undefined;
    }
    const mapped = node.map((el) => sanitizeNode(el, log));
    return mapped.some((el) => el !== undefined) ? mapped : undefined;
  }
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      const s = sanitizeNode(v, log);
      if (s !== undefined) out[k] = s;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

export function sanitizeCitationMap(raw: unknown, log: Warn): CitationMap {
  return sanitizeNode(raw, log) ?? {};
}

/**
 * Split the `{ value, citation }` wrapper out of a JSON-mode agent response.
 *
 * Models don't always comply, so every shape degrades to something renderable:
 * - `{value, citation}` → the wrapper, citations sanitized.
 * - `{value}` alone (the only key) → the wrapper minus citations. This is also
 *   what `parseJsonResponse` produces for non-object JSON, so the two agree.
 * - anything else → treated as the bare output. A user field literally named
 *   `value` is why we require `citation` (or a lone key) before unwrapping:
 *   misreading `{value, other}` as the wrapper would silently drop `other`.
 */
export function splitCitedResponse(
  parsed: Record<string, unknown>,
  log: Warn,
): { value: unknown; citation: CitationMap } {
  if ('value' in parsed && isPlainObject(parsed['citation'])) {
    return { value: parsed['value'], citation: sanitizeCitationMap(parsed['citation'], log) };
  }
  if ('value' in parsed && Object.keys(parsed).length === 1) {
    return { value: parsed['value'], citation: {} };
  }
  log.warn(
    'cite is enabled but the agent returned no "citation" map — its data points will render uncited',
  );
  return { value: parsed, citation: {} };
}
