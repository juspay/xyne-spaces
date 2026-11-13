/**
 * `:::citation{…}` support for {@link MarkdownView} — the markdown half of runtime
 * citations, mirroring what `cite={…}` does for structured data.
 *
 * An agent writing prose wraps each sourced statement in a container directive:
 *
 *   :::citation{ref="steps.ocr.output.results.0.data" page=3 quote="TOTAL 5000"}
 *   The invoice totals ₹5,000.
 *   :::
 *
 * which renders the statement plus a ↗ marker opening the source.
 */
import { visit, SKIP } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { defaultSchema } from 'rehype-sanitize';
import { CITATION_DIRECTIVE_ATTRS } from '@xyne/workflow-sdk/common';

/** The element the directive becomes; `components` maps it to MarkdownCitation. */
export const CITATION_TAG = 'citation';

type DirectiveNode = {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: unknown[];
  data?: Record<string, unknown>;
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } };
  value?: string;
};

const DIRECTIVE_TYPES = new Set(['containerDirective', 'leafDirective', 'textDirective']);

/**
 * Replace a node with the exact markdown it was parsed from.
 *
 * Enabling remark-directive turns on `:name` / `::name` / `:::name` **globally**,
 * for every MarkdownView caller — so text that merely looks like a directive
 * (`:release:`, a `:shrug` shortcode) would parse into an unknown node that
 * rehype-sanitize then unwraps, silently deleting the author's words. Restoring
 * the original source keeps this feature from changing any prose but our own.
 *
 * The source is sliced by the node's own offsets, so it round-trips exactly
 * rather than being re-serialised approximately.
 */
function revertToSource(node: DirectiveNode, source: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  const literal = source.slice(start, end);

  delete node.name;
  delete node.attributes;
  delete node.data;

  if (node.type === 'textDirective') {
    node.type = 'text';
    node.value = literal;
    delete node.children;
    return true;
  }
  // Block-level: `text` isn't valid where a block directive sat, so wrap it.
  node.type = 'paragraph';
  node.children = [{ type: 'text', value: literal }];
  return true;
}

/**
 * Map `:::citation{…}` onto a `<citation>` element carrying its attributes, and
 * neutralise every other directive (see {@link revertToSource}).
 */
export function remarkCitationDirective() {
  return (tree: Root, file: VFile): void => {
    const source = String(file.value);

    visit(tree, (node) => {
      const n = node as unknown as DirectiveNode;
      if (!DIRECTIVE_TYPES.has(n.type)) return;

      if (n.type === 'containerDirective' && n.name === CITATION_TAG) {
        const attrs = n.attributes ?? {};
        const props: Record<string, string> = {};
        for (const key of CITATION_DIRECTIVE_ATTRS) {
          const v = attrs[key];
          if (typeof v === 'string' && v !== '') props[key] = v;
        }
        // A lone paragraph would put a block inside our inline wrapper and push
        // the marker onto its own line; unwrap it so the marker trails the text.
        const kids = n.children;
        if (Array.isArray(kids) && kids.length === 1) {
          const only = kids[0] as { type?: string; children?: unknown[] };
          if (only.type === 'paragraph' && Array.isArray(only.children)) {
            n.children = only.children;
          }
        }
        const data = n.data ?? (n.data = {});
        data['hName'] = CITATION_TAG;
        data['hProperties'] = props;
        return;
      }

      if (revertToSource(n, source)) return SKIP;
      return;
    });
  };
}

/**
 * `defaultSchema` plus the `citation` element.
 *
 * Without this, sanitize doesn't merely ignore `<citation>` — it **unwraps** it,
 * dropping the marker while keeping the text, so citations would silently vanish.
 * Only our five attributes are allowed through, and `url` is confined to http(s),
 * so the directive can't smuggle in markup or a `javascript:` target.
 */
export const citationSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), CITATION_TAG],
  attributes: {
    ...defaultSchema.attributes,
    [CITATION_TAG]: [...CITATION_DIRECTIVE_ATTRS],
  },
  protocols: {
    ...defaultSchema.protocols,
    url: ['http', 'https'],
  },
};
