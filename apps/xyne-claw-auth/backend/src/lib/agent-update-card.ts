import { agentIdentity, buildAgentUpdateApprovalFlow, type AgentChange, type FlowDefinition } from "xyne-claw-shared";
import { agentRepository } from "../repositories/index.js";
import { buildAvailableToolsCatalog } from "../routes/tools.js";
import {
  listCallableAgentOptions,
  resolveAgentCapabilities,
  toConfigTools,
  toolIdsFromConfig,
  unknownToolsNote,
} from "./agent-card.js";
import { resolvePromptChange } from "./prompt-edits.js";
import type { WriteCardAction } from "./write-card-render.js";

export const UPDATE_AGENT_TOOL = "update-agent";

export interface AgentUpdateRow {
  name: string;
  slug: string;
  description?: string | null;
  systemPrompt?: string | null;
  modelId?: string | null;
  color?: string | null;
  scope?: string | null;
}

export interface AgentToolLabel {
  id: string;
  label: string;
}

export interface AgentToolsChange {
  before: AgentToolLabel[];
  after: AgentToolLabel[];
  unknown: string[];
}

export interface AgentUpdateDescription {
  changes: AgentChange[];
  note?: string;
}

const SCALAR_FIELDS = [
  { field: "name", label: "Name" },
  { field: "description", label: "Description" },
  { field: "modelId", label: "Model" },
  { field: "color", label: "Colour" },
] as const;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
    : [];

function toolsChange(tools: AgentToolsChange): AgentChange | null {
  const beforeIds = new Set(tools.before.map((t) => t.id));
  const afterIds = new Set(tools.after.map((t) => t.id));
  const added = tools.after.filter((t) => !beforeIds.has(t.id)).map((t) => t.label);
  const removed = tools.before.filter((t) => !afterIds.has(t.id)).map((t) => t.label);
  if (added.length === 0 && removed.length === 0) return null;
  return {
    field: "tools",
    label: "Tools",
    ...(added.length > 0 ? { added } : {}),
    ...(removed.length > 0 ? { removed } : {}),
  };
}

export function describeAgentUpdate(
  row: AgentUpdateRow,
  params: Record<string, unknown>,
  tools?: AgentToolsChange,
): AgentUpdateDescription {
  const changes: AgentChange[] = [];
  const notes: string[] = [];

  for (const { field, label } of SCALAR_FIELDS) {
    const after = text(params[field]);
    const before = text(row[field]);
    if (!after || after === before) continue;
    changes.push({ field, label, ...(before ? { before } : {}), after });
  }

  const currentPrompt = row.systemPrompt ?? "";
  const prompt = resolvePromptChange(params, currentPrompt);
  if (prompt.error) {
    notes.push(`The system prompt change can't be applied: ${prompt.error}`);
  } else if (prompt.prompt !== undefined && prompt.prompt !== currentPrompt) {
    changes.push({
      field: "systemPrompt",
      label: "System prompt",
      ...(currentPrompt.trim() ? { before: currentPrompt } : {}),
      after: prompt.prompt,
    });
  }

  if (tools) {
    const change = toolsChange(tools);
    if (change) changes.push(change);
    const unknown = unknownToolsNote(tools.unknown);
    if (unknown) notes.push(unknown);
  }

  return { changes, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
}

async function resolveToolsChange(
  config: unknown,
  requested: string[],
  orgId: string,
  userId: string,
  slug: string,
): Promise<AgentToolsChange> {
  const catalog = await buildAvailableToolsCatalog(undefined, orgId);
  const beforeIds = toolIdsFromConfig(config);
  const current = await resolveAgentCapabilities(
    beforeIds,
    catalog,
    userId,
    await listCallableAgentOptions(orgId, userId, slug),
  );
  const proposed = await resolveAgentCapabilities(requested, catalog, userId);
  const labels = new Map([...current.capabilities, ...proposed.capabilities].map((c) => [c.id, c.label]));
  const label = (id: string): AgentToolLabel => ({ id, label: labels.get(id) ?? id });
  return {
    before: beforeIds.map(label),
    after: toolIdsFromConfig({ tools: toConfigTools(proposed) }).map(label),
    unknown: proposed.unknown,
  };
}

export async function buildAgentUpdateCardFlow(
  action: WriteCardAction,
  orgId: string,
): Promise<FlowDefinition | null> {
  if (action.tool !== UPDATE_AGENT_TOOL) return null;
  const slug = text(action.params["slug"]);
  if (!slug) return null;
  const row = await agentRepository.findBySlug(slug, orgId);
  if (!row) return null;

  const tools =
    action.params["tools"] !== undefined
      ? await resolveToolsChange(row.config, stringList(action.params["tools"]), orgId, action.userId, row.slug)
      : undefined;
  const { changes, note } = describeAgentUpdate(row, action.params, tools);
  if (changes.length === 0) return null;

  const summary = text(action.params["summary"]);
  return buildAgentUpdateApprovalFlow(
    {
      agent: agentIdentity({
        name: row.name,
        slug: row.slug,
        description: row.description ?? null,
        scope: row.scope ?? null,
      }),
      changes,
      ...(summary ? { summary } : {}),
      ...(note ? { note } : {}),
    },
    action,
  );
}
