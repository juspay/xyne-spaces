import { db } from '@/database/client';
import { listS2SClawAgents } from '@/services/clawAgentService';
import type { S2SClawAgent } from '@/services/clawAgentService';

/**
 * Who a workflow's agent run acts as.
 *
 * **The agent acts as itself.** The workflow author picks the agent in step
 * config, and every claw agent published as a Spaces app has its own Spaces
 * user (`spacesAppUserId`) — so the run carries the agent's identity and
 * inherits the agent's permissions, not the workflow author's.
 *
 * This is what the app-mention path already does (`clawAgentService.ts`,
 * `runClawAgent`). Automations goes a slightly older route — `spacesAppId` →
 * `installedApps.userId`, falling back to the automation's creator — which
 * needs a fallback because it resolves the *installation* rather than the
 * agent. Resolving the agent directly needs none.
 */
export interface ClawRunIdentity {
  agentSlug: string;
  /** The agent's own Spaces user — claw pins the run to this. */
  userId: string;
  userName: string;
  userEmail: string;
  spacesWorkspaceId: string;
  spacesOrgId: string;
  spacesOrgMemberId: string;
}

const AGENT_LIST_CACHE_TTL_MS = 60_000;
let agentListCache: { agents: S2SClawAgent[]; fetchedAt: number } | null = null;

/**
 * Claw agents this deployment can actually dispatch to, cached briefly.
 *
 * `dispatch()` resolves an agent on every run, including every repair re-run,
 * so an uncached call would put a claw round-trip in front of each one. Same
 * TTL automations uses.
 *
 * Filtered to agents carrying BOTH ids, because an agent missing either cannot
 * be dispatched: `runS2SClawAgent` needs `spacesAppId` to find the app's
 * signing secret, and the run needs `spacesAppUserId` for its identity. An
 * agent without them would only fail later, mid-run.
 */
export async function listDispatchableClawAgents(): Promise<S2SClawAgent[]> {
  if (agentListCache && Date.now() - agentListCache.fetchedAt < AGENT_LIST_CACHE_TTL_MS) {
    return agentListCache.agents;
  }
  const agents = (await listS2SClawAgents()).filter(
    (agent) => Boolean(agent.spacesAppId) && Boolean(agent.spacesAppUserId),
  );
  agentListCache = { agents, fetchedAt: Date.now() };
  return agents;
}

/** Test seam — the cache is process-global and would otherwise leak between cases. */
export function resetClawAgentCache(): void {
  agentListCache = null;
}

/**
 * Resolve the identity a run of `agentSlug` should carry.
 *
 * Throws rather than falling back to some other user: claw pins the run to this
 * identity and the agent's tools act with its permissions, so a run attributed
 * to the wrong principal is worse than a run that does not start.
 *
 * The three failure modes are reported separately because they need different
 * fixes — and `agentSlug` is free text in the builder today, so a typo is the
 * most likely one.
 */
export async function resolveClawRunIdentity(
  agentSlug: string,
  workspaceId: string,
): Promise<ClawRunIdentity> {
  const agents = await listDispatchableClawAgents();
  const agent = agents.find((candidate) => candidate.slug === agentSlug);

  if (!agent) {
    // Distinguish "no such agent" from "exists but not dispatchable" — the
    // second is a claw-side publishing problem, not a typo in the workflow.
    const known = await listS2SClawAgents();
    const unpublished = known.find((candidate) => candidate.slug === agentSlug);
    throw new Error(
      unpublished
        ? `[workflows] claw agent "${agentSlug}" is not published as a Spaces app `
          + '(no spacesAppId/spacesAppUserId), so a workflow cannot run it'
        : `[workflows] claw agent "${agentSlug}" not found — check the agent slug, `
          + 'or whether the agent is enabled in claw',
    );
  }

  const agentUserId = agent.spacesAppUserId as string;

  const [workspace, user] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } }),
    db.user.findUnique({
      where: { id: agentUserId },
      select: { name: true, email: true, orgMemberId: true },
    }),
  ]);

  if (!workspace?.orgId) {
    throw new Error(`[workflows] workspace ${workspaceId} has no organization`);
  }
  if (!user) {
    throw new Error(
      `[workflows] claw agent "${agentSlug}" points at Spaces user ${agentUserId}, which does not exist`,
    );
  }
  if (!user.orgMemberId) {
    throw new Error(
      `[workflows] the Spaces user for claw agent "${agentSlug}" has no orgMemberId`,
    );
  }

  return {
    agentSlug,
    userId: agentUserId,
    userName: user.name,
    userEmail: user.email,
    spacesWorkspaceId: workspaceId,
    spacesOrgId: workspace.orgId,
    spacesOrgMemberId: user.orgMemberId,
  };
}
