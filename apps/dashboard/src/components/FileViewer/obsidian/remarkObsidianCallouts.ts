/* Obsidian callouts: `> [!type] Optional title` blockquotes.
 * Transforms the blockquote (in-place) into an inert styled container by
 * setting data.hName/hProperties — mdast-util-to-hast emits <div data-callout>.
 * No raw HTML is produced; the sanitize allow-list keeps only div+data-callout. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { calloutMeta } from './labels';

export default function remarkObsidianCallouts() {
  return (tree: any): void => {
    const recurse = (node: any): void => {
      if (!node || !Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child && child.type === 'blockquote') convert(child);
        recurse(child);
      }
    };
    recurse(tree);
  };
}

function convert(bq: any): void {
  const first = bq.children?.[0];
  if (!first || first.type !== 'paragraph' || !Array.isArray(first.children)) return;
  const t0 = first.children[0];
  if (!t0 || t0.type !== 'text') return;

  const m = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]?([^\n]*)/.exec(t0.value);
  if (!m) return;

  const type = m[1].toLowerCase();
  const custom = (m[3] || '').trim();
  // Drop the marker line; keep any body text that followed on later lines.
  t0.value = t0.value.slice(m[0].length);
  const paraEmpty = first.children.every((c: any) => c.type === 'text' && !c.value.trim());
  if (paraEmpty) bq.children.shift();

  const meta = calloutMeta(type);
  bq.data = {
    hName: 'div',
    hProperties: { className: ['obsidian-callout'], dataCallout: type },
  };
  bq.children.unshift({
    type: 'paragraph',
    data: { hName: 'div', hProperties: { className: ['obsidian-callout-header'] } },
    children: [{ type: 'text', value: `${meta.icon}  ${custom || meta.label}` }],
  });
}
