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
// mrkdwn block parser: in @xyne/shared (src/slack/mrkdwn.ts)
// ============================================================================

export { parseMrkdwnBlocks, encodeAnglesInsideLinkUrls } from '@xyne/shared';
export type { ParsedListItem, MrkdwnBlockHandlers } from '@xyne/shared';
