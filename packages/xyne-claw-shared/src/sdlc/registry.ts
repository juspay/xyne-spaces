import { WORKFLOW_MCP_TOOL_NAMES, WORKFLOW_MCP_WRITE_TOOL_NAMES } from "../tools/workflow-tool-names.js";

export type SdlcToolTransport = "direct" | "custom" | "subagent";
export type SdlcMutationLevel = "read" | "write";
export type SdlcTrustedBinding = "none" | "hub" | "repository" | "actor";

export interface SdlcToolCapability {
  name: string;
  transport: SdlcToolTransport;
  group: "sdlc" | "spaces" | "sandbox" | "planning" | "subagent";
  mutation: SdlcMutationLevel;
  trustedBinding: SdlcTrustedBinding;
}

export const SDLC_AGENT_SLUG = "sdlc-agent" as const;

export const SDLC_TOOL_NAMES = {
  listArtifacts: "spaces-sdlc-list-artifacts",
  readArtifact: "spaces-sdlc-read-artifact",
  mutateArtifact: "spaces-sdlc-mutate-artifact",
  listArtifactVersions: "spaces-sdlc-list-artifact-versions",
  readArtifactVersion: "spaces-sdlc-read-artifact-version",
  createPullRequest: "spaces-sdlc-create-pull-request",
  listTracks: "spaces-sdlc-list-tracks",
  createTrack: "spaces-sdlc-create-track",
  listArtifactTypes: "spaces-sdlc-list-artifact-types",
  listRepositories: "spaces-sdlc-list-repositories",
  listEntityLinks: "spaces-sdlc-list-entity-links",
} as const;

export type SdlcToolName = (typeof SDLC_TOOL_NAMES)[keyof typeof SDLC_TOOL_NAMES];

export const SDLC_TOOL_CAPABILITIES: readonly SdlcToolCapability[] = [
  { name: SDLC_TOOL_NAMES.listArtifacts, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.readArtifact, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "hub" },
  { name: SDLC_TOOL_NAMES.mutateArtifact, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.listArtifactVersions, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "hub" },
  { name: SDLC_TOOL_NAMES.readArtifactVersion, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "hub" },
  { name: SDLC_TOOL_NAMES.createPullRequest, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "actor" },
  { name: SDLC_TOOL_NAMES.listTracks, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.createTrack, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.listArtifactTypes, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.listRepositories, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "none" },
  { name: SDLC_TOOL_NAMES.listEntityLinks, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "hub" },
] as const;

export const SDLC_GENERIC_SANDBOX_TOOLS = [
  "sandbox-create",
  "sandbox-run",
  "sandbox-run-detached",
  "sandbox-poll-job",
  "sandbox-write-file",
  "sandbox-edit-file",
  "sandbox-copy-in",
  "sandbox-read-file",
  "sandbox-deliver-files",
  "sandbox-destroy",
  "sdlc-repository-access",
  "git-read",
] as const;

export const SDLC_PLANNING_TOOLS = ["todo-read", "todo-write", "web-search"] as const;
export const SDLC_SUBAGENTS = ["github", "bitbucket", "context7"] as const;

export const SDLC_GENERIC_SPACES_WRITE_TOOLS = [
  "spaces-create-ticket",
  "spaces-create-bulk-tickets",
  "spaces-update-ticket",
  "spaces-schedule-call",
  "spaces-create-canvas",
  "spaces-edit-canvas",
  "user-send-message",
  "spaces-upload-to-kb",
] as const;

export const SDLC_RETIRED_TOOL_NAMES = [
  "spaces-sdlc-create-artifact",
  "spaces-sdlc-update-baseline",
  "spaces-sdlc-wiki-list-pages",
  "spaces-sdlc-wiki-read-page",
  "spaces-sdlc-wiki-write-page",
  "spaces-sdlc-wiki-move-page",
  "sandbox-sdlc-wiki-git-context",
  "spaces-sdlc-wiki-begin-checkpoint",
  "spaces-sdlc-wiki-verify-sources",
  "spaces-sdlc-wiki-finalize-commit",
  "sandbox-sdlc-git-context",
] as const;

export const SDLC_DIRECT_TOOL_NAMES = SDLC_TOOL_CAPABILITIES
  .filter((tool) => tool.transport === "direct")
  .map((tool) => tool.name);

export const SDLC_CUSTOM_TOOL_NAMES = [
  ...SDLC_GENERIC_SANDBOX_TOOLS,
  ...SDLC_PLANNING_TOOLS,
] as const;

export interface SdlcAgentToolProfile {
  tools: { direct: string[]; custom: string[]; subagents: string[] };
  toolPermissions: Record<string, "allow" | "ask">;
  agentToolAllows: string[];
}

export function buildSdlcAgentToolProfile(spacesMcpToolNames: readonly string[]): SdlcAgentToolProfile {
  const uniqueToolNames = [...new Set(spacesMcpToolNames)];
  if (uniqueToolNames.length !== spacesMcpToolNames.length) {
    throw new Error("Duplicate tool names in Xyne Spaces MCP export");
  }
  const retired = SDLC_RETIRED_TOOL_NAMES.filter((name) => uniqueToolNames.includes(name));
  if (retired.length > 0) {
    throw new Error(`Retired SDLC tools remain exported: ${retired.join(", ")}`);
  }
  const direct = [...uniqueToolNames, ...WORKFLOW_MCP_TOOL_NAMES];
  const missing = SDLC_DIRECT_TOOL_NAMES.filter((name) => !direct.includes(name));
  if (missing.length > 0) {
    throw new Error(`SDLC MCP tools missing from Xyne Spaces server: ${missing.join(", ")}`);
  }
  const toolPermissions: Record<string, "allow" | "ask"> = {};
  for (const name of SDLC_GENERIC_SPACES_WRITE_TOOLS) {
    if (direct.includes(name)) toolPermissions[`xyne-spaces__${name}`] = "ask";
  }
  for (const tool of SDLC_TOOL_CAPABILITIES) {
    if (tool.transport === "direct") toolPermissions[`xyne-spaces__${tool.name}`] = "allow";
  }
  // Workflow writes are "allow", not "ask": SDLC runs are also triggered BY
  // workflows (sessions like wf-…), where nobody is in a thread to approve, so
  // an "ask" would fail closed and stall the run. Matches ask-ai's seeded config.
  for (const name of WORKFLOW_MCP_WRITE_TOOL_NAMES) {
    toolPermissions[`xyne-workflows__${name}`] = "allow";
  }
  return {
    tools: {
      direct,
      custom: [...SDLC_CUSTOM_TOOL_NAMES],
      subagents: [...SDLC_SUBAGENTS],
    },
    toolPermissions,
    agentToolAllows: [...SDLC_CUSTOM_TOOL_NAMES],
  };
}

export function sdlcTrustedBindingFor(toolName: string): SdlcTrustedBinding {
  return SDLC_TOOL_CAPABILITIES.find((tool) => tool.name === toolName)?.trustedBinding ?? "none";
}

let cachedProfile: SdlcAgentToolProfile | undefined;

export function sdlcAgentToolProfile(spacesMcpToolNames: readonly string[]): SdlcAgentToolProfile {
  cachedProfile ??= buildSdlcAgentToolProfile(spacesMcpToolNames);
  return cachedProfile;
}

