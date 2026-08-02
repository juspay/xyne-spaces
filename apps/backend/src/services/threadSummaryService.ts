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

// Shared across the whole app (dedupes LLM calls across users/replicas) and
// survives backend restarts, unlike a plain in-process Map. Entries expire
// on their own via SUMMARY_CACHE_TTL_SECONDS, so there's no manual eviction
// to maintain.
const SUMMARY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function summaryCacheKey(conversationId: string): string {
  return `thread-summary:${conversationId}`;
}

/**
 * Rollout gate — THREAD_SUMMARY_ENABLED_CHANNELS env var, same pattern as
 * Pulse's per-channel allowlist. Checked at every entry point (pre-warm on
 * add, keep-warm on message, and both HTTP endpoints) rather than relying on
 * the pending-recommendation flag alone to indirectly suppress it, so a
 * manual button click on a disabled channel can't bypass it either.
 *
 * The literal value "all" (case-insensitive) turns it on for every channel,
 * so a full rollout doesn't require enumerating every channel ID.
 */
export function isThreadSummaryEnabledForChannel(channelId: string | null | undefined): boolean {
  const { enabledChannels } = config.threadSummary;
  if (enabledChannels.some((c) => c.toLowerCase() === 'all')) return true;
  return !!channelId && enabledChannels.includes(channelId);
}

/** Read-only — whatever's currently cached, or undefined. Never triggers generation. */
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

/** Lazily constructed — undefined until first use, null if no API key is configured. */
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
  /** True if this was served from the existing cached summary — no LLM call was made. */
  cached: boolean;
  /**
   * The messageId this content was actually generated from. Lets the client
   * tell a genuinely up-to-date summary apart from a stale one served as a
   * fallback (LLM failure / no client configured) — the client compares this
   * against the latest message it has and only then treats it as current.
   */
  asOfMessageId: string;
}

// Tagging a brand-new participant in a message fires TWO independent side
// effects off the same underlying insert — the new ConversationParticipant
// row (pre-warms the cache) and the message itself (keepThreadSummaryWarm,
// which by then sees the recommendation flag already set and also
// generates). Both call getOrGenerateThreadSummary for the same
// conversationId within the same instant, and without this, both would
// independently miss the not-yet-written cache and make their own LLM call.
// Keyed by conversationId + min-message behavior so a concurrent second (or
// third) caller on the same path just awaits the same in-flight generation
// instead of duplicating it.
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

