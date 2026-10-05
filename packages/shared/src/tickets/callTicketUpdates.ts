/**
 * Shape of the "ticket updates from this call" card: one bot message per call
 * (`messageSubtype: call_ticket_updates`) whose YAML frontmatter carries the
 * proposals and what participants decided about them. The backend writes it and
 * the dashboard renders it, so the field mapping lives here once. Frontmatter
 * extraction (remark + yaml) stays in each app; this module only turns the parsed
 * object into a typed document and back.
 */

import { TicketStatusV2 } from '../zero/types.js';

export const CALL_TICKET_UPDATES_SUBTYPE = 'call_ticket_updates';
export const TICKET_UPDATES_HEADING = '## Ticket updates from this call';

/** An approval claims its row before doing anything; a claim older than this is abandoned. */
export const TICKET_UPDATE_CLAIM_TTL_MS = 2 * 60 * 1000;

export type TicketUpdateMatchedBy = 'xyne-id' | 'title' | 'number-only';

export interface TicketUpdateClaim {
  by: string;
  at: string;
}

export interface TicketUpdateProposal {
  updateId: string;
  ticketId: string;
  /**
   * The ticket lives outside the call's channel, so the card carries no identity
   * for it (no id, title, stage or thread). Each viewer resolves it through their
   * own ticket access; without access the row stays locked.
   */
  restricted: boolean;
  xyneId: string;
  title: string;
  ticketConversationId: string;
  ticketChannelId: string;
  boardType: string;
  currentStageName: string;
  currentStatusV2: string;
  /** The spoken update rewritten as a short status note. */
  update: string;
  proposedStatusV2: string | null;
  /** Stage on the ticket's board that carries the proposed status, when one can be picked. */
  proposedStageName: string | null;
  /** The other stages on the ticket's board, so the card can offer a picker. */
  stageOptions: string[];
  speaker: string | null;
  timestampSeconds: number | null;
  segment: number | null;
  quote: string | null;
  confidence: number;
  matchedBy: TicketUpdateMatchedBy;
  /** Set while someone's approval of this row is in flight. */
  claim: TicketUpdateClaim | null;
}

export interface AppliedTicketUpdate {
  updateId: string;
  ticketId: string;
  restricted: boolean;
  xyneId: string;
  title: string;
  ticketConversationId: string;
  ticketChannelId: string;
  appliedBy: string;
  appliedAt: string;
  commentMessageId: string | null;
  newStageName: string | null;
  newStatusV2: string | null;
  /** Stage move that was requested but is waiting for an approver on the board. */
  stagePendingApproval: string | null;
}

export interface IgnoredTicketUpdate {
  updateId: string;
  ticketId: string;
  restricted: boolean;
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

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    : [];
const notNull = <T>(x: T | null): x is T => x !== null;

function toClaim(raw: unknown): TicketUpdateClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const claim = raw as Record<string, unknown>;
  const by = str(claim['by']);
  const at = str(claim['at']);
  return by && at ? { by, at } : null;
}

function toProposal(raw: Record<string, unknown>): TicketUpdateProposal | null {
  const updateId = str(raw['updateId']);
  const ticketId = str(raw['ticketId']);
  if (!updateId || !ticketId) return null;
  const matchedBy = str(raw['matchedBy']);
  return {
    updateId,
    ticketId,
    restricted: raw['restricted'] === true,
    xyneId: str(raw['xyneId']),
    title: str(raw['title']),
    ticketConversationId: str(raw['ticketConversationId']),
    ticketChannelId: str(raw['ticketChannelId']),
    boardType: str(raw['boardType'], 'DEFAULT'),
    currentStageName: str(raw['currentStageName']),
    currentStatusV2: str(raw['currentStatusV2']),
    update: str(raw['update']),
    proposedStatusV2: strOrNull(raw['proposedStatusV2']),
    proposedStageName: strOrNull(raw['proposedStageName']),
    stageOptions: Array.isArray(raw['stageOptions'])
      ? raw['stageOptions'].filter((x): x is string => typeof x === 'string')
      : [],
    speaker: strOrNull(raw['speaker']),
    timestampSeconds: numOrNull(raw['timestampSeconds']),
    segment: numOrNull(raw['segment']),
    quote: strOrNull(raw['quote']),
    confidence: typeof raw['confidence'] === 'number' ? raw['confidence'] : 0,
    matchedBy: matchedBy === 'title' || matchedBy === 'number-only' ? matchedBy : 'xyne-id',
    claim: toClaim(raw['claim']),
  };
}

