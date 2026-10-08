import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { formatUserMention } from '@/bots/implementations/qa-alert-bot/alert-formatting';
import { postBotMessageToChannel } from '@/bypassAcl/automationServices';
import { db } from '@/database/client';

/**
 * Posts an alert in a channel as the Automations bot, tagging the given users on a line above it.
 * `content` is HTML and must already be escaped. Returns false without posting when no channel
 * is given or the channel is not in `workspaceId`, so a fixed channel id from config can never
 * receive another workspace's alert.
 */
export async function postAlertToChannel(params: {
  channelId: string | null | undefined;
  workspaceId: string;
  content: string;
  mentionUserIds?: string[];
}): Promise<boolean> {
  const { channelId, workspaceId, content, mentionUserIds = [] } = params;
  if (!channelId) return false;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { workspaceId: true },
  });
  if (channel?.workspaceId !== workspaceId) return false;

  const users = mentionUserIds.length
    ? await db.user.findMany({
        where: { id: { in: mentionUserIds }, workspaceId },
        select: { id: true, name: true, email: true, picture: true },
      })
    : [];
  const mentions = users
    .map((user) => formatUserMention(user.id, user.name, { email: user.email, picture: user.picture }))
    .join(' ');

  const botUserId = await getAutomationsBotUserId(workspaceId);
  await postBotMessageToChannel(
    botUserId,
    channelId,
    workspaceId,
    mentions ? `${mentions}<br/><br/>${content}` : content,
  );
  return true;
}
