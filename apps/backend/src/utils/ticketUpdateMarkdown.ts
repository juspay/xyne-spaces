/**
 * Reads and writes the "ticket updates from this call" card message
 * (messageSubtype `call_ticket_updates`). The proposals live in a YAML
 * frontmatter block, the same convention the Pulse actionables message uses. The
 * document shape and its field mapping are shared with the dashboard in
 * `@xyne/shared` (tickets/callTicketUpdates); this file only does the frontmatter
 * extraction and the YAML dump.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import {
  TICKET_UPDATES_HEADING,
  normalizeTicketUpdatesDoc,
  serializeTicketUpdatesDoc,
  type TicketUpdatesDoc,
} from '@xyne/shared';
import { logger } from './logger';

export {
  CALL_TICKET_UPDATES_SUBTYPE,
  TICKET_UPDATES_HEADING,
  isTicketUpdateClaimFresh,
  type AppliedTicketUpdate,
  type IgnoredTicketUpdate,
  type TicketUpdateClaim,
  type TicketUpdateMatchedBy,
  type TicketUpdateProposal,
  type TicketUpdatesDoc,
} from '@xyne/shared';

function parseFrontmatter(markdown: string): unknown {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);
  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        return yamlLoad(node.value);
      } catch (error) {
        logger.error('[ticketUpdateMarkdown] Failed to parse YAML frontmatter', { error });
        return null;
      }
    }
  }
  return null;
}

export function parseTicketUpdatesContent(markdown: string): TicketUpdatesDoc {
  return normalizeTicketUpdatesDoc(parseFrontmatter(markdown));
}

export function buildTicketUpdatesContent(doc: TicketUpdatesDoc): string {
  return (
    '---\n' + yamlDump(serializeTicketUpdatesDoc(doc), { lineWidth: -1 }) + '---\n\n' + TICKET_UPDATES_HEADING + '\n'
  );
}
