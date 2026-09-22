import { randomUUID } from 'crypto';
import type { Canvas, Ticket } from '@prisma/client';
import { CanvasRole, TagMethod, TicketReferenceRelation } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { runScopedClawAgent, ClawAgentNotAvailableError } from '@/services/clawAgentService';
import { tagRepository } from '@/database/repositories/tagRepository';
import { initializeYSweetDoc } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

// Seeded with the spaces-emails tool (seed.ts) — slug behind a constant so a
// future desk-canvas-specific agent swaps in without touching the dispatch.
const DESK_CANVAS_AGENT_SLUG = 'ask-ai';

/** Thrown when a generation is already running for this ticket's canvas. */
export class CanvasGenerationInProgressError extends Error {
  constructor() {
    super('Canvas generation already in progress for this ticket');
    this.name = 'CanvasGenerationInProgressError';
  }
}

type DeskThreadCanvasScope = 'chat' | 'email' | 'both';

/** Shape of `canvas.metadata` for desk-thread canvases. No index signature:
 *  Prisma's InputJsonValue rejects one typed `unknown`. */
export interface CanvasMetadata {
  source?: string;
  ticketId?: string;
  conversationIds?: string[];
  generationStatus?: string;
  generationStartedAt?: string;
  sessionId?: string;
  error?: string;
}

/** A run whose callback never landed would lock the ticket out forever; past
 *  this age a new dispatch takes over. Mirrors reapStuckPending in
 *  deskReportGenerationService. */
const STUCK_GENERATION_MS = 30 * 60 * 1000;

function isGenerationStuck(metadata: CanvasMetadata): boolean {
  const startedAt = Date.parse(metadata.generationStartedAt ?? '');
  // Unstamped rows predate the field — stuck, rather than locked forever.
  if (Number.isNaN(startedAt)) return true;
  return Date.now() - startedAt > STUCK_GENERATION_MS;
}

const CANVAS_LABEL_SOURCE_TYPE = 'canvas';
const CANVAS_LABEL_CATEGORY = 'generic';

interface DeskThreadCanvasDispatchInput {
  ticket: Ticket;
  user: { id: string; name: string | null; email: string; workspaceId: string };
  scope: DeskThreadCanvasScope;
  labels: string[];
  includeMerged: boolean;
  /** Caller's session cookie, forwarded so claw-auth can authenticate this as
   *  the acting user (its priority-1 path) rather than relying on the shared
   *  S2S key. Mirrors clawIdentity in api/sdk/direct.ts. */
  cookie?: string | undefined;
}

/** One canvas per ticket: found by its (indexed) home channel + metadata.ticketId. */
async function findOrCreateTicketCanvas(args: {
  ticket: Ticket;
  conversationIds: string[];
  userId: string;
  workspaceId: string;
  sessionId: string;
}): Promise<Canvas> {
  const { ticket, conversationIds, userId, workspaceId, sessionId } = args;

  const existing = await db.canvas.findFirst({
    where: {
      channelId: ticket.channelId,
      isArchived: false,
      metadata: { path: ['ticketId'], equals: ticket.id },
    },
  });

  if (existing) {
    const metadata = (existing.metadata as CanvasMetadata | null) ?? {};
    // One at a time: a second click would overwrite sessionId and orphan the
    // first run's callback.
    if (metadata.generationStatus === 'GENERATING' && !isGenerationStuck(metadata)) {
      throw new CanvasGenerationInProgressError();
    }
    const nextMetadata = {
      ...metadata,
      conversationIds,
      generationStatus: 'GENERATING',
      generationStartedAt: new Date().toISOString(),
      sessionId,
      error: undefined,
    };
    await db.canvas.update({
      where: { id: existing.id },
      data: { metadata: nextMetadata, lastEditedBy: userId, lastEditedAt: new Date() },
    });
    // @@unique([canvasId, channelId]) — upsert, never blind insert.
    await ensureChannelParticipant(existing.id, ticket.channelId, workspaceId);
    return { ...existing, metadata: nextMetadata } as Canvas;
  }

  const now = new Date();
  const canvasId = randomUUID();
  const canvas = await db.canvas.create({
    data: {
      id: canvasId,
      title: ticket.title,
      content: [],
      workspaceId,
      createdBy: userId,
      channelId: ticket.channelId,
      visibility: 'PRIVATE',
      isTemplate: false,
      isCollaborative: true,
      lastEditedBy: userId,
      lastEditedAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: {
        source: 'desk-thread',
        ticketId: ticket.id,
        conversationIds,
        generationStatus: 'GENERATING',
        generationStartedAt: now.toISOString(),
        sessionId,
      },
      participants: {
        create: { id: randomUUID(), workspaceId, userId, role: CanvasRole.OWNER, joinedAt: now, updatedAt: now },
      },
    },
  });
  await ensureChannelParticipant(canvasId, ticket.channelId, workspaceId);

  const placeholder: BlockNoteBlock[] = [
    {
      id: randomUUID(),
      type: 'paragraph',
      props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
      content: [{ type: 'text', text: 'Generating canvas from thread…', styles: {} }],
      children: [],
    } as BlockNoteBlock,
  ];
  const initialized = await initializeYSweetDoc(canvasId, placeholder, userId);
  if (!initialized) {
    // Non-fatal: the callback syncs real content over syncToYSweet either way.
    logger.warn('[DeskThreadCanvas] placeholder seed failed — canvas row created empty', { canvasId });
  }

  return canvas;
}

