import type { AppPrismaClient } from "../db.js";
import { SDLC_AGENT_PROMPT, SDLC_AGENT_SLUG, sdlcAgentToolProfile } from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../mcp/servers/xyne-spaces-tools.js";
import { agentRepository } from "../repositories/agentRepository.js";

export interface SdlcAgentDesiredState {
  name: string;
  description: string;
  systemPrompt: string;
  scope: string;
  color: string;
  config: {
    requireSdlcRepository: boolean;
    tools: { subagents: string[]; direct: string[]; custom: string[] };
    toolPermissions: Record<string, "allow" | "ask">;
  };
  agentToolAllows: string[];
}

export function sdlcAgentDesiredState(): SdlcAgentDesiredState {
  const profile = sdlcAgentToolProfile(xyneSpacesTools.map((tool) => tool.name));
  return {
    name: "SDLC Assistant",
    description: "Repository-grounded baselines, PRDs, Tech Docs, and implementation workflows.",
    systemPrompt: SDLC_AGENT_PROMPT,
    scope: "global",
    color: "#2563eb",
    config: {
      requireSdlcRepository: true,
      tools: {
        subagents: [...profile.tools.subagents],
        direct: [...profile.tools.direct],
        custom: [...profile.tools.custom],
      },
      toolPermissions: profile.toolPermissions,
    },
    agentToolAllows: [...profile.agentToolAllows],
  };
}

export interface SdlcAgentChange {
  field: string;
  affectsRuns: boolean;
  detail: string;
}

interface ExistingAgentRow {
  name: string | null;
  description: string | null;
  systemPrompt: string | null;
  scope: string | null;
  color: string | null;
  config: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstDifferingLine(from: string, to: string): string {
  const fromLines = from.split("\n");
  const toLines = to.split("\n");
  for (let i = 0; i < Math.max(fromLines.length, toLines.length); i += 1) {
    if (fromLines[i] !== toLines[i]) {
      return `first change at line ${i + 1}: "${(toLines[i] ?? "(removed)").slice(0, 120)}"`;
    }
  }
  return "trailing whitespace only";
}

function sameStringSet(a: unknown, b: readonly string[]): boolean {
  if (!Array.isArray(a)) return false;
  const left = [...a].map(String).sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

export function diffSdlcAgent(
  existing: ExistingAgentRow,
  desired: SdlcAgentDesiredState = sdlcAgentDesiredState(),
): SdlcAgentChange[] {
  const changes: SdlcAgentChange[] = [];
  const config = record(existing.config);
  const tools = record(config["tools"]);
  const permissions = record(config["toolPermissions"]);

  if ((existing.systemPrompt ?? "") !== desired.systemPrompt) {
    changes.push({
      field: "systemPrompt",
      affectsRuns: true,
      detail: `${(existing.systemPrompt ?? "").length} -> ${desired.systemPrompt.length} chars; ${firstDifferingLine(existing.systemPrompt ?? "", desired.systemPrompt)}`,
    });
  }

  if (config["requireSdlcRepository"] !== desired.config.requireSdlcRepository) {
    changes.push({
      field: "config.requireSdlcRepository",
      affectsRuns: true,
      detail: `${String(config["requireSdlcRepository"])} -> ${String(desired.config.requireSdlcRepository)}`,
    });
  }

  for (const key of ["direct", "custom", "subagents"] as const) {
    if (!sameStringSet(tools[key], desired.config.tools[key])) {
      const before = Array.isArray(tools[key]) ? (tools[key] as unknown[]).length : "unset";
      changes.push({
        field: `config.tools.${key}`,
        affectsRuns: false,
        detail: `${before} -> ${desired.config.tools[key].length} tools`,
      });
    }
  }

  const changedPermissions = Object.entries(desired.config.toolPermissions).filter(
    ([tool, permission]) => permissions[tool] !== permission,
  );
  if (changedPermissions.length > 0) {
    changes.push({
      field: "config.toolPermissions",
      affectsRuns: false,
      detail: `${changedPermissions.length} entr${changedPermissions.length === 1 ? "y" : "ies"} differ: ${changedPermissions.map(([tool]) => tool).slice(0, 5).join(", ")}`,
    });
  }

  for (const key of ["name", "description", "scope", "color"] as const) {
    if ((existing[key] ?? "") !== desired[key]) {
      changes.push({
        field: key,
        affectsRuns: false,
        detail: `${JSON.stringify(existing[key])} -> ${JSON.stringify(desired[key])}`,
      });
    }
  }

  return changes;
}

export interface SdlcAgentSyncRow {
  orgId: string;
  agentId: string;
  changes: SdlcAgentChange[];
  applied: boolean;
}

export async function syncSdlcAgent(
  prisma: AppPrismaClient,
  options: { orgId?: string; apply: boolean; requesterId?: string },
): Promise<SdlcAgentSyncRow[]> {
  const desired = sdlcAgentDesiredState();
  const agents = await prisma.agent.findMany({
    where: { slug: SDLC_AGENT_SLUG, ...(options.orgId ? { orgId: options.orgId } : {}) },
    select: {
      id: true,
      orgId: true,
      name: true,
      description: true,
      systemPrompt: true,
      scope: true,
      color: true,
      config: true,
    },
  });

  const rows: SdlcAgentSyncRow[] = [];
  for (const agent of agents) {
    const changes = diffSdlcAgent(agent, desired);
    if (!options.apply || changes.length === 0) {
      rows.push({ orgId: agent.orgId, agentId: agent.id, changes, applied: false });
      continue;
    }

    if (changes.some((change) => change.field === "systemPrompt")) {
      await agentRepository.createAndActivatePromptVersion({
        agentId: agent.id,
        systemPrompt: desired.systemPrompt,
        note: "code sync: sdlc-agent prompt from xyne-claw-shared",
        createdByUserId: options.requesterId ?? null,
      });
    }

    const existingConfig = record(agent.config);
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        name: desired.name,
        description: desired.description,
        scope: desired.scope,
        color: desired.color,
        config: {
          ...existingConfig,
          requireSdlcRepository: desired.config.requireSdlcRepository,
          tools: { ...record(existingConfig["tools"]), ...desired.config.tools },
          toolPermissions: {
            ...record(existingConfig["toolPermissions"]),
            ...desired.config.toolPermissions,
          },
        },
      },
    });

    for (const slug of desired.agentToolAllows) {
      const tool = await prisma.tool.findUnique({ where: { slug }, select: { id: true } });
      if (!tool) continue;
      await prisma.agentTool.upsert({
        where: { agentId_toolId: { agentId: agent.id, toolId: tool.id } },
        create: { agentId: agent.id, toolId: tool.id, permission: "allow" },
        update: { permission: "allow" },
      });
    }

    rows.push({ orgId: agent.orgId, agentId: agent.id, changes, applied: true });
  }

  return rows;
}
