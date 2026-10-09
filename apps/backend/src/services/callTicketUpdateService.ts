/**
 * Post-call "ticket updates": find EXISTING tickets that people talked about in a
 * call transcript, extract what was said about each one and any spoken status
 * change, and post them as a review card in the call thread. Nothing is applied
 * automatically — a call participant approves each item (comment on the ticket
 * and/or move its stage) or ignores it.
 *
 * Matching never searches the whole workspace: the LLM only chooses among a
 * bounded candidate list — tickets in the call's channel and tickets assigned to
 * the people on the call — so a garbled project code still resolves against a
 * small set.
 *
 * The card is one message read by everyone in the channel the call thread lives
 * in (the call's updates channel when set, otherwise its own), so a ticket from
 * any other channel is posted as a "restricted" row that carries no ticket
 * identity: each viewer resolves it through their own ticket access, and approve
 * / ignore check that access again here.
 */
import { randomUUID } from 'crypto';
import type { Agent } from '@framework';
import type { Call, Message, Prisma } from '@prisma/client';
import {
  ActivityType,
  BoardType,
  MessageType,
  TicketStatusV2,
  formatCallTimestamp,
  resolveStageForStatus,
  ticketUpdateCommentSource,
  type TicketUpdateBoardStage,
} from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { withWorkspaceScope } from '@/database/tenant/context';
import { mutateTicketUpdatesCard } from '@/services/callTicketUpdateCard';
import { logger } from '@/utils/logger';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { executeCallLlmWithRetry } from './callLlmRetry';
import { extractJson } from '@/team-intelligence/llm-utils';
import { numberTranscriptSegments, type CitationSegment } from '@/services/callDocumentService';
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
const MAX_PROPOSALS = 25;
const MIN_CONFIDENCE = 0.5;
const NUMBER_ONLY_MAX_CONFIDENCE = 0.6;
const OPEN_STATUSES = [TicketStatusV2.TODO, TicketStatusV2.STARTED, TicketStatusV2.PAUSED];
// Tickets closed this recently are still talked about ("had to revert it, back to
// backlog"), so they stay in the channel candidate list.
const RECENTLY_CLOSED_DAYS = 14;
const RECENTLY_CLOSED_LIMIT = 30;
const STATUS_VALUES: string[] = Object.values(TicketStatusV2);

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
  assignedTo: string | null;
  assigneeName: string | null;
  /** The stages of the ticket's board, in order; empty for a flow board, which takes no stage. */
  stageNames: string[];
  /** Where this candidate came from. */
  source: 'spoken-id' | 'channel' | 'participant';
}