function toApplied(raw: Record<string, unknown>): AppliedTicketUpdate | null {
  const updateId = str(raw['updateId']);
  const ticketId = str(raw['ticketId']);
  if (!updateId || !ticketId) return null;
  return {
    updateId,
    ticketId,
    restricted: raw['restricted'] === true,
    xyneId: str(raw['xyneId']),
    title: str(raw['title']),
    ticketConversationId: str(raw['ticketConversationId']),
    ticketChannelId: str(raw['ticketChannelId']),
    appliedBy: str(raw['appliedBy']),
    appliedAt: str(raw['appliedAt']),
    commentMessageId: strOrNull(raw['commentMessageId']),
    newStageName: strOrNull(raw['newStageName']),
    newStatusV2: strOrNull(raw['newStatusV2']),
    stagePendingApproval: strOrNull(raw['stagePendingApproval']),
  };
}

function toIgnored(raw: Record<string, unknown>): IgnoredTicketUpdate | null {
  const updateId = str(raw['updateId']);
  const ticketId = str(raw['ticketId']);
  if (!updateId || !ticketId) return null;
  return {
    updateId,
    ticketId,
    restricted: raw['restricted'] === true,
    xyneId: str(raw['xyneId']),
    title: str(raw['title']),
    ignoredBy: str(raw['ignoredBy']),
    ignoredAt: str(raw['ignoredAt']),
  };
}

/** Turn a parsed frontmatter object into a typed document. Unknown or malformed entries are dropped. */
export function normalizeTicketUpdatesDoc(raw: unknown): TicketUpdatesDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { updates: [], applied: [], ignored: [] };
  }
  const data = raw as Record<string, unknown>;
  return {
    updates: records(data['updates']).map(toProposal).filter(notNull),
    applied: records(data['applied']).map(toApplied).filter(notNull),
    ignored: records(data['ignored']).map(toIgnored).filter(notNull),
  };
}

