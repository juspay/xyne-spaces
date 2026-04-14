/**
 * Ask AI Bot
 *
 * Responds to DM conversations, channel @mentions, and thread replies.
 * Receives plain-text questions (HTML stripped by messages-handler before dispatch).
 * Streams from xyne-ai and outputs JSON with an HTML `summary` field — stored and
 * rendered as HTML by RenderMessageWithHTML, not markdown.
 * User mention placeholders (<Full Name>) in summary are resolved to interactive
 * mention spans by injectMentionSpans() before storage.
 */

import { z } from 'zod';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';
import { xyneAIStream } from '@/agents/xyne-ai/index.js';
import { AgentsConfig } from '@/agents/config.js';
import { logger } from '@/utils/logger.js';
import { db } from '@/database/client.js';
import { PROMPT_NAMES } from '@/agents/xyne-ai/langfuse/index.js';

const inputSchema = z.object({ message: z.string().describe('User question or request') });
const outputSchema = z.object({ response: z.string() });
type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Replace #channel-name text with TipTap channel mention spans.
 * Looks up each channel name in the DB to get the ID and visibility.
 * Only replaces matches found in text content (skips inside HTML tags).
 */
async function injectChannelMentionSpans(html: string): Promise<string> {
  const names = new Set<string>();
  const pattern = /#([\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const offset = m.index;
    const before = html.slice(0, offset);
    if (before.lastIndexOf('<') > before.lastIndexOf('>')) continue; // inside a tag
    names.add(m[1].toLowerCase());
  }
  if (names.size === 0) return html;

  const channels = await db.channel.findMany({
    where: { name: { in: [...names], mode: 'insensitive' } },
    select: { id: true, name: true, visibility: true },
  });
  const channelMap = new Map(channels.map(c => [c.name.toLowerCase(), c]));

  return html.replace(/#([\w-]+)/g, (match, name, offset) => {
    const before = html.slice(0, offset);
    if (before.lastIndexOf('<') > before.lastIndexOf('>')) return match;
    const ch = channelMap.get(name.toLowerCase());
    if (!ch) return match;
    const isPrivate = ch.visibility === 'PRIVATE';
    return `<span data-channel-mention="" data-channel-id="${ch.id}" data-channel-name="${ch.name}" data-is-private="${isPrivate}" class="chat-input-channel-mention" contenteditable="false" role="button" aria-label="Mention channel ${ch.name}" tabindex="-1">#${ch.name}</span>`;
  });
}

/**
 * Replace @channel / @here plain text with TipTap special mention spans.
 * Only called when the AI explicitly includes these in its output.
 */
function injectSpecialMentionSpans(html: string): string {
  return html
    .replace(/@channel\b/gi, '<span class="chat-input-special-mention" data-mention-type="channel" contenteditable="false">@channel</span>')
    .replace(/@here\b/gi, '<span class="chat-input-special-mention" data-mention-type="here" contenteditable="false">@here</span>');
}

/**
 * Extract a usable summary string from potentially malformed or double-encoded JSON output.
 * Tries multiple extraction strategies: direct parse, double-encoded JSON, JSON block extraction.
 */
function extractSummaryFromOutput(rawOutput: unknown): string {
  // If already a string, try to parse as JSON first
  const rawString = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
  
  // Try direct JSON parse
  try {
    const direct = JSON.parse(rawString);
    if (typeof direct === 'string') {
      // Double-encoded: the response is a JSON string wrapping actual content
      try {
        const inner = JSON.parse(direct);
        return typeof inner.summary === 'string' ? inner.summary : direct;
      } catch {
        return direct;
      }
    } else if (typeof direct === 'object' && direct !== null) {
      return typeof direct.summary === 'string' ? direct.summary : rawString;
    }
  } catch {
    // JSON.parse failed — try to find a {...} block and extract summary
    try {
      const jsonBlock = rawString.match(/\{[\s\S]*?\}/);
      if (jsonBlock) {
        const extracted = JSON.parse(jsonBlock[0]) as Record<string, unknown>;
        if (typeof extracted.summary === 'string') {
          return extracted.summary;
        }
      }
    } catch {
      // All extraction attempts failed
    }
  }
  
  // Final fallback: return as-is if string, or stringify
  return typeof rawOutput === 'string' ? rawOutput : rawString;
}

/**
 * Replace <Full Name> tags produced by the AI with proper Xyne mention spans.
 * Tags are resolved to DB user IDs by stream.ts before this runs.
 * The resulting HTML is stored directly as message content and rendered by RenderMessageWithHTML.
 */
