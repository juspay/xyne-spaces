import { Prisma } from '@prisma/client';
import {
  RoomRecapStatus,
  RoomRecapType,
  RoomSourceType,
  RoomStatus,
  RoomCurationCadence,
  RoomMemberStatus,
  RoomRole,
} from '@xyne/shared';
import { db } from '../database/client';
import { config } from '../config/env';
import { logger } from '@/utils/logger';
import { getAccessibleChannelIds } from './pythonQuery/acl/tables/channel-access-helper';
import { getConversationInsight } from './clawAgentService';
import { getPromptFromLangfuse, PROMPT_NAMES } from '../agents/xyne-ai/langfuse/prompts.js';

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CLAW_RUN_TIMEOUT_MS = 10 * 60 * 1000;
// Accepts "## Checklist", "### Checklist", "##Checklist" and trailing text on
// the heading line ("## Checklist (as of today)"). Still anchored to the start
// of a line behind hashes, so the word in prose never matches.
const CHECKLIST_HEADING_RE = /^#{2,3}[ \t]*Checklist\b/im;

function extractMarkdown(content: string): string {
  const out = content.trim();
  // Only unwrap when the fence wraps the ENTIRE answer (the agent replying with
  // ```markdown ... ```). A fence in the middle of the brief is real content.
  const fenced = out.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1]!.trim();
  return out;
}

function sanitizePromptText(value: string): string {
  return value.replace(/</g, '‹');
}

// One agent run emits "## Summary" (+ "## Stakeholders") then "## Checklist".
// When the agent omits the "## Checklist" heading the whole document is the
// summary and no checklist recap is written.
function splitBrief(markdown: string): { summary: string; checklist: string } {
  const idx = markdown.search(CHECKLIST_HEADING_RE);
  if (idx === -1) return { summary: markdown.trim(), checklist: '' };
  return { summary: markdown.slice(0, idx).trim(), checklist: markdown.slice(idx).trim() };
}

async function persistRecap(
  roomId: string,
  type: RoomRecapType,
  body: string,
  citations: RecapCitations,
  opts: { cursorAt?: Date }
): Promise<boolean> {
  if (!body.trim()) return false;
  return await db.$transaction(async (tx) => {
    // workspaceId is read off the room rather than re-derived from the project:
    // it is stamped there on insert, and this is the only recap write path.
    const current = await tx.room.findUnique({
      where: { id: roomId },
      select: { status: true, workspaceId: true },
    });
    if (current?.status !== RoomStatus.ACTIVE) {
      logger.info(`[ROOM-CURATION] Room ${roomId} is no longer active, discarding recap`);
      return false;
    }
    // Recaps are a draft/approve workflow: a room holds at most one un-reviewed
    // draft per type. Scoped to status=PENDING AND this type, so this only ever
    // replaces the stale draft the owner has not acted on yet — APPROVED recaps
    // (and drafts of the other type) are never touched.
    await tx.roomRecap.deleteMany({
      where: { roomId, status: RoomRecapStatus.PENDING, type },
    });
    await tx.roomRecap.create({
      data: {
        roomId,
        workspaceId: current.workspaceId,
        type,
        body,
        // Raw "clf-<toolCallId>#<n>" tokens stay inline in `body`; the client
        // resolves them against these citations and builds the links.
        citations:
          citations.length > 0 ? (citations as unknown as Prisma.InputJsonValue) : undefined,
        status: RoomRecapStatus.PENDING,
        createdAt: new Date(),
      },
    });
    if (opts.cursorAt) {
      await tx.room.update({ where: { id: roomId }, data: { lastCuratedAt: opts.cursorAt } });
    }
    return true;
  });
}

type ClawCitation = {
  kind?: string;
  channelId?: string;
  channelKind?: string;
  conversationId?: string;
  messageId?: string;
  chunkIndex?: number;
  canvasId?: string;
  xyneId?: string;
  ticketId?: string;
  mailId?: string;
  url?: string;
};

type ClawToolInvocation = {
  toolCallId?: string;
  citations?: ClawCitation[];
};

// What we persist on room_recaps.citations — just enough for the client to
// resolve the inline "clf-" tokens, not the whole invocation blob.
type RecapCitations = Array<{ toolCallId: string; citations: ClawCitation[] }>;

function slimCitations(toolInvocations: ClawToolInvocation[]): RecapCitations {
  const slim: RecapCitations = [];
  for (const invocation of toolInvocations) {
    if (!invocation.toolCallId || !invocation.citations?.length) continue;
    slim.push({ toolCallId: invocation.toolCallId, citations: invocation.citations });
  }
  return slim;
}

type RunStreamResult = {
  content: string;
  toolInvocations: ClawToolInvocation[];
};

