/**
 * Resolve a runtime {@link CitationRef} to something openable.
 *
 * The agent cites a *ref* — a path it was shown — never a document, because an
 * `Attachment`'s `data` is an opaque host handle no model can know. Turning that
 * ref into a document happens here, where the workflow config and every step's
 * output are in hand.
 *
 * Four rules, in order. None of them guess:
 *
 * 1. **Direct** — the ref resolves to an attachment. The normal path: labels name
 *    the owning document, so the agent cites something openable.
 * 2. **Forward** — the ref lands on a data point another agent already cited, so
 *    resolve *through* that citation. This is how `ocr → agent → agent` chains
 *    inherit provenance exactly, with nothing extra to author.
 * 3. **Walk-up** — walk up the cited path and take the attachment sitting beside
 *    the data (`…results.0.pages.1.text` → `…results.0.source`). Sound because a
 *    step that derives data from a document emits the document next to it; the
 *    doc is a *sibling of the value*, so it can't be mis-attributed.
 * 4. **Nothing** — no attachment above it. Honest: a value derived from an API
 *    call has no document, and inventing one would be worse than none.
 *
 * **Forward outranks walk-up because an assertion outranks an inference.**
 * Forward is an upstream agent *stating* where a value came from; walk-up is
 * "there is a file nearby, probably that one". Running walk-up first let a citing
 * step's own output artifact (`output.attachments` — files it *produced*) shadow
 * the document the value was actually *read* from.
 */
import type { Attachment } from '@xyne/workflow-sdk';
// The boundary between a cited value and its citation mirror is defined by the
// SDK that PRODUCES that shape, not re-guessed here — so a rename fails the
// build rather than silently breaking resolution at runtime.
import { CITED_VALUE_SEGMENTS, splitCitedRef } from '@xyne/workflow-sdk/common';
import type { Anchor } from '../../shared/viewers/useDomAnchor.js';
import type { CitationRef, CitationMap } from '../../shared/citation.js';
import { citationsAt } from '../../shared/citation.js';
import { isAttachment, isAttachmentArray } from '../../shared/AttachmentCard.js';
import { resolveRef, type OriginResolverCtx } from './origin-resolver.js';

/** What a citation opens: a document at a specific spot, an external link, or —
 *  for a computed value — the inputs it was derived from.
 *
 *  The document variant carries an {@link Anchor}, not a loose `page`. This is
 *  the boundary where the *agent's* vocabulary (a flat `page`, the one locator a
 *  model can honestly assert) becomes the *renderer's* vocabulary (a locator
 *  union that can also address a cell or a line). Converting here rather than at
 *  the viewer keeps every downstream hop able to express provenance in formats
 *  that have no pages — a spreadsheet citation is representable, instead of
 *  being squeezed through a PDF-shaped field.
 *
 *  A derivation is *shown*, not checked: the expression and its inputs are
 *  displayed so a reader can follow the arithmetic themselves. Recomputing it to
 *  assert ✓/⚠ is deliberately out of scope for now. */
export type ResolvedCitation =
  | { kind: 'doc'; attachment: Attachment; anchor?: Anchor | undefined }
  /**
   * The ref resolved, but to data rather than a document — an API field, an
   * upstream computed total. Still provenance worth showing: the reader gets the
   * value and the step that produced it, just nothing to open.
   *
   * This is the discrimination the *agent* couldn't make (it can't know whether a
   * path happens to hold an attachment), made here where the answer exists.
   */
  /**
   * `stepId` + `path` are what make this OPENABLE rather than a dead marker: the
   * panel shows that step's recorded output with the cited field highlighted.
   * Unlike a document, the address needs no `locator` — the ref path IS the
   * address, so the highlight is an exact lookup rather than a text search.
   */
  | {
      kind: 'value';
      ref: string;
      label: string;
      value: unknown;
      /** The step that produced it — the innermost one, not a control-flow container. */
      stepId?: string | undefined;
      /** Ref to that step's output root; the panel resolves it to render the tree. */
      stepOutputRef?: string | undefined;
      /** Where the cited value sits inside that output. */
      path?: string[] | undefined;
    }
  /** `quote` rides along so a url used as a derived input can show WHAT was taken
   *  from the page, not just which page — the same thing a doc input shows. */
  | { kind: 'url'; url: string; title?: string | undefined; quote?: string | undefined }
  | {
      kind: 'derived';
      expression?: string | undefined;
      label?: string | undefined;
      inputs: ResolvedCitation[];
    };

/** The page a doc citation points at, when it has one — for labels like "p.3". */
export function citationPage(c: ResolvedCitation): number | undefined {
  if (c.kind !== 'doc') return undefined;
  return c.anchor?.locator?.at === 'page' ? c.anchor.locator.page : undefined;
}