function injectMentionSpans(
  html: string,
  userTags: Record<string, { name: string; userId: string }>
): string {
  let result = html;
  for (const [tag, { name, userId }] of Object.entries(userTags)) {
    const span = userId
      ? `<span class="chat-input-mention" data-mention="" data-mention-type="user" data-user-id="${userId}" data-username="${name}" contenteditable="false" role="button" aria-label="Mention ${name}" tabindex="-1">@${name}</span>`
      : `@${name}`;
    result = result.split(tag).join(span);
  }
  return result;
}

@Bot({
  id: 'ask-ai',
  name: 'Ask AI',
  email: 'ask-ai@bot.xyne.ai',
  description: 'AI assistant that searches messages, tickets, and answers questions',
  inputSchema,
  outputSchema,
  scope: 'all',
  interactionMode: 'dm',
  picture: '/bot-avatars/ask-ai.png',
  useQueue: false,
})
export class AskAIBot extends UnifiedBaseBot<Input, Output> {
  protected readonly definition: InternalBotDefinition<Input, Output> = {
    id: 'ask-ai',
    name: 'Ask AI',
    email: 'ask-ai@bot.xyne.ai',
    description: 'AI assistant that searches messages, tickets, and answers questions',
    runtimeType: 'internal',
    inputSchema,
    outputSchema,
    scope: 'all',
  };

  protected async *executeInternal(
    input: Input,
    context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    const { message } = input;
    const { channelId, conversationId, userId, userEmail, userName, sessionId } = context;

    try {
      const userName_ = userName || 'Unknown User';
      const userEmail_ = userEmail || `user-${userId}@xyne.ai`;

      const [attachmentIds, agentsConfig] = await Promise.all([
        conversationId
          ? db.messageAttachment
              .findMany({ where: { conversationId }, select: { id: true }, orderBy: { createdAt: 'asc' } })
              .then(rows => rows.map(r => r.id))
          : Promise.resolve([]),
        userEmail
          ? AgentsConfig.fetch({ email: userEmail })
          : Promise.resolve(AgentsConfig.defaults()),
      ]);

      const stream = xyneAIStream({
        query: message,
        userId,
        sessionId: sessionId || conversationId,
        channelIds: [channelId],
        conversationId,
        webSearchEnabled: true,
        createCanvasEnabled: false,
        researchContext: undefined,
        messageAttachmentIds: attachmentIds,
        agentPromptName: PROMPT_NAMES.XYNE_AI_CHAT_SYSTEM,
        userInfo: { userId, userName: userName_, userEmail: userEmail_ },
        agentsConfig,
        memoryEnabled: false,  // Bot context: disable get_memories/update_memory tools
      });

      let response = '';

      for await (const chunk of stream) {
        if (context.abortSignal?.aborted) {
          yield this.createErrorEvent('<p>Request cancelled.</p>', { channelId });
          return;
        }

        if (chunk.type === 'tool_output' && chunk.output) {
          // Tool outputs carry Genius chart/table data — cast through unknown to satisfy ToolOutput
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          yield this.createToolOutputEvent(chunk.output as unknown as any, {
            toolName: chunk.toolName,
            channelId,
          });
          continue;
        }

        if (chunk.type === 'complete' && chunk.output?.summary) {
          const tags = chunk.output.userTags as Record<string, { name: string; userId: string }> | undefined;
          // Apply JSON fallback extraction to handle malformed or double-encoded JSON
          const extractedSummary = extractSummaryFromOutput(chunk.output.summary);
          const withUserMentions = tags && Object.keys(tags).length > 0
            ? injectMentionSpans(extractedSummary, tags)
            : extractedSummary;
          const withSpecialMentions = injectSpecialMentionSpans(withUserMentions);
          response = await injectChannelMentionSpans(withSpecialMentions);
          yield this.createContentEvent(response, { channelId });
          continue;
        }

        if (chunk.type === 'error') {
          throw new Error(chunk.error || 'Unknown error from xyne-ai stream');
        }
      }

      yield this.createDoneEvent({
        fullContent: response,
        channelId,
        sessionId: sessionId || conversationId,
      });

    } catch (error) {
      logger.error('[AskAIBot] Execution failed', {
        conversationId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      yield this.createErrorEvent(
        '<p>Sorry, something went wrong. Please try rephrasing your question.</p>',
        { channelId }
      );
    }
  }

}