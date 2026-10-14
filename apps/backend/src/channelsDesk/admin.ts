// Linking a Channels desk to an installed app (one active desk per install, set up by an app admin or the
// app's creator), and choosing which of the app's channels feed it.
import { Prisma } from '@prisma/client';
import { AccessType, ChannelScopeType, ChannelType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { channelsDeskAppOf, channelsDeskChannelSourceName, channelsDeskOf, channelsDeskSourceName } from './desk';

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

/**
 * Adds one of the app's channels to the desk. 'not-eligible' if it can't go on a desk (the app isn't in it,
 * or it's a DM, an archived channel or a desk); 'other-desk' if another desk has it.
 */
export async function addChannelsDeskChannel(
  desk: { id: string; workspaceId: string },
  channelId: string,
): Promise<'added' | 'not-eligible' | 'other-desk'> {
  const { added, available } = await listChannelsDeskChannels(desk.id);
  if (added.some((channel) => channel.id === channelId)) return 'added';
  const channel = available.find((candidate) => candidate.id === channelId);
  const name = channelsDeskChannelSourceName(channelId);
  if (!channel) {
    const onADesk = await db.externalSource.findFirst({ where: { name, isActive: true }, select: { id: true } });
    return onADesk ? 'other-desk' : 'not-eligible';
  }
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'other-desk';
    throw err;
  }
  return 'added';
}

/** Stops a channel feeding the desk; its existing tickets stay. False if it wasn't on this desk. */
export async function removeChannelsDeskChannel(deskId: string, channelId: string): Promise<boolean> {
  const removed = await db.externalSource.updateMany({
    where: { name: channelsDeskChannelSourceName(channelId), channelId: deskId, isActive: true },
    data: { isActive: false },
  });
  return removed.count > 0;
}

/**
 * For the app API: puts one of the app's channels on its app's Channels desk, or takes it off. The admin
 * who linked the desk to the app already chose that its channels may feed it.
 */
export async function setAppChannelOnDesk(
  app: { installedAppId: string; workspaceId: string },
  channelId: string,
  onDesk: boolean,
): Promise<'done' | 'no-desk' | 'not-eligible' | 'other-desk'> {
  const deskId = await channelsDeskOf(app.installedAppId);
  if (!deskId) return 'no-desk';
  if (!onDesk) {
    await removeChannelsDeskChannel(deskId, channelId);
    return 'done';
  }
  const result = await addChannelsDeskChannel({ id: deskId, workspaceId: app.workspaceId }, channelId);
  return result === 'added' ? 'done' : result;
}
