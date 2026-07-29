import type { Agent, AgentShare } from "../../lib/types";

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

  if (agent.ownerUserId === userId || isAdmin) {
    role = "owner";
  } else {
    const myShare = shares.find((s) => s.userId === userId);
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
