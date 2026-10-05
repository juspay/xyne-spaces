// Linking a HUB desk to an installed app (one active desk per install, set up by an app admin or the
// app's creator), and choosing which of the app's channels feed it.
import { Prisma } from '@prisma/client';
import { AccessType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { hubAppOf, hubChannelSourceName, hubSourceName } from './hub';

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
export async function linkHubDesk(args: {
  workspaceId: string;
  installedAppId: string;
  appName: string;
  deskChannelId: string;
  linkedBy: string;
}): Promise<void> {
  await db.externalSource.create({
    data: {
      name: hubSourceName(args.installedAppId),
      sourceType: ExternalSourcePlatform.APP_HUB,
      displayName: args.appName,
      channelId: args.deskChannelId,
      externalIdentifier: args.installedAppId,
      workspaceId: args.workspaceId,
      credentials: '', // A HUB link holds no secrets; the column is required.
    },
  });
  logger.info('[hub-desk] Linked', { installedAppId: args.installedAppId, deskChannelId: args.deskChannelId, by: args.linkedBy });
}

export interface HubChannel {
  id: string;
  name: string;
}

/**
 * The desk's app's channels the caller can see: the ones on this desk, and the ones on no desk yet.
 * Read under the caller's own access, so private channels they aren't in are never listed.
 */
export async function listHubChannels(deskId: string): Promise<{ added: HubChannel[]; available: HubChannel[] }> {
  const app = await hubAppOf(deskId);
  const install = app && (await db.installedApps.findUnique({ where: { id: app.id }, select: { userId: true } }));
  if (!install) return { added: [], available: [] };
  const channels = await db.channel.findMany({
    where: { createdBy: install.userId, isArchived: false },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const links = await db.externalSource.findMany({
    where: { name: { in: channels.map((channel) => hubChannelSourceName(channel.id)) }, isActive: true },
    select: { channelId: true, externalIdentifier: true },
  });
  const deskOf = new Map(links.map((link) => [link.externalIdentifier, link.channelId]));
  return {
    added: channels.filter((channel) => deskOf.get(channel.id) === deskId),
    available: channels.filter((channel) => !deskOf.has(channel.id)),
  };
}

/** Adds one of the app's channels to the desk. False if it isn't available (not the app's, or on another desk). */
export async function addHubChannel(desk: { id: string; workspaceId: string }, channelId: string): Promise<boolean> {
  const { added, available } = await listHubChannels(desk.id);
  if (added.some((channel) => channel.id === channelId)) return true;
  const channel = available.find((candidate) => candidate.id === channelId);
  if (!channel) return false;
  const name = hubChannelSourceName(channelId);
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
          sourceType: ExternalSourcePlatform.APP_HUB_CHANNEL,
          displayName: channel.name,
          channelId: desk.id,
          externalIdentifier: channelId,
          workspaceId: desk.workspaceId,
          credentials: '', // A HUB link holds no secrets; the column is required.
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
export async function removeHubChannel(deskId: string, channelId: string): Promise<boolean> {
  const removed = await db.externalSource.updateMany({
    where: { name: hubChannelSourceName(channelId), channelId: deskId, isActive: true },
    data: { isActive: false },
  });
  return removed.count > 0;
}
