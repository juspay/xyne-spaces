/**
 * Apply side of the agent-authoring tools (xyne-claw-shared/src/tools/agent-tools).
 *
 * Every one of those tools is a WRITE tool: the pod signs a pending action and
 * executes nothing, and this module runs only after a human clicked Approve in
 * flow-action. By the time we are called the HMAC over {serverType, tool,
 * params, userId} has been verified and `userId` is the approver, so `params`
 * are trusted as *transport* — but NOT as authority. Two rules follow:
 *
 *   1. Permission is re-checked HERE, against the row, at apply time. The pod
 *      cannot enforce an ACL it cannot read, and the draft may have been signed
 *      minutes ago by an agent acting for a user whose rights have since
 *      changed. Creates are owned by the approver; updates require edit rights
 *      on the target.
 *
 *   2. Nothing an agent supplies becomes a credential. create-mcp runs the
 *      shared `validateMcpProposal` policy (https-only, no stdio fields, no
 *      secret-shaped values) a second time on this side, because the pod-side
 *      check is advice and this one is enforcement.
 *
 * Kept out of flow-action.ts deliberately: that file is already the single
 * biggest branch point in the service, and six more tool cases inline would
 * bury the MCP path that the rest of it is about.
 */

import { prisma } from "../db.js";
import { errMsg } from "./errors.js";
import {
  agentRepository,
  agentShareRepository,
  subagentDefinitionRepository,
  subagentShareRepository,
} from "../repositories/index.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { resolveAgentCapabilities, toConfigTools, unknownToolsNote } from "./agent-card.js";
import { writeAuditLog } from "./audit.js";
import { resolvePromptChange } from "./prompt-edits.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-tools-apply");

/** Tool slugs this module owns. flow-action routes on this set. */
export const AGENT_TOOL_SLUGS = new Set([
  "create-agent",
  "update-agent",
  "create-subagent",
  "update-subagent",
  "create-mcp",
]);

export type ApplyResult =
  | { ok: true; message: string; note?: string }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];