async function ensureChannelParticipant(canvasId: string, channelId: string, workspaceId: string): Promise<void> {
  // Upsert, not findFirst+create: concurrent dispatches would race into a
  // P2002 on @@unique([canvasId, channelId]).
  await db.canvasParticipant.upsert({
    where: { canvasId_channelId: { canvasId, channelId } },
    update: {},
    create: { id: randomUUID(), workspaceId, canvasId, channelId, role: CanvasRole.EDITOR, joinedAt: new Date(), updatedAt: new Date() },
  });
}

/** Resolve the primary conversation plus any merged-in tickets' conversations. */
async function resolveConversationIds(ticket: Ticket, includeMerged: boolean): Promise<string[]> {
  const ids = [ticket.conversationId].filter(Boolean) as string[];
  if (!includeMerged) return ids;

  const mappings = await db.ticketReferenceMapping.findMany({
    where: { targetTicketId: ticket.id, relationType: TicketReferenceRelation.MERGED_INTO },
    include: { sourceTicket: { select: { conversationId: true } } },
  });
  for (const mapping of mappings) {
    if (mapping.sourceTicket.conversationId) ids.push(mapping.sourceTicket.conversationId);
  }
  return [...new Set(ids)];
}

/** Mirrors canvasController.addCanvasLabel — dedupe first, insertTagRow throws
 *  on the tag unique constraint otherwise. */
async function applyLabels(canvasId: string, labels: string[], userId: string, workspaceId: string): Promise<void> {
  const names = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  if (names.length === 0) return;

  const existingRows = await tagRepository.findActiveTags(canvasId, CANVAS_LABEL_SOURCE_TYPE, CANVAS_LABEL_CATEGORY);
  const existing = new Set(existingRows.map((row) => row.tag.toLowerCase()));

  for (const name of names) {
    if (existing.has(name.toLowerCase())) continue;
    await tagRepository.insertTagRow({
      sourceId: canvasId,
      sourceType: CANVAS_LABEL_SOURCE_TYPE,
      workspaceId,
      configKey: null,
      tagCategory: CANVAS_LABEL_CATEGORY,
      tag: name,
      method: TagMethod.MANUAL,
      reason: null,
      createdBy: userId,
      updatedBy: userId,
    });
  }
}

/** Inlined into the prompt because no MCP tool covers Message rows. `visibleTo
 *  IS NULL` only — the canvas is seen by more people than a private side-note. */