/**
 * A spreadsheet cell address ("OPPR!G69") for a cell-anchored citation — the
 * sheet counterpart of {@link citationPage}. Without it every cell of one
 * workbook renders as the same file name, so the operands of a derivation (and
 * repeated citations into one sheet) are indistinguishable.
 */
export function citationCell(c: ResolvedCitation): string | undefined {
  if (c.kind !== 'doc') return undefined;
  const loc = c.anchor?.locator;
  if (loc?.at !== 'cell') return undefined;
  const addr = `${String(loc.col)}${String(loc.row)}`;
  return loc.sheet ? `${loc.sheet}!${addr}` : addr;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The attachment at this node, or on one of its direct properties.
 *
 * Deliberately one level deep. A cited value's document sits *beside* it
 * (`{ source, data, pages }`), so its parent is exactly where to look — while a
 * deep scan could surface an unrelated attachment from somewhere further down
 * the output and attribute the value to the wrong file.
 */
function attachmentIn(value: unknown): Attachment | undefined {
  if (isAttachment(value)) return value;
  if (isAttachmentArray(value)) return value[0];
  if (!isPlainObject(value)) return undefined;
  for (const v of Object.values(value)) {
    if (isAttachment(v)) return v;
    if (isAttachmentArray(v) && v[0]) return v[0];
  }
  return undefined;
}

function docAt(attachment: Attachment, anchor: Anchor | undefined): ResolvedCitation {
  return {
    kind: 'doc',
    attachment,
    ...(anchor && (anchor.quote !== undefined || anchor.locator !== undefined)
      ? { anchor }
      : {}),
  };
}

/** Rule 1 — the cited node *is* the document. The normal path, since labels name it. */
function directDoc(
  ref: string,
  anchor: Anchor | undefined,
  ctx: OriginResolverCtx,
): ResolvedCitation | undefined {
  const attachment = attachmentIn(resolveRef(ref, ctx).value);
  return attachment ? docAt(attachment, anchor) : undefined;
}

/**
 * How far {@link walkUpDoc} may climb: the number of leading segments it must keep.
 *
 * Walk-up is only sound *inside a derived-data record*, where `results.0.source`
 * genuinely sits beside `results.0.pages.1.text`. At a step's output root the
 * meaning inverts: `output.attachments` is what that step **produced**, not what
 * it **read**. So a ref into a cited response is floored at `…response.value` —
 * above that line, a nearby attachment is not evidence of anything.
 */
function walkUpFloor(ref: string): number {
  const split = splitCitedRef(ref);
  if (!split) return 1;
  // Everything up to and including `value` is off-limits to the climb. Derived
  // from where the boundary actually sits, so it holds at any nesting depth —
  // the previous version assumed the value lived at `steps.<id>.output.…` and
  // stopped flooring anything inside a PARALLEL, letting the climb reach a
  // step's own produced artifacts.
  return split.base.split('.').length + CITED_VALUE_SEGMENTS.length;
}

/**
 * Rule 3 — each ancestor of the cited node, nearest first.
 *
 * A safety net, not the main path: the ref names the document directly, so rule 1
 * normally hits. Climbing survives only for an agent that cited an internal text
 * node anyway — without it, such a citation would be dropped rather than merely
 * imprecise (the document opens, just not at the exact page).
 */
function walkUpDoc(
  ref: string,
  anchor: Anchor | undefined,
  ctx: OriginResolverCtx,
): ResolvedCitation | undefined {
  const segments = ref.split('.');
  const floor = walkUpFloor(ref);

  for (let i = segments.length - 1; i >= floor; i--) {
    const attachment = attachmentIn(resolveRef(segments.slice(0, i).join('.'), ctx).value);
    if (attachment) return docAt(attachment, anchor);
  }
  return undefined;
}

/**
 * The step that actually PRODUCED a cited value, plus how to reach its output.
 *
 * `parseRef` reports the *outermost* step, which for a ref through any
 * control-flow container is the container itself — `extractors`, not
 * `sec_vi_risk`. Attributing a citation to "Section extractors (parallel)" tells
 * a reader nothing: the container ran twelve branches and they need the one that
 * made this number. Five step types splice this shape (`parallel`, `map`, `loop`,
 * `switch`, `conditional`) and `getBranches` is a `BaseStep` hook, so any future
 * one does too — reading the LAST `steps.<id>` segment handles them all.
 *
 * `outputRef` is the ref truncated at that step's own `output`, and is what the
 * panel resolves. Deliberately not `ctx.stepOutput(stepId)`: step states are keyed
 * by bare leaf id, so under MAP/LOOP the same id exists once per iteration and a
 * bare lookup would silently return the wrong one. The truncated ref still
 * carries `items.0`, so it addresses the right iteration.
 */
function innermostStep(
  ref: string,
): { stepId: string; outputRef: string; path: string[] } | undefined {
  const s = ref.split('.');
  const i = s.lastIndexOf('steps');
  const stepId = i >= 0 ? s[i + 1] : undefined;
  if (stepId === undefined) return undefined;
  const rest = s.slice(i + 2);
  // Only a ref into a step's OUTPUT has a producer to attribute.
  if (rest[0] !== 'output') return undefined;
  return {
    stepId,
    outputRef: s.slice(0, i + 3).join('.'),
    path: rest.slice(1),
  };
}

/**
 * Rule 2 — the citation another agent already attached to this data point.
 *
 * Navigates *relatively*: swap the cited `…response.value` for its sibling
 * `…response.citation` and resolve that with the ordinary walker. Nothing here
 * knows where the producing step sits in the graph — no step id, no output
 * lookup, no assumption that steps are top-level. That is deliberate: the
 * previous version pattern-matched an absolute path and so returned nothing for
 * every agent inside a PARALLEL, silently disabling provenance inheritance for
 * whole workflows. With no topology inputs left, no future control-flow shape
 * (nested parallel, map, branch) can break it the same way.
 */
function forwardedCitations(ref: string, ctx: OriginResolverCtx): CitationRef[] {
  const split = splitCitedRef(ref);
  if (!split) return [];

  const sibling = [split.base, 'output', split.envelope, 'citation'].join('.');
  const citation = resolveRef(sibling, ctx).value as CitationMap | undefined;
  if (citation === undefined) return [];

  // An empty field path means the ref cited the WHOLE response value. That lands
  // on a mirror branch rather than a leaf, so there is no single source to
  // inherit — `citationsAt` returns [] and the citation falls through to the
  // step-output form, which is what it honestly is.
  return citationsAt(citation, split.field);
}

export function resolveCitationRef(
  ref: CitationRef,
  ctx: OriginResolverCtx,
  /** Refs already followed — a malformed chain must not spin forever. */
  visited: ReadonlySet<string> = new Set(),
): ResolvedCitation | undefined {
  if (ref.kind === 'url') {
    return { kind: 'url', url: ref.url, title: ref.title, quote: ref.quote };
  }
  if (ref.kind === 'derived') {
    // Each input resolves through the ordinary rules, so an input can itself be
    // a value another agent cited — provenance still composes.
    const inputs = ref.inputs
      .map((i) => resolveCitationRef(i, ctx, visited))
      .filter((r): r is ResolvedCitation => r !== undefined);
    return {
      kind: 'derived',
      ...(ref.expression !== undefined ? { expression: ref.expression } : {}),
      ...(ref.label !== undefined ? { label: ref.label } : {}),
      inputs,
    };
  }
  if (visited.has(ref.ref)) return undefined;

  const anchor: Anchor = {
    ...(ref.quote !== undefined ? { quote: ref.quote } : {}),
    ...(ref.locator !== undefined ? { locator: ref.locator } : {}),
  };

  const direct = directDoc(ref.ref, anchor, ctx);
  if (direct) return direct;

  const seen = new Set(visited).add(ref.ref);
  for (const next of forwardedCitations(ref.ref, ctx)) {
    const resolved = resolveCitationRef(next, ctx, seen);
    if (!resolved) continue;
    if (resolved.kind === 'doc') {
      // The citing agent's own address wins over what it inherited — it read this
      // value, so it knows where in the document it sits.
      const merged: Anchor = { ...resolved.anchor, ...anchor };
      return {
        ...resolved,
        ...(merged.quote !== undefined || merged.locator !== undefined
          ? { anchor: merged }
          : {}),
      };
    }
    return resolved;
  }

  // Only now — nobody upstream asserted a source, so fall back to inferring one
  // from a nearby attachment, bounded so a step's own artifacts can't pose as it.
  const up = walkUpDoc(ref.ref, anchor, ctx);
  if (up) return up;

  // The ref resolves, but to data rather than a document — an API field, a
  // computed total upstream. That is real provenance and must stay openable:
  // returning undefined here would render a dead marker, indistinguishable from
  // a hallucinated path.
  const value = resolveRef(ref.ref, ctx);
  if (value.value !== undefined) {
    // Attribution comes from the INNERMOST step; `resolveRef`'s own label/stepId
    // name the outermost one, which inside any control-flow container is the
    // container rather than the producer.
    const inner = innermostStep(ref.ref);
    const producedBy = inner ? ctx.stepTitle(inner.stepId) ?? inner.stepId : undefined;
    return {
      kind: 'value',
      ref: ref.ref,
      label: ref.label ?? producedBy ?? value.label,
      value: value.value,
      ...(inner
        ? { stepId: inner.stepId, stepOutputRef: inner.outputRef, path: inner.path }
        : {}),
    };
  }

  // Nothing at this path at all — the agent invented it.
  return undefined;
}
