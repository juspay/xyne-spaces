import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  agentSlugFromWebhookUrl,
  listS2SClawAgents,
  type S2SClawAgent,
} from './clawAgentService';

export interface ChannelClawAgent {
  id: string;
  name: string;
  agentSlug: string;
  description: string | null;
}

export async function listClawAgentsInChannel(
  channelId: string,
  requesterUserId: string
): Promise<ChannelClawAgent[]> {
  const requester = await db.channelParticipant.findFirst({
    where: { channelId, userId: requesterUserId },
    select: { userId: true },
  });
  if (!requester) return [];

  const participants = await db.channelParticipant.findMany({
    where: { channelId },
    select: { userId: true },
  });
  const participantUserIds = new Set(participants.map((participant) => participant.userId));
  if (participantUserIds.size === 0) return [];

  let agents: S2SClawAgent[] = [];
  try {
    agents = await listS2SClawAgents();
  } catch {
    logger.warn('[ChannelClawAgentService] Falling back to legacy agent resolution');
  }

  const resolvedBySlug = new Map<
    string,
    { agentSlug: string; userId: string; description: string | null }
  >();
  const resolvedUserIds = new Set<string>();
  for (const agent of agents) {
    if (agent.spacesAppUserId && participantUserIds.has(agent.spacesAppUserId)) {
      resolvedBySlug.set(agent.slug, {
        agentSlug: agent.slug,
        userId: agent.spacesAppUserId,
        description: agent.description,
      });
      resolvedUserIds.add(agent.spacesAppUserId);
    }
  }

  const legacyCandidateIds = [...participantUserIds].filter((id) => id !== requesterUserId);
  const legacyApps = legacyCandidateIds.length
    ? await db.installedApps.findMany({
        where: { userId: { in: legacyCandidateIds }, webhookUrl: { contains: '/webhook/' } },
        select: { userId: true, webhookUrl: true },
      })
    : [];
  for (const app of legacyApps) {
    const agentSlug = agentSlugFromWebhookUrl(app.webhookUrl);
    if (!agentSlug || resolvedBySlug.has(agentSlug) || resolvedUserIds.has(app.userId)) continue;
    const registeredAgent = agents.find((agent) => agent.slug === agentSlug);
    resolvedBySlug.set(agentSlug, {
      agentSlug,
      userId: app.userId,
      description: registeredAgent?.description ?? null,
    });
    resolvedUserIds.add(app.userId);
  }

  const resolved = [...resolvedBySlug.values()];
  const users = await db.user.findMany({
    where: { id: { in: resolved.map(({ userId }) => userId) } },
    select: { id: true, name: true },
  });
  const usersById = new Map(users.map((user) => [user.id, user]));
  return resolved.flatMap(({ agentSlug, userId, description }) => {
    const user = usersById.get(userId);
    return user ? [{ id: user.id, name: user.name, agentSlug, description }] : [];
  });
}
