/**
 * Post-call "ticket updates": find EXISTING tickets that people talked about in a
 * call transcript, extract what was said about each one and any spoken status
 * change, and post them as a review card in the call thread. Nothing is applied
 * automatically — a call participant approves each item (comment on the ticket
 * and/or move its stage) or ignores it. See docs/plan-call-ticket-updates.md.
 *
 * Matching never searches the whole workspace: the LLM only chooses among a
 * bounded candidate list (ticket ids spoken in the transcript, the channel's open
 * tickets, tickets assigned to the participants, and tickets discussed in earlier
 * instances of the same recurring series), so a garbled project code still
 * resolves against a small set.
 */
import { randomUUID } from 'crypto';
import type { Agent } from '@framework';
import type { Call, Message } from '@prisma/client';
import { ActivityType, BoardType, MessageType, TicketStatusV2 } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
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
  moveTicketUpdate,
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
const STATUS_VALUES: string[] = Object.values(TicketStatusV2);

interface CandidateTicket {
  id: string;
  xyneId: string;
  title: string;
  statusV2: string;
  stageName: string;
  boardId: string;
  boardType: string;
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
  conversationId: string;
  assignedTo: string | null;
  board: { boardType: string } | null;
};

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

export function resolveStageForStatus(
  stages: Array<{ name: string; sequenceNumber: number; defaultTicketStatusV2: string }>,
  currentStageName: string,
  status: string,
): string | null {
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

export type ApplyTicketUpdateResult =
  | { ok: true; content: string; applied: AppliedTicketUpdate }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; stageOptions?: string[] };

