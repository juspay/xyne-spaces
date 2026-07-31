/* Obsidian inline tags: `#tag`, `#nested/tag`.
 * Rendered as an inert chip span (not a link). The leading boundary character
 * (start-of-text or whitespace / open-paren) is preserved as its own text node
 * so we don't tag `#` inside words, URLs (`example.com/#x`) or hex colours after
 * a non-boundary character. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { replaceInText } from './mdastText';

export default function remarkObsidianTags() {
  return (tree: any): void => {
    replaceInText(tree, /(^|[\s(])#([A-Za-z][\w-]*(?:\/[\w-]+)*)/, (m) => [
      { type: 'text', value: m[1] },
      {
        type: 'obsidianInline',
        data: { hName: 'span', hProperties: { className: ['obsidian-tag'], dataTag: m[2] } },
        children: [{ type: 'text', value: `#${m[2]}` }],
      },
    ]);
  };
}
