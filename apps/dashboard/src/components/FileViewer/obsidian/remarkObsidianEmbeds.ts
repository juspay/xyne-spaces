/* Obsidian embeds/transclusion: `![[Note#Heading]]`.
 * SECURITY: an attachment has no vault to resolve against, so we NEVER fetch or
 * resolve the target (prevents SSRF / tracking). It renders as an inert
 * placeholder span. Runs BEFORE the wikilink pass so the leading `!` is consumed. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { replaceInText } from './mdastText';

export default function remarkObsidianEmbeds() {
  return (tree: any): void => {
    replaceInText(tree, /!\[\[([^\]\n]+)\]\]/, (m) => {
      const target = m[1].trim();
      return {
        type: 'obsidianEmbed',
        data: {
          hName: 'span',
          hProperties: { className: ['obsidian-embed'], dataEmbed: target },
        },
        children: [{ type: 'text', value: `⧉ Embedded note “${target}” — preview not available` }],
      };
    });
  };
}
