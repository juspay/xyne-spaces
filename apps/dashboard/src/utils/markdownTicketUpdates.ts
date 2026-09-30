/**
 * Parses the "ticket updates from this call" card message (messageSubtype
 * `call_ticket_updates`). The backend keeps the proposals in a YAML frontmatter
 * block at the top of the message; see apps/backend/src/utils/ticketUpdateMarkdown.ts
 * for the canonical shape. Also exposes the generic frontmatter strip used for
 * every markdown bot message so the YAML never renders as text.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad } from 'js-yaml';

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
  update: string;
  proposedStatusV2: string | null;
  proposedStageName: string | null;
  stageOptions: string[];
  speaker: string | null;
  timestampSeconds: number | null;
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

export interface ParsedTicketUpdates {
  updates: TicketUpdateProposal[];
  applied: AppliedTicketUpdate[];
  ignored: IgnoredTicketUpdate[];
  /** Markdown body with the frontmatter removed. */
  content: string;
}

function parseFrontmatter(markdown: string): { data: Record<string, unknown>; end: number } | null {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);
  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const data = yamlLoad(node.value);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        return { data: data as Record<string, unknown>, end: node.position?.end.offset ?? 0 };
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

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    : [];

export function parseTicketUpdatesMarkdown(markdown: string): ParsedTicketUpdates {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { updates: [], applied: [], ignored: [], content: markdown };
  const { data, end } = fm;

  const updates: TicketUpdateProposal[] = records(data['updates'])
    .map(u => {
      const matchedBy = str(u['matchedBy']);
      return {
        updateId: str(u['updateId']),
        ticketId: str(u['ticketId']),
        xyneId: str(u['xyneId']),
        title: str(u['title']),
        ticketConversationId: str(u['ticketConversationId']),
        boardType: str(u['boardType'], 'DEFAULT'),
        currentStageName: str(u['currentStageName']),
        currentStatusV2: str(u['currentStatusV2']),
        update: str(u['update']),
        proposedStatusV2: strOrNull(u['proposedStatusV2']),
        proposedStageName: strOrNull(u['proposedStageName']),
        stageOptions: Array.isArray(u['stageOptions'])
          ? u['stageOptions'].filter((x): x is string => typeof x === 'string')
          : [],
        speaker: strOrNull(u['speaker']),
        timestampSeconds: numOrNull(u['timestampSeconds']),
        quote: strOrNull(u['quote']),
        confidence: typeof u['confidence'] === 'number' ? u['confidence'] : 0,
        matchedBy: (matchedBy === 'title' || matchedBy === 'number-only'
          ? matchedBy
          : 'xyne-id') as TicketUpdateMatchedBy,
      };
    })
    .filter(u => u.updateId && u.ticketId);

  const applied: AppliedTicketUpdate[] = records(data['applied'])
    .map(a => ({
      updateId: str(a['updateId']),
      ticketId: str(a['ticketId']),
      xyneId: str(a['xyneId']),
      title: str(a['title']),
      ticketConversationId: str(a['ticketConversationId']),
      appliedBy: str(a['appliedBy']),
      appliedAt: str(a['appliedAt']),
      commentMessageId: strOrNull(a['commentMessageId']),
      newStageName: strOrNull(a['newStageName']),
      newStatusV2: strOrNull(a['newStatusV2']),
    }))
    .filter(a => a.updateId && a.ticketId);

  const ignored: IgnoredTicketUpdate[] = records(data['ignored'])
    .map(i => ({
      updateId: str(i['updateId']),
      ticketId: str(i['ticketId']),
      xyneId: str(i['xyneId']),
      title: str(i['title']),
      ignoredBy: str(i['ignoredBy']),
      ignoredAt: str(i['ignoredAt']),
    }))
    .filter(i => i.updateId && i.ticketId);

  return { updates, applied, ignored, content: markdown.substring(end).trim() };
}

export function formatTranscriptTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
