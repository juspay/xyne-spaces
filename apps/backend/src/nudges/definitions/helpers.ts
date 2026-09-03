import { z } from 'zod';
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
} from '@juspay-jaf/jaf';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { OrgLLMServiceAccountPurpose, MessageType, SurfaceAreaType, ChannelScopeType } from '@xyne/shared';
import { parseAgentOutput } from '@/services/agents/utils';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { extractUrls } from '@/utils/urlUtils';
import { ENTITY_URL_PATTERNS, HASH_ENTITY_PATTERNS } from '../entityUrlPatterns';
import type {
  MessageNudgePayload,
  MessageNudgeEvaluationContext,
  ActivityContextOutput,
  NudgeBuildContextRuntime,
} from '../types';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';

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
    select: { scopeType: true },
  });

  if (!channel) return false;
  if (channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM) return false;

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
      sourceType: SurfaceAreaType.MESSAGE,
    },
    threadMessages,
    projectTags: existingProjectTags,
    activityContext,
    message: payload,
  };
}

// --- LLM agent runner with retry-on-malformed-JSON ---

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MODEL = 'glm-flash-experimental';

export interface RunNudgeAgentOptions {
  /** Display name for the agent (used in logs and registry). */
  agentName: string;
  /** System prompt for the agent. */
  systemPrompt: string;
  /** User input payload — will be JSON-stringified. */
  input: Record<string, unknown>;
  /** Zod schema to validate the LLM output. */
  schema: z.ZodSchema;
  /** Model override (default: glm-flash-experimental). */
  model?: string;
  /** Max retry attempts after the initial call (default: 2). */
  maxRetries?: number;
  /** Temperature for generation (default: 0.1). */
  temperature?: number;
  /** Project whose organization owns the LiteLLM service-account credential. */
  projectId: string;
}

function extractLastAssistantMessage(finalState: RunState<unknown>): string | null {
  for (let i = finalState.messages.length - 1; i >= 0; i--) {
    const msg = finalState.messages[i];
    if (msg && typeof msg === 'object' && 'role' in msg && msg.role === 'assistant') {
      const content = 'content' in msg ? msg.content : undefined;
      if (typeof content === 'string') return content;
    }
  }
  return null;
}

/**
 * Runs a JAF agent with automatic retry on malformed JSON output.
 *
 * On parse failure the malformed assistant response is appended to the
 * conversation and a correction prompt is sent, giving the LLM a chance
 * to fix its output without losing context.
 */
export async function runNudgeAgent<T>(opts: RunNudgeAgentOptions): Promise<T> {
  const {
    agentName,
    systemPrompt,
    input,
    schema,
    model = DEFAULT_MODEL,
    maxRetries = DEFAULT_MAX_RETRIES,
    temperature = 0.1,
    projectId,
  } = opts;

  const credential = await orgLLMCredentialService.getCredentialByProjectId(
    projectId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }
  const provider = makeLiteLLMProvider(credential.baseUrl, credential.apiKey);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: JSON.stringify(input, null, 2) },
  ];

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const agent: Agent<Record<string, never>, T> = {
      name: agentName,
      instructions: () => systemPrompt,
      modelConfig: { temperature },
    };

    const initialState: RunState<Record<string, never>> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [...messages],
      currentAgentName: agentName,
      context: {},
      turnCount: 0,
    };

    const runConfig: RunConfig<Record<string, never>> = {
      agentRegistry: new Map([[agentName, agent]]),
      modelProvider: provider as RunConfig<Record<string, never>>['modelProvider'],
      maxTurns: 2,
      modelOverride: model,
    };

    try {
      const result = await run(initialState, runConfig);
      const rawOutput = extractLastAssistantMessage(result.finalState);

      if (result.outcome.status === 'completed') {
        try {
          const output = result.outcome.output;
          if (typeof output === 'string') {
            return parseAgentOutput(output, schema);
          }
          return schema.parse(output);
        } catch (parseError) {
          lastError = parseError instanceof Error ? parseError : new Error(String(parseError));

          logger.warn(`[${agentName}] Parse failed, retrying with correction`, {
            attempt: attempt + 1,
            maxRetries,
            error: lastError.message,
          });

          if (attempt < maxRetries && rawOutput) {
            messages.push({ role: 'assistant', content: rawOutput });
            messages.push({
              role: 'user',
              content: `Your previous response was not valid JSON. Error: ${lastError.message}. Please respond with ONLY a valid JSON object matching the required schema. No markdown, no commentary, no code fences.`,
            });
          }
          continue;
        }
      }

      if (result.outcome.status === 'error') {
        lastError = new Error(`${agentName} failed: ${result.outcome.error._tag}`);

        if (attempt < maxRetries && rawOutput) {
          messages.push({ role: 'assistant', content: rawOutput });
          messages.push({
            role: 'user',
            content: `Your previous response caused an error. Please respond with ONLY a valid JSON object matching the required schema. No markdown, no commentary, no code fences.`,
          });
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn(`[${agentName}] Run failed`, {
        attempt: attempt + 1,
        maxRetries,
        error: lastError.message,
      });
    }
  }

  throw lastError ?? new Error(`${agentName} failed after retries.`);
}

// --- Channel ID resolution ---

/**
 * Resolves the channelId for a message by looking up its conversation.
 * Returns empty string if resolution fails.
 */
export async function resolveChannelIdForMessage(messageId: string): Promise<string> {
  try {
    const msg = await db.message.findUnique({
      where: { messageId },
      select: { conversation: { select: { channelId: true } } },
    });
    return msg?.conversation?.channelId ?? '';
  } catch {
    logger.warn('[resolveChannelIdForMessage] Failed to resolve channelId', { messageId });
    return '';
  }
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
