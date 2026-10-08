import { UserStatus, WorkspaceRole } from '@xyne/shared';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { postAlertToChannel } from '@/services/channelAlertService';
import { notificationService } from '@/services/notificationService';
import { listDeskManagerUserIds } from '@/utils/channelMembership';
import { escapeHtml } from '@/utils/htmlEscape';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from './types';

const TAG = '[DeskSourceDisconnect]';

const PLATFORM_LABELS: Record<string, string> = {
  [ExternalSourcePlatform.GOOGLE]: 'Gmail',
  'google-channel-email': 'Gmail',
  [ExternalSourcePlatform.MICROSOFT]: 'Outlook',
  'microsoft-channel-email': 'Outlook',
  [ExternalSourcePlatform.FACEBOOK]: 'Facebook Page',
  [ExternalSourcePlatform.INSTAGRAM]: 'Instagram',
  [ExternalSourcePlatform.ZOHO]: 'Zoho Mail',
  [ExternalSourcePlatform.GOOGLE_PLAY]: 'Google Play',
  [ExternalSourcePlatform.APP_STORE]: 'App Store',
  [ExternalSourcePlatform.SLACK_DESK]: 'Slack',
};

// One-off DL member backfill sources are temporary and never shown as a connected account.
const isTemporarySource = (name: string): boolean =>
  name.startsWith('google-dl-sync--') || name.startsWith('microsoft-dl-sync--');

/** Opens the desk (or the support home for the shared mailbox) with the integrations modal. */
const reconnectPath = (workspaceId: string, channelId: string | null): string =>
  `/${encodeURIComponent(workspaceId)}/support${channelId ? `/${encodeURIComponent(channelId)}` : ''}?deskIntegrations=open`;

/** The alerts-channel message asking someone to reconnect the account. */
function reconnectAlertContent(source: {
  reconnectPath: string;
  accountName?: string | null;
  platform?: string;
  deskName?: string;
}): string {
  const link = `${(config.frontendUrl ?? '').replace(/\/$/, '')}${source.reconnectPath}`;

  const lines = ['⚠️ <strong>Desk account disconnected</strong>', ''];
  if (source.accountName) lines.push(`<strong>Account:</strong> ${escapeHtml(source.accountName)}`);
  if (source.platform) lines.push(`<strong>Type:</strong> ${escapeHtml(source.platform)}`);
  if (source.deskName) lines.push(`<strong>Desk:</strong> ${escapeHtml(source.deskName)}`);
  lines.push(
    '',
    'New messages from this account will not reach the desk until it is reconnected.',
    `👉 <a href="${escapeHtml(link)}">Reconnect in desk settings</a>`,
  );
  return lines.join('<br/>');
}

async function notifyOne(sourceId: string): Promise<void> {
  const source = await db.externalSource.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      name: true,
      displayName: true,
      sourceType: true,
      workspaceId: true,
      channelId: true,
      ownerUserId: true,
    },
  });
  if (!source || isTemporarySource(source.name)) return;
  // User-bound sources with no desk (calendar watches) are not desk accounts.
  if (!source.channelId && source.ownerUserId) return;

  let recipientUserIds: string[];
  let deskName: string | undefined;
  if (source.channelId) {
    const [managers, channel] = await Promise.all([
      listDeskManagerUserIds(source.channelId),
      db.channel.findUnique({ where: { id: source.channelId }, select: { name: true } }),
    ]);
    recipientUserIds = managers;
    deskName = channel?.name;
  } else {
    const admins = await db.user.findMany({
      where: {
        workspaceId: source.workspaceId,
        role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });
    recipientUserIds = admins.map((user) => user.id);
  }

  const platform = PLATFORM_LABELS[source.sourceType];
  const accountLabel = source.displayName
    ? `${source.displayName}${platform ? ` (${platform})` : ''}`
    : (platform ?? 'A connected account');

  await notificationService.sendDeskAccountDisconnectedNotification({
    sourceId: source.id,
    accountLabel,
    workspaceId: source.workspaceId,
    recipientUserIds,
    actionUrl: reconnectPath(source.workspaceId, source.channelId),
    ...(deskName && { deskName }),
    ...(source.channelId && { channelId: source.channelId }),
  });

  try {
    await postAlertToChannel({
      channelId: config.deskAlertChannelId,
      workspaceId: source.workspaceId,
      mentionUserIds: [...new Set([...recipientUserIds, ...config.deskAlertMentionUserIds])],
      content: reconnectAlertContent({
        reconnectPath: reconnectPath(source.workspaceId, source.channelId),
        accountName: source.displayName,
        ...(platform && { platform }),
        ...(deskName && { deskName }),
      }),
    });
  } catch (error) {
    logger.error(`${TAG} Failed to post disconnect alert to channel`, { sourceId, error });
  }
}

/** For sources the caller has already marked disconnected. Never throws. */
export async function notifyDeskSourcesDisconnected(sourceIds: string[]): Promise<void> {
  for (const sourceId of sourceIds) {
    try {
      await notifyOne(sourceId);
    } catch (error) {
      logger.error(`${TAG} Failed to notify about disconnected source`, { sourceId, error });
    }
  }
}

/**
 * Marks a source disconnected because the provider no longer accepts its credentials, and
 * notifies whoever can reconnect it. Returns false when it was already disconnected, so repeat
 * detections of the same dead token notify once.
 */
export async function disconnectDeskSourceBySystem(
  sourceId: string,
  { clearCredentials }: { clearCredentials: boolean },
): Promise<boolean> {
  const { count } = await db.externalSource.updateMany({
    where: { id: sourceId, isActive: true },
    data: { isActive: false, ...(clearCredentials && { credentials: '' }) },
  });
  if (count === 0) return false;

  logger.warn(`${TAG} Source marked disconnected`, { sourceId });
  await notifyDeskSourcesDisconnected([sourceId]);
  return true;
}
