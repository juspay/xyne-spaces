import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface CitationMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const CITATION_MARK_NAME = 'citation';
export const CITATION_DATA_ATTR = 'data-citation-ref';
const CITATION_BADGE_PLUGIN_KEY = new PluginKey<DecorationSet>('citationBadge');

function buildCitationBadgeData(doc: PMNode): {
  decorationSet: DecorationSet;
  orderedRefs: string[];
} {
  type Range = { to: number; ref: string };
  const ranges: Range[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== CITATION_MARK_NAME) continue;
      const ref = (mark.attrs as { ref?: unknown }).ref;
      if (typeof ref !== 'string' || !ref) continue;
      const from = pos;
      const to = pos + node.nodeSize;
      const last = ranges[ranges.length - 1];
      if (last && last.ref === ref && last.to === from) {
        last.to = to;
      } else {
        ranges.push({ to, ref });
      }
    }
  });
  if (ranges.length === 0) {
    return { decorationSet: DecorationSet.empty, orderedRefs: [] };
  }
  const refToNum = new Map<string, number>();
  const orderedRefs: string[] = [];
  for (const r of ranges) {
    if (!refToNum.has(r.ref)) {
      refToNum.set(r.ref, refToNum.size + 1);
      orderedRefs.push(r.ref);
    }
  }
  const decorations: Decoration[] = [];
  for (const r of ranges) {
    const num = refToNum.get(r.ref)!;
    decorations.push(
      Decoration.widget(
        r.to,
        () => {
          const sup = document.createElement('sup');
          sup.textContent = String(num);
          sup.className = 'xyne-citation-badge';
          sup.setAttribute(CITATION_DATA_ATTR, r.ref);
          sup.style.cssText =
            'display:inline-block;margin-left:0.18em;padding:0 0.4em;' +
            'background-color:rgb(254 226 226);color:rgb(185 28 28);' +
            'border-radius:0.3em;font-size:0.7em;font-weight:700;' +
            'line-height:1.1;cursor:pointer;user-select:none;' +
            'vertical-align:super;text-decoration:none;';
          return sup;
        },
        { side: 1, key: `cite-${r.ref}-${r.to}` },
      ),
    );
  }
  return { decorationSet: DecorationSet.create(doc, decorations), orderedRefs };
}

function createCitationBadgePlugin(
  getOnRefsChange: () => ((refs: string[]) => void) | null,
): Plugin<DecorationSet> {
  let lastRefsKey = '';
  const emit = (refs: string[]): void => {
    const key = refs.join('|');
    if (key === lastRefsKey) return;
    lastRefsKey = key;
    const cb = getOnRefsChange();
    if (!cb) return;
    queueMicrotask(() => cb(refs));
  };
  return new Plugin<DecorationSet>({
    key: CITATION_BADGE_PLUGIN_KEY,
    state: {
      init: (_, { doc }) => {
        const { decorationSet, orderedRefs } = buildCitationBadgeData(doc);
        emit(orderedRefs);
        return decorationSet;
      },
      apply: (tr, prev) => {
        if (!tr.docChanged) return prev;
        const { decorationSet, orderedRefs } = buildCitationBadgeData(tr.doc);
        emit(orderedRefs);
        return decorationSet;
      },
    },
    props: {
      decorations(state) {
        return CITATION_BADGE_PLUGIN_KEY.getState(state);
      },
    },
  });
}

