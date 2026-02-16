import Bull from 'bull';
import { MessageType } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { proactiveNudgeService } from '@/services/nudges/proactiveNudgeService';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import {
  generateNudges,
  type ProactiveNudgeInput,
} from '@/agents/nudge-extractor';
import { ZodError } from 'zod';
import type { ProactiveNudgeOutputLenient } from '@/services/nudges/proactiveNudgeSchemas';
import { redisService } from '@/services/redisService';

const THREAD_MESSAGE_LIMIT = 15;
const MAX_SUBTICKET_SUGGESTIONS = 6;
const MAX_EXISTING_PROJECT_TAGS = 40;
const PROACTIVE_NUDGE_QUEUE_NAME = 'proactive-nudge';
const PROACTIVE_NUDGE_JOB_NAME = 'generate-nudges';

export type ProactiveNudgeJobData = {
  messageId: string;
  conversationId: string;
  channelId: string;
  projectId: string;
  senderId: string;
};

const normalizeText = (content: string, hasAttachment: boolean): string => {
  const plain = extractPlainTextFromHtml(content || '');
  if (!plain.trim() && hasAttachment) {
    return 'Sent an attachment';
  }
  return plain.trim();
};

const isParseError = (error: unknown): boolean => {
  if (error instanceof SyntaxError) return true;
  if (error instanceof ZodError) return true;
  if (error instanceof Error) {
    return /json|parse/i.test(error.message);
  }
  return false;
};

const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const retryablePatterns = ['timeout', 'etimedout', 'econnreset', 'rate limit', '429', '503', '504'];
  return retryablePatterns.some(pattern => error.message.toLowerCase().includes(pattern));
};

const sanitizeSubticketSuggestions = (
  rawSubtickets: unknown,
): Array<{ title: string; description: string }> => {
  if (!Array.isArray(rawSubtickets)) return [];

  const normalized = rawSubtickets
    .map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const title =
        typeof record.title === 'string'
          ? record.title.trim()
          : typeof record.name === 'string'
            ? record.name.trim()
            : '';
      if (!title) return null;
      const rawDescription =
        typeof record.description === 'string' && record.description.trim()
          ? record.description.trim()
          : typeof record.details === 'string' && record.details.trim()
            ? record.details.trim()
          : undefined;
      const description = rawDescription ?? `Implement ${title}.`;
      return { title, description };
    })
    .filter((item): item is { title: string; description: string } => item !== null);

  return normalized.slice(0, MAX_SUBTICKET_SUGGESTIONS);
};

const normalizeCreateTicketNudge = (
  nudge: ProactiveNudgeOutputLenient['nudges'][number],
  fallbackText: string,
): ProactiveNudgeOutputLenient['nudges'][number] => {
  const title = (typeof nudge.title === 'string' && nudge.title.trim()) || fallbackText.slice(0, 120) || 'Create ticket';
  const description =
    (typeof nudge.description === 'string' && nudge.description.trim()) || fallbackText || 'No description provided.';
  const existingActions = Array.isArray(nudge.suggested_actions) ? nudge.suggested_actions : [];
  const createAction = existingActions.find(action => action?.action_type === 'CREATE_TICKET_FROM_MESSAGE');
  const payload =
    createAction && createAction.payload && typeof createAction.payload === 'object' && !Array.isArray(createAction.payload)
      ? (createAction.payload as Record<string, unknown>)
      : {};

  const subticketSuggestions = sanitizeSubticketSuggestions(payload.subticket_suggestions);

  return {
    ...nudge,
    title,
    description,
    suggested_actions: [
      {
        label:
          typeof createAction?.label === 'string' && createAction.label.trim()
            ? createAction.label
            : 'Review ticket draft',
        action_type: 'CREATE_TICKET_FROM_MESSAGE',
        payload: {
          ...payload,
          title_suggestion:
            typeof payload.title_suggestion === 'string' && payload.title_suggestion.trim()
              ? payload.title_suggestion
              : title,
          description_suggestion:
            typeof payload.description_suggestion === 'string' && payload.description_suggestion.trim()
              ? payload.description_suggestion
              : description,
          subticket_suggestions: subticketSuggestions,
        },
      },
    ] as ProactiveNudgeOutputLenient['nudges'][number]['suggested_actions'],
  };
};

class ProactiveNudgeWorker {
  private queue: Bull.Queue<ProactiveNudgeJobData> | null = null;
  private queuePromise: Promise<Bull.Queue<ProactiveNudgeJobData>> | null = null;
  private isProcessorRegistered = false;
  private isInitialized = false;

