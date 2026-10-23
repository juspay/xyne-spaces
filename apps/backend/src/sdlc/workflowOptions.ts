import type { Prisma } from '@prisma/client';
import type { FieldOptionsPage } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import type { XyneCtx } from '@/workflowsV2/types';
import { repoIdsForChannel } from './sdlcChannelMembership';

// Same reach as requireSdlcHubReader: a picker must not offer a hub the editor could not open.
function readableHubs(caller: XyneCtx): Prisma.ChannelWhereInput {
  return {
    workspaceId: caller.workspaceId,
    type: 'SDLC',
    OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId: caller.userId } } }],
  };
}

interface Lookup {
  search?: string | undefined;
  values?: readonly string[] | undefined;
}

export async function hubOptions(caller: XyneCtx, { search, values }: Lookup): Promise<FieldOptionsPage> {
  const hubs = await db.channel.findMany({
    where: {
      ...readableHubs(caller),
      ...(values ? { id: { in: [...values] } } : {}),
      ...(!values && search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { name: 'asc' },
    take: 50,
    select: { id: true, name: true },
  });
  return { items: hubs.map((hub) => ({ value: hub.id, label: hub.name })) };
}

export async function repositoryOptions(
  caller: XyneCtx,
  channelId: unknown,
  { search, values }: Lookup,
): Promise<FieldOptionsPage> {
  if (typeof channelId !== 'string' || !channelId) return { items: [], notice: 'Choose a hub first' };
  const hub = await db.channel.findFirst({ where: { id: channelId, ...readableHubs(caller) }, select: { id: true } });
  if (!hub) return { items: [], notice: 'This hub is not available to you' };
  const repoIds = await repoIdsForChannel(db, channelId);
  const repositories = await db.repo.findMany({
    where: {
      id: { in: values ? repoIds.filter((id) => values.includes(id)) : repoIds },
      ...(!values && search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return { items: repositories.map((repository) => ({ value: repository.id, label: repository.name })) };
}