/** Lowercase-kebab, matching the slug rules the agent + subagent routes enforce. */
function kebab(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isValidKebab(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/** The approver's org — every row written here is scoped to it. */
async function orgOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  return user?.orgId ?? null;
}

/**
 * Resolve a flat tool-identifier list into the agent config's tool buckets,
 * reusing the same resolver the draft card uses so a name means the same thing
 * on both paths. Unknown names are reported, never fatal — an agent that
 * hallucinated one tool out of eight should still produce the other seven.
 */
async function resolveTools(toolIds: string[], orgId: string, userId: string) {
  const { buildAvailableToolsCatalog } = await import("../routes/tools.js");
  const catalog = await buildAvailableToolsCatalog(undefined, orgId);
  return resolveAgentCapabilities(toolIds, catalog, userId);
}

// ── Agents ───────────────────────────────────────────────────────────────────

async function createAgent(params: Record<string, unknown>, userId: string): Promise<ApplyResult> {
  const name = str(params["name"]);
  const description = str(params["description"]);
  const systemPrompt = str(params["systemPrompt"]);
  const slug = kebab(str(params["slug"]) || name);

  if (!name || !description || !systemPrompt) {
    return { ok: false, error: "Agent name, description and system prompt are all required." };
  }
  if (!slug || !isValidKebab(slug)) {
    return { ok: false, error: `Invalid agent identifier "${slug}" — use lowercase letters, digits and single hyphens.` };
  }

  const orgId = await orgOf(userId);
  if (!orgId) return { ok: false, error: "Could not resolve your organization to create the agent." };

  if (await agentRepository.findBySlug(slug, orgId)) {
    return { ok: false, error: `An agent with the identifier "${slug}" already exists — nothing was created.` };
  }

  const resolved = await resolveTools(strList(params["tools"]), orgId, userId);
  const created = await agentRepository.create({
    slug,
    name,
    description,
    systemPrompt,
    scope: "personal",
    color: str(params["color"]) || "#6366f1",
    modelId: str(params["modelId"]),
    config: { tools: toConfigTools(resolved) },
    owner: { connect: { id: userId } },
    org: { connect: { id: orgId } },
  });

  await writeAuditLog({
    actorUserId: userId,
    eventType: "AGENT_CREATED",
    targetId: created.id,
    description: `agent-authored agent "${name}" (${slug}) approved from a create-agent card`,
    metadata: { subagents: resolved.subagents, custom: resolved.custom },
  }).catch(() => {});
  log.info(`[create-agent] created ${slug} (id=${created.id}) owner=${userId} org=${orgId}`);

  const note = unknownToolsNote(resolved.unknown);
  return { ok: true, message: `Agent "${name}" created (\`${slug}\`).`, ...(note ? { note } : {}) };
}

async function updateAgent(params: Record<string, unknown>, userId: string): Promise<ApplyResult> {
  const slug = kebab(str(params["slug"]));
  if (!slug) return { ok: false, error: "The agent's identifier is required." };

  const orgId = await orgOf(userId);
  if (!orgId) return { ok: false, error: "Could not resolve your organization." };

  const agent = await agentRepository.findBySlug(slug, orgId);
  if (!agent) return { ok: false, error: `No agent "${slug}" in your workspace.` };

  // Edit rights re-checked against the row, not the card.
  const share = await agentShareRepository.findByAgentAndUser(agent.id, userId);
  const mayEdit = agent.ownerUserId === userId || share?.role === "EDITOR" || (await isClawAdmin(userId));
  if (!mayEdit) {
    return { ok: false, error: `You don't have permission to change the agent "${slug}".` };
  }

  const data: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const field of ["name", "description", "modelId", "color"] as const) {
    const value = str(params[field]);
    if (value) {
      data[field] = value;
      changed.push(field);
    }
  }

  // Prompt changes go through resolvePromptChange: anchored promptEdits against
  // the stored prompt, or full replacement only while the prompt is short.
  const promptChange = resolvePromptChange(params, agent.systemPrompt ?? "");
  if (promptChange.error) return { ok: false, error: promptChange.error };
  if (promptChange.prompt !== undefined) {
    data["systemPrompt"] = promptChange.prompt;
    changed.push("systemPrompt");
  }

  let note: string | undefined;
  if (params["tools"] !== undefined) {
    const resolved = await resolveTools(strList(params["tools"]), orgId, userId);
    // config is opaque JSON: merge so a tools-only change can't drop the
    // agent's other settings (automationProvider, sandbox flags, …).
    const existingConfig = (agent.config ?? {}) as Record<string, unknown>;
    data["config"] = { ...existingConfig, tools: toConfigTools(resolved) };
    changed.push("tools");
    note = unknownToolsNote(resolved.unknown);
  }

  if (changed.length === 0) {
    return { ok: false, error: "Nothing to change — no fields were supplied." };
  }

  await agentRepository.update(slug, orgId, data);
  await writeAuditLog({
    actorUserId: userId,
    eventType: "AGENT_UPDATED",
    targetId: agent.id,
    description: `agent "${slug}" updated from an update-agent card (${changed.join(", ")})`,
    metadata: { changed },
  }).catch(() => {});
  log.info(`[update-agent] ${slug} updated by ${userId} fields=${changed.join(",")}`);

  return { ok: true, message: `Agent "${slug}" updated — changed ${changed.join(", ")}.`, ...(note ? { note } : {}) };
}

// ── Subagents ────────────────────────────────────────────────────────────────