async function runClawAgentForRoom(
  room: { id: string; clawAgentId: string | null },
  ownerId: string,
  readableChannels: ClawSource[],
  task: string
): Promise<RunStreamResult> {
  const agentSlug = room.clawAgentId ?? 'ask-ai';

  const owner = await db.user.findUnique({
    where: { id: ownerId },
    select: { name: true, email: true },
  });
  const userName = owner?.name ?? 'Unknown';
  const userEmail = owner?.email ?? '';

  const attachedContext = readableChannels.map((source) => ({
    type: 'channel',
    id: source.sourceId,
    title: source.label,
  }));

  const url = `${config.xyneClaw.authUrl.replace(/\/$/, '')}/claw/api/v1/run/stream`;

  const conversationId = `room-curation-${room.id}-${Date.now()}`;
  const payload: Record<string, unknown> = {
    userId: ownerId,
    userName,
    userEmail,
    task,
    agentSlug,
    provider: 'spaces',
    conversationId,
    channelId: readableChannels[0]?.sourceId ?? '',
    ...(attachedContext.length > 0 && { attachedContext }),
    agentConfig: {
      webSearchEnabled: 'false',
      deepResearchEnabled: 'false',
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-s2s-key': config.xyneClaw.s2sKey,
        'x-user-id': ownerId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CLAW_RUN_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Could not reach the curation agent service: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`The curation agent service returned HTTP ${res.status}. ${detail}`.trim());
  }

  const streamed = await readRunStream(res.body, agentSlug);

  const insight = await getConversationInsight({ agentSlug, conversationId, userId: ownerId }).catch(
    (error) => {
      logger.warn(`[ROOM-CURATION] Could not fetch citations for ${conversationId}`, error);
      return null;
    }
  );
  const fetched = (insight?.toolInvocations ?? []) as ClawToolInvocation[];
  return {
    content: insight?.content?.trim() ? insight.content : streamed.content,
    toolInvocations: fetched.length > 0 ? fetched : streamed.toolInvocations,
  };
}

async function readRunStream(
  stream: ReadableStream<Uint8Array>,
  agentSlug: string
): Promise<RunStreamResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let deltas = '';
  const toolInvocations: ClawToolInvocation[] = [];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const eventLine = frame.match(/^event:\s*(.+)$/m);
        const dataLine = frame.match(/^data:\s*(.*)$/m);
        if (!eventLine || !dataLine) continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataLine[1]!) as Record<string, unknown>;
        } catch {
          continue;
        }

        const event = eventLine[1]!.trim();
        if (event === 'delta') {
          const chunk = data.content ?? data.delta;
          if (typeof chunk === 'string') deltas += chunk;
        } else if (event === 'invocation') {
          toolInvocations.push(data as ClawToolInvocation);
        } else if (event === 'error') {
          throw new Error(
            `The curation agent failed: ${String(data.error ?? data.message ?? 'unknown error')}`
          );
        } else if (event === 'done') {
          const status = typeof data.status === 'string' ? data.status : 'completed';
          if (status !== 'completed' && status !== 'success') {
            logger.error(
              `[ROOM-CURATION] Claw agent "${agentSlug}" run ended ${status}`,
              data
            );
            const detail = data.error ?? data.message ?? data.reason;
            throw new Error(
              `The curation agent run ${status}${detail ? `: ${String(detail)}` : ''}.`
            );
          }
          const content = typeof data.content === 'string' ? data.content : '';
          return { content: content || deltas, toolInvocations };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error(
    deltas
      ? `The curation agent "${agentSlug}" was cut off before it finished.`
      : `The curation agent "${agentSlug}" returned no result.`
  );
}

type ClawSource = {
  sourceId: string;
  label: string;
  addedBy: string;
};

async function filterSourcesForClaw(
  roomId: string,
  ownerId: string,
  sources: ClawSource[]
): Promise<ClawSource[]> {
  const accessByUserId = new Map<string, Set<string>>();
  const getAccess = async (userId: string): Promise<Set<string>> => {
    const cached = accessByUserId.get(userId);
    if (cached) return cached;
    const ids = new Set(await getAccessibleChannelIds(db, userId));
    accessByUserId.set(userId, ids);
    return ids;
  };

  const kept: ClawSource[] = [];
  for (const source of sources) {
    const readers: Set<string>[] = [await getAccess(ownerId)];
    if (source.addedBy !== ownerId) readers.push(await getAccess(source.addedBy));

    if (readers.every((accessible) => accessible.has(source.sourceId))) {
      kept.push(source);
    } else {
      logger.warn(
        `[ROOM-CURATION] Channel source ${source.sourceId} withheld from agent (room ${roomId}): not readable by both owner and attacher`
      );
    }
  }
  return kept;
}

