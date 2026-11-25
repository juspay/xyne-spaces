/**
 * Slack BlockKit → FlowJSON. The conversion lives in @xyne/shared (src/slack/flow.ts) so the
 * encryption extractor can run it on decrypted content; this looks the Slack ids up first.
 */
import { logger } from '@/utils/logger';
import {
  buildFlowFromBlockKit,
  collectAllSlackGroupIds,
  collectAllSlackUserIds,
  parseBlockKitInput,
  type BlockKitInput,
  type FlowDefinition,
  type SlackIdMaps,
} from '@xyne/shared';
import { resolveSlackIds } from './slackUserResolver';

export type { BlockKitInput } from '@xyne/shared';
export {
  mrkdwnToFlowComponent,
  slackAttachmentToFlowComponent,
  slackBlockElementToFlowComponent,
  slackBlockToFlowComponent,
} from '@xyne/shared';

/**
 * The Xyne ids of the Slack users and groups a BlockKit payload mentions (`<@U…>` in mrkdwn,
 * `user_id` in rich_text): the database first (metadata.slackId), then the Slack API by email.
 * Ids that resolve to nothing are left out.
 */
export async function resolveBlockKitIdMaps(
  input: { userIds: string[]; groupIds: string[] },
  botToken?: string,
  workspaceId?: string,
): Promise<SlackIdMaps> {
  const maps: SlackIdMaps = { users: {}, groups: {} };
  if (!botToken) return maps;
  if (input.userIds.length > 0) {
    const resolved = await resolveSlackIds(input.userIds, botToken, 'user', workspaceId);
    for (const [slackId, entry] of resolved ?? []) if (entry.dbId) maps.users[slackId] = entry.dbId;
  }
  if (input.groupIds.length > 0) {
    const resolved = await resolveSlackIds(input.groupIds, botToken, 'group', workspaceId);
    for (const [slackId, entry] of resolved ?? []) if (entry.dbId) maps.groups[slackId] = entry.dbId;
  }
  return maps;
}

/**
 * Convert a BlockKit message to a FlowDefinition (v2): the ids looked up here, the conversion
 * by @xyne/shared's buildFlowFromBlockKit. Null when there is nothing structured.
 *
 * @param botToken    Bot token for Slack API calls to resolve user mentions not yet stored in
 *                    the Xyne DB by slackId metadata. Without it, mentions keep their Slack ids.
 * @param workspaceId Xyne workspace ID used when looking up users by email.
 */
export async function convertBlockKitToFlowJSON(
  input: BlockKitInput,
  botToken?: string,
  workspaceId?: string,
): Promise<FlowDefinition | null> {
  if (!botToken) {
    logger.warn('No bot token provided, skipping Slack user ID resolution. User mentions may not render correctly.');
  }
  const parsed = parseBlockKitInput(input);
  if (!parsed) return null;
  const blockKitInput = { text: parsed.plainText ?? input.text, blocks: parsed.blocks, attachments: parsed.attachments };
  const idMaps = await resolveBlockKitIdMaps(
    { userIds: collectAllSlackUserIds(blockKitInput), groupIds: collectAllSlackGroupIds(blockKitInput) },
    botToken,
    workspaceId,
  );
  return buildFlowFromBlockKit(input, idMaps, crypto.randomUUID());
}