async function createSubagent(params: Record<string, unknown>, userId: string): Promise<ApplyResult> {
  const name = kebab(str(params["name"]));
  const description = str(params["description"]);
  const systemPrompt = str(params["systemPrompt"]);
  const paramDescription = str(params["paramDescription"]);
  const paramName = kebab(str(params["paramName"])) || "question";

  if (!name || !isValidKebab(name)) {
    return { ok: false, error: `Invalid subagent name "${name}" — use lowercase letters, digits and single hyphens.` };
  }
  if (!description || !systemPrompt || !paramDescription) {
    return { ok: false, error: "Subagent description, system prompt and parameter description are all required." };
  }

  const orgId = await orgOf(userId);
  if (!orgId) return { ok: false, error: "Could not resolve your organization to create the subagent." };

  if (await subagentDefinitionRepository.findByName(name, orgId)) {
    return { ok: false, error: `A subagent named "${name}" already exists — nothing was created.` };
  }

  const resolved = await resolveTools(strList(params["tools"]), orgId, userId);
  const created = await subagentDefinitionRepository.create({
    name,
    description,
    systemPrompt,
    paramName,
    paramDescription,
    progressLabels: strList(params["progressLabels"]),
    tools: toConfigTools(resolved),
    createdByUserId: userId,
    org: { connect: { id: orgId } },
  });

  await writeAuditLog({
    actorUserId: userId,
    eventType: "SUBAGENT_CREATED",
    targetId: created.id,
    description: `agent-authored subagent "${name}" approved from a create-subagent card`,
    metadata: { subagents: resolved.subagents, custom: resolved.custom },
  }).catch(() => {});
  log.info(`[create-subagent] created ${name} (id=${created.id}) owner=${userId} org=${orgId}`);

  const note = unknownToolsNote(resolved.unknown);
  return { ok: true, message: `Subagent "${name}" created.`, ...(note ? { note } : {}) };
}

async function updateSubagent(params: Record<string, unknown>, userId: string): Promise<ApplyResult> {
  const name = kebab(str(params["name"]));
  if (!name) return { ok: false, error: "The subagent's name is required." };

  const orgId = await orgOf(userId);
  if (!orgId) return { ok: false, error: "Could not resolve your organization." };

  const existing = await subagentDefinitionRepository.findByName(name, orgId);
  if (!existing) return { ok: false, error: `No subagent "${name}" in your workspace.` };

  // Mirrors canEditSubagent in routes/subagents.ts: creator, EDITOR share, admin.
  const share = await subagentShareRepository.findBySubagentAndUser(existing.id, userId);
  const mayEdit =
    existing.createdByUserId === userId || share?.role === "EDITOR" || (await isClawAdmin(userId));
  if (!mayEdit) {
    return { ok: false, error: `You don't have permission to change the subagent "${name}".` };
  }

  const data: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const field of ["description", "paramName", "paramDescription"] as const) {
    const value = str(params[field]);
    if (value) {
      data[field] = field === "paramName" ? kebab(value) : value;
      changed.push(field);
    }
  }

  // Same prompt-change contract as update-agent (see resolvePromptChange).
  const promptChange = resolvePromptChange(params, existing.systemPrompt ?? "");
  if (promptChange.error) return { ok: false, error: promptChange.error };
  if (promptChange.prompt !== undefined) {
    data["systemPrompt"] = promptChange.prompt;
    changed.push("systemPrompt");
  }
  if (typeof params["enabled"] === "boolean") {
    data["enabled"] = params["enabled"];
    changed.push("enabled");
  }

  let note: string | undefined;
  if (params["tools"] !== undefined) {
    const resolved = await resolveTools(strList(params["tools"]), orgId, userId);
    data["tools"] = toConfigTools(resolved);
    changed.push("tools");
    note = unknownToolsNote(resolved.unknown);
  }

  if (changed.length === 0) {
    return { ok: false, error: "Nothing to change — no fields were supplied." };
  }

  await subagentDefinitionRepository.update(name, orgId, data);
  await writeAuditLog({
    actorUserId: userId,
    eventType: "SUBAGENT_UPDATED",
    targetId: existing.id,
    description: `subagent "${name}" updated from an update-subagent card (${changed.join(", ")})`,
    metadata: { changed },
  }).catch(() => {});
  log.info(`[update-subagent] ${name} updated by ${userId} fields=${changed.join(",")}`);

  return { ok: true, message: `Subagent "${name}" updated — changed ${changed.join(", ")}.`, ...(note ? { note } : {}) };
}

