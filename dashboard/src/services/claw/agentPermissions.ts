// agentPermissions — derive what the current user may do with an agent.
//
// Ported verbatim (behaviour-wise) from
// xyne-claw-auth/frontend/src/v3/lib/agentPermissions.ts so the dashboard gates
// editing exactly like the claw-auth frontend. Keep the role rules in sync with
// that source of truth.
//
// NOTE ON ADMINS: an admin is promoted to role "owner" here, so `role` is NOT a
// reliable *ownership* check. Callers that need true ownership (delete, publish,
// rename handle, change model) must re-check `agent.ownerUserId === userId`
// directly rather than trusting `role === "owner"`.

import type { Agent, AgentShare } from './clawAuthAgentTypes';

export type AgentRole = 'owner' | 'editor' | 'contributor' | 'viewer' | 'none';

export interface AgentPermissions {
  role: AgentRole;
  /** Can change the agent's config (owner / editor / contributor). */
  canEdit: boolean;
  /** Can manage contributors (owner only). */
  canShare: boolean;
  /** May view the detail page at all. */
  canViewPage: boolean;
}

export function getAgentPermissions(
  agent: Agent,
  userId: string,
  shares: AgentShare[],
  isAdmin: boolean,
): AgentPermissions {
  let role: AgentRole = 'none';

  if (agent.ownerUserId === userId || isAdmin) {
    role = 'owner';
  } else {
    const myShare = shares.find(s => s.userId === userId);
    if (myShare) {
      switch (myShare.role) {
        case 'EDITOR':
          role = 'editor';
          break;
        case 'CONTRIBUTOR':
          role = 'contributor';
          break;
        case 'VIEWER':
          role = 'viewer';
          break;
      }
    } else if (agent.scope === 'global') {
      role = 'viewer';
    }
  }

  return {
    role,
    canEdit: role === 'owner' || role === 'editor' || role === 'contributor',
    canShare: role === 'owner',
    canViewPage: role !== 'none',
  };
}
