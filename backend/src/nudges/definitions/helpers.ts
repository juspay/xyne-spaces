import { MessageType } from '@prisma/client';
import type { SurfaceAreaType } from '@prisma/client';
import { db } from '@/database/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { extractUrls } from '@/utils/urlUtils';
import { ENTITY_URL_PATTERNS, HASH_ENTITY_PATTERNS } from '../entityUrlPatterns';
import type {
  MessageNudgePayload,
  MessageNudgeEvaluationContext,
  ActivityContextOutput,
  NudgeBuildContextRuntime,
} from '../types';

const DEFAULT_MAX_PROJECT_TAGS = 40;
const THREAD_MESSAGE_LIMIT = 15;

export function normalizeText(content: string, hasAttachment: boolean): string {
  const text = extractPlainTextFromHtml(content).trim();
  if (!text && hasAttachment) return 'Sent an attachment';
  return text;
}

export async function fetchExistingProjectTags(
  projectId: string,
  limit: number = DEFAULT_MAX_PROJECT_TAGS,
): Promise<string[]> {
  const tickets = await db.ticket.findMany({
    where: { projectId },
    select: { id: true },
  });

  if (tickets.length === 0) return [];

  const groups = await db.ticketTag.groupBy({
    by: ['name'],
    where: {
      ticketId: { in: tickets.map((t) => t.id) },
      name: { not: '' },
    },
    _count: { name: true },
    orderBy: [{ _count: { name: 'desc' } }, { name: 'asc' }],
    take: limit,
  });

  return groups
    .map((g) => g.name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Checks whether a message is eligible for nudge evaluation.
 * Used as a lookback handler gate for message-triggered definitions.
 *
 * Accepts either a full MessageNudgePayload-like object or raw IDs
 * extracted from an activity event's contextMetadata.
 */
export async function isEligibleMessage(params: {
  messageId: string;
  channelId: string;
  conversationId: string;
}): Promise<boolean> {
  const { messageId, channelId, conversationId } = params;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { projectId: true, scopeType: true },
  });

  if (!channel?.projectId) return false;
  if (channel.scopeType === 'DM' || channel.scopeType === 'GROUP_DM') return false;

  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { initialMessageId: true },
  });

  if (!conversation || conversation.initialMessageId !== messageId) return false;

  const message = await db.message.findUnique({
    where: { messageId },
    select: { msgType: true, content: true, hasAttachment: true },
  });

  if (!message) return false;
  if (message.msgType === MessageType.SYSTEM || message.msgType === MessageType.BOT) return false;

  const text = extractPlainTextFromHtml(message.content || '').trim();
  if (!text && !message.hasAttachment) return false;

  return true;
}

/**
 * Shared buildContext implementation for all message-triggered nudge definitions.
 * Fetches recent thread messages and project tags, then assembles the evaluation context.
 */
export async function buildMessageNudgeContext(
  payload: MessageNudgePayload,
  activityContext: ActivityContextOutput,
  runtime: NudgeBuildContextRuntime,
): Promise<MessageNudgeEvaluationContext> {
  const [recentMessages, existingProjectTags] = await Promise.all([
    db.message.findMany({
      where: {
        conversationId: payload.conversationId,
        isDeleted: false,
        msgType: { in: [MessageType.USER, MessageType.BOT] },
        messageId: { not: payload.messageId },
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
    fetchExistingProjectTags(payload.projectId),
  ]);

  const threadMessages = recentMessages
    .slice()
    .reverse()
    .map((msg) => ({
      messageId: msg.messageId,
      content: normalizeText(msg.content ?? '', msg.hasAttachment),
      senderId: msg.senderId,
      createdAt: msg.createdAt,
    }));

  return {
    triggerEvent: runtime.event,
    enrichedActivity: runtime.enrichedActivity,
    source: {
      sourceId: runtime.messagePayload?.messageId ?? payload.messageId,
      projectId: payload.projectId,
      sourceType: 'MESSAGE',
    },
    threadMessages,
    projectTags: existingProjectTags,
    activityContext,
    message: payload,
  };
}

// --- URL parsing helpers for implicit nudge definitions ---

export interface ParsedEntityReference {
  targetType: SurfaceAreaType;
  targetId: string;
}

/**
 * Extracts all Xyne entity references from URLs found in HTML content.
 *
 * URL extraction: reuses extractUrls() from @/utils/urlUtils (HTML-aware,
 * handles bare domains, TLD validation, deduplication).
 *
 * Entity matching: uses the shared ENTITY_URL_PATTERNS (path-segment matching)
 * and HASH_ENTITY_PATTERNS (hash-fragment matching) from entityUrlPatterns.ts
 * — the same patterns used by activityContextResolver.
 *
 * Returns deduplicated list of (targetType, targetId) pairs.
 */
export function parseXyneUrlsFromContent(htmlContent: string): ParsedEntityReference[] {
  const urls = extractUrls(htmlContent);
  if (urls.length === 0) return [];

  const results: ParsedEntityReference[] = [];
  const seen = new Set<string>();

  for (const rawUrl of urls) {
    let pathname: string;
    let hash: string;
    try {
      // extractUrls may return bare domains; prepend protocol for URL parsing
      const normalized = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
      const url = new URL(normalized);
      pathname = url.pathname;
      hash = url.hash;
    } catch {
      continue;
    }

    // Match path-segment patterns (ticket, canvas, etc.)
    for (const { pattern, surfaceType, idGroup } of ENTITY_URL_PATTERNS) {
      const match = pathname.match(pattern);
      if (!match?.[idGroup]) continue;

      // Only create links for entity types that are valid SurfaceAreaType targets
      if (surfaceType !== 'TICKET' && surfaceType !== 'CANVAS' && surfaceType !== 'MESSAGE') continue;

      const targetId = match[idGroup];
      const key = `${surfaceType}:${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ targetType: surfaceType as SurfaceAreaType, targetId });
    }

    // Match hash-fragment patterns (e.g. #messageId=...)
    if (hash) {
      for (const { pattern, surfaceType, idGroup } of HASH_ENTITY_PATTERNS) {
        if (surfaceType !== 'TICKET' && surfaceType !== 'CANVAS' && surfaceType !== 'MESSAGE') continue;

        const match = hash.match(pattern);
        if (!match?.[idGroup]) continue;

        const targetId = match[idGroup];
        const key = `${surfaceType}:${targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ targetType: surfaceType as SurfaceAreaType, targetId });
      }
    }
  }

  return results;
}