export const CitationMark = Mark.create<CitationMarkOptions>({
  name: CITATION_MARK_NAME,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  inclusive: false,

  addAttributes() {
    return {
      ref: {
        default: null,
        parseHTML: (element): string | null =>
          element.getAttribute(CITATION_DATA_ATTR) ?? element.getAttribute('ref'),
        renderHTML: (attributes): Record<string, string> => {
          if (!attributes['ref']) return {};
          return { [CITATION_DATA_ATTR]: String(attributes['ref']) };
        },
      },

      meaningful: {
        default: true,
        parseHTML: (element): boolean => /[\p{L}\p{N}]/u.test(element.textContent ?? ''),
        renderHTML: (): Record<string, string> => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'cite[ref]',
      },
      {
        tag: `cite[${CITATION_DATA_ATTR}]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const meaningful = (mark.attrs as { meaningful?: boolean }).meaningful !== false;
    const baseStyle = 'font-style:normal;cursor:pointer;';
    const highlightStyle = meaningful
      ? 'background-color:rgba(254,226,226,0.6);padding:0 0.15em;border-radius:0.2em;'
      : '';
    return [
      'cite',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'xyne-citation',
        style: baseStyle + highlightStyle,
      }),
      0,
    ];
  },

  addStorage() {
    return {
      onRefsChange: null as ((refs: string[]) => void) | null,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as {
      onRefsChange: ((refs: string[]) => void) | null;
    };
    return [createCitationBadgePlugin(() => storage.onRefsChange)];
  },
});

export interface InlineCitation {
  point: string;
  label: string;
  url: string;
}

function sanitizeCitationUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  // Accept relative URLs from xyne-claw (thread / canvas links)
  if (trimmed.startsWith('/')) {
    // Only allow well-formed relative paths (may contain %-encoded chars)
    if (/^\/[a-zA-Z0-9_/.\-=%]+$/.test(trimmed)) return trimmed;
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : '';
  } catch {
    return '';
  }
}

/**
 * v3 claw inline-citation token: `[clf-<toolCallId>#<chunkIndex>]`. Also
 * accepts the fullwidth-bracket variants the LLM occasionally emits.
 *
 * IMPORTANT: do NOT trail this with `\s?`. Tokens often sit at end-of-line in
 * markdown lists (`- Item [clf-...#1]\n- Next item`), and consuming the `\n`
 * collapses every list item into one paragraph (bug seen 2026-06-15).
 */
export const CLAW_CITATION_TOKEN_RE = /([【[⟦])(clf-[A-Za-z0-9_.:-]+#\d+)([】\]⟧])/g;

/**
 * Lenient catch-all for malformed clf tokens the LLM sometimes hallucinates.
 * Real example: `[clf-functions.Xyne_Spaces__spaces-tickets:0#1–20]` (en-dash
 * range), `[clf-chatcmpl-tool-be9722dab2b59416#1-20]` (wrong toolCallId
 * format), or any other shape that doesn't match the strict regex above.
 * Without this pass they'd render as raw bracket text in the prose. We strip
 * them outright since they're never valid citations.
 */
export const CLAW_CITATION_MALFORMED_RE = /[【[⟦]\s*clf-[^】\]⟧]*[】\]⟧]/g;

export function stripCitationMarks(html: string): string {
  return html
    .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, '$1')
    .replace(/\n?<citation\b[^>]*>([\s\S]*?)<\/citation>/gi, '')
    .replace(CLAW_CITATION_TOKEN_RE, '')
    .replace(CLAW_CITATION_MALFORMED_RE, '');
}

export interface ClawCitationRef {
  /** Raw toolCallId portion of the token (stripped of the leading "clf-"). */
  toolCallId: string;
  /** 1-based chunk index — matches Citation.chunkIndex on the matching tool invocation. */
  chunkIndex: number;
  /** The original token text, useful for replacement passes. */
  token: string;
}

/**
 * Scan markdown for v3-style `[clf-…#N]` inline citation tokens and return
 * a parsed list. Returns an empty list when no tokens are present, so callers
 * can short-circuit without extra checks.
 */
export function extractClawCitationRefs(content: string): ClawCitationRef[] {
  if (!content || content.indexOf('clf-') === -1) return [];
  const refs: ClawCitationRef[] = [];
  const re = new RegExp(CLAW_CITATION_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const body = m[2];
    if (!body) continue;
    const hashIdx = body.lastIndexOf('#');
    if (hashIdx <= 0) continue;
    const toolCallId = body.slice('clf-'.length, hashIdx);
    const chunkIndex = Number(body.slice(hashIdx + 1));
    if (!toolCallId || !Number.isFinite(chunkIndex)) continue;
    refs.push({ toolCallId, chunkIndex, token: m[0] });
  }
  return refs;
}

/**
 * Replace every `[clf-<toolCallId>#<N>]` token in `content` with the markdown
 * link `[<toolNumber>.<N>](cite:clf-<toolCallId>#<N>)`. Caller passes a
 * pre-built `toolNumbers` map keyed by toolCallId so the same tool used
 * across many tokens shares one stable display number (1, 2, 3 …) in the UI.
 *
 * Mirrors v3's `linkifyClawCitations` in ChatPageV3.tsx so behavior between
 * the two surfaces stays consistent.
 */
export function linkifyClawCitations(
  content: string,
  toolNumbers: ReadonlyMap<string, number>,
): string {
  if (!content || content.indexOf('clf-') === -1) return content;
  return content.replace(CLAW_CITATION_TOKEN_RE, (match, _o, body: string) => {
    const hashIdx = body.lastIndexOf('#');
    if (hashIdx <= 0) return match;
    const toolCallId = body.slice('clf-'.length, hashIdx);
    const chunkIndex = body.slice(hashIdx + 1);
    const toolNumber = toolNumbers.get(toolCallId);
    if (!toolNumber) return match;
    return `[${toolNumber}.${chunkIndex}](cite:${body})`;
  });
}

/** A single source inside a grouped (`cite-group:`) citation link. */
export interface ClawCiteGroupRef {
  toolCallId: string;
  chunkIndex: number;
}

/**
 * Like {@link linkifyClawCitations}, but additionally GROUPS runs of 2+ inline
 * citation tokens that sit next to each other (separated only by spaces/tabs —
 * no other text) into a single `[+N](cite-group:<body1>,<body2>,…)` link. The
 * `a` renderer turns that into a stacked "cluster" chip whose popover lists each
 * source. A lone token renders exactly as {@link linkifyClawCitations} would.
 */
export function linkifyAndGroupClawCitations(
  content: string,
  toolNumbers: ReadonlyMap<string, number>,
): string {
  if (!content || content.indexOf('clf-') === -1) return content;
  // Whole-token pattern (brackets included); mirrors CLAW_CITATION_TOKEN_RE.
  const TOKEN_SRC = '[【\\[⟦]clf-[A-Za-z0-9_.:-]+#\\d+[】\\]⟧]';
  // A maximal run of adjacent tokens — spaces/tabs (NOT newlines) between them,
  // so we never group across line breaks / list items.
  const runRe = new RegExp(`${TOKEN_SRC}(?:[ \\t]*${TOKEN_SRC})*`, 'g');
  const tokenRe = new RegExp(CLAW_CITATION_TOKEN_RE.source, 'g');
  return content.replace(runRe, run => {
    tokenRe.lastIndex = 0;
    const resolved: Array<{ body: string; toolNumber: number; chunkIndex: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(run)) !== null) {
      const body = m[2];
      if (!body) continue;
      const hashIdx = body.lastIndexOf('#');
      if (hashIdx <= 0) continue;
      const toolCallId = body.slice('clf-'.length, hashIdx);
      const chunkIndex = body.slice(hashIdx + 1);
      const toolNumber = toolNumbers.get(toolCallId);
      if (!toolNumber) continue; // unknown tool — drop, matches strip behavior
      resolved.push({ body, toolNumber, chunkIndex });
    }
    if (resolved.length === 0) return run; // leave raw for stripCitationMarks
    if (resolved.length === 1) {
      const r = resolved[0]!;
      return `[${r.toolNumber}.${r.chunkIndex}](cite:${r.body})`;
    }
    const bodies = resolved.map(r => r.body).join(',');
    return `[+${resolved.length}](cite-group:${bodies})`;
  });
}

/** Parse a `cite-group:<clf-a#1>,<clf-b#2>,…` href into its individual refs. */
export function parseCiteGroupHref(href: string): ClawCiteGroupRef[] {
  const PREFIX = 'cite-group:';
  if (!href || !href.startsWith(PREFIX)) return [];
  const refs: ClawCiteGroupRef[] = [];
  for (const raw of href.slice(PREFIX.length).split(',')) {
    const body = raw.trim();
    if (!body.startsWith('clf-')) continue;
    const rest = body.slice('clf-'.length);
    const hashIdx = rest.lastIndexOf('#');
    if (hashIdx <= 0) continue;
    const toolCallId = rest.slice(0, hashIdx);
    const chunkIndex = Number(rest.slice(hashIdx + 1));
    if (!toolCallId || !Number.isFinite(chunkIndex)) continue;
    refs.push({ toolCallId, chunkIndex });
  }
  return refs;
}

/**
 * Build a stable display-number map (`toolCallId` → 1, 2, 3 …) following the
 * order tokens appear in the rendered markdown — so the first tool the model
 * cites is always shown as "1.x" regardless of execution order.
 */
export function buildClawCitationToolNumbers(content: string): Map<string, number> {
  const numbers = new Map<string, number>();
  if (!content || content.indexOf('clf-') === -1) return numbers;
  const re = new RegExp(CLAW_CITATION_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const body = m[2];
    if (!body) continue;
    const hashIdx = body.lastIndexOf('#');
    if (hashIdx <= 0) continue;
    const toolCallId = body.slice('clf-'.length, hashIdx);
    if (!numbers.has(toolCallId)) numbers.set(toolCallId, numbers.size + 1);
  }
  return numbers;
}

export function extractCitationBlock(text: string | null | undefined): string {
  if (!text) return '';
  const match = /<citation\b[^>]*>[\s\S]*?<\/citation>/i.exec(text);
  return match?.[0] ?? '';
}

export function appendCitationBlock(
  content: string,
  citationSource: string | null | undefined,
): string {
  const block = extractCitationBlock(citationSource);
  if (!block) return content;
  return extractCitationBlock(content) ? content : `${content}${content ? '\n' : ''}${block}`;
}

/** Strips the entire <citation> block (including surrounding whitespace/newlines). */
export function stripCitationBlock(text: string): string {
  if (!text) return text;
  return text.replace(/\s*<citation\b[^>]*>([\s\S]*?)<\/citation>\s*/gi, '');
}

export function extractInlineCitations(content: string): InlineCitation[] {
  const match = /<citation\b[^>]*>([\s\S]*?)<\/citation>/i.exec(content);
  if (!match || !match[1]) return [];

  const citations: InlineCitation[] = [];
  const lines = match[1].trim().split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const km = /^\d+\.\s+(.+?)\s+\|\|\|\s+\[([^\]]+)\]\(([^)]+)\)/.exec(trimmed);
    if (km && km[1] && km[2]) {
      citations.push({
        point: km[1].trim(),
        label: km[2].trim(),
        url: sanitizeCitationUrl(km[3] || ''),
      });
      continue;
    }
    const lm = /^\d+\.\s*\[([^\]]+)\]\(([^)]+)\)/.exec(trimmed);
    if (lm && lm[1] && lm[2]) {
      citations.push({ point: '', label: lm[1].trim(), url: sanitizeCitationUrl(lm[2]) });
    }
  }
  return citations;
}

export function getCitationRefFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Node)) return null;
  const el = target instanceof Element ? target : target.parentElement;
  if (!el) return null;
  const refEl = el.closest(`[${CITATION_DATA_ATTR}]`);
  if (!refEl) return null;
  return refEl.getAttribute(CITATION_DATA_ATTR);
}
