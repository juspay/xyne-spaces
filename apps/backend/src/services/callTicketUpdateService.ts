/**
 * Post-call "ticket updates": find EXISTING tickets that people talked about in a
 * call transcript, extract what was said about each one and any spoken status
 * change, and post them as a review card in the call thread. Nothing is applied
 * automatically — a call participant approves each item (comment on the ticket
 * and/or move its stage) or ignores it.
 *
 * Matching never searches the whole workspace: the LLM only chooses among a
 * bounded candidate list (ticket ids spoken in the transcript, the channel's open
 * tickets, tickets assigned to the participants, and tickets discussed in earlier
 * instances of the same recurring series), so a garbled project code still
 * resolves against a small set.
 *
 * The card is one message read by everyone in the call's channel, so a ticket
 * from any other channel is posted as a "restricted" row that carries no ticket
 * identity: each viewer resolves it through their own ticket access, and approve
 * / ignore check that access again here.
 */
import { randomUUID } from 'crypto';
import type { Agent } from '@framework';
import type { Call, Message } from '@prisma/client';
import { ActivityType, BoardType, ChannelVisibility, MessageType, TicketStatusV2 } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { withWorkspaceScope } from '@/database/tenant/context';
import { mutateTicketUpdatesCardTx } from '@/bypassAcl/transactions/callTicketUpdateService';
import { logger } from '@/utils/logger';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { executeCallLlmWithRetry } from './callLlmRetry';
import { numberTranscriptSegments, type CitationSegment } from '@/services/callDocumentService';
import { callShareService } from '@/services/callShareService';
import { conversationService } from '@/services/conversationService';
import { ticketStageTransitionService } from '@/services/stageTransition/ticketStageTransitionService';
import { ActivitySource } from '@/types/ticket';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { buildUserQueryContext } from '@/utils/queryContext';
import { getCallTicketUpdatesTotal, getCallTicketUpdatesAppliedTotal } from '@/services/otel/suggestionMetrics';
import {
  CALL_TICKET_UPDATES_SUBTYPE,
  buildTicketUpdatesContent,
  isTicketUpdateClaimFresh,
  parseTicketUpdatesContent,
  type AppliedTicketUpdate,
  type IgnoredTicketUpdate,
  type TicketUpdateMatchedBy,
  type TicketUpdateProposal,
} from '@/utils/ticketUpdateMarkdown';

const CHANNEL_CANDIDATE_LIMIT = 150;
const PARTICIPANT_CANDIDATE_LIMIT = 100;
const SERIES_MEMORY_INSTANCES = 6;
const MAX_PROPOSALS = 25;
const MIN_CONFIDENCE = 0.5;
const NUMBER_ONLY_MAX_CONFIDENCE = 0.6;
const OPEN_STATUSES = [TicketStatusV2.TODO, TicketStatusV2.STARTED, TicketStatusV2.PAUSED];
// Tickets closed this recently are still talked about ("had to revert it, back to
// backlog"), so they stay in the channel candidate list.
const RECENTLY_CLOSED_DAYS = 14;
const RECENTLY_CLOSED_LIMIT = 30;
const STATUS_VALUES: string[] = Object.values(TicketStatusV2);
const GUEST_ROLE = 'GUEST';

interface CandidateTicket {
  id: string;
  xyneId: string;
  title: string;
  statusV2: string;
  stageName: string;
  boardId: string;
  boardType: string;
  channelId: string;
  conversationId: string;
  assigneeName: string | null;
  /** Where this candidate came from; series entries carry the date it was last discussed. */
  source: 'spoken-id' | 'channel' | 'participant' | 'series';
  lastDiscussedAt: string | null;
}

interface LlmMention {
  ref: string;
  update: string;
  statusIntent: string | null;
  speaker: string | null;
  segment: number | null;
  quote: string | null;
  confidence: number;
  matchedBy: TicketUpdateMatchedBy;
}

const TICKET_UPDATES_PROMPT = `You are reviewing a call transcript to find updates that people gave about EXISTING tickets.

CANDIDATE TICKETS — the only tickets you may reference. Use the exact "ref" value:
{candidates}

TRANSCRIPT — each line is "[n] [MM:SS] Speaker: text"; n is the line number:
{transcript}

RULES:
- Only include a ticket that was actually discussed in this call. Never invent tickets or updates.
- One entry per ticket: merge every mention of the same ticket into a single entry.
- "update": a 1-2 sentence status note in the third person, past tense, saying what was said about the ticket (what was done, what is blocked, what comes next). No speaker labels, no timestamps.
- "statusIntent": ONLY when someone explicitly stated a change of state, else null. Map: done / finished / merged / shipped / closed -> COMPLETED; started / picking up / working on it now -> STARTED; blocked / on hold / parked / pausing -> PAUSED; dropping / cancelling / won't do -> CANCELLED; back to backlog / not started yet -> TODO. Discussing a ticket without changing its state is null.
- "segment": the n of the single most relevant transcript line. "quote": that line's text, verbatim.
- "speaker": the speaker name from that line.
- "confidence": 0 to 1, how sure you are this is the right ticket AND the update is accurate.
- "matchedBy": "xyne-id" when the ticket id was spoken (even garbled), "title" when matched from the topic, "number-only" as described below.
- Speech-to-text garbles ticket ids: "token 4127", "token dash forty one twenty seven", "tokin 4127" all mean TOKEN-4127. Resolve them against the candidate ids.
- If a ticket number is spoken with an unrecognisable prefix and EXACTLY ONE candidate carries that number, use it with "matchedBy": "number-only" and confidence at most 0.6. If several candidates share the number, leave it out.
- Candidates marked "discussed in an earlier call of this series" are what vague references like "the one from last week" usually mean.
- Skip greetings, small talk and anything that is not about a candidate ticket.

OUTPUT: valid JSON only, no code fences, no explanations:
{"mentions":[{"ref":"<candidate ref>","update":"...","statusIntent":"COMPLETED"|"STARTED"|"PAUSED"|"CANCELLED"|"TODO"|null,"speaker":"...","segment":12,"quote":"...","confidence":0.85,"matchedBy":"xyne-id"}]}
If nothing qualifies: {"mentions":[]}`;