async function fetchChatTranscript(conversationIds: string[]): Promise<string> {
  const messages = await db.message.findMany({
    where: { conversationId: { in: conversationIds }, visibleTo: null, isDeleted: false },
    include: { sender: { select: { name: true, displayName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
    take: 501,
  });
  const truncated = messages.length > 500;
  const rendered = (truncated ? messages.slice(0, 500) : messages)
    .map((msg) => {
      const who = msg.sender?.displayName || msg.sender?.name || msg.sender?.email || msg.senderId;
      const at = msg.createdAt.toISOString();
      return `[${at}] ${who}:\n${msg.content}`;
    })
    .join('\n\n');
  return truncated ? `${rendered}\n\n[…chat truncated: oldest 500 of >500 messages shown…]` : rendered;
}

function buildTask(args: {
  ticket: Ticket;
  scope: DeskThreadCanvasScope;
  conversationIds: string[];
  labels: string[];
  chatTranscript: string | null;
}): string {
  const { ticket, scope, conversationIds, labels, chatTranscript } = args;
  const lines: string[] = [
    `You are producing a canvas that summarises a support-desk ticket thread so any agent can get up to speed quickly.`,
    ``,
    `Ticket: "${ticket.title}" (xyneId: ${ticket.xyneId})`,
    `Scope: ${scope}`,
    `Conversation ids: ${conversationIds.join(', ')}`,
  ];
  if (scope === 'email' || scope === 'both') {
    lines.push(
      `For EACH conversation id listed above, call the spaces-emails tool to fetch the full email thread (all messages, participants, timestamps).`,
    );
  }
  if (chatTranscript) {
    lines.push(``, `Chat thread transcript (deterministically fetched, do NOT re-fetch):`, `---`, chatTranscript, `---`);
  }
  if (labels.length > 0) {
    lines.push(``, `The requesting user pre-selected these labels — prominently feature them where relevant: ${labels.join(', ')}.`);
  }
  lines.push(
    ``,
    `Write a well-structured markdown canvas covering: a one-paragraph summary, participants, timeline of key events, the current state / resolution, and any outstanding actions. Include a suggested-labels section near the top with 2-5 short labels describing the thread.`,
    ``,
    `Respond with ONLY a JSON object of the shape { "markdown": "<the whole canvas markdown>" } — no prose before or after, no code fence.`,
  );
  return lines.join('\n');
}

async function markCanvasFailed(canvasId: string, message: string): Promise<void> {
  const canvas = await db.canvas.findUnique({ where: { id: canvasId }, select: { metadata: true } });
  const metadata = (canvas?.metadata as CanvasMetadata | null) ?? {};
  await db.canvas.update({
    where: { id: canvasId },
    data: { metadata: { ...metadata, generationStatus: 'FAILED', error: message } },
  });
}

async function dispatch(input: DeskThreadCanvasDispatchInput): Promise<{ canvasId: string }> {
  const { ticket, user, scope, labels, includeMerged, cookie } = input;

  const conversationIds = await resolveConversationIds(ticket, includeMerged);
  const sessionId = randomUUID();

  const canvas = await findOrCreateTicketCanvas({
    ticket,
    conversationIds,
    userId: user.id,
    workspaceId: user.workspaceId,
    sessionId,
  });

  try {
    await applyLabels(canvas.id, labels, user.id, user.workspaceId);
  } catch (err) {
    // Labels are best-effort — never block generation on them.
    logger.warn('[DeskThreadCanvas] applying labels failed — continuing', { canvasId: canvas.id, error: err });
  }

  // Without orgId the same slug can surface once per org, and the dispatch may
  // pick an agent whose Spaces app lives elsewhere (see ScopedClawIdentity).
  const workspace = await db.workspace.findUnique({
    where: { id: user.workspaceId },
    select: { orgId: true },
  });

  const chatTranscript = scope === 'chat' || scope === 'both' ? await fetchChatTranscript(conversationIds) : null;
  const task = buildTask({ ticket, scope, conversationIds, labels, chatTranscript });
  const callbackUrl = `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}/api/internal/desk-canvas/callback/${encodeURIComponent(canvas.id)}/${encodeURIComponent(sessionId)}`;

  try {
    await runScopedClawAgent({
      identity: {
        userId: user.id,
        workspaceId: user.workspaceId,
        ...(workspace?.orgId ? { orgId: workspace.orgId } : {}),
        ...(cookie ? { cookie } : {}),
      },
      agentSlug: DESK_CANVAS_AGENT_SLUG,
      task,
      userId: user.id,
      userName: user.name || 'Desk Agent',
      userEmail: user.email,
      conversationId: `desk-canvas-${canvas.id}-${sessionId}`,
      channelId: ticket.channelId,
      workspaceId: user.workspaceId,
      callbackUrl,
    });
  } catch (err) {
    const isAgentMissing = err instanceof ClawAgentNotAvailableError;
    const message = isAgentMissing
      ? `Agent "${DESK_CANVAS_AGENT_SLUG}" isn't installed in this workspace. Ask an admin to install it.`
      : `Failed to dispatch canvas generation: ${err instanceof Error ? err.message : 'Unknown error'}`;
    logger.warn('[DeskThreadCanvas] dispatch failed — marking FAILED', { canvasId: canvas.id, error: err });
    await markCanvasFailed(canvas.id, message);
    // Preserve the typed error so the controller can map it to 409.
    throw err;
  }

  logger.info('[DeskThreadCanvas] dispatched canvas generation', { canvasId: canvas.id, ticketId: ticket.id, sessionId, scope });
  return { canvasId: canvas.id };
}

export const deskThreadCanvasService = { dispatch };