export type IgnoreTicketUpdateResult =
  | { ok: true; content: string; ignored: IgnoredTicketUpdate }
  | { ok: false; status: 403 | 404 | 409; error: string };

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
    const proposals = await this.toProposals(mentions, candidates, segmentByN);

    const posted = await this.postCard(call, callExternalId, conversationId, workspaceId, proposals);
    getCallTicketUpdatesTotal().add(posted, { workspaceId });
    logger.info(`[${callExternalId}] ticket_updates_posted`, {
      candidates: candidates.size,
      mentions: mentions.length,
      proposals: proposals.length,
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

    // 3. Open tickets assigned to people on the call.
    const participants = await repositories.calls.getCallParticipantsWithUserDetails(callExternalId).catch(() => []);
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
      const earlier = await db.call.findMany({
        where: { recurringSeriesId: call.recurringSeriesId, id: { not: call.id }, startedAt: { lt: call.startedAt } },
        orderBy: { startedAt: 'desc' },
        take: SERIES_MEMORY_INSTANCES,
        select: { externalId: true, startedAt: true },
      });
      const startedAtByExternalId = new Map(earlier.map((c) => [c.externalId, c.startedAt]));
      const messages = await repositories.messages.findTicketUpdateMessagesByCallIds(earlier.map((c) => c.externalId));
      const discussed = new Map<string, string>();
      for (const message of messages) {
        const callId = (message.metadata as Record<string, unknown> | null)?.['callId'];
        const when = typeof callId === 'string' ? startedAtByExternalId.get(callId) : undefined;
        const doc = parseTicketUpdatesContent(message.content);
        for (const item of [...doc.updates, ...doc.applied, ...doc.ignored]) {
          if (!discussed.has(item.ticketId)) discussed.set(item.ticketId, (when ?? message.createdAt).toISOString().slice(0, 10));
        }
      }
      if (discussed.size > 0) {
        const rows = await db.ticket.findMany({
          where: { workspaceId, id: { in: [...discussed.keys()] } },
          select: TICKET_CANDIDATE_SELECT,
        });
        rows.forEach((r) => add(r, 'series', discussed.get(r.id) ?? null));
      }
    }

    // Assignee names for the prompt.
    const assigneeIds = [...new Set([...candidates.values()].map((c) => c.id))];
    if (assigneeIds.length > 0) {
      const ticketAssignees = await db.ticket.findMany({
        where: { id: { in: assigneeIds } },
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
      if (matchedBy === 'number-only') confidence = Math.min(confidence, NUMBER_ONLY_MAX_CONFIDENCE);
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
      const boardStages = stagesByBoard.get(c.boardId) ?? [];
      const proposedStageName =
        m.statusIntent && m.statusIntent !== c.statusV2 && c.boardType !== BoardType.FLOW
          ? resolveStageForStatus(boardStages, c.stageName, m.statusIntent)
          : null;
      const segment = m.segment !== null ? segmentByN.get(m.segment) ?? null : null;
      return {
        updateId: randomUUID(),
        ticketId: c.id,
        xyneId: c.xyneId,
        title: c.title,
        ticketConversationId: c.conversationId,
        boardType: c.boardType,
        currentStageName: c.stageName,
        currentStatusV2: c.statusV2,
        update: m.update,
        proposedStatusV2: m.statusIntent && m.statusIntent !== c.statusV2 ? m.statusIntent : null,
        proposedStageName,
        stageOptions: boardStages.map((s) => s.name).filter((n) => n !== c.stageName),
        speaker: segment?.speaker ?? m.speaker,
        timestampSeconds: segment ? timestampToSeconds(segment.timestamp) : null,
        segment: segment ? segment.n : null,
        quote: segment?.text ?? m.quote,
        confidence: Math.round(m.confidence * 100) / 100,
        matchedBy: m.matchedBy,
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
    const previous = existing ? parseTicketUpdatesContent(existing.content) : { updates: [], applied: [], ignored: [] };

    // A re-run never re-proposes a ticket the user already approved or ignored.
    const handled = new Set([...previous.applied, ...previous.ignored].map((x) => x.ticketId));
    const updates = proposals.filter((p) => !handled.has(p.ticketId));

    if (!existing && updates.length === 0) return 0;

    const content = buildTicketUpdatesContent({ updates, applied: previous.applied, ignored: previous.ignored });
    const baseMetadata = {
      messageSubtype: CALL_TICKET_UPDATES_SUBTYPE,
      callId: callExternalId,
      isAiGenerated: true,
      contentFormat: 'markdown',
      ticketUpdatesCount: updates.length,
    };

    if (existing) {
      const version = Number((existing.metadata as Record<string, unknown> | null)?.['version'] ?? 1);
      await repositories.messages.update(existing.messageId, {
        content,
        metadata: { ...baseMetadata, version: version + 1, lastUpdatedAt: new Date().toISOString() },
      });
      logger.info(`[${callExternalId}] ticket_updates_card_updated`, { message_id: existing.messageId, version: version + 1 });
      return updates.length;
    }

    const bot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
    if (!bot) throw new Error('Xyne Automatic bot not found - cannot post ticket updates');
    const message = await repositories.messages.create({
      conversationId,
      senderId: bot.id,
      content,
      msgType: MessageType.BOT,
      showInChannel: false,
      metadata: { ...baseMetadata, version: 1, createdAt: new Date().toISOString() },
    });
    await repositories.conversations.incrementReplyCount(conversationId);
    logger.info(`[${callExternalId}] ticket_updates_card_created`, { message_id: message.messageId, call_id: call.id });
    return updates.length;
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
    const head = await repositories.messages.findHeadMessageByCallId(callExternalId);
    if (!head) return { error: { status: 404 as const, error: 'Call thread not found' } };
    const message = await repositories.messages.findTicketUpdatesByCallId(head.conversationId, callExternalId);
    if (!message) return { error: { status: 404 as const, error: 'No ticket updates for this call' } };
    return { call, message };
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
    const { callExternalId, updateId, userId, workspaceId, postComment, changeStatus } = params;
    if (!postComment && !changeStatus) {
      return { ok: false, status: 400, error: 'Nothing to apply: choose the comment, the status change, or both' };
    }
    const loaded = await this.loadCard(callExternalId, userId, workspaceId);
    if ('error' in loaded) return { ok: false, ...loaded.error };
    const { call, message } = loaded;

    const update = parseTicketUpdatesContent(message.content).updates.find((u) => u.updateId === updateId);
    if (!update) return { ok: false, status: 409, error: 'This update was already handled' };

    const ticket = await db.ticket.findUnique({ where: { id: update.ticketId }, include: { board: { select: { boardType: true } } } });
    if (!ticket || ticket.workspaceId !== workspaceId) return { ok: false, status: 404, error: 'Ticket not found' };
    if (!(await repositories.channelParticipants.isParticipant(ticket.channelId, userId))) {
      return { ok: false, status: 403, error: "You are not a member of the ticket's channel" };
    }

    // Resolve the target stage before touching anything, so a bad choice fails cleanly.
    let targetStage: { name: string; defaultTicketStatusV2: string } | null = null;
    if (changeStatus) {
      const boardType = ticket.board?.boardType ?? BoardType.DEFAULT;
      const stageName = params.stageName?.trim() || update.proposedStageName;
      const stages = await db.stage.findMany({
        where: { boardId: ticket.boardId },
        orderBy: { sequenceNumber: 'asc' },
        select: { name: true, defaultTicketStatusV2: true },
      });
      const options = stages.map((s) => s.name).filter((n) => n !== ticket.stageName);
      if (boardType === BoardType.FLOW) {
        return { ok: false, status: 400, error: 'Tickets on a flow board move through their board transitions; post the comment only', stageOptions: [] };
      }
      if (!stageName) {
        return { ok: false, status: 400, error: 'Choose the stage to move the ticket to', stageOptions: options };
      }
      targetStage = stages.find((s) => s.name === stageName) ?? null;
      if (!targetStage) {
        return { ok: false, status: 400, error: `"${stageName}" is not a stage on this board`, stageOptions: options };
      }
      if (targetStage.name === ticket.stageName) {
        return { ok: false, status: 400, error: `Ticket is already in "${ticket.stageName}"`, stageOptions: options };
      }
    }

    // 1. Comment on the ticket thread, as the user who approved it.
    let commentMessageId: string | null = null;
    if (postComment) {
      const body = (params.message?.trim() || update.update).trim();
      const when = update.timestampSeconds !== null ? ` at ${formatSeconds(update.timestampSeconds)}` : '';
      const source = `_From the call "${call.title ?? 'Untitled call'}"${when}${update.speaker ? `, said by ${update.speaker}` : ''}._`;
      const result = await conversationService.addMessageToConversation({
        conversationId: ticket.conversationId,
        userId,
        content: `${body}\n\n${source}`,
        msgType: MessageType.USER,
        metadata: {
          contentFormat: 'markdown',
          source: 'call_ticket_update',
          callId: callExternalId,
          updateId,
          ...(update.timestampSeconds !== null ? { timestampSeconds: update.timestampSeconds } : {}),
        },
      });
      commentMessageId = result.message.messageId;
      // Notifications, mentions and unread counts live in the side-effect
      // handler; conversationService does not fire it. Best-effort, as in the
      // automation reply step.
      try {
        const ctx = await buildUserQueryContext(userId);
        void new MessagesSideEffectHandler(ctx)
          .onInsert({ entityId: commentMessageId, entityType: 'messages', operation: 'insert' })
          .catch((err) => logger.error('[callTicketUpdate] comment side-effect failed', err));
      } catch (err) {
        logger.error('[callTicketUpdate] comment side-effect context failed', err);
      }
    }

    // 2. Move the stage. Always a stage move (never a bare statusV2 write): the
    //    stage carries the status, the activity row and the thread system message.
    let newStageName: string | null = null;
    let newStatusV2: string | null = null;
    if (changeStatus && targetStage) {
      const boardType = ticket.board?.boardType ?? BoardType.DEFAULT;
      if (boardType === BoardType.NON_LINEAR) {
        const result = await ticketStageTransitionService.transitionTicket(ticket.id, userId, targetStage.name, {});
        if (!result.success) {
          return { ok: false, status: 400, error: result.message ?? 'Stage transition not allowed' };
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
      } else {
        await repositories.tickets.updateTicketStage(ticket.id, targetStage.name, userId, ActivitySource.INTERNAL);
      }
      newStageName = targetStage.name;
      newStatusV2 = targetStage.defaultTicketStatusV2;
    }

    // 3. Record it on the card.
    const applied: AppliedTicketUpdate = {
      updateId,
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      title: ticket.title,
      ticketConversationId: ticket.conversationId,
      appliedBy: userId,
      appliedAt: new Date().toISOString(),
      commentMessageId,
      newStageName,
      newStatusV2,
    };
    const moved = moveTicketUpdate(message.content, updateId, { applied });
    if (!moved) return { ok: false, status: 409, error: 'This update was already handled' };
    await repositories.messages.update(message.messageId, { content: moved.content, edited: true });
    getCallTicketUpdatesAppliedTotal().add(1, { workspaceId });
    logger.info(`[${callExternalId}] ticket_update_applied`, {
      update_id: updateId, ticket: ticket.xyneId, comment: !!commentMessageId, stage: newStageName, user_id: userId,
    });
    return { ok: true, content: moved.content, applied };
  }

  async ignore(params: { callExternalId: string; updateId: string; userId: string; workspaceId: string }): Promise<IgnoreTicketUpdateResult> {
    const { callExternalId, updateId, userId, workspaceId } = params;
    const loaded = await this.loadCard(callExternalId, userId, workspaceId);
    if ('error' in loaded) return { ok: false, ...loaded.error };
    const { message } = loaded;
    const update = parseTicketUpdatesContent(message.content).updates.find((u) => u.updateId === updateId);
    if (!update) return { ok: false, status: 409, error: 'This update was already handled' };
    const ignored: IgnoredTicketUpdate = {
      updateId,
      ticketId: update.ticketId,
      xyneId: update.xyneId,
      title: update.title,
      ignoredBy: userId,
      ignoredAt: new Date().toISOString(),
    };
    const moved = moveTicketUpdate(message.content, updateId, { ignored });
    if (!moved) return { ok: false, status: 409, error: 'This update was already handled' };
    await repositories.messages.update(message.messageId, { content: moved.content, edited: true });
    logger.info(`[${callExternalId}] ticket_update_ignored`, { update_id: updateId, ticket: update.xyneId, user_id: userId });
    return { ok: true, content: moved.content, ignored };
  }
}

export const callTicketUpdateService = new CallTicketUpdateService();
