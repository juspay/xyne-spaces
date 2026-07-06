import type {
  SlackAttachment,
  SlackBlock,
  SlackBlockKitMessage,
} from './slackBlockKitTypes';
import { resolveSlackMentions } from './slackUserResolver';

// ============================================================================
// Slack message resolution
// ============================================================================

export type SlackResolvableMessageParts = Pick<SlackBlockKitMessage, 'text' | 'blocks' | 'attachments'>;

export async function resolveSlackMessageParts(
  message: SlackResolvableMessageParts,
  botToken?: string,
  workspaceId?: string,
): Promise<SlackResolvableMessageParts> {
  const resolved: SlackResolvableMessageParts = {};

  if (message.text) {
    resolved.text = await resolveSlackMentions(message.text, botToken, false, workspaceId);
  }

  if (message.blocks?.length) {
    const resolvedBlocksJson = await resolveSlackMentions(JSON.stringify(message.blocks), botToken, true, workspaceId);
    resolved.blocks = JSON.parse(resolvedBlocksJson) as SlackBlock[];
  }

  if (message.attachments?.length) {
    const resolvedAttachmentsJson = await resolveSlackMentions(JSON.stringify(message.attachments), botToken, true, workspaceId);
    resolved.attachments = JSON.parse(resolvedAttachmentsJson) as SlackAttachment[];
  }

  return resolved;
}

export async function resolveSlackText(text: string, botToken?: string, workspaceId?: string): Promise<string> {
  return resolveSlackMentions(text, botToken, false, workspaceId);
}

// ============================================================================
// mrkdwn block parser
// ============================================================================

export interface ParsedListItem {
  text: string;
  num?: number;
}

export interface MrkdwnBlockHandlers<T> {
  onRegular: (lines: string[]) => T;
  onQuote: (lines: string[]) => T;
  onList: (type: 'ul' | 'ol', items: ParsedListItem[]) => T;
  onCode: (lines: string[]) => T;
}

/**
 * Shared line-by-line parser for Slack mrkdwn block-level syntax.
 * Handles code fences, blockquotes, bullet lists, ordered lists, and regular text.
 * Consecutive lines of the same block type are accumulated and flushed as a unit.
 * Calls the appropriate handler on each flush and collects the results.
 */
export function parseMrkdwnBlocks<T>(content: string, handlers: MrkdwnBlockHandlers<T>): T[] {
  const results: T[] = [];
  let quoteLines: string[] = [];
  let regularLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: ParsedListItem[] = [];
  let codeLines: string[] | null = null;

  const flushRegular = () => {
    if (!regularLines.length) return;
    results.push(handlers.onRegular(regularLines));
    regularLines = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    results.push(handlers.onQuote(quoteLines));
    quoteLines = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) return;
    results.push(handlers.onList(listType, listItems));
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    if (codeLines === null) return;
    results.push(handlers.onCode(codeLines));
    codeLines = null;
  };

  const pushListItem = (type: 'ul' | 'ol', item: ParsedListItem) => {
    flushRegular();
    flushQuote();
    if (listType && listType !== type) flushList();
    listType = type;
    listItems.push(item);
  };

  for (const line of content.split('\n')) {
    // ---- Inside a code block: look for a closing ``` anywhere on the line ----
    // Slack has no info-string / language concept: ``` simply toggles code, and
    // any text on the same line as the fence is part of the message. A closing
    // fence may therefore be glued to the end of the last code line
    // (e.g. `MIGRATION_SHEET_ID=...```), so we scan for it mid-line rather than
    // only at the start.
    if (codeLines !== null) {
      const closeIdx = line.indexOf('```');
      if (closeIdx === -1) {
        codeLines.push(line);
        continue;
      }
      const before = line.slice(0, closeIdx);
      if (before.length) codeLines.push(before);
      flushCode();
      const after = line.slice(closeIdx + 3);
      if (after.trim().length) regularLines.push(after);
      continue;
    }

    // ---- Not in a code block: an opening ``` may appear anywhere on the line ----
    const openIdx = line.indexOf('```');
    if (openIdx !== -1) {
      // Text before the opening fence is regular content.
      const before = line.slice(0, openIdx);
      if (before.trim().length) regularLines.push(before);
      flushRegular();
      flushQuote();
      flushList();

      const rest = line.slice(openIdx + 3);
      const closeInRest = rest.indexOf('```');
      if (closeInRest !== -1) {
        // Single-line fence: ```content``` — opening and closing on the same line.
        results.push(handlers.onCode([rest.slice(0, closeInRest)]));
        const after = rest.slice(closeInRest + 3);
        if (after.trim().length) regularLines.push(after);
      } else {
        // Opening fence with the remainder of the line as the first code line.
        // This is the content Slack shows but a CommonMark info-string drops.
        codeLines = [];
        if (rest.length) codeLines.push(rest);
      }
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);

    if (quoteMatch) {
      flushRegular();
      flushList();
      quoteLines.push(quoteMatch[1]);
    } else if (bulletMatch) {
      pushListItem('ul', { text: bulletMatch[1] });
    } else if (orderedMatch) {
      pushListItem('ol', { text: orderedMatch[2], num: parseInt(orderedMatch[1], 10) });
    } else {
      flushQuote();
      flushList();
      regularLines.push(line);
    }
  }

  flushCode();
  flushRegular();
  flushQuote();
  flushList();

  return results;
}
