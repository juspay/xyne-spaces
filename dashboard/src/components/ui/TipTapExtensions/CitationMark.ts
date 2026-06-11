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

export function stripCitationMarks(html: string): string {
  return html
    .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, '$1')
    .replace(/\n?<citation\b[^>]*>([\s\S]*?)<\/citation>/gi, '');
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

export function stripOrphanCitations(
  html: string | null | undefined,
  validRefs: ReadonlySet<string> | null,
): string {
  if (!html) return '';
  if (!validRefs) return html;
  return html.replace(
    /<cite\b([^>]*)>([\s\S]*?)<\/cite>/gi,
    (match, attrs: string, inner: string) => {
      const refMatch = /(?:data-citation-ref|ref)="([^"]+)"/i.exec(attrs);
      if (!refMatch || !refMatch[1]) return match;
      return validRefs.has(refMatch[1]) ? match : inner;
    },
  );
}

export function extractCitationRefs(html: string | null | undefined): string[] {
  if (!html) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  const re = /<cite\b[^>]*?(?:data-citation-ref|ref)="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const ref = match[1];
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

export function extractCitationContents(html: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!html) return out;
  const re = /<cite\b([^>]*)>([\s\S]*?)<\/cite>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const refMatch = /(?:data-citation-ref|ref)="([^"]+)"/i.exec(attrs);
    const ref = refMatch?.[1];
    if (!ref || out.has(ref)) continue;
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.set(ref, text);
  }
  return out;
}

export function getCitationRefFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Node)) return null;
  const el = target instanceof Element ? target : target.parentElement;
  if (!el) return null;
  const refEl = el.closest(`[${CITATION_DATA_ATTR}]`);
  if (!refEl) return null;
  return refEl.getAttribute(CITATION_DATA_ATTR);
}

export default CitationMark;