/**
 * Get the thread's summary, generating (or regenerating) it only if there are
 * messages newer than the last time it was summarized. Shared by both the
 * "recommend on add" side effect, the on-demand header button, and the
 * "keep it warm on new messages" hook, so there's a single cache per
 * conversation regardless of who/what triggers it.
 *
 * Cached in Redis, NOT as a Message row — the summary isn't shared/visible
 * chat content, it's a dedupe cache the frontend also mirrors per-user in
 * localStorage for instant redisplay. Redis (over a plain in-process cache)
 * means this survives backend restarts and stays consistent across replicas
 * in a multi-instance deployment.
 *
 * Deliberately a single direct LLM call, not routed through the xyne-claw
 * agent pipeline — a one-shot summarization doesn't need session/tool
 * overhead, and this needs to be fast enough for a user to wait on a click.
 */
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

  // Fetch the LATEST N messages (desc), then reverse to chronological order
  // for the prompt — not the oldest N. For threads over the limit, taking
  // from the oldest end would summarize ancient history while the cache
  // still claims to be current as of the actual latest message, silently
  // dropping everything recent (exactly what the recency-weighting
  // instruction above depends on actually being in the transcript).
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

  // Message content is HTML (rich-text composer output), not plain text —
  // feeding raw markup into the prompt wastes tokens and risks the model
  // trying to "summarize" tags instead of the actual conversation.
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

  // Escalating token budgets across retries: glm-latest is a reasoning model
  // that can spend its whole budget on a hidden chain-of-thought before writing
  // anything (finishReason 'length' → empty or mid-word-truncated content, e.g.
  // "**Juned"). `enable_thinking:false` is meant to disable that but the gateway
  // doesn't always honour it, so a second attempt with ~2x room usually lands a
  // COMPLETE summary. A truncated result is accepted only as a last resort.
  const budgets = [baseMaxTokens, Math.min(maxSummaryMaxTokens * 2, baseMaxTokens * 2)];

  let summaryText: string | null = null;
  for (let attempt = 0; attempt < budgets.length && !summaryText; attempt++) {
    const maxTokens = budgets[attempt]!;
    try {
      // The timeout side of Promise.race is never implicitly cancelled when
      // client.generate() wins the race — without clearing it explicitly, its
      // setTimeout keeps the process alive and fires anyway (harmlessly, since
      // the race already settled) up to the configured timeout after every single
      // successful call. Not just theoretical: under real summary traffic this
      // is a dangling timer per request.
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

/**
 * Called by conversationController's getSummary once every user who was
 * flagged for a thread's recommendation has seen it (checked right after
 * that request already read/returned this cache's content, so there's no
 * race to worry about) — at that point nobody's left waiting on this cache,
 * so there's no reason to keep it around or keep paying to regenerate it as
 * new messages land. A later on-demand button click just computes a fresh
 * one from scratch.
 */
export async function deleteCachedSummary(conversationId: string): Promise<void> {
  try {
    await redisService.del(summaryCacheKey(conversationId));
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis delete failed', { error });
  }
}

/**
 * Tracks which users still need to see the "you were just added" catch-up
 * summary for a thread — ONE Redis set per conversation (SADD/SREM/SCARD),
 * not one flag key per user. A user's id is added the instant they're
 * genuinely added by someone else (the real ConversationParticipant insert
 * side effect — not inferred from lastReadAt/joinedAt timestamps, see the
 * git history for why that broke down), and removed the moment they've seen
 * it. Once the set empties out, getRecommendation tears deleteCachedSummary
 * down too — see there.
 *
 * Uses real Redis SET operations (not a hand-rolled JSON array in a string
 * key) specifically so add/remove is atomic — two users being consumed at
 * nearly the same moment can't clobber each other's removal the way a
 * naive read-modify-write on a JSON blob could.
 */
const PENDING_USERS_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function pendingUsersKey(conversationId: string): string {
  return `thread-pending-users:${conversationId}`;
}

/** Called once by the real-time participant-insert event when someone else adds/mentions this user into a conversation they weren't part of. */
export async function flagThreadRecommendation(conversationId: string, userId: string): Promise<void> {
  try {
    const key = pendingUsersKey(conversationId);
    await redisService.sadd(key, userId);
    await redisService.expire(key, PENDING_USERS_TTL_SECONDS);
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis write failed, recommendation flag not set', { error });
  }
}

/**
 * Check + consume in one step — atomically removes userId from the pending
 * set if present (so it's only ever surfaced once).
 */
export async function consumeThreadRecommendation(conversationId: string, userId: string): Promise<boolean> {
  try {
    const removedCount = await redisService.srem(pendingUsersKey(conversationId), userId);
    return removedCount > 0;
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis read/write failed, assuming no pending recommendation', { error });
    return false;
  }
}

/**
 * Whether anyone is still waiting to see this thread's recommendation — used
 * both by the "keep it warm on new messages" hook (stop regenerating once
 * the pending audience is gone) and by getRecommendation (tear the cache
 * down once nobody's left pending, checked after it's already served its
 * result).
 */
export async function hasPendingRecommendations(conversationId: string): Promise<boolean> {
  try {
    return (await redisService.scard(pendingUsersKey(conversationId))) > 0;
  } catch (error) {
    logger.warn('[ThreadSummaryService] Redis read failed, assuming no pending recommendations', { error });
    return false;
  }
}