async function runCuration(roomId: string, force: boolean): Promise<void> {
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room) {
    logger.warn(`[ROOM-CURATION] Room ${roomId} not found, skipping`);
    return;
  }
  if (room.status !== RoomStatus.ACTIVE) {
    logger.info(`[ROOM-CURATION] Room ${roomId} is ${room.status}, skipping`);
    return;
  }

  const owner = await db.roomMember.findFirst({
    where: { roomId, role: RoomRole.OWNER, status: RoomMemberStatus.APPROVED },
    select: { userId: true },
  });
  if (!owner) {
    throw new Error(
      `[ROOM-CURATION] Room ${roomId} has no approved owner — curation cannot run without an owner identity.`
    );
  }
  const ownerId = owner.userId;

  const windowEnd = new Date();

  const sources = (await db.roomSource.findMany({
    where: { roomId, sourceType: RoomSourceType.CHANNEL },
    select: { sourceId: true, label: true, addedBy: true },
  })) as ClawSource[];
  if (sources.length === 0) {
    logger.info(`[ROOM-CURATION] Room ${roomId} has no channels, skipping`);
    return;
  }

  const readableSources = await filterSourcesForClaw(roomId, ownerId, sources);
  if (readableSources.length === 0) {
    logger.info(`[ROOM-CURATION] Room ${roomId} has no readable channels, skipping`);
    return;
  }

  const incremental = !force && room.lastCuratedAt;
  const since = force
    ? new Date(Date.now() - DEFAULT_LOOKBACK_MS)
    : (room.lastCuratedAt ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS));
  const windowLine = incremental
    ? `Focus on activity since ${since.toISOString()} (the last recap). If nothing meaningful changed since then, say so in one line.`
    : `Cover activity from roughly the last week.`;

  const channels = await db.channel.findMany({
    where: { id: { in: readableSources.map((source) => source.sourceId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(channels.map((channel) => [channel.id, channel.name]));
  const channelList = readableSources
    .map(
      (source) =>
        `- #${sanitizePromptText(nameById.get(source.sourceId) ?? source.label)} (id: ${source.sourceId})`
    )
    .join('\n');

  const template = room.checklistTemplate?.trim() ?? '';
  const checklistSection = template
    ? ((await getPromptFromLangfuse(PROMPT_NAMES.ROOM_CURATION_CHECKLIST_SECTION, {
        templateVariables: { checklist_template: sanitizePromptText(template) },
      })) ?? '')
    : '';
  if (template && !checklistSection) {
    logger.warn(
      `[ROOM-CURATION] Room ${roomId} has a checklist but no checklist prompt is available — running summary only`
    );
  }

  const task = await getPromptFromLangfuse(PROMPT_NAMES.ROOM_CURATION_BRIEF, {
    templateVariables: {
      room_name: sanitizePromptText(room.name),
      tracking_query: sanitizePromptText(room.description),
      window_line: windowLine,
      channel_list: channelList,
      checklist_section: checklistSection,
    },
  });
  if (!task) {
    throw new Error(`No curation prompt available for "${PROMPT_NAMES.ROOM_CURATION_BRIEF}".`);
  }

  const { content: resultText, toolInvocations } = await runClawAgentForRoom(
    room,
    ownerId,
    readableSources,
    task
  );

  const citations = slimCitations(toolInvocations);
  logger.info(
    `[ROOM-CURATION] citations: ${toolInvocations.length} tool invocation(s) fetched, ` +
      `${citations.length} persisted with the recap`
  );

  const { summary, checklist } = splitBrief(extractMarkdown(resultText));
  if (!summary) {
    throw new Error('The curation agent returned no usable result.');
  }
  if (checklistSection && !checklist) {
    logger.warn(
      `[ROOM-CURATION] Room ${roomId} brief had no "## Checklist" section — persisting summary only`
    );
  }

  // Only advance lastCuratedAt on the summary write, and only if it lands.
  const persisted = await persistRecap(roomId, RoomRecapType.SUMMARY, summary, citations, {
    cursorAt: windowEnd,
  });
  if (!persisted) return;
  logger.info(`[ROOM-CURATION] Room ${roomId} summary generated`);

  if (checklist) {
    await persistRecap(roomId, RoomRecapType.CHECKLIST, checklist, citations, {});
    logger.info(`[ROOM-CURATION] Room ${roomId} checklist updated`);
  } else {
    // This run has no checklist to replace the previous run's draft with, so
    // drop it explicitly — otherwise a stale draft sits next to the fresh
    // summary still badged "Pending approval". APPROVED recaps are untouched.
    const cleared = await db.roomRecap.deleteMany({
      where: { roomId, status: RoomRecapStatus.PENDING, type: RoomRecapType.CHECKLIST },
    });
    if (cleared.count > 0) {
      logger.info(
        `[ROOM-CURATION] Room ${roomId} produced no checklist — cleared ${cleared.count} stale pending checklist draft(s)`
      );
    }
  }
}

export async function curateRoom(roomId: string, force = false): Promise<void> {
  try {
    await runCuration(roomId, force);
  } catch (error) {
    logger.error(`[ROOM-CURATION] Curation run failed for room ${roomId}`, error);
    throw error;
  }
}

export async function findDueRoomIds(now: Date = new Date()): Promise<string[]> {
  const rooms = await db.room.findMany({
    where: {
      status: RoomStatus.ACTIVE,
      curationCadence: { in: [RoomCurationCadence.DAILY, RoomCurationCadence.HOURLY] },
    },
    select: { id: true, curationCadence: true, lastCuratedAt: true },
  });

  return rooms
    .filter((room) => {
      const anchor = room.lastCuratedAt?.getTime() ?? 0;
      if (anchor === 0) return true;
      const interval = room.curationCadence === RoomCurationCadence.HOURLY ? HOUR_MS : DAY_MS;
      return now.getTime() - anchor >= interval;
    })
    .map((room) => room.id);
}
