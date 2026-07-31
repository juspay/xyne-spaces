/* Obsidian wikilinks: `[[Note]]` and `[[Note|alias]]`.
 * SECURITY: rendered as an INERT span, never an <a href>. There is no vault to
 * resolve to in an attachment, and turning arbitrary target text into a link
 * would open protocol-injection / open-redirect surface for zero benefit. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { replaceInText } from './mdastText';

export default function remarkWikiLinks() {
  return (tree: any): void => {
    replaceInText(tree, /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/, (m) => {
      const target = m[1].trim();
      const alias = (m[2] || m[1]).trim();
      return {
        type: 'obsidianInline',
        data: {
          hName: 'span',
          hProperties: { className: ['obsidian-wikilink'], dataWikilink: target },
        },
        children: [{ type: 'text', value: alias }],
      };
    });
  };
}