// ── MCP servers ──────────────────────────────────────────────────────────────

/**
 * Register an agent-proposed MCP server.
 *
 * No credentials are written here and none can be: `validateMcpProposal`
 * rejects the proposal outright if it carries anything secret-shaped, and the
 * McpServer row we create holds only the endpoint plus the NAMES of the headers
 * the user will fill. Connecting (i.e. supplying values, which are encrypted
 * per-user/per-agent in UserMcpConnection / AgentMcpConnection) stays a
 * browser → claw-auth action the user performs themselves.
 */
async function createMcp(params: Record<string, unknown>, userId: string): Promise<ApplyResult> {
  const { validateMcpProposal } = await import("xyne-claw-shared");
  const verdict = validateMcpProposal(params);
  if (!verdict.ok || !verdict.config) {
    return { ok: false, error: verdict.error ?? "This MCP server proposal was rejected." };
  }
  const cfg = verdict.config;

  // `type` is the connector key used everywhere else (tool prefixes, connection
  // lookups), so it has to be slug-shaped and unique.
  const type = kebab(cfg.name);
  if (!type || !isValidKebab(type)) {
    return { ok: false, error: `Could not derive a valid server identifier from "${cfg.name}".` };
  }
  const existing = await prisma.mcpServer.findFirst({ where: { type } });
  if (existing) {
    return { ok: false, error: `An MCP server "${type}" is already registered — nothing was created.` };
  }

  // Header names become the credential form the user fills in the dashboard.
  const credentialForm = cfg.headerNames.map((header) => ({
    key: header,
    label: header,
    type: "password" as const,
    required: true,
  }));

  const created = await prisma.mcpServer.create({
    data: {
      name: cfg.name,
      type,
      url: cfg.url,
      transport: "http",
      ...(cfg.description ? { description: cfg.description } : {}),
      enabled: true,
      ...(credentialForm.length > 0
        ? {
            credentialForm,
            credentialSchema: {
              type: "object",
              properties: Object.fromEntries(cfg.headerNames.map((h) => [h, { type: "string" }])),
              required: cfg.headerNames,
            },
          }
        : {}),
      httpConfigTemplate: {
        url: cfg.url,
        headers: Object.fromEntries(cfg.headerNames.map((h) => [h, `{{${h}}}`])),
      },
    },
  });

  await writeAuditLog({
    actorUserId: userId,
    eventType: "MCP_SERVER_CREATED",
    targetId: created.id,
    description: `agent-proposed MCP server "${cfg.name}" (${type}) approved from a create-mcp card`,
    metadata: { url: cfg.url, headerNames: cfg.headerNames },
  }).catch(() => {});
  log.info(`[create-mcp] registered ${type} url=${cfg.url} by=${userId} headers=${cfg.headerNames.length}`);

  const note =
    cfg.headerNames.length > 0
      ? `Add your credentials for ${cfg.headerNames.join(", ")} in Connections — the agent was never given them.`
      : undefined;
  return { ok: true, message: `MCP server "${cfg.name}" registered.`, ...(note ? { note } : {}) };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Apply an approved agent-authoring action. `userId` is the approver, already
 * verified by flow-action to be the signer of the pending action.
 */
export async function applyAgentToolAction(
  tool: string,
  params: Record<string, unknown>,
  userId: string,
): Promise<ApplyResult> {
  try {
    switch (tool) {
      case "create-agent":
        return await createAgent(params, userId);
      case "update-agent":
        return await updateAgent(params, userId);
      case "create-subagent":
        return await createSubagent(params, userId);
      case "update-subagent":
        return await updateSubagent(params, userId);
      case "create-mcp":
        return await createMcp(params, userId);
      default:
        return { ok: false, error: `Unknown agent-authoring tool: ${tool}` };
    }
  } catch (err) {
    const msg = errMsg(err);
    log.error(`[apply] ${tool} failed for user=${userId}: ${msg}`);
    return { ok: false, error: `Couldn't apply ${tool} just now — please try approving again.` };
  }
}
