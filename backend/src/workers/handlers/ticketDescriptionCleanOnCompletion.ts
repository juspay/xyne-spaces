import { db } from '@/database/client';
import { getContextOrNull } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import vespaClient from '@/vespa/client';
import { ticketSchema } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { cleanTicketDescriptionHtml } from '@/services/tickets/descriptionCleaner/htmlCleaner';
import { cleanTicketDescriptionWithLlm } from '@/agents/ticket-cleaning-and-themes';
import type { VespaJobType } from '@/zero/vespa-injection/core/types';
import { ChannelType, VespaInsertionStatus, VespaOperationType } from '@prisma/client';

type TicketDescriptionCleanContext = {
  docId: string;
  jobType: VespaJobType;
  mappedData?: Record<string, unknown> | null;
  userId?: string;
};

const MAX_LLM_ATTEMPTS = 2;
const CHANNEL_REF_DELIMITER = '::';

function extractChannelId(channelRef: unknown): string | null {
  if (typeof channelRef !== 'string') return null;
  const idx = channelRef.lastIndexOf(CHANNEL_REF_DELIMITER);
  if (idx === -1) return null;
  const channelId = channelRef.slice(idx + CHANNEL_REF_DELIMITER.length).trim();
  return channelId || null;
}

async function resolveChannelType(mapped: Record<string, unknown>): Promise<ChannelType | null> {
  let channelId = extractChannelId(mapped.channelRef);

  if (!channelId) {
    const convId = typeof mapped.convId === 'string' ? mapped.convId : '';
    if (convId) {
      const conversation = await db.conversation.findUnique({
        where: { conversationId: convId },
        select: { channelId: true },
      });
      channelId = conversation?.channelId ?? null;
    }
  }

  if (!channelId) return null;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { type: true },
  });

  return channel?.type ?? null;
}

async function resolveTicketProjectId(
  ticketId: string,
  mapped: Record<string, unknown>,
): Promise<string | null> {
  if (typeof mapped.projectId === 'string' && mapped.projectId.trim()) {
    return mapped.projectId;
  }

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { projectId: true },
  });

  return ticket?.projectId ?? null;
}

async function upsertTicketCleanupFailure(
  ticketId: string,
  userId: string | undefined,
  errorMessage: string,
  attempts: number,
): Promise<void> {
  try {
    const existing = await db.vespaInsertionLogs.findFirst({
      where: {
        entityId: ticketId,
        entityType: ticketSchema,
        type: VespaOperationType.POST_INGEST_CLEAN,
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      status: VespaInsertionStatus.FAILED,
      namespace: NAMESPACE,
      errorMessage,
      errorDetails: {
        attempts,
        source: 'ticket_description_clean_on_completion',
        timestamp: new Date().toISOString(),
      },
      retryCount: 0,
      resolvedAt: null,
      userId: userId ?? null,
    };

    if (existing) {
      await db.vespaInsertionLogs.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { workspaceId: true },
    });
    const workspaceId = ticket?.workspaceId ?? getContextOrNull()?.workspaceId;
    if (!workspaceId) {
      throw new Error(
        `workspaceId required: ticket ${ticketId} not found and no tenant context`,
      );
    }

    await db.vespaInsertionLogs.create({
      data: {
        workspaceId,
        entityId: ticketId,
        entityType: ticketSchema,
        type: VespaOperationType.POST_INGEST_CLEAN,
        ...data,
      },
    });
  } catch (error) {
    logger.warn('[TicketDescCleanOnCompletion] Failed to upsert cleanup failure log', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function clearTicketCleanupFailure(ticketId: string): Promise<void> {
  try {
    await db.vespaInsertionLogs.deleteMany({
      where: {
        entityId: ticketId,
        entityType: ticketSchema,
        type: VespaOperationType.POST_INGEST_CLEAN,
      },
    });
  } catch (error) {
    logger.warn('[TicketDescCleanOnCompletion] Failed to clear cleanup failure log', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runTicketDescriptionCleanOnCompletion(
  ctx: TicketDescriptionCleanContext,
): Promise<void> {
  const startTime = Date.now();

  if (ctx.jobType === 'delete') {
    return;
  }

  const mapped = ctx.mappedData ?? {};
  const title = typeof mapped.title === 'string' ? mapped.title : '';
  const description = typeof mapped.description === 'string' ? mapped.description : '';
  if (!description) {
    return;
  }

  const { cleaned } = cleanTicketDescriptionHtml(description);
  if (!cleaned) {
    return;
  }

  const channelType = await resolveChannelType(mapped);
  const isEmailTicket = channelType === ChannelType.EMAIL;
  const projectId = isEmailTicket ? await resolveTicketProjectId(ctx.docId, mapped) : null;

  let descriptionClean = cleaned;
  let usedLlm = false;
  let attempts = 0;
  let lastError: string | undefined;
  let llmAttempted = false;

  if (isEmailTicket && projectId) {
    logger.info('[TicketDescCleanOnCompletion] Email ticket detected', {
      ticketId: ctx.docId,
      channelType,
    });
    llmAttempted = true;
    const input = {
      title,
      description: cleaned,
    };

    for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
      attempts = attempt;
      const attemptStart = Date.now();
      try {
        const result = await cleanTicketDescriptionWithLlm(input, { projectId });
        descriptionClean = result.description || cleaned;
        usedLlm = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn('[TicketDescCleanOnCompletion] LLM attempt failed', {
          ticketId: ctx.docId,
          jobType: ctx.jobType,
          attempt,
          durationMs: Date.now() - attemptStart,
          error: lastError,
        });
      }
    }
  }

  if (llmAttempted && !usedLlm) {
    await upsertTicketCleanupFailure(
      ctx.docId,
      ctx.userId,
      lastError || 'LLM cleanup failed',
      attempts,
    );
  }

  if (llmAttempted && usedLlm) {
    await clearTicketCleanupFailure(ctx.docId);
  }

  try {
    await vespaClient.crudService.update(
      [{ docId: ctx.docId, fields: { description_clean: descriptionClean } }],
      ticketSchema,
    );

    logger.info('[TicketDescCleanOnCompletion] Vespa ticket updated', {
      ticketId: ctx.docId,
      jobType: ctx.jobType,
      usedLlm,
      attempts,
      durationMs: Date.now() - startTime,
      fallback: !usedLlm,
      error: lastError,
    });
  } catch (error) {
    logger.error('[TicketDescCleanOnCompletion] Vespa update failed', {
      ticketId: ctx.docId,
      jobType: ctx.jobType,
      usedLlm,
      attempts,
      durationMs: Date.now() - startTime,
      error: error,
    });
  }
}
