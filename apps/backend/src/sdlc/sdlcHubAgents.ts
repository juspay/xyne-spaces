import type { PrismaClient } from '@prisma/client';
import { ChannelRole } from '@xyne/shared';
import { SDLC_AGENT_PENDING_RELATION } from '@xyne/shared/sdlc';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { AppError } from '@/middleware/errorHandler';
import { listS2SClawAgents } from '@/services/clawAgentService';
import { ensureLink } from './entityLinkService';
import type { SdlcActor } from './types';

const participants = new ChannelParticipantRepository();

/** An agent got its Spaces bot user: add it to every hub it is pending in and drop those links. */
export async function promoteRegisteredAgent(
  db: PrismaClient,
  agentId: string,
  botUserId: string
): Promise<number> {
  const links = await db.sdlcEntityLink.findMany({
    where: { relationType: SDLC_AGENT_PENDING_RELATION, targetType: 'AGENT', targetId: agentId },
    select: { channelId: true },
  });
  // Add before delete, no transaction: addParticipant is idempotent, so a crash in between just retries.
  for (const { channelId } of links) {
    await participants.addParticipant(channelId, botUserId, ChannelRole.MEMBER);
    await db.sdlcEntityLink.deleteMany({
      where: { channelId, relationType: SDLC_AGENT_PENDING_RELATION, targetId: agentId },
    });
  }
  return links.length;
}

/**
 * Slugs of the hub's agents: its channel's bot members, plus agents created here that
 * are still waiting for approval. A pending agent that got registered joins the channel on this read.
 */
export async function listHubAgents(
  db: PrismaClient,
  actor: SdlcActor,
  channelId: string
): Promise<{ memberSlugs: string[]; pendingSlugs: string[] }> {
  // Any channel the actor is in, or a public SDLC hub; agents are channel members either way.
  const channel = await db.channel.findFirst({
    where: {
      id: channelId,
      workspaceId: actor.workspaceId,
      OR: [
        { type: 'SDLC', visibility: 'PUBLIC' },
        { participants: { some: { userId: actor.userId } } },
      ],
    },
    select: { id: true },
  });
  if (!channel) throw new AppError('Channel not found', 404);
  const pendingLinks = await db.sdlcEntityLink.findMany({
    where: { channelId, relationType: SDLC_AGENT_PENDING_RELATION, targetType: 'AGENT' },
    select: { targetId: true },
  });

  // With the viewer, the list includes their personal agents; pending ones usually are.
  const agents = await listS2SClawAgents(actor.userId);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const stillPending: string[] = [];
  for (const { targetId: agentId } of pendingLinks) {
    const botUserId = byId.get(agentId)?.spacesAppUserId;
    if (!botUserId) {
      stillPending.push(agentId);
      continue;
    }
    // Fallback for a missed registration notice; claw-auth normally promotes on install.
    await promoteRegisteredAgent(db, agentId, botUserId);
  }

  // Not listClawAgentsInChannel: it returns nothing to a viewer outside a public hub.
  const botUserIds = agents.flatMap((agent) => agent.spacesAppUserId ?? []);
  const botIds = new Set(
    (
      await db.channelParticipant.findMany({
        where: { channelId, userId: { in: botUserIds } },
        select: { userId: true },
      })
    ).map((participant) => participant.userId)
  );
  return {
    memberSlugs: agents.flatMap((agent) =>
      agent.spacesAppUserId && botIds.has(agent.spacesAppUserId) ? [agent.slug] : []
    ),
    pendingSlugs: stillPending.flatMap((id) => byId.get(id)?.slug ?? []),
  };
}

export async function markHubAgentPending(
  db: PrismaClient,
  actor: SdlcActor,
  channelId: string,
  agentId: string
): Promise<void> {
  const member = await db.channelParticipant.findFirst({
    where: {
      channelId,
      userId: actor.userId,
      channel: { workspaceId: actor.workspaceId, type: 'SDLC' },
    },
    select: { id: true },
  });
  if (!member) throw new AppError('SDLC hub membership is required', 403);
  // Only the creator's own unregistered agent; anything else would skip the normal add-bot flow.
  const agent = (await listS2SClawAgents(actor.userId)).find(
    (candidate) => candidate.id === agentId
  );
  if (!agent || agent.ownerUserId !== actor.userId || agent.spacesAppUserId) {
    throw new AppError('Only your own agent awaiting approval can be linked to a hub', 403);
  }
  await ensureLink(
    db,
    {
      channelId,
      sourceType: 'CHANNEL',
      sourceId: channelId,
      targetType: 'AGENT',
      targetId: agentId,
      relationType: SDLC_AGENT_PENDING_RELATION,
    },
    actor
  );
}
