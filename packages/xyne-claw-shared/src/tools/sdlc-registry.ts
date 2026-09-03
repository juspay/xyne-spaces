export type SdlcToolTransport = "direct" | "custom" | "subagent";
export type SdlcMutationLevel = "read" | "write";
export type SdlcTrustedBinding =
  | "none"
  | "repository"
  | "execution"
  | "execution_or_interactive"
  | "wiki_execution";

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
  beginWikiCheckpoint: "spaces-sdlc-wiki-begin-checkpoint",
  verifyWikiSources: "spaces-sdlc-wiki-verify-sources",
  finalizeWikiCommit: "spaces-sdlc-wiki-finalize-commit",
  gitContext: "sandbox-sdlc-git-context",
  createPullRequest: "spaces-sdlc-create-pull-request",
  listTracks: "spaces-sdlc-list-tracks",
  createTrack: "spaces-sdlc-create-track",
  listArtifactTypes: "spaces-sdlc-list-artifact-types",
} as const;

export type SdlcToolName = (typeof SDLC_TOOL_NAMES)[keyof typeof SDLC_TOOL_NAMES];

export const SDLC_TOOL_CAPABILITIES: readonly SdlcToolCapability[] = [
  { name: SDLC_TOOL_NAMES.listArtifacts, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.readArtifact, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.mutateArtifact, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.listArtifactVersions, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.readArtifactVersion, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.beginWikiCheckpoint, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "wiki_execution" },
  { name: SDLC_TOOL_NAMES.verifyWikiSources, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "wiki_execution" },
  { name: SDLC_TOOL_NAMES.finalizeWikiCommit, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "wiki_execution" },
  { name: SDLC_TOOL_NAMES.gitContext, transport: "custom", group: "sdlc", mutation: "read", trustedBinding: "wiki_execution" },
  { name: SDLC_TOOL_NAMES.createPullRequest, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "execution_or_interactive" },
  { name: SDLC_TOOL_NAMES.listTracks, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.createTrack, transport: "direct", group: "sdlc", mutation: "write", trustedBinding: "repository" },
  { name: SDLC_TOOL_NAMES.listArtifactTypes, transport: "direct", group: "sdlc", mutation: "read", trustedBinding: "repository" },
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
  "sandbox-repo-setup",
  "git-read",
] as const;

export const SDLC_PLANNING_TOOLS = ["todo-read", "todo-write", "web-search"] as const;
export const SDLC_SUBAGENTS = ["spaces", "github", "bitbucket", "context7"] as const;

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

const SDLC_HIDDEN_GENERIC_SPACES_TOOLS = new Set([
  "spaces-create-canvas",
  "spaces-edit-canvas",
]);

export const SDLC_RETIRED_TOOL_NAMES = [
  "spaces-sdlc-create-artifact",
  "spaces-sdlc-update-baseline",
  "spaces-sdlc-wiki-list-pages",
  "spaces-sdlc-wiki-read-page",
  "spaces-sdlc-wiki-write-page",
  "spaces-sdlc-wiki-move-page",
  "sandbox-sdlc-wiki-git-context",
] as const;

export const SDLC_DIRECT_TOOL_NAMES = SDLC_TOOL_CAPABILITIES
  .filter((tool) => tool.transport === "direct")
  .map((tool) => tool.name);

export const SDLC_CUSTOM_TOOL_NAMES = [
  ...SDLC_GENERIC_SANDBOX_TOOLS,
  SDLC_TOOL_NAMES.gitContext,
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
  const direct = uniqueToolNames.filter((name) => !SDLC_HIDDEN_GENERIC_SPACES_TOOLS.has(name));
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

export const SDLC_REQUIRED_TOOLS = {
  baseline: [SDLC_TOOL_NAMES.mutateArtifact],
  work: ["sandbox-repo-setup", "sandbox-run", SDLC_TOOL_NAMES.createPullRequest],
  wikiSurvey: [SDLC_TOOL_NAMES.listArtifacts, SDLC_TOOL_NAMES.gitContext],
  wikiPage: [SDLC_TOOL_NAMES.mutateArtifact],
  wikiFinalize: [SDLC_TOOL_NAMES.finalizeWikiCommit],
} as const;

export function sdlcTrustedBindingFor(toolName: string): SdlcTrustedBinding {
  return SDLC_TOOL_CAPABILITIES.find((tool) => tool.name === toolName)?.trustedBinding ?? "none";
}
