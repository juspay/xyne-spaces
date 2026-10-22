import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { listS2SClawAgents, type S2SClawAgent } from '@/services/clawAgentService';
import type { AgentCard } from './types';

/**
 * claw-auth's agent list, cached briefly: it is read on every episode that passes the
 * gate, and agent settings change rarely. A failed fetch keeps the last good list.
 */
const CACHE_MS = 60_000;
let cached: { at: number; agents: S2SClawAgent[] } | null = null;

async function allAgents(): Promise<S2SClawAgent[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.agents;
  try {
    cached = { at: Date.now(), agents: await listS2SClawAgents() };
  } catch (error) {
    logger.warn('[Proactivity] agent list unavailable', { error });
    if (!cached) return [];
  }
  return cached.agents;
}

/** What routing reads: the owner's text or the generated card. */
export const routingTextOf = (agent: S2SClawAgent): string =>
  agent.proactivity?.description?.trim() ?? '';

const asCard = (agent: S2SClawAgent, name: string): AgentCard | null => {
  const description = routingTextOf(agent);
  if (!description || !agent.spacesAppUserId) return null;
  return { slug: agent.slug, userId: agent.spacesAppUserId, name, description };
};

/**
 * Agents in the channel that may answer without a mention: every agent whose bot is a
 * member, once it has a routing card. The channel's mode is the only switch.
 */
export async function proactiveAgentsIn(channelId: string): Promise<AgentCard[]> {
  const agents = (await allAgents()).filter((a) => routingTextOf(a) && a.spacesAppUserId);
  if (agents.length === 0) return [];
  const members = await db.channelParticipant.findMany({
    where: { channelId, userId: { in: agents.map((a) => a.spacesAppUserId!) } },
    select: { userId: true, user: { select: { name: true, displayName: true } } },
  });
  const names = new Map(members.map((m) => [m.userId, m.user?.displayName || m.user?.name]));
  return agents.flatMap((agent) => {
    const name = names.get(agent.spacesAppUserId!);
    if (name === undefined) return [];
    const card = asCard(agent, name || agent.name);
    return card ? [card] : [];
  });
}

/** The claw agent with this slug, if any. */
export async function agentBySlug(slug: string): Promise<S2SClawAgent | null> {
  return (await allAgents()).find((a) => a.slug === slug) ?? null;
}

/** The claw agent behind a bot user, if any; for follow-ups. */
export async function agentByUserId(userId: string): Promise<S2SClawAgent | null> {
  return (await allAgents()).find((a) => a.spacesAppUserId === userId) ?? null;
}

/** The bot users of all claw agents. */
export async function agentUserIds(): Promise<Set<string>> {
  return new Set(
    (await allAgents()).flatMap((a) => (a.spacesAppUserId ? [a.spacesAppUserId] : []))
  );
}

/** Whether any of these users is a claw agent's bot: a message tagging one goes the normal way. */
export async function includesAgent(userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return false;
  const agentUsers = await agentUserIds();
  return userIds.some((id) => agentUsers.has(id));
}
