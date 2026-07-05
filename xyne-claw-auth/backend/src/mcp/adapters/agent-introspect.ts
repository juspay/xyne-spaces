/**
 * Agent-config introspection tools — read-only, claw-auth-executed (no upstream
 * connector / no credentials). Surfaced under the synthetic `claw-builtin`
 * server type alongside webfetch, and catalogued as System Tools
 * (source `custom:agent-introspect`) so an agent opts in by selecting them into
 * `config.tools.custom[]`. Execution is handled inline in /mcp/call.
 *
 * Purpose: lets an "agent-config advisor" agent inspect LIVE agents and the real
 * tool/subagent catalog so it can recommend what tools/subagents to add. Strictly
 * advisory — these tools never mutate config. Secrets (signing secrets, app/OAuth
 * tokens, encrypted creds) are never returned.
 */

import { prisma } from "../../db.js";
import type { McpToolInfo } from "../types.js";

import { createLogger } from "../../logger.js";
const log = createLogger("agent-introspect");

// Slugs MUST match the `tools` rows seeded by the add_agent_introspect_tools
// migration AND the customGroups slug the frontend writes into tools.custom[]
// AND the runtime selectionKey gate. Keep name === selectionKey (like webfetch).
export const AGENT_INTROSPECT_TOOLS: McpToolInfo[] = [
  {
    name: "list_agents",
    description:
      "List all agents with a summary of their configuration: slug, name, scope, enabled, model, " +
      "attached tools (subagents/direct/custom/gateway), skills and KB scope. Use this to survey the " +
      "fleet before recommending changes. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        enabledOnly: { type: "boolean", description: "If true, only return enabled agents." },
      },
      required: [],
    },
    selectionKey: "list_agents",
  },
  {
    name: "get_agent_config",
    description:
      "Get one agent's full configuration by slug: system prompt, config JSON (tools, model settings, " +
      "feature flags), attached skills and knowledge-base grants. Use after list_agents to inspect a " +
      "specific agent in detail. Read-only; secrets are never returned.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The agent slug to inspect." },
      },
      required: ["slug"],
    },
    selectionKey: "get_agent_config",
  },
  {
    name: "list_available_tools",
    description:
      "List the full catalog of tools, subagents and integrations that COULD be added to an agent — " +
      "including each integration's read/write tools, risk level and how many agents already use it " +
      "(usageCount). Compare against an agent's current config to recommend additions. Read-only.",
    inputSchema: { type: "object", properties: {}, required: [] },
    selectionKey: "list_available_tools",
  },
];

export const AGENT_INTROSPECT_TOOL_NAMES = AGENT_INTROSPECT_TOOLS.map((t) => t.name);

function toolsSummary(config: unknown): Record<string, unknown> {
  const tools = (config as { tools?: Record<string, unknown> } | null)?.tools ?? {};
  const arr = (k: string) => (Array.isArray((tools as Record<string, unknown>)[k]) ? ((tools as Record<string, unknown>)[k] as unknown[]) : []);
  return {
    subagents: arr("subagents"),
    direct: arr("direct"),
    custom: arr("custom"),
    gateway: arr("gateway"),
  };
}

export async function handleListAgents(params: Record<string, unknown>): Promise<string> {
  const enabledOnly = params["enabledOnly"] === true;
  const rows = await prisma.agent.findMany({
    where: enabledOnly ? { enabled: true } : {},
    select: {
      slug: true,
      name: true,
      description: true,
      scope: true,
      enabled: true,
      modelId: true,
      kbScope: true,
      config: true,
      skills: { select: { skill: { select: { slug: true, name: true } } } },
      _count: { select: { collections: true } },
    },
    orderBy: { slug: "asc" },
  });
  const agents = rows.map((a) => ({
    slug: a.slug,
    name: a.name,
    description: a.description,
    scope: a.scope,
    enabled: a.enabled,
    modelId: a.modelId,
    kbScope: a.kbScope,
    tools: toolsSummary(a.config),
    skills: a.skills.map((s) => s.skill.slug),
    kbGrants: a._count.collections,
  }));
  return JSON.stringify({ count: agents.length, agents });
}

export async function handleGetAgentConfig(params: Record<string, unknown>): Promise<string> {
  const slug = String(params["slug"] ?? "").trim();
  if (!slug) return JSON.stringify({ error: "`slug` is required" });
  const a = await prisma.agent.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      description: true,
      scope: true,
      enabled: true,
      modelId: true,
      kbScope: true,
      systemPrompt: true,
      config: true,
      skills: { select: { skill: { select: { slug: true, name: true, description: true } } } },
      collections: { select: { collectionId: true, fileId: true } },
    },
  });
  if (!a) return JSON.stringify({ error: `No agent with slug "${slug}"` });
  // Secrets (signingSecret, spacesAppToken, provider creds) are intentionally
  // not selected, so they can never leak through this tool.
  return JSON.stringify({
    slug: a.slug,
    name: a.name,
    description: a.description,
    scope: a.scope,
    enabled: a.enabled,
    modelId: a.modelId,
    kbScope: a.kbScope,
    systemPrompt: a.systemPrompt,
    config: a.config,
    tools: toolsSummary(a.config),
    skills: a.skills.map((s) => s.skill),
    kbGrants: a.collections,
  });
}

export async function handleListAvailableTools(): Promise<string> {
  // Lazy import to avoid a load-order cycle (routes/tools imports mcp pieces).
  const { buildAvailableToolsCatalog } = await import("../../routes/tools.js");
  const catalog = await buildAvailableToolsCatalog();
  const integrations = (catalog.integrations ?? []).map((i) => ({
    slug: i.slug,
    label: i.label,
    kind: i.kind,
    connected: i.connected,
    usageCount: i.usageCount,
    readTools: (i.readTools ?? []).map((t) => ({ slug: t.slug, name: t.name, risk: t.riskLevel })),
    writeTools: (i.writeTools ?? []).map((t) => ({ slug: t.slug, name: t.name, risk: t.riskLevel })),
  }));
  const subagents = (catalog.subagents ?? []).map((s) => ({
    name: s.name,
    description: s.description,
    serverType: s.serverType,
    source: s.source,
  }));
  return JSON.stringify({
    integrations,
    subagents,
    customGroups: catalog.customGroups ?? [],
  });
}

export async function handleAgentIntrospect(tool: string, params: Record<string, unknown>): Promise<string> {
  switch (tool) {
    case "list_agents":
      return handleListAgents(params);
    case "get_agent_config":
      return handleGetAgentConfig(params);
    case "list_available_tools":
      return handleListAvailableTools();
    default:
      log.warn(`[agent-introspect] unknown tool ${tool}`);
      throw new Error(`Unknown agent-introspect tool: ${tool}`);
  }
}