  private async getQueue(): Promise<Bull.Queue<ProactiveNudgeJobData>> {
    if (this.queue) return this.queue;
    if (this.queuePromise) return this.queuePromise;

    this.queuePromise = (async () => {
      const redisConfig = {...redisService.getRedisConfig(), lazyConnect: false};


      const queue = new Bull<ProactiveNudgeJobData>(PROACTIVE_NUDGE_QUEUE_NAME, {
        redis: redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
        settings: {
          stalledInterval: 30 * 1000,
          maxStalledCount: 1,
        },
      });

      this.queue = queue;
      return queue;
    })();

    try {
      return await this.queuePromise;
    } finally {
      this.queuePromise = null;
    }
  }

  async enqueue(data: ProactiveNudgeJobData): Promise<Bull.Job<ProactiveNudgeJobData>> {
    const queue = await this.getQueue();
    return queue.add(PROACTIVE_NUDGE_JOB_NAME, data, {
      jobId: `nudge-${data.messageId}`,
    });
  }

  async start(): Promise<void> {
    if (this.isInitialized) return;

    const queue = await this.getQueue();
    if (!this.isProcessorRegistered) {
      queue.process(PROACTIVE_NUDGE_JOB_NAME, 3, async (job) => {
        return this.processJob(job);
      });
      this.isProcessorRegistered = true;
    }

    this.isInitialized = true;
    logger.info('[ProactiveNudgeWorker] Started');
  }

  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.queuePromise = null;
    this.isProcessorRegistered = false;
    this.isInitialized = false;
  }

  private async fetchExistingProjectTags(projectId: string): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ name: string | null }>>`
      SELECT tt.name
      FROM "ticket_tags" tt
      INNER JOIN "tickets" t ON t.id = tt."ticketId"
      WHERE t."projectId" = ${projectId}
        AND tt.name IS NOT NULL
        AND char_length(trim(tt.name)) > 0
      GROUP BY tt.name
      ORDER BY COUNT(*) DESC, tt.name ASC
      LIMIT ${MAX_EXISTING_PROJECT_TAGS}
    `;

    const deduped = new Set<string>();
    for (const row of rows) {
      const tagName = typeof row.name === 'string' ? row.name.trim() : '';
      if (!tagName) continue;
      if (deduped.has(tagName)) continue;
      deduped.add(tagName);
    }

    return Array.from(deduped);
  }

  private async processJob(job: Bull.Job<ProactiveNudgeJobData>): Promise<void> {
    const { messageId, conversationId, channelId, projectId, senderId } = job.data;

    try {
      const input = await this.buildInput({
        messageId,
        conversationId,
        channelId,
        projectId,
        senderId,
      });

      const output = await generateNudges(input, {
        messageId,
        channelId,
        projectId,
      });

      const candidateNudges = (output.nudges ?? []).filter(nudge => nudge.type === 'CREATE_TICKET');
      const primaryCreateNudge = candidateNudges[0]
        ? normalizeCreateTicketNudge(candidateNudges[0], input.current_message.text)
        : null;
      const filteredOutput = {
        ...output,
        nudges: primaryCreateNudge ? [primaryCreateNudge] : [],
      };

      let resolvedOutput = filteredOutput;

      if (resolvedOutput.nudges.length > 0) {
        const duplicateCheckStartedAt = Date.now();
        const nudgeWorkItems = resolvedOutput.nudges.map((nudge, index) => {
          const fallbackTitle =
            (typeof nudge.title === 'string' && nudge.title.trim()) ||
            input.current_message.text.slice(0, 120) ||
            'Create a ticket';
          const fallbackDescription =
            (typeof nudge.description === 'string' && nudge.description.trim()) ||
            input.current_message.text ||
            'No description provided.';

          return {
            index,
            nudge,
            fallbackTitle,
            fallbackDescription,
          };
        });

        const duplicateCheckResults = await Promise.allSettled(
          nudgeWorkItems.map(({ fallbackTitle, fallbackDescription }) =>
            ticketDuplicateService.checkDuplicates({
              title: fallbackTitle,
              description: fallbackDescription,
              projectId,
              userId: senderId,
              limit: 10,
            }),
          ),
        );

        const survivingByIndex = new Map<number, typeof resolvedOutput.nudges[number]>();
        let convertedCount = 0;

        duplicateCheckResults.forEach((result, idx) => {
          const workItem = nudgeWorkItems[idx];
          if (!workItem) {
            return;
          }

          if (result.status === 'rejected') {
            logger.warn('[ProactiveNudgeWorker] Duplicate check failed, keeping nudge', {
              messageId,
              nudgeTitle: workItem.fallbackTitle,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
            survivingByIndex.set(workItem.index, workItem.nudge);
            return;
          }

          if (result.value.analysis.isDuplicate) {
            const duplicateTicketId = result.value.analysis.duplicateTicketId;
            if (!duplicateTicketId) {
              logger.warn('[ProactiveNudgeWorker] Duplicate detected without ticket id, keeping CREATE_TICKET', {
                messageId,
                nudgeTitle: workItem.fallbackTitle,
              });
              survivingByIndex.set(workItem.index, workItem.nudge);
              return;
            }

            const duplicateCandidate = result.value.candidates.find(
              candidate => candidate.id === duplicateTicketId,
            );

            convertedCount += 1;
            logger.info('[ProactiveNudgeWorker] Converting nudge to EXISTING_TICKET', {
              messageId,
              nudgeTitle: workItem.fallbackTitle,
              duplicateTicketId,
            });
            survivingByIndex.set(workItem.index, {
              ...workItem.nudge,
              type: 'EXISTING_TICKET',
              title: workItem.nudge.title || 'Existing ticket found',
              description:
                workItem.nudge.description || 'A similar ticket already exists. Open it instead of creating a duplicate.',
              suggested_actions: [
                {
                  label: 'Open ticket',
                  action_type: 'OPEN_TICKET',
                  payload: {
                    ticketId: duplicateTicketId,
                    ...(duplicateCandidate?.channelId ? { channelId: duplicateCandidate.channelId } : {}),
                    ...(duplicateCandidate?.boardId ? { boardId: duplicateCandidate.boardId } : {}),
                  },
                },
              ] as ProactiveNudgeOutputLenient['nudges'][number]['suggested_actions'],
            } as ProactiveNudgeOutputLenient['nudges'][number]);
            return;
          }

          survivingByIndex.set(workItem.index, workItem.nudge);
        });

        const survivingNudges = [...survivingByIndex.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, nudge]) => nudge);

        logger.info('[ProactiveNudgeWorker] Duplicate check batch completed', {
          messageId,
          candidateCount: nudgeWorkItems.length,
          convertedCount,
          survivingCount: survivingNudges.length,
          duplicateCheckDurationMs: Date.now() - duplicateCheckStartedAt,
        });

        resolvedOutput = { ...resolvedOutput, nudges: survivingNudges };
      }

      await proactiveNudgeService.persistForMessage(messageId, resolvedOutput);
    } catch (error) {
      const parseError = isParseError(error);
      if (parseError) {
        logger.warn('[ProactiveNudgeWorker] Parse error', {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      logger.error('[ProactiveNudgeWorker] Job failed', {
        messageId,
        retryable: isRetryableError(error),
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async buildInput(params: {
    messageId: string;
    conversationId: string;
    channelId: string;
    projectId: string;
    senderId: string;
  }): Promise<ProactiveNudgeInput> {
    const { messageId, conversationId, channelId, projectId } = params;

    const [message, channel, recentMessages, existingProjectTags] = await Promise.all([
      db.message.findUnique({
        where: { messageId },
        select: {
          messageId: true,
          content: true,
          senderId: true,
          createdAt: true,
          hasAttachment: true,
        },
      }),
      db.channel.findUnique({
        where: { id: channelId },
        select: { name: true },
      }),
      db.message.findMany({
        where: {
          conversationId,
          isDeleted: false,
          msgType: { in: [MessageType.USER, MessageType.BOT] },
          messageId: { not: messageId },
        },
        orderBy: { createdAt: 'desc' },
        take: THREAD_MESSAGE_LIMIT,
        select: {
          messageId: true,
          content: true,
          senderId: true,
          createdAt: true,
          hasAttachment: true,
        },
      }),
      this.fetchExistingProjectTags(projectId),
    ]);

    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    const senderIds = new Set<string>([
      message.senderId,
      ...recentMessages.map((msg) => msg.senderId),
    ]);

    const users = await db.user.findMany({
      where: { id: { in: Array.from(senderIds) } },
      select: { id: true, name: true },
    });

    const userMap = new Map(users.map((user) => [user.id, user.name ?? 'Unknown']));

    const currentMessageText = normalizeText(message.content ?? '', message.hasAttachment);
    const channelName = channel?.name ?? 'Unknown Channel';

    const input: ProactiveNudgeInput = {
      current_message: {
        id: message.messageId,
        text: currentMessageText,
        author_user_id: message.senderId,
        author_display_name: userMap.get(message.senderId) ?? 'Unknown',
        timestamp_iso: message.createdAt.toISOString(),
        channel_id: channelId,
        channel_name: channelName,
        thread_id: conversationId,
      },
      current_thread_messages: recentMessages
        .slice()
        .reverse()
        .map((threadMessage) => ({
          id: threadMessage.messageId,
          text: normalizeText(threadMessage.content ?? '', threadMessage.hasAttachment),
          author_user_id: threadMessage.senderId,
          author_display_name: userMap.get(threadMessage.senderId) ?? 'Unknown',
          timestamp_iso: threadMessage.createdAt.toISOString(),
        })),
      existing_project_tags: existingProjectTags,
    };

    return input;
  }
}

export const proactiveNudgeWorker = new ProactiveNudgeWorker();