interface LlmMention {
  ref: string;
  update: string;
  statusIntent: string | null;
  /** A stage of the ticket's own board that was named as where it goes. */
  stageIntent: string | null;
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
- "update": a 1-2 sentence status note in the third person saying what was said about the ticket (what was done, what is blocked, what comes next). Keep the sense of what was said: something planned or proposed ("we can move it to review") is written as planned ("To be moved to In Review"), never as already done. No speaker labels, no timestamps.
- "statusIntent": ONLY when someone explicitly stated a change of state, else null. Map: done / finished / merged / shipped / closed -> COMPLETED; started / picking up / working on it now -> STARTED; blocked / on hold / parked / pausing -> PAUSED; dropping / cancelling / won't do -> CANCELLED; back to backlog / not started yet -> TODO. Discussing a ticket without changing its state is null.
- "stageIntent": ONLY when someone said which stage the ticket moves to, or should move to ("move it to in review", "that one goes to QA"). Use the exact name from that candidate's "stages" list; null when no stage was named, when the name is not in the list, or when the candidate lists no stages. A stage can be named without any statusIntent, and the other way round.
- "segment": the n of the single most relevant transcript line. "quote": that line's text, verbatim.
- "speaker": the speaker name from that line.
- "confidence": 0 to 1, how sure you are this is the right ticket AND the update is accurate.
- "matchedBy": "xyne-id" when the ticket id was spoken (even garbled), "title" when matched from the topic, "number-only" as described below.
- Speech-to-text garbles ticket ids: "token 4127", "token dash forty one twenty seven", "tokin 4127" all mean TOKEN-4127. Resolve them against the candidate ids.
- If a ticket is referred to by its number alone ("ticket 4", "number twelve") or with an unrecognisable prefix, and EXACTLY ONE candidate carries that number, use it with "matchedBy": "number-only" and confidence at most 0.6. Leading zeros do not matter: 4 is 0004. If several candidates share the number, leave it out. A number counts only when it clearly points at a ticket, not a quantity or a figure of speech ("one of them", "step 2").
- Skip greetings, small talk and anything that is not about a candidate ticket.

OUTPUT: valid JSON only, no code fences, no explanations:
{"mentions":[{"ref":"<candidate ref>","update":"...","statusIntent":"COMPLETED"|"STARTED"|"PAUSED"|"CANCELLED"|"TODO"|null,"stageIntent":"<stage name>"|null,"speaker":"...","segment":12,"quote":"...","confidence":0.85,"matchedBy":"xyne-id"}]}
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

type BoardStage = TicketUpdateBoardStage;

function timestampToSeconds(timestamp: string): number | null {
  const parts = timestamp.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

const SCRUBBED_TICKET = '[ticket]';

/**
 * Model-written text for a restricted row, with the ticket's id and title taken
 * out: the model had both in its prompt and may restate them. Exact matches only
 * (any case, any spacing or dash in the id) — a paraphrased title still passes.
 */
function scrubTicketIdentity(text: string, ticket: { xyneId: string; title: string }): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns: string[] = [];
  const title = ticket.title.trim();
  if (title) {
    const body = title.split(/\s+/).map(escape).join('\\s+');
    patterns.push(`${/^\w/.test(title) ? '\\b' : ''}${body}${/\w$/.test(title) ? '\\b' : ''}`);
  }
  const id = /^(.+?)-(\d+)$/.exec(ticket.xyneId);
  if (id) patterns.push(`\\b${escape(id[1])}\\s*[-–]?\\s*${id[2]}\\b`);
  if (patterns.length === 0) return text;
  return text
    .replace(new RegExp(patterns.join('|'), 'gi'), SCRUBBED_TICKET)
    // "TOKEN-4127 (Acme ledger migration)" → one placeholder, not two.
    .replace(/\[ticket\](?:[\s(:,–-]*\[ticket\]\)?)+/g, SCRUBBED_TICKET);
}

function callThreadRefs(metadata: unknown): { conversationId: string | null; systemMessageId: string | null } {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  return {
    conversationId: typeof meta['conversationId'] === 'string' ? meta['conversationId'] : null,
    systemMessageId: typeof meta['systemMessageId'] === 'string' ? meta['systemMessageId'] : null,
  };
}

type Failure<S extends number> = { ok: false; status: S; error: string; stageOptions?: string[] };

export type ApplyTicketUpdateResult =
  | { ok: true; applied: AppliedTicketUpdate }
  | Failure<400 | 403 | 404 | 409>;

export type IgnoreTicketUpdateResult =
  | { ok: true; ignored: IgnoredTicketUpdate }
  | Failure<403 | 404 | 409>;

type AccessibleTicket = Prisma.TicketGetPayload<{ include: { board: { select: { boardType: true } } } }>;

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
    if (!call.channelId) {
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
    if (mentions === null) {
      // A failed run says nothing about the call: leave an earlier run's card as it is.
      logger.info(`[${callExternalId}] ticket_updates_skipped`, { reason: 'generation_failed' });
      return 0;
    }
    // The card's audience is whoever reads the call thread, which can live in a
    // different channel than the call (callUpdatesChannel). Unresolved → every
    // row is restricted.
    const thread = await db.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true },
    });
    const proposals = await this.toProposals(mentions, candidates, segmentByN, thread?.channelId ?? null);

    const { pending: posted, added } = await this.postCard(call, callExternalId, conversationId, workspaceId, proposals);
    // Only rows this run put on the card: the pipeline runs more than once per
    // call, and a re-run that finds the same tickets adds nothing.
    getCallTicketUpdatesTotal().add(added, { workspaceId });
    logger.info(`[${callExternalId}] ticket_updates_posted`, {
      candidates: candidates.size,
      mentions: mentions.length,
      proposals: proposals.length,
      restricted: proposals.filter((p) => p.restricted).length,
      pending_on_card: posted,
      added_to_card: added,
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
    const add = (row: TicketCandidateRow, source: CandidateTicket['source']) => {
      // Keep the strongest provenance.
      if (candidates.has(row.id)) return;
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
        assignedTo: row.assignedTo,
        assigneeName: null,
        stageNames: [],
        source,
      });
    };

    const participants = await repositories.calls.findParticipants(call.id).catch((error) => {
      logger.warn(`[${callExternalId}] ticket_updates_participants_lookup_failed`, { error });
      return [];
    });
    const participantIds = [...new Set([call.createdByUserId, ...participants.map((p) => p.userId)])];

    // 1. Ticket ids spoken in the transcript, built from the workspace's real
    //    project codes so "TOKEN 4127" / "token-4127" resolve but "step 3" does not.
    //    Same reach as the steps below — the call's channel or a participant's
    //    ticket — but by id, so a closed or older ticket is still found.
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
          where: {
            workspaceId,
            xyneId: { in: [...spoken] },
            OR: [{ channelId }, { assignedTo: { in: participantIds } }],
          },
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
    if (participantIds.length > 0) {
      const rows = await db.ticket.findMany({
        where: { workspaceId, assignedTo: { in: participantIds }, isArchived: false, statusV2: { in: OPEN_STATUSES } },
        orderBy: { updatedAt: 'desc' },
        take: PARTICIPANT_CANDIDATE_LIMIT,
        select: TICKET_CANDIDATE_SELECT,
      });
      rows.forEach((r) => add(r, 'participant'));
    }

    // Assignee names for the prompt.
    const assigneeIds = [...new Set([...candidates.values()].map((c) => c.assignedTo).filter((x): x is string => !!x))];
    if (assigneeIds.length > 0) {
      const users = await db.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } });
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      for (const c of candidates.values()) {
        if (c.assignedTo) c.assigneeName = nameById.get(c.assignedTo) ?? null;
      }
    }

    // Board stages for the prompt, so a stage that was named can be proposed as it is.
    const boardIds = [...new Set([...candidates.values()].filter((c) => c.boardType !== BoardType.FLOW).map((c) => c.boardId))];
    if (boardIds.length > 0) {
      const stages = await db.stage.findMany({
        where: { boardId: { in: boardIds } },
        orderBy: { sequenceNumber: 'asc' },
        select: { boardId: true, name: true },
      });
      for (const c of candidates.values()) {
        if (c.boardType !== BoardType.FLOW) c.stageNames = stages.filter((s) => s.boardId === c.boardId).map((s) => s.name);
      }
    }

    return candidates;
  }

  // ── LLM ───────────────────────────────────────────────────────────────────

  /** The mentions the LLM found, or null when the run failed (as opposed to finding none). */
  private async extractMentions(
    callExternalId: string,
    numberedTranscript: string,
    candidates: Map<string, CandidateTicket>,
    createAgent: () => Promise<Agent | null>,
  ): Promise<LlmMention[] | null> {
    const candidateLines = [...candidates.values()]
      .map((c) => {
        const bits = [
          `ref: ${c.id}`,
          `id: ${c.xyneId}`,
          `title: ${c.title}`,
          `status: ${c.statusV2}`,
          `stage: ${c.stageName}`,
          c.stageNames.length > 0 ? `stages: ${c.stageNames.join(', ')}` : null,
          c.assigneeName ? `assignee: ${c.assigneeName}` : null,
        ].filter(Boolean);
        return `- ${bits.join(' | ')}`;
      })
      .join('\n');

    const result = await executeCallLlmWithRetry(
      createAgent,
      // Replacer functions: titles and transcript text are user content, and a string
      // replacement would expand `$&` / `$'` inside them.
      () =>
        TICKET_UPDATES_PROMPT.replace('{candidates}', () => candidateLines).replace('{transcript}', () => numberedTranscript),
      'ticket_updates_generation',
      callExternalId,
    );
    if (!result.ok) {
      logger.error(`[${callExternalId}] ticket_updates_generation_failed`, { reason: result.reason });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(result.content));
    } catch (error) {
      logger.error(`[${callExternalId}] ticket_updates_generation_failed`, { reason: 'invalid_json', error });
      return null;
    }
    const raw = (parsed as { mentions?: unknown })?.mentions;
    if (!Array.isArray(raw)) {
      logger.error(`[${callExternalId}] ticket_updates_generation_failed`, { reason: 'invalid_format' });
      return null;
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
        // A bare number is only trusted against this channel's tickets; a
        // participant's ticket from another channel that happens to share the
        // number is far more likely to be a wrong match.
        if (candidates.get(ref)!.source === 'participant') continue;
        confidence = Math.min(confidence, NUMBER_ONLY_MAX_CONFIDENCE);
      }
      if (confidence < MIN_CONFIDENCE) continue;
      const statusIntent = typeof m['statusIntent'] === 'string' && STATUS_VALUES.includes(m['statusIntent']) ? m['statusIntent'] : null;
      // Only a stage of the ticket's own board, and not the one it is already in.
      const candidate = candidates.get(ref)!;
      const stageSaid = typeof m['stageIntent'] === 'string' ? m['stageIntent'].trim().toLowerCase() : '';
      const stageIntent =
        (stageSaid && candidate.stageNames.find((n) => n.toLowerCase() === stageSaid && n !== candidate.stageName)) || null;
      const mention: LlmMention = {
        ref,
        update,
        statusIntent,
        stageIntent,
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
    audienceChannelId: string | null,
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

      // A ticket from outside the thread's channel: everyone in that channel reads
      // the card, so it gets no identity and no board details. What was said about it comes
      // from the transcript the same audience can already open; the text the model
      // wrote had the ticket in front of it, so its id and title are scrubbed.
      if (c.channelId !== audienceChannelId) {
        return {
          ...spoken,
          update: scrubTicketIdentity(m.update, c),
          quote: segment?.text ?? (m.quote ? scrubTicketIdentity(m.quote, c) : null),
          restricted: true,
          xyneId: '',
          title: '',
          ticketConversationId: '',
          ticketChannelId: '',
          boardType: c.boardType,
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
        // A stage that was named wins; otherwise the stage that stands for the spoken status.
        proposedStageName:
          c.boardType === BoardType.FLOW
            ? null
            : m.stageIntent ??
              (spoken.proposedStatusV2 ? resolveStageForStatus(boardStages, c.stageName, spoken.proposedStatusV2) : null),
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
  ): Promise<{ pending: number; added: number }> {
    const existing = await repositories.messages.findTicketUpdatesByCallId(conversationId, callExternalId);

    if (existing) {
      // A re-run merges into whatever the card holds right now: decisions people
      // made stay, a row someone is in the middle of approving stays, and the
      // rest of the pending rows are replaced by the new proposals. A proposal
      // for a ticket that already has a pending row keeps that row's updateId,
      // so a draft or an Approve on an open card still finds its row.
      const merged = await mutateTicketUpdatesCard(existing.messageId, (doc) => {
        const inFlight = doc.updates.filter((u) => isTicketUpdateClaimFresh(u.claim));
        const settled = new Set([...doc.applied, ...doc.ignored, ...inFlight].map((x) => x.ticketId));
        const pendingIds = new Map(doc.updates.map((u) => [u.ticketId, u.updateId]));
        const fresh = proposals.filter((p) => !settled.has(p.ticketId));
        const updates = [
          ...inFlight,
          ...fresh.map((p) => ({ ...p, updateId: pendingIds.get(p.ticketId) ?? p.updateId })),
        ];
        return {
          doc: { updates, applied: doc.applied, ignored: doc.ignored },
          result: { pending: updates.length, added: fresh.filter((p) => !pendingIds.has(p.ticketId)).length },
        };
      });
      if (merged.found) {
        logger.info(`[${callExternalId}] ticket_updates_card_updated`, { message_id: existing.messageId });
        return merged.result;
      }
    }

    if (proposals.length === 0) return { pending: 0, added: 0 };

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
    return { pending: proposals.length, added: proposals.length };
  }

  // ── approve / ignore ──────────────────────────────────────────────────────

  private async loadCard(
    callExternalId: string,
    userId: string,
    workspaceId: string,
  ): Promise<{ error: { status: 403 | 404; error: string } } | { call: Call; message: Message }> {
    // Workspace scope, not the caller's ACL: the Calls ACL is keyed on the call's
    // own channel, but the card is read in the channel its thread lives in
    // (callUpdatesChannel when set). Whoever can read the card may act on it, so
    // the decision is made explicitly here against that channel. Awaited inside
    // the scope on purpose (see loadTicketForUser).
    return withWorkspaceScope(async () => {
      const call = await repositories.calls.findByExternalId(callExternalId);
      if (!call || call.workspaceId !== workspaceId) {
        return { error: { status: 404 as const, error: 'Call not found' } };
      }
      // The call row records its thread; the metadata scan is only for older rows.
      const conversationId =
        callThreadRefs(call.metadata).conversationId ??
        (await repositories.messages.findHeadMessageByCallId(callExternalId))?.conversationId;
      const thread = conversationId
        ? await db.conversation.findUnique({ where: { conversationId }, select: { channelId: true } })
        : null;
      // Host, anyone who took part, or a current member of the thread's channel —
      // the same channel that decides which rows are restricted.
      const mayAct =
        call.createdByUserId === userId ||
        (await repositories.calls.findParticipant(call.id, userId)) !== null ||
        (thread !== null && (await repositories.channelParticipants.isParticipant(thread.channelId, userId)));
      if (!mayAct) {
        return { error: { status: 403 as const, error: 'Not part of this call' } };
      }
      if (!conversationId) return { error: { status: 404 as const, error: 'Call thread not found' } };
      const message = await repositories.messages.findTicketUpdatesByCallId(conversationId, callExternalId);
      if (!message) return { error: { status: 404 as const, error: 'No ticket updates for this call' } };
      return { call, message };
    });
  }

  /**
   * The ticket, if this user may read it. Read under the caller's own context so
   * the tickets ACL decides (members, public channels, and every route a guest
   * has in) instead of a copy of that rule kept here.
   */
  private async loadTicketForUser(
    ticketId: string,
  ): Promise<{ error: { status: 403 | 404; error: string } } | { ticket: AccessibleTicket }> {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: { board: { select: { boardType: true } } },
    });
    if (ticket) return { ticket };
    // Workspace scope only to tell "no such ticket" from "no access". Awaited
    // inside the scope on purpose: a Prisma query only runs when it is awaited,
    // and awaiting it outside would run it back under the caller's ACL.
    const exists = await withWorkspaceScope(async () => {
      return await db.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    });
    return exists
      ? { error: { status: 403 as const, error: "You don't have access to this ticket" } }
      : { error: { status: 404 as const, error: 'Ticket not found' } };
  }

  async apply(params: {
    callExternalId: string;
    updateId: string;
    userId: string;
    workspaceId: string;
    postComment: boolean;
    changeStatus: boolean;
    message?: string;
    stageName?: string;
  }): Promise<ApplyTicketUpdateResult> {
    const { callExternalId, updateId, userId, workspaceId, changeStatus } = params;
    // A comment box the user cleared means no comment: nothing is posted in its place.
    const postComment = params.postComment && params.message?.trim() !== '';
    if (!postComment && !changeStatus) {
      return { ok: false, status: 400, error: 'Nothing to apply: choose the comment, the status change, or both' };
    }
    const loaded = await this.loadCard(callExternalId, userId, workspaceId);
    if ('error' in loaded) return { ok: false, ...loaded.error };
    const { call, message } = loaded;

    const update = parseTicketUpdatesContent(message.content).updates.find((u) => u.updateId === updateId);
    if (!update) return { ok: false, status: 409, error: 'This update was already handled' };

    const access = await this.loadTicketForUser(update.ticketId);
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
    // here and only one gets past: the card write is retried on a lost race, and
    // the claim's token tells a retry its own claim from another's. A live claim
    // blocks its own author too (a double submit carries a new token), so it
    // cannot apply twice; a claim is released on failure and otherwise expires.
    const claimToken = randomUUID();
    const claim = await mutateTicketUpdatesCard(message.messageId, (doc) => {
      const row = doc.updates.find((u) => u.updateId === updateId);
      if (!row) return { result: 'handled' as const };
      if (isTicketUpdateClaimFresh(row.claim)) {
        return { result: row.claim.token === claimToken ? ('ok' as const) : ('claimed' as const) };
      }
      row.claim = { by: userId, at: new Date().toISOString(), token: claimToken };
      return { doc, result: 'ok' as const };
    });
    if (!claim.found || claim.result === 'handled') {
      return { ok: false, status: 409, error: 'This update was already handled' };
    }
    if (claim.result === 'claimed') {
      return { ok: false, status: 409, error: 'This update is already being applied' };
    }

    const releaseClaim = () =>
      mutateTicketUpdatesCard(message.messageId, (doc) => {
        const row = doc.updates.find((u) => u.updateId === updateId);
        if (!row || row.claim?.token !== claimToken) return { result: null };
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
      const finalised = await mutateTicketUpdatesCard(message.messageId, (doc) => ({
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
      return { ok: true, applied };
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
    const source = `_${ticketUpdateCommentSource({
      callTitle: call.title,
      callStartedAt: call.startedAt,
      when: update.timestampSeconds !== null ? formatCallTimestamp(update.timestampSeconds) : null,
      speaker: update.speaker,
    })}_`;
    const result = await conversationService.addMessageToConversation({
      conversationId: ticket.conversationId,
      userId,
      content: `${body}\n\n${source}`,
      msgType: MessageType.USER,
      // Approving a card must not join the user to the ticket's channel; the
      // Messages ACL already lets a workspace member post into a public one.
      isAddingParticipant: false,
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
  }): Promise<IgnoreTicketUpdateResult> {
    const { callExternalId, updateId, userId, workspaceId } = params;
    const loaded = await this.loadCard(callExternalId, userId, workspaceId);
    if ('error' in loaded) return { ok: false, ...loaded.error };
    const { message } = loaded;

    const update = parseTicketUpdatesContent(message.content).updates.find((u) => u.updateId === updateId);
    if (!update) return { ok: false, status: 409, error: 'This update was already handled' };
    const access = await this.loadTicketForUser(update.ticketId);
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
    const written = await mutateTicketUpdatesCard(message.messageId, (doc) => {
      const row = doc.updates.find((u) => u.updateId === updateId);
      // Gone because our own retried write already landed, or handled by someone else.
      if (!row) {
        const ours = doc.ignored.some((i) => i.updateId === updateId && i.ignoredBy === userId);
        return { result: ours ? ('ok' as const) : ('handled' as const) };
      }
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
    return { ok: true, ignored };
  }
}

export const callTicketUpdateService = new CallTicketUpdateService();