/** Drop empty strings, nulls, empty lists and `false` flags so a row only stores what it actually carries. */
function compact<T extends object>(entry: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === null || value === undefined || value === '' || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The plain object to dump as frontmatter. A restricted row never serialises an
 * identity field, whatever the in-memory object holds. `boardType` stays: it
 * identifies nothing, and the card needs it to know a flow board takes no stage.
 */
export function serializeTicketUpdatesDoc(doc: TicketUpdatesDoc): Record<string, unknown> {
  const stripIdentity = <T extends { restricted: boolean }>(entry: T): T =>
    entry.restricted
      ? {
          ...entry,
          xyneId: '',
          title: '',
          ticketConversationId: '',
          ticketChannelId: '',
          currentStageName: '',
          currentStatusV2: '',
          proposedStageName: null,
          stageOptions: [],
          newStageName: null,
          stagePendingApproval: null,
        }
      : entry;
  const data: Record<string, unknown> = {};
  if (doc.updates.length > 0) data['updates'] = doc.updates.map((u) => compact(stripIdentity(u)));
  if (doc.applied.length > 0) data['applied'] = doc.applied.map((a) => compact(stripIdentity(a)));
  if (doc.ignored.length > 0) data['ignored'] = doc.ignored.map((i) => compact(stripIdentity(i)));
  return data;
}

/** A position in a call as MM:SS, or H:MM:SS past the hour. */
export function formatCallTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Where an approved update came from: the line appended to the comment posted on
 * the ticket. One wording for the server that posts it and the card that previews it.
 * `when` is the already-formatted position in the call, when one is known.
 */
export function ticketUpdateCommentSource(params: {
  callTitle: string | null;
  callStartedAt: Date | number;
  when: string | null;
  speaker: string | null;
}): string {
  const { callTitle, callStartedAt, when, speaker } = params;
  const callLabel = callTitle
    ? `the call "${callTitle}"`
    : `the call on ${new Date(callStartedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `From ${callLabel}${when ? ` at ${when}` : ''}${speaker ? `, said by ${speaker}` : ''}.`;
}

export interface TicketUpdateBoardStage {
  name: string;
  sequenceNumber: number;
  defaultTicketStatusV2: string;
}

const STAGE_NAME_HINTS: Record<string, RegExp> = {
  [TicketStatusV2.COMPLETED]: /\b(done|complete|completed|closed|resolved|shipped|released|finished)\b/i,
  [TicketStatusV2.STARTED]:
    /\b(in progress|in-progress|doing|development|in dev|working|active|started|implementation)\b/i,
  [TicketStatusV2.PAUSED]: /\b(paused|on hold|on-hold|blocked|parked|waiting|hold)\b/i,
  [TicketStatusV2.CANCELLED]: /\b(cancelled|canceled|won'?t (do|fix)|rejected|dropped|invalid|discarded)\b/i,
  [TicketStatusV2.TODO]: /\b(todo|to do|backlog|triage|new|open|not started)\b/i,
};

/**
 * Pick the stage a ticket should move to for a spoken status. Exact
 * `defaultTicketStatusV2` matches win; when several stages share that status
 * (common on boards where every stage defaults to STARTED) or none does, fall
 * back to the stage name and board order so the card can still prefill the
 * picker. Returns null only when nothing sensible exists.
 *
 * Shared because both sides need the same answer: the backend when it builds a
 * proposal or applies one without a stage, the dashboard when it prefills the
 * picker for a ticket whose stages the card does not carry.
 */
export function resolveStageForStatus(
  stages: TicketUpdateBoardStage[],
  currentStageName: string,
  status: string,
): string | null {
  const ordered = [...stages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const others = ordered.filter((s) => s.name !== currentStageName);
  if (others.length === 0) return null;
  const hint = STAGE_NAME_HINTS[status];
  const byStatus = others.filter((s) => s.defaultTicketStatusV2 === status);

  if (byStatus.length === 1) return byStatus[0].name;
  const pool = byStatus.length > 1 ? byStatus : others;
  const byName = hint ? pool.filter((s) => hint.test(s.name)) : [];
  if (byName.length > 0) return byName[0].name;
  if (byStatus.length === 0) {
    // No stage carries the status and none is named for it: "done" still means
    // the last stage of the board; anything else has no sensible target.
    const last = ordered[ordered.length - 1];
    return status === TicketStatusV2.COMPLETED && last.name !== currentStageName ? last.name : null;
  }
  // Several stages carry the status and none is named for it: use board order.
  const currentSeq = ordered.find((s) => s.name === currentStageName)?.sequenceNumber ?? -1;
  if (status === TicketStatusV2.COMPLETED) return byStatus[byStatus.length - 1].name;
  if (status === TicketStatusV2.TODO) return byStatus[0].name;
  return byStatus.find((s) => s.sequenceNumber > currentSeq)?.name ?? byStatus[0].name;
}

export function isTicketUpdateClaimFresh(
  claim: TicketUpdateClaim | null,
  nowMs: number = Date.now(),
): claim is TicketUpdateClaim {
  if (!claim) return false;
  const at = Date.parse(claim.at);
  return Number.isFinite(at) && nowMs - at < TICKET_UPDATE_CLAIM_TTL_MS;
}
