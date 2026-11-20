/**
 * Optional host functions for the Spaces tools: Spaces directory lookups and
 * signed headers for calls to the claw runtime. Unset by default, in which case
 * they report "not available".
 */
import type { MentionLookups } from "xyne-claw-mcp-common/mention-transform";

export interface McpServersHost {
  /** Spaces directory API (workspace and user lookups) is usable. */
  spacesDirectoryAvailable(): boolean;
  getWorkspaceIdForUser(userId: string, caller?: string, requestedWorkspaceId?: string): Promise<string | null>;
  mentionLookups(workspaceId?: string): MentionLookups;
  /** Signed headers for a call to the claw runtime, or null when claw-auth can't sign. */
  runtimeAuthHeaders(method: string, url: string): Record<string, string> | null;
}

const NO_HOST: McpServersHost = {
  spacesDirectoryAvailable: () => false,
  getWorkspaceIdForUser: async () => null,
  mentionLookups: () => {
    throw new Error("Spaces directory is not available here");
  },
  runtimeAuthHeaders: () => null,
};

let current: McpServersHost = NO_HOST;

export function setMcpServersHost(host: McpServersHost | null): void {
  current = host ?? NO_HOST;
}

export function serversHost(): McpServersHost {
  return current;
}
