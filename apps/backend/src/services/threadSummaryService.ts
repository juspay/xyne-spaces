import { db } from '@/database/client';
import { config } from '@/config/env';
import { MessageType } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';

function computeSummaryMaxTokens(transcriptLength: number): number {
  const { minSummaryMaxTokens, maxSummaryMaxTokens, transcriptCharsPerMaxToken } = config.threadSummary;
  const scaled = Math.ceil(transcriptLength / transcriptCharsPerMaxToken);
  return Math.min(maxSummaryMaxTokens, Math.max(minSummaryMaxTokens, scaled));
}

export interface CachedSummaryEntry {
  content: string;
  asOfMessageId: string;
}

const SUMMARY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function summaryCacheKey(conversationId: string): string {
  return `thread-summary:${conversationId}`;
}

export function isThreadSummaryEnabledForChannel(channelId: string | null | undefined): boolean {
  const { enabledChannels } = config.threadSummary;
  if (enabledChannels.some((c) => c.toLowerCase() === 'all')) return true;
  return !!channelId && enabledChannels.includes(channelId);
}

export async function getCachedSummary(conversationId: string): Promise<CachedSummaryEntry | undefined> {
  try {
    const raw = await redisService.get(summaryCacheKey(conversationId));
    if (!raw) return undefined;
    return JSON.parse(raw) as CachedSummaryEntry;
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis read failed, treating as cache miss', { error });
    return undefined;
  }
}

