/* Obsidian-flavored markdown support for the attachment "rendered" view.
 *
 * All Obsidian syntax is expanded at the REMARK (mdast) stage into inert,
 * allow-listed nodes; nothing here emits raw HTML. Wire order matters:
 *  - properties table needs the frontmatter node from remark-frontmatter
 *  - embeds run before wikilinks so `![[...]]` is consumed before `[[...]]`
 *
 * Consumed by ReadmeViewer together with `obsidianSanitizeSchema` (the single
 * security gate, used WITHOUT rehype-raw) and `obsidianComponents`. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import remarkFrontmatter from 'remark-frontmatter';
import remarkPropertiesTable from './remarkPropertiesTable';
import remarkObsidianCallouts from './remarkObsidianCallouts';
import remarkObsidianEmbeds from './remarkObsidianEmbeds';
import remarkWikiLinks from './remarkWikiLinks';
import remarkObsidianTags from './remarkObsidianTags';
import remarkHighlight from './remarkHighlight';

export const obsidianRemarkPlugins: any[] = [
  [remarkFrontmatter, ['yaml']],
  remarkPropertiesTable,
  remarkObsidianCallouts,
  remarkObsidianEmbeds,
  remarkWikiLinks,
  remarkObsidianTags,
  remarkHighlight,
];

export { obsidianSanitizeSchema } from './sanitizeSchema';
export { obsidianComponents } from './components';
