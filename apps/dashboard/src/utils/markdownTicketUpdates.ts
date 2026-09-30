/**
 * Reads the "ticket updates from this call" card message (messageSubtype
 * `call_ticket_updates`). The backend keeps the proposals in a YAML frontmatter
 * block at the top of the message. The document shape and its field mapping are
 * shared with the backend in `@xyne/shared` (tickets/callTicketUpdates); this
 * file only extracts the frontmatter. It also exposes the generic frontmatter
 * strip used for every markdown bot message so the YAML never renders as text,
 * and a read-only parser for the retired "Suggested Tickets" card.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad } from 'js-yaml';
import { normalizeTicketUpdatesDoc, type TicketUpdatesDoc } from '@xyne/shared';

export type {
  AppliedTicketUpdate,
  IgnoredTicketUpdate,
  TicketUpdateProposal,
  TicketUpdatesDoc,
} from '@xyne/shared';

export interface ParsedTicketUpdates extends TicketUpdatesDoc {
  /** Markdown body with the frontmatter removed. */
  content: string;
}

function parseFrontmatter(markdown: string): { data: unknown; end: number } | null {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);
  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        const data: unknown = yamlLoad(node.value);
        return { data, end: node.position?.end.offset ?? 0 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Remove a leading YAML frontmatter block, if any. */
export function stripFrontmatter(markdown: string): string {
  const fm = parseFrontmatter(markdown);
  return fm ? markdown.substring(fm.end).trim() : markdown;
}

export function parseTicketUpdatesMarkdown(markdown: string): ParsedTicketUpdates {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { updates: [], applied: [], ignored: [], content: markdown };
  return { ...normalizeTicketUpdatesDoc(fm.data), content: markdown.substring(fm.end).trim() };
}

export interface LegacyTicketSuggestion {
  title: string;
  description: string;
}

export interface LegacyCreatedTicket {
  ticketId: string;
  xyneId: string;
  title: string;
  conversationId: string;
}

export interface LegacySuggestedTickets {
  suggestions: LegacyTicketSuggestion[];
  created: LegacyCreatedTicket[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
      )
    : [];

/**
 * The retired "Suggested Tickets" card (`call_suggested_tickets`) kept its state
 * the same way: `suggestions[]` that were never acted on and `created[]` for the
 * tickets someone made from one. Old messages are shown read-only from this.
 */
export function parseLegacySuggestedTickets(markdown: string): LegacySuggestedTickets {
  const fm = parseFrontmatter(markdown);
  const data =
    fm && fm.data && typeof fm.data === 'object' && !Array.isArray(fm.data)
      ? (fm.data as Record<string, unknown>)
      : {};
  return {
    suggestions: objects(data['suggestions'])
      .map(s => ({ title: text(s['title']), description: text(s['description']) }))
      .filter(s => s.title),
    created: objects(data['created'])
      .map(c => ({
        ticketId: text(c['ticketId']),
        xyneId: text(c['xyneId']),
        title: text(c['title']),
        conversationId: text(c['conversationId']),
      }))
      .filter(c => c.ticketId && c.xyneId),
  };
}

export function formatTranscriptTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
