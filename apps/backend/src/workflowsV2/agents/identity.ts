import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import {
  listScopedClawAgents,
  type ScopedClawIdentity,
} from '@/services/clawAgentService';

type ClawScope = ScopedClawIdentity & { workspaceId: string; orgId: string };

/** Not `attributes.createdByUserId`: the router consumes that at create and never persists it. */
export const SDLC_AUTHOR_METADATA_KEY = 'sdlcAuthorUserId';

export function sdlcAuthorOf(metadata: string | null | undefined): string | undefined {
  try {
    const author = (JSON.parse(metadata ?? '{}') as Record<string, unknown>)[SDLC_AUTHOR_METADATA_KEY];
    return typeof author === 'string' && author ? author : undefined;
  } catch {
    return undefined;
  }
}

/** Whoever last changed the steps: the router stamps it on every config write. */
export function runAuthorOf(ctx: StepExecutionContext): string | undefined {
  const author = ctx.runtime.metadata[SDLC_AUTHOR_METADATA_KEY];
  return typeof author === 'string' && author ? author : undefined;
}

/** Without `orgId` claw-auth cannot narrow to one org, and another org's agent of the same slug can match. */
export async function clawScopeFor(userId: string, workspaceId: string): Promise<ClawScope> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
  if (!workspace?.orgId) throw new Error(`[workflows] workspace ${workspaceId} has no organization`);
  return { userId, workspaceId, orgId: workspace.orgId };
}

/** Who a RUN_AGENT run acts as: the agent's own Spaces user, chosen from the agents the author can reach. */
export interface ClawRunIdentity {
  agentSlug: string;
  userId: string;
  userName: string;
  userEmail: string;
  spacesWorkspaceId: string;
  spacesOrgId: string;
  spacesOrgMemberId: string;
}

/** Throws rather than falling back: a run attributed to the wrong principal is worse than one that does not start. */
export async function resolveClawRunIdentity(
  agentSlug: string,
  scope: ClawScope,
): Promise<ClawRunIdentity> {
  const agent = (await listScopedClawAgents(scope)).find((candidate) => candidate.slug === agentSlug);
  if (!agent) {
    throw new Error(
      `[workflows] claw agent "${agentSlug}" not found, or not visible to the workflow's author — `
        + 'check the slug, and that the agent is enabled and shared with them',
    );
  }
  if (!agent.spacesAppId || !agent.spacesAppUserId) {
    throw new Error(
      `[workflows] claw agent "${agentSlug}" is not published as a Spaces app `
        + '(no spacesAppId/spacesAppUserId), so a workflow cannot run it',
    );
  }

  const user = await db.user.findUnique({
    where: { id: agent.spacesAppUserId },
    select: { name: true, email: true, orgMemberId: true },
  });
  if (!user) {
    throw new Error(
      `[workflows] claw agent "${agentSlug}" points at Spaces user ${agent.spacesAppUserId}, which does not exist`,
    );
  }
  if (!user.orgMemberId) {
    throw new Error(`[workflows] the Spaces user for claw agent "${agentSlug}" has no orgMemberId`);
  }

  return {
    agentSlug,
    userId: agent.spacesAppUserId,
    userName: user.name,
    userEmail: user.email,
    spacesWorkspaceId: scope.workspaceId,
    spacesOrgId: scope.orgId,
    spacesOrgMemberId: user.orgMemberId,
  };
}
