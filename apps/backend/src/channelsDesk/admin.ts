// Linking a Channels desk to an installed app (one active desk per install, set up by an app admin or the
// app's creator), and choosing which of the app's channels feed it.
import { Prisma } from '@prisma/client';
import { AccessType, ChannelScopeType, ChannelType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { channelsDeskAppOf, channelsDeskChannelSourceName, channelsDeskSourceName } from './desk';

/** Whether the user may manage Xyne Apps (ADMIN on XYNE-APPS). */
export async function canManageApps(userId: string): Promise<boolean> {
  const resource = await db.resource.findUnique({ where: { name: 'XYNE-APPS' }, select: { id: true } });
  return !!resource && (await repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN));
}

/** The installed app's name and creator, if it is installed in this workspace. */
export async function findInstalledApp(
  workspaceId: string,
  installedAppId: string,
): Promise<{ name: string; createdBy: string } | null> {
  const install = await db.installedApps.findFirst({
    where: { id: installedAppId, user: { workspaceId } },
    select: { app: { select: { name: true, createdBy: true } } },
  });
  return install ? { name: install.app.name, createdBy: install.app.createdBy } : null;
}

/** Links the app to the desk. The link's unique name keeps an app on one desk, should two be created at once. */
export async function linkChannelsDesk(args: {
  workspaceId: string;
  installedAppId: string;
  appName: string;
  deskChannelId: string;
  linkedBy: string;
}): Promise<void> {
  await db.externalSource.create({
    data: {
      name: channelsDeskSourceName(args.installedAppId),
      sourceType: ExternalSourcePlatform.APP_CHANNELS_DESK,
      displayName: args.appName,
      channelId: args.deskChannelId,
      externalIdentifier: args.installedAppId,
      workspaceId: args.workspaceId,
      credentials: '', // A Channels desk link holds no secrets; the column is required.
    },
  });
  logger.info('[channels-desk] Linked', { installedAppId: args.installedAppId, deskChannelId: args.deskChannelId, by: args.linkedBy });
}

export interface ChannelsDeskChannel {
  id: string;
  name: string;
}

/**
 * The desk's channels, and the channels its app is in that are on no desk yet (regular channels only,
 * never a desk or a DM). A channel stays on the desk until it is removed, even if the app leaves it.
 * Read under the caller's own access, so private channels they aren't in are never listed.
 */
export async function listChannelsDeskChannels(deskId: string): Promise<{ added: ChannelsDeskChannel[]; available: ChannelsDeskChannel[] }> {
  const app = await channelsDeskAppOf(deskId);
  const install = app && (await db.installedApps.findUnique({ where: { id: app.id }, select: { userId: true } }));
  if (!install) return { added: [], available: [] };
  const [deskLinks, appChannels] = await Promise.all([
    db.externalSource.findMany({
      where: { channelId: deskId, sourceType: ExternalSourcePlatform.APP_CHANNELS_DESK_CHANNEL, isActive: true },
      select: { externalIdentifier: true },
    }),
    db.channel.findMany({
      where: {
        participants: { some: { userId: install.userId } },
        type: ChannelType.DEFAULT,
        scopeType: ChannelScopeType.DEFAULT,
        isArchived: false,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const [added, taken] = await Promise.all([
    db.channel.findMany({
      where: { id: { in: deskLinks.flatMap((link) => link.externalIdentifier ?? []) } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.externalSource.findMany({
      where: { name: { in: appChannels.map((channel) => channelsDeskChannelSourceName(channel.id)) }, isActive: true },
      select: { externalIdentifier: true },
    }),
  ]);
  const onADesk = new Set(taken.map((link) => link.externalIdentifier));
  return { added, available: appChannels.filter((channel) => !onADesk.has(channel.id)) };
}

/** Adds one of the app's channels to the desk. False if it isn't available (app not in it, or on another desk). */
export async function addChannelsDeskChannel(desk: { id: string; workspaceId: string }, channelId: string): Promise<boolean> {
  const { added, available } = await listChannelsDeskChannels(desk.id);
  if (added.some((channel) => channel.id === channelId)) return true;
  const channel = available.find((candidate) => candidate.id === channelId);
  if (!channel) return false;
  const name = channelsDeskChannelSourceName(channelId);
  try {
    // A removed channel leaves an inactive row; adding it again repoints that row.
    const repointed = await db.externalSource.updateMany({
      where: { name, isActive: false },
      data: { channelId: desk.id, isActive: true, displayName: channel.name },
    });
    if (repointed.count === 0) {
      await db.externalSource.create({
        data: {
          name,
          sourceType: ExternalSourcePlatform.APP_CHANNELS_DESK_CHANNEL,
          displayName: channel.name,
          channelId: desk.id,
          externalIdentifier: channelId,
          workspaceId: desk.workspaceId,
          credentials: '', // A Channels desk link holds no secrets; the column is required.
        },
      });
    }
  } catch (err) {
    // Another desk added it at the same moment.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
  return true;
}

/** Stops a channel feeding the desk; its existing tickets stay. False if it wasn't on this desk. */
export async function removeChannelsDeskChannel(deskId: string, channelId: string): Promise<boolean> {
  const removed = await db.externalSource.updateMany({
    where: { name: channelsDeskChannelSourceName(channelId), channelId: deskId, isActive: true },
    data: { isActive: false },
  });
  return removed.count > 0;
}
