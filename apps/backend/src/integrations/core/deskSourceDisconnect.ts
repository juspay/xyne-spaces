import { UserStatus, WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { listDeskManagerUserIds } from '@/utils/channelMembership';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from './types';

const TAG = '[DeskSourceDisconnect]';

/**
 * Log message Grafana alerts match on; keep it stable. One error line per desk account the
 * system disconnects, with the fields needed to say which account and desk.
 */
export const DESK_ACCOUNT_DISCONNECTED = 'desk_account_disconnected';

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

  const platform = PLATFORM_LABELS[source.sourceType];
  const desk = source.channelId
    ? await db.channel.findUnique({ where: { id: source.channelId }, select: { name: true } })
    : null;
  const deskName = desk?.name;

  // Logged before anything that can fail, so the alert never depends on the notification.
  logger.error(DESK_ACCOUNT_DISCONNECTED, {
    sourceId: source.id,
    sourceType: source.sourceType,
    platform,
    accountName: source.displayName,
    workspaceId: source.workspaceId,
    channelId: source.channelId,
    deskName,
  });

  let recipientUserIds: string[];
  if (source.channelId) {
    recipientUserIds = await listDeskManagerUserIds(source.channelId);
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

  await notifyDeskSourcesDisconnected([sourceId]);
  return true;
}
