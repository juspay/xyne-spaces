import { WORKFLOW_MCP_TOOL_NAMES, WORKFLOW_MCP_WRITE_TOOL_NAMES } from "../tools/workflow-tool-names.js";

export type SdlcToolTransport = "direct" | "custom" | "subagent";
export type SdlcMutationLevel = "read" | "write";

export interface SdlcToolCapability {
  name: string;
  transport: SdlcToolTransport;
  group: "sdlc" | "spaces" | "sandbox" | "planning" | "subagent";
  mutation: SdlcMutationLevel;
}

export const SDLC_AGENT_SLUG = "sdlc-agent" as const;

export const SDLC_TOOL_NAMES = {
  listArtifacts: "spaces-sdlc-list-artifacts",
  readArtifact: "spaces-sdlc-read-artifact",
  writeArtifact: "spaces-sdlc-write-artifact",
  archiveArtifact: "spaces-sdlc-archive-artifact",
  listArtifactVersions: "spaces-sdlc-list-artifact-versions",
  createPullRequest: "spaces-sdlc-create-pull-request",
  listTracks: "spaces-sdlc-list-tracks",
  createTrack: "spaces-sdlc-create-track",
  createTrackFolder: "spaces-sdlc-create-track-folder",
  listArtifactTypes: "spaces-sdlc-list-artifact-types",
  listRepositories: "spaces-sdlc-list-repositories",
  listEntityLinks: "spaces-sdlc-list-entity-links",
} as const;

export type SdlcToolName = (typeof SDLC_TOOL_NAMES)[keyof typeof SDLC_TOOL_NAMES];

export const SDLC_TOOL_CAPABILITIES: readonly SdlcToolCapability[] = [
  { name: SDLC_TOOL_NAMES.listArtifacts, transport: "direct", group: "sdlc", mutation: "read" },
  { name: SDLC_TOOL_NAMES.readArtifact, transport: "direct", group: "sdlc", mutation: "read" },
  { name: SDLC_TOOL_NAMES.writeArtifact, transport: "direct", group: "sdlc", mutation: "write" },
  { name: SDLC_TOOL_NAMES.archiveArtifact, transport: "direct", group: "sdlc", mutation: "write" },
  { name: SDLC_TOOL_NAMES.listArtifactVersions, transport: "direct", group: "sdlc", mutation: "read" },
  { name: SDLC_TOOL_NAMES.createPullRequest, transport: "direct", group: "sdlc", mutation: "write" },
  { name: SDLC_TOOL_NAMES.listTracks, transport: "direct", group: "sdlc", mutation: "read" },
  { name: SDLC_TOOL_NAMES.createTrack, transport: "direct", group: "sdlc", mutation: "write" },
  { name: SDLC_TOOL_NAMES.createTrackFolder, transport: "direct", group: "sdlc", mutation: "write" },
  { name: SDLC_TOOL_NAMES.listArtifactTypes, transport: "direct", group: "sdlc", mutation: "read" },
  { name: SDLC_TOOL_NAMES.listRepositories, transport: "direct", group: "sdlc", mutation: "read" },
  { name: SDLC_TOOL_NAMES.listEntityLinks, transport: "direct", group: "sdlc", mutation: "read" },
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
  "spaces-sdlc-mutate-artifact",
  "spaces-sdlc-read-artifact-version",
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
  /** Permissions for a run a person is watching; see sdlcToolPermissions for headless runs. */
  toolPermissions: Record<string, "allow" | "ask">;
  agentToolAllows: string[];
}

/** Writes ask on a watched run and are allowed on automation/workflow runs, where nobody can approve. */
export function sdlcToolPermissions(
  direct: readonly string[],
  interactive: boolean,
): Record<string, "allow" | "ask"> {
  const write = interactive ? "ask" : "allow";
  const toolPermissions: Record<string, "allow" | "ask"> = {};
  for (const name of SDLC_GENERIC_SPACES_WRITE_TOOLS) {
    if (direct.includes(name)) toolPermissions[`xyne-spaces__${name}`] = write;
  }
  for (const tool of SDLC_TOOL_CAPABILITIES) {
    if (tool.transport === "direct") {
      toolPermissions[`xyne-spaces__${tool.name}`] = tool.mutation === "write" ? write : "allow";
    }
  }
  for (const name of WORKFLOW_MCP_WRITE_TOOL_NAMES) {
    toolPermissions[`xyne-workflows__${name}`] = write;
  }
  return toolPermissions;
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
  return {
    tools: {
      direct,
      custom: [...SDLC_CUSTOM_TOOL_NAMES],
      subagents: [...SDLC_SUBAGENTS],
    },
    toolPermissions: sdlcToolPermissions(direct, true),
    agentToolAllows: [...SDLC_CUSTOM_TOOL_NAMES],
  };
}

let cachedProfile: SdlcAgentToolProfile | undefined;

export function sdlcAgentToolProfile(spacesMcpToolNames: readonly string[]): SdlcAgentToolProfile {
  cachedProfile ??= buildSdlcAgentToolProfile(spacesMcpToolNames);
  return cachedProfile;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The SDLC tools unioned into an agent's tools selection. Undefined stays undefined:
 * an agent with no selection is unrestricted, and creating one would restrict it.
 */
export function withSdlcToolsConfig(
  tools: Record<string, unknown> | undefined,
  profile: SdlcAgentToolProfile,
): Record<string, unknown> | undefined {
  if (!tools) return undefined;
  const union = (key: "direct" | "custom" | "subagents") => [
    ...new Set([...stringList(tools[key]), ...profile.tools[key]]),
  ];
  return { ...tools, direct: union("direct"), custom: union("custom"), subagents: union("subagents") };
}

/**
 * Adds the SDLC profile to an agent config for one run: tools are a union with the
 * agent's own, SDLC tool permissions overwrite the agent's. An unrestricted agent keeps
 * no tools selection but still gets the permissions.
 */
export function mergeSdlcToolProfile(
  config: Record<string, unknown>,
  profile: SdlcAgentToolProfile,
  options: { interactive: boolean },
): Record<string, unknown> {
  const raw = config["tools"];
  const tools = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  const permissions = config["toolPermissions"];
  return {
    ...config,
    ...(tools ? { tools: withSdlcToolsConfig(tools, profile) } : {}),
    toolPermissions: {
      ...(permissions && typeof permissions === "object" && !Array.isArray(permissions) ? permissions : {}),
      ...sdlcToolPermissions(profile.tools.direct, options.interactive),
    },
  };
}