async function setCachedSummary(conversationId: string, entry: CachedSummaryEntry): Promise<void> {
  try {
    await redisService.set(summaryCacheKey(conversationId), JSON.stringify(entry), SUMMARY_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis write failed, summary generated but not cached', { error });
  }
}

let llmClient: LLMClient | null | undefined;

function getLlmClient(): LLMClient | null {
  if (llmClient === undefined) {
    const apiKey = config.llm.litellmApiKey;
    llmClient = apiKey
      ? new LLMClient({
          provider: {
            type: 'litellm',
            config: { apiKey, baseUrl: config.llm.litellmBaseUrl, timeout: 60000 },
          },
          defaultModel: config.workflow.defaultModelName,
        })
      : null;
  }
  return llmClient;
}

export interface ThreadSummaryResult {
  content: string;
  cached: boolean;
  asOfMessageId: string;
}

const inFlightGenerations = new Map<string, Promise<ThreadSummaryResult | null>>();

async function hasEnoughMessagesForRecommendation(conversationId: string): Promise<boolean> {
  const messageCount = await db.message.count({
    where: { conversationId, isDeleted: false, msgType: { not: MessageType.SYSTEM } },
  });
  return messageCount > config.threadSummary.minMessages;
}

export async function canRecommendThreadSummary(conversationId: string): Promise<boolean> {
  return hasEnoughMessagesForRecommendation(conversationId);
}

export function getOrGenerateThreadSummary(
  conversationId: string,
  options: { enforceMinMessages?: boolean } = {},
): Promise<ThreadSummaryResult | null> {
  const enforceMinMessages = options.enforceMinMessages ?? true;
  const inFlightKey = `${conversationId}:${enforceMinMessages ? 'min-gated' : 'manual'}`;
  const inFlight = inFlightGenerations.get(inFlightKey);
  if (inFlight) return inFlight;

  const promise = generateThreadSummary(conversationId, { enforceMinMessages }).finally(() => {
    inFlightGenerations.delete(inFlightKey);
  });
  inFlightGenerations.set(inFlightKey, promise);
  return promise;
}

async function generateThreadSummary(
  conversationId: string,
  options: { enforceMinMessages: boolean },
): Promise<ThreadSummaryResult | null> {
  if (options.enforceMinMessages && !(await hasEnoughMessagesForRecommendation(conversationId))) {
    return null;
  }

  const latestMessage = await db.message.findFirst({
    where: { conversationId, isDeleted: false, msgType: { not: MessageType.SYSTEM } },
    orderBy: { createdAt: 'desc' },
    select: { messageId: true },
  });
  if (!latestMessage) {
    return null;
  }

  const existingSummary = await getCachedSummary(conversationId);

  if (existingSummary && existingSummary.asOfMessageId === latestMessage.messageId) {
    return { content: existingSummary.content, cached: true, asOfMessageId: latestMessage.messageId };
  }

  const client = getLlmClient();
  if (!client) {
    logger.warn('[ThreadSummaryService] No LLM client configured, skipping thread summary');
    return existingSummary
      ? { content: existingSummary.content, cached: true, asOfMessageId: existingSummary.asOfMessageId }
      : null;
  }

  const messages = (
    await db.message.findMany({
      where: { conversationId, isDeleted: false, msgType: { not: MessageType.SYSTEM } },
      orderBy: { createdAt: 'desc' },
      take: config.threadSummary.messageLimit,
    })
  ).reverse();

  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const senders = await db.user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, name: true },
  });
  const senderNameById = new Map(senders.map((u) => [u.id, u.name || 'Unknown']));

  const transcript = messages
    .map((m) => `${senderNameById.get(m.senderId) ?? 'Unknown'}: ${extractPlainTextFromHtml(m.content)}`)
    .join('\n');

  const prompt =
    'Summarize this chat thread for someone who has not read it.\n\n' +
    'Output a markdown "- " list. Nothing else. No intro line, no heading, no closing line.\n\n' +
    'HARD LIMITS:\n' +
    '- Maximum 4 points. Most threads need 2-3.\n' +
    '- Maximum 10 words per point.\n' +
    '- Maximum 40 words total.\n\n' +
    'Each point states an outcome or a decision. Never explain why.\n' +
    'Each point must be intelligible on its own. Name the system or feature it ' +
    'refers to. Never assume the reader saw the previous point.\n\n' +
    'Cut all of the following:\n' +
    '- causes and root causes (no "because", "due to", "caused by", "traced to")\n' +
    '- subordinate clauses (no "which", "that", "after", "while")\n' +
    '- who did the work, unless someone is tagged and still owes a task\n' +
    '- adjectives and adverbs\n' +
    '- status verbs that carry no information' +
    'Focus on the newest messages. Drop resolved topics the thread has moved past.\n\n' +
    'No "you". No "the team". State the fact.\n\n' +
    'Bold only person names and system or service names, using **double asterisks**. ' +
    'Nothing else gets bolded.\n\n' +
    `Thread:\n${transcript}`;

  const baseMaxTokens = computeSummaryMaxTokens(transcript.length);
  const { llmTimeoutMs, maxSummaryMaxTokens } = config.threadSummary;

  const budgets = [baseMaxTokens, Math.min(maxSummaryMaxTokens * 2, baseMaxTokens * 2)];

  let summaryText: string | null = null;
  for (let attempt = 0; attempt < budgets.length && !summaryText; attempt++) {
    const maxTokens = budgets[attempt]!;
    try {
      let timeoutHandle: NodeJS.Timeout;
      const response = await Promise.race([
        client.generate({
          model: config.workflow.defaultModelName,
          messages: [createUserMessage(prompt)],
          parameters: { maxTokens },
          extraBody: { chat_template_kwargs: { enable_thinking: false } },
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`LLM call timed out after ${llmTimeoutMs}ms`)), llmTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timeoutHandle));

      const content = response.content?.trim() || null;
      const truncated = response.finishReason === 'length';
      const isLastAttempt = attempt === budgets.length - 1;
      if (content && !truncated) {
        summaryText = content; // clean, complete summary
      } else if (content && isLastAttempt) {
        summaryText = content; // truncated, but it's our last shot — better than nothing
        logger.warn('[ThreadSummaryService] using truncated summary after retries', { finishReason: response.finishReason });
      } else {
        logger.warn('[ThreadSummaryService] summary attempt unusable, will retry if budget left', {
          attempt,
          finishReason: response.finishReason,
          hadContent: !!content,
        });
      }
    } catch (error) {
      logger.warn('[ThreadSummaryService] LLM call failed for thread summary', { attempt, error });
    }
  }

  if (!summaryText) {
    return existingSummary
      ? { content: existingSummary.content, cached: true, asOfMessageId: existingSummary.asOfMessageId }
      : null;
  }

  await setCachedSummary(conversationId, { content: summaryText, asOfMessageId: latestMessage.messageId });

  logger.info(`[ThreadSummaryService] Generated thread summary for conversation ${conversationId}`);
  return { content: summaryText, cached: false, asOfMessageId: latestMessage.messageId };
}

export async function deleteCachedSummary(conversationId: string): Promise<void> {
  try {
    await redisService.del(summaryCacheKey(conversationId));
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis delete failed', { error });
  }
}

const PENDING_USERS_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function pendingUsersKey(conversationId: string): string {
  return `thread-pending-users:${conversationId}`;
}

export async function flagThreadRecommendation(conversationId: string, userId: string): Promise<void> {
  try {
    const key = pendingUsersKey(conversationId);
    await redisService.sadd(key, userId);
    await redisService.expire(key, PENDING_USERS_TTL_SECONDS);
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis write failed, recommendation flag not set', { error });
  }
}

export async function consumeThreadRecommendation(conversationId: string, userId: string): Promise<boolean> {
  try {
    const removedCount = await redisService.srem(pendingUsersKey(conversationId), userId);
    return removedCount > 0;
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis read/write failed, assuming no pending recommendation', { error });
    return false;
  }
}

export async function hasPendingRecommendations(conversationId: string): Promise<boolean> {
  try {
    return (await redisService.scard(pendingUsersKey(conversationId))) > 0;
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis read failed, assuming no pending recommendations', { error });
    return false;
  }
}