const TICKET_CANDIDATE_SELECT = {
  id: true,
  xyneId: true,
  title: true,
  statusV2: true,
  stageName: true,
  boardId: true,
  channelId: true,
  conversationId: true,
  assignedTo: true,
  board: { select: { boardType: true } },
} as const;

type TicketCandidateRow = {
  id: string;
  xyneId: string;
  title: string;
  statusV2: string;
  stageName: string;
  boardId: string;
  channelId: string;
  conversationId: string;
  assignedTo: string | null;
  board: { boardType: string } | null;
};

type BoardStage = { name: string; sequenceNumber: number; defaultTicketStatusV2: string };

function timestampToSeconds(timestamp: string): number | null {
  const parts = timestamp.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function stripCodeFences(content: string): string {
  const m = content.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : content.trim();
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The thread a call's messages live in, from the ids the call row keeps after it ends. */
function callThreadRefs(metadata: unknown): { conversationId: string | null; systemMessageId: string | null } {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  return {
    conversationId: typeof meta['conversationId'] === 'string' ? meta['conversationId'] : null,
    systemMessageId: typeof meta['systemMessageId'] === 'string' ? meta['systemMessageId'] : null,
  };
}

/**
 * Pick the stage a ticket should move to for a spoken status. Exact
 * `defaultTicketStatusV2` matches win; when several stages share that status
 * (common on boards where every stage defaults to STARTED) or none does, fall
 * back to the stage name and board order so the card can still prefill the
 * picker. Returns null only when nothing sensible exists.
 */
const STAGE_NAME_HINTS: Record<string, RegExp> = {
  [TicketStatusV2.COMPLETED]: /\b(done|complete|completed|closed|resolved|shipped|released|finished)\b/i,
  [TicketStatusV2.STARTED]: /\b(in progress|in-progress|doing|development|in dev|working|active|started|implementation)\b/i,
  [TicketStatusV2.PAUSED]: /\b(paused|on hold|on-hold|blocked|parked|waiting|hold)\b/i,
  [TicketStatusV2.CANCELLED]: /\b(cancelled|canceled|won'?t (do|fix)|rejected|dropped|invalid|discarded)\b/i,
  [TicketStatusV2.TODO]: /\b(todo|to do|backlog|triage|new|open|not started)\b/i,
};

export function resolveStageForStatus(stages: BoardStage[], currentStageName: string, status: string): string | null {
  const ordered = [...stages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const others = ordered.filter((s) => s.name !== currentStageName);
  if (others.length === 0) return null;
  const hint = STAGE_NAME_HINTS[status];
  const byStatus = others.filter((s) => s.defaultTicketStatusV2 === status);
  const named = (list: typeof others) => (hint ? list.filter((s) => hint.test(s.name)) : []);

  if (byStatus.length === 1) return byStatus[0].name;
  const pool = byStatus.length > 1 ? byStatus : others;
  const byName = named(pool);
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

type Failure<S extends number> = { ok: false; status: S; error: string; stageOptions?: string[] };

export type ApplyTicketUpdateResult =
  | { ok: true; content: string; applied: AppliedTicketUpdate }
  | Failure<400 | 403 | 404 | 409>;

export type IgnoreTicketUpdateResult =
  | { ok: true; content: string; ignored: IgnoredTicketUpdate }
  | Failure<403 | 404 | 409>;

type AccessibleTicket = NonNullable<Awaited<ReturnType<CallTicketUpdateService['findTicket']>>>;

export class CallTicketUpdateService {
  /**
   * Run extraction for a finished channel call and post / refresh the card
   * message in the call thread. Returns the number of pending proposals on the
   * card afterwards (0 when nothing was found or the call has no channel).
   */
  async generateAndPost(params: {
    call: Call;
    callExternalId: string;
    conversationId: string;
    formattedTranscript: string;
    createAgent: () => Promise<Agent | null>;
  }): Promise<number> {
    const { call, callExternalId, conversationId, formattedTranscript, createAgent } = params;
    if (!call.channelId || !call.workspaceId) {
      logger.info(`[${callExternalId}] ticket_updates_skipped`, { reason: 'no_channel' });
      return 0;
    }
    const workspaceId = call.workspaceId;

    const candidates = await this.collectCandidates(call, callExternalId, formattedTranscript);
    if (candidates.size === 0) {
      logger.info(`[${callExternalId}] ticket_updates_skipped`, { reason: 'no_candidate_tickets' });
      return 0;
    }

    const { numbered, segments } = numberTranscriptSegments(formattedTranscript);
    const segmentByN = new Map(segments.map((s) => [s.n, s]));
    const mentions = await this.extractMentions(callExternalId, numbered, candidates, createAgent);
    const proposals = await this.toProposals(mentions, candidates, segmentByN, call.channelId);

    const posted = await this.postCard(call, callExternalId, conversationId, workspaceId, proposals);
    getCallTicketUpdatesTotal().add(posted, { workspaceId });
    logger.info(`[${callExternalId}] ticket_updates_posted`, {
      candidates: candidates.size,
      mentions: mentions.length,
      proposals: proposals.length,
      restricted: proposals.filter((p) => p.restricted).length,
      pending_on_card: posted,
    });
    return posted;
  }

  // ── candidates ────────────────────────────────────────────────────────────

  private async collectCandidates(
    call: Call,
    callExternalId: string,
    transcript: string,
  ): Promise<Map<string, CandidateTicket>> {
    const workspaceId = call.workspaceId;
    const channelId = call.channelId as string;
    const candidates = new Map<string, CandidateTicket>();
    const add = (row: TicketCandidateRow, source: CandidateTicket['source'], lastDiscussedAt: string | null = null) => {
      if (candidates.has(row.id)) {
        // Keep the strongest provenance; series entries carry the date.
        const existing = candidates.get(row.id)!;
        if (lastDiscussedAt && !existing.lastDiscussedAt) existing.lastDiscussedAt = lastDiscussedAt;
        return;
      }
      candidates.set(row.id, {
        id: row.id,
        xyneId: row.xyneId,
        title: row.title,
        statusV2: row.statusV2,
        stageName: row.stageName,
        boardId: row.boardId,
        boardType: row.board?.boardType ?? BoardType.DEFAULT,
        channelId: row.channelId,
        conversationId: row.conversationId,
        assigneeName: null,
        source,
        lastDiscussedAt,
      });
    };

    // 1. Ticket ids spoken in the transcript, built from the workspace's real
    //    project codes so "TOKEN 4127" / "token-4127" resolve but "step 3" does not.
    const projects = await db.project.findMany({ where: { workspaceId }, select: { code: true } });
    const codes = projects.map((p) => p.code).filter((c) => /^[A-Za-z][A-Za-z0-9]*$/.test(c));
    if (codes.length > 0) {
      const re = new RegExp(`\\b(${codes.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[-–]?\\s*(\\d{1,6})\\b`, 'gi');
      const spoken = new Set<string>();
      for (const m of transcript.matchAll(re)) {
        spoken.add(`${m[1].toUpperCase()}-${m[2]}`);
      }
      if (spoken.size > 0) {
        const rows = await db.ticket.findMany({
          where: { workspaceId, xyneId: { in: [...spoken] } },
          select: TICKET_CANDIDATE_SELECT,
        });
        rows.forEach((r) => add(r, 'spoken-id'));
      }
    }

    // 2. Open tickets in the call's channel.
    const channelRows = await db.ticket.findMany({
      where: { workspaceId, channelId, isArchived: false, statusV2: { in: OPEN_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: CHANNEL_CANDIDATE_LIMIT,
      select: TICKET_CANDIDATE_SELECT,
    });
    channelRows.forEach((r) => add(r, 'channel'));
    const recentlyClosed = await db.ticket.findMany({
      where: {
        workspaceId,
        channelId,
        isArchived: false,
        statusV2: { in: [TicketStatusV2.COMPLETED, TicketStatusV2.CANCELLED] },
        updatedAt: { gte: new Date(Date.now() - RECENTLY_CLOSED_DAYS * 24 * 3600 * 1000) },
      },
      orderBy: { updatedAt: 'desc' },
      take: RECENTLY_CLOSED_LIMIT,
      select: TICKET_CANDIDATE_SELECT,
    });
    recentlyClosed.forEach((r) => add(r, 'channel'));

    // 3. Open tickets assigned to people on the call.
    const participants = await repositories.calls.getCallParticipantsWithUserDetails(callExternalId).catch((error) => {
      logger.warn(`[${callExternalId}] ticket_updates_participants_lookup_failed`, { error });
      return [];
    });
    const participantIds = [...new Set([call.createdByUserId, ...participants.map((p) => p.userId)])];
    if (participantIds.length > 0) {
      const rows = await db.ticket.findMany({
        where: { workspaceId, assignedTo: { in: participantIds }, isArchived: false, statusV2: { in: OPEN_STATUSES } },
        orderBy: { updatedAt: 'desc' },
        take: PARTICIPANT_CANDIDATE_LIMIT,
        select: TICKET_CANDIDATE_SELECT,
      });
      rows.forEach((r) => add(r, 'participant'));
    }

    // 4. Series memory: tickets discussed in earlier instances of the same
    //    recurring series, including ones that have since been closed.
    if (call.recurringSeriesId) {
      const discussed = await this.ticketsDiscussedEarlierInSeries(call, workspaceId);
      if (discussed.size > 0) {
        const rows = await db.ticket.findMany({
          where: { workspaceId, id: { in: [...discussed.keys()] } },
          select: TICKET_CANDIDATE_SELECT,
        });
        rows.forEach((r) => add(r, 'series', discussed.get(r.id) ?? null));
      }
    }

    // Assignee names for the prompt.
    const candidateTicketIds = [...candidates.keys()];
    if (candidateTicketIds.length > 0) {
      const ticketAssignees = await db.ticket.findMany({
        where: { id: { in: candidateTicketIds } },
        select: { id: true, assignedTo: true },
      });
      const userIds = [...new Set(ticketAssignees.map((t) => t.assignedTo).filter((x): x is string => !!x))];
      const users = userIds.length
        ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      for (const t of ticketAssignees) {
        const c = candidates.get(t.id);
        if (c && t.assignedTo) c.assigneeName = nameById.get(t.assignedTo) ?? null;
      }
    }

    return candidates;
  }

  /**
   * ticketId → date it was last discussed, read from the cards of the series'
   * earlier calls. Looks the cards up by each call's thread, which the call row
   * still records after the call has ended.
   */
  private async ticketsDiscussedEarlierInSeries(call: Call, workspaceId: string): Promise<Map<string, string>> {
    const earlier = await db.call.findMany({
      where: { recurringSeriesId: call.recurringSeriesId, id: { not: call.id }, startedAt: { lt: call.startedAt } },
      orderBy: { startedAt: 'desc' },
      take: SERIES_MEMORY_INSTANCES,
      select: { startedAt: true, metadata: true },
    });
    const startedAtByConversationId = new Map<string, Date>();
    for (const c of earlier) {
      const refs = callThreadRefs(c.metadata);
      const conversationId =
        refs.conversationId ??
        (refs.systemMessageId ? (await repositories.messages.findById(refs.systemMessageId))?.conversationId ?? null : null);
      if (conversationId) startedAtByConversationId.set(conversationId, c.startedAt);
    }
    const messages = await repositories.messages.findTicketUpdateMessagesByConversationIds(workspaceId, [
      ...startedAtByConversationId.keys(),
    ]);
    const discussed = new Map<string, string>();
    for (const message of messages) {
      const when = startedAtByConversationId.get(message.conversationId) ?? message.createdAt;
      const doc = parseTicketUpdatesContent(message.content);
      for (const item of [...doc.updates, ...doc.applied, ...doc.ignored]) {
        if (!discussed.has(item.ticketId)) discussed.set(item.ticketId, when.toISOString().slice(0, 10));
      }
    }
    return discussed;
  }

  // ── LLM ───────────────────────────────────────────────────────────────────

  private async extractMentions(
    callExternalId: string,
    numberedTranscript: string,
    candidates: Map<string, CandidateTicket>,
    createAgent: () => Promise<Agent | null>,
  ): Promise<LlmMention[]> {
    const candidateLines = [...candidates.values()]
      .map((c) => {
        const bits = [
          `ref: ${c.id}`,
          `id: ${c.xyneId}`,
          `title: ${c.title}`,
          `status: ${c.statusV2}`,
          `stage: ${c.stageName}`,
          c.assigneeName ? `assignee: ${c.assigneeName}` : null,
          c.lastDiscussedAt ? `discussed in an earlier call of this series on ${c.lastDiscussedAt}` : null,
        ].filter(Boolean);
        return `- ${bits.join(' | ')}`;
      })
      .join('\n');

    const result = await executeCallLlmWithRetry(
      createAgent,
      () => TICKET_UPDATES_PROMPT.replace('{candidates}', candidateLines).replace('{transcript}', numberedTranscript),
      'ticket_updates_generation',
      callExternalId,
    );
    if (!result.ok) {
      logger.error(`[${callExternalId}] ticket_updates_generation_failed`, { reason: result.reason });
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(result.content));
    } catch (error) {
      logger.error(`[${callExternalId}] ticket_updates_generation_failed`, { reason: 'invalid_json', error });
      return [];
    }
    const raw = (parsed as { mentions?: unknown })?.mentions;
    if (!Array.isArray(raw)) {
      logger.error(`[${callExternalId}] ticket_updates_generation_failed`, { reason: 'invalid_format' });
      return [];
    }

    const byRef = new Map<string, LlmMention>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      const ref = typeof m['ref'] === 'string' ? m['ref'] : '';
      const update = typeof m['update'] === 'string' ? m['update'].trim() : '';
      if (!candidates.has(ref) || !update) continue;
      const matchedByRaw = m['matchedBy'];
      const matchedBy: TicketUpdateMatchedBy =
        matchedByRaw === 'title' || matchedByRaw === 'number-only' ? matchedByRaw : 'xyne-id';
      let confidence = typeof m['confidence'] === 'number' ? Math.max(0, Math.min(1, m['confidence'])) : 0;
      if (matchedBy === 'number-only') {
        // A bare number is only trusted against this channel's tickets (or ones this
        // series already discussed); a participant's ticket from another channel that
        // happens to share the number is far more likely to be a wrong match.
        if (candidates.get(ref)!.source === 'participant') continue;
        confidence = Math.min(confidence, NUMBER_ONLY_MAX_CONFIDENCE);
      }
      if (confidence < MIN_CONFIDENCE) continue;
      const statusIntent = typeof m['statusIntent'] === 'string' && STATUS_VALUES.includes(m['statusIntent']) ? m['statusIntent'] : null;
      const mention: LlmMention = {
        ref,
        update,
        statusIntent,
        speaker: typeof m['speaker'] === 'string' ? m['speaker'] : null,
        segment: typeof m['segment'] === 'number' ? Math.trunc(m['segment']) : null,
        quote: typeof m['quote'] === 'string' ? m['quote'] : null,
        confidence,
        matchedBy,
      };
      const existing = byRef.get(ref);
      if (!existing || existing.confidence < mention.confidence) byRef.set(ref, mention);
    }
    return [...byRef.values()].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_PROPOSALS);
  }

  // ── proposals ─────────────────────────────────────────────────────────────

  private async toProposals(
    mentions: LlmMention[],
    candidates: Map<string, CandidateTicket>,
    segmentByN: Map<number, CitationSegment>,
    callChannelId: string,
  ): Promise<TicketUpdateProposal[]> {
    const boardIds = [...new Set(mentions.map((m) => candidates.get(m.ref)!.boardId))];
    const stages = boardIds.length
      ? await db.stage.findMany({
          where: { boardId: { in: boardIds } },
          orderBy: { sequenceNumber: 'asc' },
          select: { boardId: true, name: true, sequenceNumber: true, defaultTicketStatusV2: true },
        })
      : [];
    const stagesByBoard = new Map<string, typeof stages>();
    for (const s of stages) {
      const list = stagesByBoard.get(s.boardId) ?? [];
      list.push(s);
      stagesByBoard.set(s.boardId, list);
    }

    return mentions.map((m) => {
      const c = candidates.get(m.ref)!;
      const segment = m.segment !== null ? segmentByN.get(m.segment) ?? null : null;
      const spoken = {
        updateId: randomUUID(),
        ticketId: c.id,
        update: m.update,
        proposedStatusV2: m.statusIntent && m.statusIntent !== c.statusV2 ? m.statusIntent : null,
        speaker: segment?.speaker ?? m.speaker,
        timestampSeconds: segment ? timestampToSeconds(segment.timestamp) : null,
        segment: segment ? segment.n : null,
        quote: segment?.text ?? m.quote,
        confidence: Math.round(m.confidence * 100) / 100,
        matchedBy: m.matchedBy,
        claim: null,
      };

      // A ticket from another channel: everyone in this channel reads the card,
      // so it gets no identity and no board details. What was said about it comes
      // from the transcript the same audience can already open.
      if (c.channelId !== callChannelId) {
        return {
          ...spoken,
          restricted: true,
          xyneId: '',
          title: '',
          ticketConversationId: '',
          ticketChannelId: '',
          boardType: '',
          currentStageName: '',
          currentStatusV2: '',
          proposedStageName: null,
          stageOptions: [],
        };
      }

      const boardStages = stagesByBoard.get(c.boardId) ?? [];
      return {
        ...spoken,
        restricted: false,
        xyneId: c.xyneId,
        title: c.title,
        ticketConversationId: c.conversationId,
        ticketChannelId: c.channelId,
        boardType: c.boardType,
        currentStageName: c.stageName,
        currentStatusV2: c.statusV2,
        proposedStageName:
          spoken.proposedStatusV2 && c.boardType !== BoardType.FLOW
            ? resolveStageForStatus(boardStages, c.stageName, spoken.proposedStatusV2)
            : null,
        stageOptions: boardStages.map((s) => s.name).filter((n) => n !== c.stageName),
      };
    });
  }

  // ── card message ──────────────────────────────────────────────────────────

  private async postCard(
    call: Call,
    callExternalId: string,
    conversationId: string,
    workspaceId: string,
    proposals: TicketUpdateProposal[],
  ): Promise<number> {
    const existing = await repositories.messages.findTicketUpdatesByCallId(conversationId, callExternalId);

    if (existing) {
      // A re-run merges into whatever the card holds right now: decisions people
      // made stay, a row someone is in the middle of approving stays, and the
      // rest of the pending rows are replaced by the new proposals.
      const merged = await mutateTicketUpdatesCardTx(existing.messageId, (doc) => {
        const inFlight = doc.updates.filter((u) => isTicketUpdateClaimFresh(u.claim));
        const settled = new Set([...doc.applied, ...doc.ignored, ...inFlight].map((x) => x.ticketId));
        const updates = [...inFlight, ...proposals.filter((p) => !settled.has(p.ticketId))];
        return { doc: { updates, applied: doc.applied, ignored: doc.ignored }, result: updates.length };
      });
      if (merged.found) {
        logger.info(`[${callExternalId}] ticket_updates_card_updated`, { message_id: existing.messageId });
        return merged.result;
      }
    }

    if (proposals.length === 0) return 0;

    const bot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
    if (!bot) throw new Error('Xyne Automatic bot not found - cannot post ticket updates');
    const message = await repositories.messages.create({
      conversationId,
      senderId: bot.id,
      content: buildTicketUpdatesContent({ updates: proposals, applied: [], ignored: [] }),
      msgType: MessageType.BOT,
      showInChannel: false,
      metadata: {
        messageSubtype: CALL_TICKET_UPDATES_SUBTYPE,
        callId: callExternalId,
        isAiGenerated: true,
        contentFormat: 'markdown',
        ticketUpdatesCount: proposals.length,
        version: 1,
        createdAt: new Date().toISOString(),
      },
    });
    await repositories.conversations.incrementReplyCount(conversationId);
    logger.info(`[${callExternalId}] ticket_updates_card_created`, { message_id: message.messageId, call_id: call.id });
    return proposals.length;
  }

  // ── approve / ignore ──────────────────────────────────────────────────────

  private async loadCard(
    callExternalId: string,
    userId: string,
    workspaceId: string,
  ): Promise<{ error: { status: 403 | 404; error: string } } | { call: Call; message: Message }> {
    const call = await repositories.calls.findByExternalId(callExternalId);
    if (!call || (call.workspaceId && call.workspaceId !== workspaceId)) {
      return { error: { status: 404 as const, error: 'Call not found' } };
    }
    if (!(await callShareService.isCallAudience(call, userId))) {
      return { error: { status: 403 as const, error: 'Not part of this call' } };
    }
    // The call row records its thread; the metadata scan is only for older rows.
    const conversationId =
      callThreadRefs(call.metadata).conversationId ??
      (await repositories.messages.findHeadMessageByCallId(callExternalId))?.conversationId;
    if (!conversationId) return { error: { status: 404 as const, error: 'Call thread not found' } };
    const message = await repositories.messages.findTicketUpdatesByCallId(conversationId, callExternalId);
    if (!message) return { error: { status: 404 as const, error: 'No ticket updates for this call' } };
    return { call, message };
  }

  private findTicket(ticketId: string) {
    // Workspace scope, not the caller's ACL: the access decision is made
    // explicitly in loadTicketForUser so "no such ticket" and "no access" stay
    // distinguishable. Awaited inside the scope on purpose: a Prisma query only
    // runs when it is awaited, and awaiting it outside would run it back under
    // the caller's ACL.
    return withWorkspaceScope(async () => {
      return await db.ticket.findUnique({
        where: { id: ticketId },
        include: { board: { select: { boardType: true } }, channel: { select: { visibility: true } } },
      });
    });
  }

  /**
   * The ticket, if this user may read it. Mirrors the tickets read rule
   * (`accessibleTicketWhere`): a ticket in a public channel is readable by every
   * member of the workspace, a ticket in a private channel only by that
   * channel's members, and guests only through channels they were added to.
   */
  private async loadTicketForUser(
    ticketId: string,
    userId: string,
    workspaceId: string,
    role: string | undefined,
  ): Promise<{ error: { status: 403 | 404; error: string } } | { ticket: AccessibleTicket }> {
    const ticket = await this.findTicket(ticketId);
    if (!ticket || ticket.workspaceId !== workspaceId) {
      return { error: { status: 404 as const, error: 'Ticket not found' } };
    }
    const isPublic = ticket.channel?.visibility === ChannelVisibility.PUBLIC && role !== GUEST_ROLE;
    if (!isPublic && !(await repositories.channelParticipants.isParticipant(ticket.channelId, userId))) {
      return { error: { status: 403 as const, error: "You don't have access to this ticket" } };
    }
    return { ticket };
  }

  async apply(params: {
    callExternalId: string;
    updateId: string;
    userId: string;
    workspaceId: string;
    role?: string;
    postComment: boolean;
    changeStatus: boolean;
    message?: string;
    stageName?: string;
  }): Promise<ApplyTicketUpdateResult> {
    const { callExternalId, updateId, userId, workspaceId, postComment, changeStatus } = params;
    if (!postComment && !changeStatus) {
      return { ok: false, status: 400, error: 'Nothing to apply: choose the comment, the status change, or both' };
    }
    const loaded = await this.loadCard(callExternalId, userId, workspaceId);
    if ('error' in loaded) return { ok: false, ...loaded.error };
    const { call, message } = loaded;

    const update = parseTicketUpdatesContent(message.content).updates.find((u) => u.updateId === updateId);
    if (!update) return { ok: false, status: 409, error: 'This update was already handled' };

    const access = await this.loadTicketForUser(update.ticketId, userId, workspaceId, params.role);
    if ('error' in access) return { ok: false, ...access.error };
    const { ticket } = access;
    const boardType = ticket.board?.boardType ?? BoardType.DEFAULT;

    // Resolve the target stage before touching anything, so a bad choice fails cleanly.
    let targetStage: BoardStage | null = null;
    if (changeStatus) {
      if (boardType === BoardType.FLOW) {
        return { ok: false, status: 400, error: 'Tickets on a flow board move through their board transitions; post the comment only', stageOptions: [] };
      }
      const stages = await db.stage.findMany({
        where: { boardId: ticket.boardId },
        orderBy: { sequenceNumber: 'asc' },
        select: { name: true, sequenceNumber: true, defaultTicketStatusV2: true },
      });
      const options = stages.map((s) => s.name).filter((n) => n !== ticket.stageName);
      // A restricted row carries no stage on the card, so it is resolved here from
      // the status that was spoken.
      const stageName =
        params.stageName?.trim() ||
        update.proposedStageName ||
        (update.proposedStatusV2 ? resolveStageForStatus(stages, ticket.stageName, update.proposedStatusV2) : null);
      if (!stageName) {
        return { ok: false, status: 400, error: 'Choose the stage to move the ticket to', stageOptions: options };
      }
      targetStage = stages.find((s) => s.name === stageName) ?? null;
      if (!targetStage) {
        return { ok: false, status: 400, error: `"${stageName}" is not a stage on this board`, stageOptions: options };
      }
    }

    // Claim the row before any side effect. Two approvals of the same row race
    // here, under the card's row lock, and only one gets past. A live claim
    // blocks its own author too, so a double submit cannot apply twice; a claim
    // is released on failure and otherwise expires.
    const claim = await mutateTicketUpdatesCardTx(message.messageId, (doc) => {
      const row = doc.updates.find((u) => u.updateId === updateId);
      if (!row) return { result: 'handled' as const };
      if (isTicketUpdateClaimFresh(row.claim)) return { result: 'claimed' as const };
      row.claim = { by: userId, at: new Date().toISOString() };
      return { doc, result: 'ok' as const };
    });
    if (!claim.found || claim.result === 'handled') {
      return { ok: false, status: 409, error: 'This update was already handled' };
    }
    if (claim.result === 'claimed') {
      return { ok: false, status: 409, error: 'This update is already being applied' };
    }

    const releaseClaim = () =>
      mutateTicketUpdatesCardTx(message.messageId, (doc) => {
        const row = doc.updates.find((u) => u.updateId === updateId);
        if (!row || row.claim?.by !== userId) return { result: null };
        row.claim = null;
        return { doc, result: null };
      }).catch((error) => logger.error(`[${callExternalId}] ticket_update_claim_release_failed`, { update_id: updateId, error }));

    try {
      // 1. Move the stage first: it is the step that can be refused (a form or an
      //    approval on the board), and refusing before the comment exists means a
      //    retry cannot post the comment twice. Always a stage move, never a bare
      //    statusV2 write: the stage carries the status, the activity row and the
      //    thread's system message.
      let newStageName: string | null = null;
      let newStatusV2: string | null = null;
      let stagePendingApproval: string | null = null;
      if (targetStage && targetStage.name !== ticket.stageName) {
        const moved = await this.moveStage(ticket, boardType, targetStage, userId, workspaceId);
        if (moved.outcome === 'refused') {
          await releaseClaim();
          return { ok: false, status: 400, error: moved.error };
        }
        if (moved.outcome === 'pending-approval') {
          stagePendingApproval = targetStage.name;
        } else {
          newStageName = targetStage.name;
          newStatusV2 = targetStage.defaultTicketStatusV2;
        }
      }

      // 2. Comment on the ticket thread, as the user who approved it.
      const commentMessageId = postComment
        ? await this.postCommentOnce({ call, callExternalId, update, ticket, userId, text: params.message })
        : null;

      // 3. Record it on the card, against the card as it is now.
      const applied: AppliedTicketUpdate = {
        updateId,
        ticketId: ticket.id,
        restricted: update.restricted,
        xyneId: ticket.xyneId,
        title: ticket.title,
        ticketConversationId: ticket.conversationId,
        ticketChannelId: ticket.channelId,
        appliedBy: userId,
        appliedAt: new Date().toISOString(),
        commentMessageId,
        newStageName,
        newStatusV2,
        stagePendingApproval,
      };
      const finalised = await mutateTicketUpdatesCardTx(message.messageId, (doc) => ({
        doc: {
          updates: doc.updates.filter((u) => u.updateId !== updateId),
          applied: [...doc.applied.filter((a) => a.updateId !== updateId), applied],
          ignored: doc.ignored,
        },
        result: null,
      }));
      if (!finalised.found) return { ok: false, status: 404, error: 'No ticket updates for this call' };

      getCallTicketUpdatesAppliedTotal().add(1, { workspaceId });
      logger.info(`[${callExternalId}] ticket_update_applied`, {
        update_id: updateId,
        ticket: ticket.xyneId,
        comment: !!commentMessageId,
        stage: newStageName,
        stage_pending_approval: stagePendingApproval,
        user_id: userId,
      });
      return { ok: true, content: finalised.content, applied };
    } catch (error) {
      await releaseClaim();
      throw error;
    }
  }

  private async moveStage(
    ticket: AccessibleTicket,
    boardType: string,
    targetStage: BoardStage,
    userId: string,
    workspaceId: string,
  ): Promise<{ outcome: 'moved' | 'pending-approval' } | { outcome: 'refused'; error: string }> {
    if (boardType !== BoardType.NON_LINEAR) {
      try {
        await repositories.tickets.updateTicketStage(ticket.id, targetStage.name, userId, ActivitySource.INTERNAL);
        return { outcome: 'moved' };
      } catch (error) {
        logger.error('[callTicketUpdate] stage move failed', { ticket_id: ticket.id, stage: targetStage.name, error });
        return { outcome: 'refused', error: `Could not move the ticket to "${targetStage.name}"` };
      }
    }

    const result = await ticketStageTransitionService.transitionTicket(ticket.id, userId, targetStage.name, {});
    // The board asked an approver to confirm the move and recorded the request:
    // that is done from the card's side, not an error to retry.
    if (!result.success && result.requiresApproval) return { outcome: 'pending-approval' };
    if (!result.success) {
      return {
        outcome: 'refused',
        error: `${result.message ?? 'Stage transition not allowed'}. Move it from the board, or approve with the comment only.`,
      };
    }
    void db.ticketActivity
      .create({
        data: {
          ticketId: ticket.id,
          updatedBy: userId,
          workspaceId,
          activityType: ActivityType.STAGE_NAME,
          value: { field: 'stageName', oldValue: ticket.stageName, newValue: targetStage.name, source: ActivitySource.INTERNAL },
        },
      })
      .catch((err) => logger.warn(`[callTicketUpdate] stage audit write failed ticketId=${ticket.id}:`, err));
    return { outcome: 'moved' };
  }

  /**
   * Post the update on the ticket thread, unless this same card row already
   * produced a comment (an earlier attempt that failed after posting). The
   * comment carries the row's `updateId`, which is what makes the retry safe.
   */
  private async postCommentOnce(params: {
    call: Call;
    callExternalId: string;
    update: TicketUpdateProposal;
    ticket: AccessibleTicket;
    userId: string;
    text: string | undefined;
  }): Promise<string> {
    const { call, callExternalId, update, ticket, userId, text } = params;
    const existing = await db.message.findFirst({
      where: {
        conversationId: ticket.conversationId,
        AND: [
          { metadata: { path: ['source'], equals: 'call_ticket_update' } },
          { metadata: { path: ['updateId'], equals: update.updateId } },
        ],
      },
      select: { messageId: true },
    });
    if (existing) return existing.messageId;

    const body = (text?.trim() || update.update).trim();
    const when = update.timestampSeconds !== null ? ` at ${formatSeconds(update.timestampSeconds)}` : '';
    const callLabel = call.title
      ? `the call "${call.title}"`
      : `the call on ${call.startedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const source = `_From ${callLabel}${when}${update.speaker ? `, said by ${update.speaker}` : ''}._`;
    const result = await conversationService.addMessageToConversation({
      conversationId: ticket.conversationId,
      userId,
      content: `${body}\n\n${source}`,
      msgType: MessageType.USER,
      metadata: {
        contentFormat: 'markdown',
        source: 'call_ticket_update',
        callId: callExternalId,
        updateId: update.updateId,
        ...(update.timestampSeconds !== null ? { timestampSeconds: update.timestampSeconds } : {}),
      },
    });
    const commentMessageId = result.message.messageId;
    // Notifications, mentions and unread counts live in the side-effect handler;
    // conversationService does not fire it. Best-effort, as in the automation
    // reply step.
    try {
      const ctx = await buildUserQueryContext(userId);
      void new MessagesSideEffectHandler(ctx)
        .onInsert({ entityId: commentMessageId, entityType: 'messages', operation: 'insert' })
        .catch((err) => logger.error('[callTicketUpdate] comment side-effect failed', err));
    } catch (err) {
      logger.error('[callTicketUpdate] comment side-effect context failed', err);
    }
    return commentMessageId;
  }

  async ignore(params: {
    callExternalId: string;
    updateId: string;
    userId: string;
    workspaceId: string;
    role?: string;
  }): Promise<IgnoreTicketUpdateResult> {
    const { callExternalId, updateId, userId, workspaceId } = params;
    const loaded = await this.loadCard(callExternalId, userId, workspaceId);
    if ('error' in loaded) return { ok: false, ...loaded.error };
    const { message } = loaded;

    const update = parseTicketUpdatesContent(message.content).updates.find((u) => u.updateId === updateId);
    if (!update) return { ok: false, status: 409, error: 'This update was already handled' };
    const access = await this.loadTicketForUser(update.ticketId, userId, workspaceId, params.role);
    if ('error' in access) return { ok: false, ...access.error };
    const { ticket } = access;

    const ignored: IgnoredTicketUpdate = {
      updateId,
      ticketId: ticket.id,
      restricted: update.restricted,
      xyneId: ticket.xyneId,
      title: ticket.title,
      ignoredBy: userId,
      ignoredAt: new Date().toISOString(),
    };
    const written = await mutateTicketUpdatesCardTx(message.messageId, (doc) => {
      const row = doc.updates.find((u) => u.updateId === updateId);
      if (!row) return { result: 'handled' as const };
      if (isTicketUpdateClaimFresh(row.claim)) return { result: 'claimed' as const };
      return {
        doc: {
          updates: doc.updates.filter((u) => u.updateId !== updateId),
          applied: doc.applied,
          ignored: [...doc.ignored, ignored],
        },
        result: 'ok' as const,
      };
    });
    if (!written.found || written.result === 'handled') {
      return { ok: false, status: 409, error: 'This update was already handled' };
    }
    if (written.result === 'claimed') {
      return { ok: false, status: 409, error: 'This update is already being applied' };
    }
    logger.info(`[${callExternalId}] ticket_update_ignored`, { update_id: updateId, ticket: ticket.xyneId, user_id: userId });
    return { ok: true, content: written.content, ignored };
  }
}

export const callTicketUpdateService = new CallTicketUpdateService();
