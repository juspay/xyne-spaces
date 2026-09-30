/**
 * Content format of the "ticket updates from this call" card message that the
 * post-call pipeline posts into a call thread (messageSubtype
 * `call_ticket_updates`). The proposals live in a YAML frontmatter block, the
 * same convention the Pulse actionables message uses, and the dashboard renders
 * the card from that block. Approve / ignore move an item from `updates` to
 * `applied` / `ignored` and rewrite the message in place.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { logger } from './logger';

export const CALL_TICKET_UPDATES_SUBTYPE = 'call_ticket_updates';
export const TICKET_UPDATES_HEADING = '## Ticket updates from this call';

export type TicketUpdateMatchedBy = 'xyne-id' | 'title' | 'number-only';

export interface TicketUpdateProposal {
  updateId: string;
  ticketId: string;
  xyneId: string;
  title: string;
  ticketConversationId: string;
  boardType: string;
  currentStageName: string;
  currentStatusV2: string;
  /** The spoken update rewritten as a short status note. */
  update: string;
  proposedStatusV2: string | null;
  /** Stage on the ticket's board that carries the proposed status, when unambiguous. */
  proposedStageName: string | null;
  /** All stage names on the ticket's board, so the card can offer a picker. */
  stageOptions: string[];
  speaker: string | null;
  timestampSeconds: number | null;
  segment: number | null;
  quote: string | null;
  confidence: number;
  matchedBy: TicketUpdateMatchedBy;
}

export interface AppliedTicketUpdate {
  updateId: string;
  ticketId: string;
  xyneId: string;
  title: string;
  ticketConversationId: string;
  appliedBy: string;
  appliedAt: string;
  commentMessageId: string | null;
  newStageName: string | null;
  newStatusV2: string | null;
}

export interface IgnoredTicketUpdate {
  updateId: string;
  ticketId: string;
  xyneId: string;
  title: string;
  ignoredBy: string;
  ignoredAt: string;
}

export interface TicketUpdatesDoc {
  updates: TicketUpdateProposal[];
  applied: AppliedTicketUpdate[];
  ignored: IgnoredTicketUpdate[];
}

function parseFrontmatter(markdown: string): { data: Record<string, unknown>; end: number } | null {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);
  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        const data = yamlLoad(node.value);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        return { data: data as Record<string, unknown>, end: node.position?.end.offset ?? 0 };
      } catch (error) {
        logger.error('[ticketUpdateMarkdown] Failed to parse YAML frontmatter', { error });
        return null;
      }
    }
  }
  return null;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];

function toProposal(raw: Record<string, unknown>): TicketUpdateProposal | null {
  const updateId = str(raw['updateId']);
  const ticketId = str(raw['ticketId']);
  if (!updateId || !ticketId) return null;
  const matchedBy = str(raw['matchedBy']);
  return {
    updateId,
    ticketId,
    xyneId: str(raw['xyneId']),
    title: str(raw['title']),
    ticketConversationId: str(raw['ticketConversationId']),
    boardType: str(raw['boardType'], 'DEFAULT'),
    currentStageName: str(raw['currentStageName']),
    currentStatusV2: str(raw['currentStatusV2']),
    update: str(raw['update']),
    proposedStatusV2: strOrNull(raw['proposedStatusV2']),
    proposedStageName: strOrNull(raw['proposedStageName']),
    stageOptions: Array.isArray(raw['stageOptions']) ? raw['stageOptions'].filter((x): x is string => typeof x === 'string') : [],
    speaker: strOrNull(raw['speaker']),
    timestampSeconds: numOrNull(raw['timestampSeconds']),
    segment: numOrNull(raw['segment']),
    quote: strOrNull(raw['quote']),
    confidence: typeof raw['confidence'] === 'number' ? raw['confidence'] : 0,
    matchedBy: matchedBy === 'title' || matchedBy === 'number-only' ? matchedBy : 'xyne-id',
  };
}

function toApplied(raw: Record<string, unknown>): AppliedTicketUpdate | null {
  const updateId = str(raw['updateId']);
  const ticketId = str(raw['ticketId']);
  if (!updateId || !ticketId) return null;
  return {
    updateId,
    ticketId,
    xyneId: str(raw['xyneId']),
    title: str(raw['title']),
    ticketConversationId: str(raw['ticketConversationId']),
    appliedBy: str(raw['appliedBy']),
    appliedAt: str(raw['appliedAt']),
    commentMessageId: strOrNull(raw['commentMessageId']),
    newStageName: strOrNull(raw['newStageName']),
    newStatusV2: strOrNull(raw['newStatusV2']),
  };
}

function toIgnored(raw: Record<string, unknown>): IgnoredTicketUpdate | null {
  const updateId = str(raw['updateId']);
  const ticketId = str(raw['ticketId']);
  if (!updateId || !ticketId) return null;
  return {
    updateId,
    ticketId,
    xyneId: str(raw['xyneId']),
    title: str(raw['title']),
    ignoredBy: str(raw['ignoredBy']),
    ignoredAt: str(raw['ignoredAt']),
  };
}

export function parseTicketUpdatesContent(markdown: string): TicketUpdatesDoc {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { updates: [], applied: [], ignored: [] };
  const notNull = <T>(x: T | null): x is T => x !== null;
  return {
    updates: asArray(fm.data['updates']).map(toProposal).filter(notNull),
    applied: asArray(fm.data['applied']).map(toApplied).filter(notNull),
    ignored: asArray(fm.data['ignored']).map(toIgnored).filter(notNull),
  };
}

export function buildTicketUpdatesContent(doc: TicketUpdatesDoc): string {
  const data: Record<string, unknown> = {};
  if (doc.updates.length > 0) data['updates'] = doc.updates;
  if (doc.applied.length > 0) data['applied'] = doc.applied;
  if (doc.ignored.length > 0) data['ignored'] = doc.ignored;
  return '---\n' + yamlDump(data, { lineWidth: -1 }) + '---\n\n' + TICKET_UPDATES_HEADING + '\n';
}

/**
 * Move one pending proposal into `applied` or `ignored`. Returns the rewritten
 * content plus the proposal that was moved, or null when the id is not pending.
 */
export function moveTicketUpdate(
  markdown: string,
  updateId: string,
  target: { applied: AppliedTicketUpdate } | { ignored: IgnoredTicketUpdate },
): { content: string; update: TicketUpdateProposal } | null {
  const doc = parseTicketUpdatesContent(markdown);
  const update = doc.updates.find((u) => u.updateId === updateId);
  if (!update) return null;
  const next: TicketUpdatesDoc = {
    updates: doc.updates.filter((u) => u.updateId !== updateId),
    applied: 'applied' in target ? [...doc.applied, target.applied] : doc.applied,
    ignored: 'ignored' in target ? [...doc.ignored, target.ignored] : doc.ignored,
  };
  return { content: buildTicketUpdatesContent(next), update };
}
