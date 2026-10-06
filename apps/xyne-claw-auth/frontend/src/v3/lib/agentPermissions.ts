import type { Agent, AgentShare } from "../../lib/types";
import { isCurrentUser } from "../../lib/identity";

export type AgentRole =
  | "owner"
  | "editor"
  | "contributor"
  | "viewer"
  | "none";

export interface AgentPermissions {
  role: AgentRole;
  canEdit: boolean;
  canShare: boolean;
  canViewPage: boolean;
}

export function getAgentPermissions(
  agent: Agent,
  userId: string,
  shares: AgentShare[],
  isAdmin: boolean,
): AgentPermissions {
  let role: AgentRole = "none";

  if (isCurrentUser(agent.ownerUserId) || isAdmin) {
    role = "owner";
  } else {
    const myShare = shares.find((s) => isCurrentUser(s.userId));
    if (myShare) {
      switch (myShare.role) {
        case "EDITOR":
          role = "editor";
          break;
        case "CONTRIBUTOR":
          role = "contributor";
          break;
        case "VIEWER":
          role = "viewer";
          break;
      }
    } else if (agent.scope === "global") {
      role = "viewer";
    }
  }

  return {
    role,
    canEdit:
      role === "owner" || role === "editor" || role === "contributor",
    canShare: role === "owner",
    canViewPage: role !== "none",
  };
}
