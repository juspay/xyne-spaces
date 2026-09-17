/**
 * Agent-card server helpers — the ONE place that turns identifiers into the
 * `agent` artifact's identity block, shared by every surface that renders it.
 *
 *   draft   (webhook /result, flow-action decisions) → identityFromDraftSpec
 *   profile (a live agent described back to the user) → identityFromAgentRow
 *
 * Both funnel through xyne-claw-shared's `agentIdentity()` normalizer, so the
 * two surfaces cannot drift: the card a user approves and the card that later
 * describes the created agent are built from the same shape.
 *
 * Capability resolution is deliberately CONSERVATIVE. A token is accepted only
 * as an exact match on a catalog subagent name, custom tool slug, MCP tool
 * selection key, or gateway integration slug. Near-misses are reported on the
 * card instead of being silently guessed into the wrong bucket.
 */

import {
  agentIdentity,
  type AgentCapability,
  type AgentIdentity,
  type AgentKnowledge,
  type AgentSkill,
} from "xyne-claw-shared";
import { errMsg } from "./errors.js";
import type { AvailableToolsCatalog, Integration, IntegrationToolEntry } from "../routes/tools.js";
import { agentRepository, agentRequestRepository, skillRepository } from "../repositories/index.js";
import { availableServerTypesSafe } from "./connector-availability.js";
import { writeAuditLog } from "./audit.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { normalizeProviderOrder } from "./provider-hints.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-card");

const trimToken = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Slug rule enforced everywhere an agent slug is accepted (tool → card → create). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidAgentSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 80 && SLUG_RE.test(slug);
}

/**
 * Is this serverType a real MCP connector — something a user can hold a
 * connection to and that ships a brand asset?
 *
 * A subagent's `serverType` is not always one: the artifacts subagent reports
 * "custom:create-ppt", a custom-tool source. Those have no icon file and no
 * possible row in user_mcp_connections, so both the icon key and the
 * needs-connecting hint must skip them.
 */
export function isConnectorServerType(serverType: string | undefined): serverType is string {
  return typeof serverType === "string" && serverType.length > 0 && !serverType.includes(":");
}

export interface ResolvedCapabilities {
  /** Card-facing capability chips, in catalog order (subagents first). */
  capabilities: AgentCapability[];
  /** config.tools.subagents — matched subagent names. */
  subagents: string[];
  /** config.tools.direct — matched MCP tool selection keys. */
  direct: string[];
  /** config.tools.gateway — matched gateway service/source selection keys. */
  gateway: string[];
  /** config.tools.custom — matched custom tool slugs. */
  custom: string[];
  /** config.tools.callableAgents — matched agent slugs this agent may call. */
  callableAgents: string[];
  /** Tokens that matched nothing. Reported on the card, never persisted. */
  unknown: string[];
}

/**
 * Resolve requested tool identifiers against the org catalog.
 *
 * `connectedFor` (optional) is the user whose connections decide the
 * "needs connecting" hint on a capability — pass the person who will approve
 * the card, since it is their account the created agent runs against.
 */
export interface CallableAgentOption {
  slug: string;
  name: string;
  description?: string | null;
}

export async function resolveAgentCapabilities(
  requested: string[],
  catalog: AvailableToolsCatalog,
  connectedFor?: string,
  callableAgentOptions: CallableAgentOption[] = [],
): Promise<ResolvedCapabilities> {
  const agentBySlug = new Map(callableAgentOptions.map((a) => [a.slug, a]));
  const subagentByName = new Map(catalog.subagents.map((s) => [s.name, s]));
  const customBySlug = new Map(
    catalog.customGroups.flatMap((g) => g.tools.map((t) => [t.slug, t] as const)),
  );
  const directBySlug = new Map<string, { integration: Integration; tool: IntegrationToolEntry }>();
  for (const integration of catalog.integrations) {
    for (const tool of [...integration.readTools, ...integration.writeTools]) {
      if (!directBySlug.has(tool.slug)) directBySlug.set(tool.slug, { integration, tool });
      if (tool.name && !directBySlug.has(tool.name)) directBySlug.set(tool.name, { integration, tool });
    }
  }
  const gatewayBySlug = new Map(
    catalog.integrations
      .filter((integration) => integration.kind === "gateway")
      .map((integration) => [integration.slug, integration] as const),
  );

  const parentOf = (slug: string): { parentId: string; parentLabel: string } | undefined => {
    const integration = directBySlug.get(slug)?.integration;
    if (!integration) return undefined;
    return { parentId: integration.slug, parentLabel: integration.label };
  };

  const subagents: string[] = [];
  const direct: string[] = [];
  const gateway: string[] = [];
  const custom: string[] = [];
  const callableAgents: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const raw of requested) {
    const token = trimToken(raw);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    if (subagentByName.has(token)) subagents.push(token);
    else if (customBySlug.has(token)) custom.push(token);
    else if (directBySlug.has(token)) direct.push(token);
    else if (gatewayBySlug.has(token)) gateway.push(token);
    else if (agentBySlug.has(token)) callableAgents.push(token);
    else unknown.push(token);
  }

  // Which serverTypes does the approver still need to connect? Only asked when
  // a matched subagent actually depends on one — this is a display hint, so a
  // lookup failure degrades to "no hint" rather than failing the card.
  //
  // `custom:*` serverTypes (e.g. the artifacts subagent's "custom:create-ppt")
  // are custom-tool sources, not MCP connectors: they can never match a
  // user_mcp_connections row, so treating them as connectable flagged EVERY such
  // chip as unconnected forever. They have no brand asset either — see
  // isConnectorServerType at the icon assignment below.
  const wantedServerTypes = subagents
    .map((name) => subagentByName.get(name)?.serverType)
    .filter((t): t is string => isConnectorServerType(t));
  const unconnected = new Set<string>(wantedServerTypes);
  if (connectedFor && unconnected.size > 0) {
    const available = await availableServerTypesSafe(connectedFor, [...unconnected]);
    if (available === null) unconnected.clear();
    else for (const type of available) unconnected.delete(type);
  } else {
    unconnected.clear();
  }

  const capabilities: AgentCapability[] = [
    ...subagents.map((name) => {
      const def = subagentByName.get(name);
      const serverType = def?.serverType;
      return {
        id: name,
        label: name,
        kind: "subagent" as const,
        group: "subagent" as const,
        ...(def?.description ? { description: def.description } : {}),
        // The brand icon is keyed by serverType, which is NOT always the
        // subagent name ("spaces" is served by "xyne-spaces") — resolve it here
        // so the renderer never guesses an asset filename. Non-connector types
        // have no asset, so omitting the key lets the chip render label-only
        // rather than falling through two 404s to a meaningless monogram.
        ...(isConnectorServerType(serverType) ? { iconKey: serverType } : {}),
        ...(isConnectorServerType(serverType) && unconnected.has(serverType)
          ? { requiresConnection: serverType }
          : {}),
      };
    }),
    ...direct.map((slug) => {
      const match = directBySlug.get(slug);
      return {
        id: slug,
        label: match?.tool.name ?? slug,
        kind: "tool" as const,
        group: "mcp" as const,
        ...(match?.tool.description ? { description: match.tool.description } : {}),
        ...(match?.integration.slug ? { iconKey: match.integration.slug } : {}),
        ...(parentOf(slug) ?? {}),
      };
    }),
    ...gateway.map((slug) => ({
      id: slug,
      label: gatewayBySlug.get(slug)?.label ?? slug,
      kind: "tool" as const,
      group: "mcp" as const,
    })),
    ...custom.map((slug) => ({
      id: slug,
      label: customBySlug.get(slug)?.name ?? slug,
      kind: "tool" as const,
      group: "builtin" as const,
      ...(parentOf(slug) ?? {}),
    })),
    ...callableAgents.map((slug) => {
      const agent = agentBySlug.get(slug);
      return {
        id: slug,
        label: agent?.name ?? slug,
        kind: "tool" as const,
        group: "agent" as const,
        ...(agent?.description ? { description: agent.description } : {}),
      };
    }),
  ];

  return { capabilities, subagents, direct, gateway, custom, callableAgents, unknown };
}

/**
 * Flatten a persisted agent's `config.tools` back into the flat identifier list
 * `resolveAgentCapabilities` takes. Only the two buckets the resolver owns are
 * read; gateway/direct selections are a different addressing scheme and are not
 * capabilities in this card's sense.
 */
export function toolIdsFromConfig(config: unknown): string[] {
  const record = (config ?? {}) as Record<string, unknown>;
  const tools = (record["tools"] ?? {}) as Record<string, unknown>;
  const read = (key: string): string[] =>
    Array.isArray(tools[key])
      ? (tools[key] as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
  return [
    ...read("subagents"),
    ...read("direct"),
    ...read("gateway"),
    ...read("custom"),
    ...read("callableAgents"),
  ];
}

/** The `config.tools` object, omitting empty buckets so a tool-less agent gets `{}`. */
export function toConfigTools(
  resolved: Pick<
    ResolvedCapabilities,
    "subagents" | "direct" | "gateway" | "custom" | "callableAgents"
  >,
): {
  subagents?: string[];
  direct?: string[];
  gateway?: string[];
  custom?: string[];
  callableAgents?: string[];
} {
  return {
    ...(resolved.subagents.length > 0 ? { subagents: resolved.subagents } : {}),
    ...(resolved.direct.length > 0 ? { direct: resolved.direct } : {}),
    ...(resolved.gateway.length > 0 ? { gateway: resolved.gateway } : {}),
    ...(resolved.custom.length > 0 ? { custom: resolved.custom } : {}),
    ...(resolved.callableAgents.length > 0 ? { callableAgents: resolved.callableAgents } : {}),
  };
}

export interface ExpandedMcpRequests {
  tokens: string[];
  unknown: string[];
}

export function expandMcpRequests(
  mcps: string[] | undefined,
  catalog: AvailableToolsCatalog,
): ExpandedMcpRequests {
  const requested = (mcps ?? []).map(trimToken).filter(Boolean);
  if (requested.length === 0) return { tokens: [], unknown: [] };

  const byKey = new Map<string, Integration>();
  for (const integration of catalog.integrations) {
    if (integration.kind !== "mcp" && integration.kind !== "gateway") continue;
    byKey.set(integration.slug.toLowerCase(), integration);
    byKey.set(integration.label.toLowerCase(), integration);
  }

  const tokens: string[] = [];
  const unknown: string[] = [];
  const seenIntegration = new Set<string>();
  for (const token of requested) {
    const integration = byKey.get(token.toLowerCase());
    if (!integration) {
      if (!unknown.includes(token)) unknown.push(token);
      continue;
    }
    if (seenIntegration.has(integration.slug)) continue;
    seenIntegration.add(integration.slug);
    if (integration.kind === "gateway") {
      tokens.push(integration.slug);
      continue;
    }
    for (const tool of [...integration.readTools, ...integration.writeTools]) {
      tokens.push(tool.name || tool.slug);
    }
  }
  return { tokens, unknown };
}

export function draftToolTokens(spec: DraftAgentSpec, catalog: AvailableToolsCatalog): string[] {
  return [...spec.tools, ...expandMcpRequests(spec.mcps, catalog).tokens];
}

/** Muted card footnote naming what could not be granted. */
export function unknownToolsNote(unknown: string[]): string | undefined {
  if (unknown.length === 0) return undefined;
  const shown = unknown.slice(0, 6).join(", ");
  const more = unknown.length > 6 ? ` (+${unknown.length - 6} more)` : "";
  return `Not granted — no such tool in this workspace: ${shown}${more}. Add them from the agent's settings.`;
}

export function unknownMcpsNote(unknown: string[]): string | undefined {
  if (unknown.length === 0) return undefined;
  const shown = unknown.slice(0, 6).join(", ");
  const verb = unknown.length === 1 ? "is not an MCP" : "are not MCPs";
  return `${shown} ${verb} in this workspace, so nothing was added for it.`;
}

/** Card footnote for providers Xyne does not offer, so the card never implies one was set. */
export function unknownProvidersNote(unknown: string[]): string | undefined {
  if (unknown.length === 0) return undefined;
  const shown = unknown.join(", ");
  const verb = unknown.length === 1 ? "is not an AI provider" : "are not AI providers";
  return `${shown} ${verb} Xyne offers — the agent uses the workspace default instead.`;
}

/** Join the card's footnotes, dropping the ones that have nothing to say. */
export function draftNote(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(" ") : undefined;
}

/** The draft spec the pod ships on `pendingAgentCard`. */
export interface DraftAgentSpec {
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  modelId?: string;
  color?: string;
  tools: string[];
  mcps?: string[];
  skills?: string[];
  knowledge?: { scope?: "COLLECTIONS" | "USER"; collections?: string[] };
  providerOrder?: string[];
  memory?: { enabled: boolean; requiresApproval?: boolean };
  scope?: "personal" | "global";
  /** The agent's own line for the thread, posted next to the card. Chat text
   *  only — deliberately NOT part of the identity, so it never renders on a
   *  re-drawn card after the decision. */
  summary?: string;
}

/**
 * Identity for a DRAFTED (not yet persisted) agent.
 *
 * `builtBy` credits the agent that authored the draft — the card says "Built by
 * @<slug>" so a user reading it later knows the agent didn't come from a human.
 */
export interface ResolvedDraftExtras {
  skills?: AgentSkill[];
  knowledgeSources?: AgentKnowledge["sources"];
  unknownSkills?: string[];
  /** providerOrder mapped onto supported keys ("anthropic" → "claude"). */
  providerOrder?: string[];
  /** Named providers Xyne does not offer — reported, never persisted. */
  unknownProviders?: string[];
}

export async function resolveDraftExtras(
  spec: DraftAgentSpec,
  orgId: string | null,
  requesterId?: string,
): Promise<ResolvedDraftExtras> {
  const extras: ResolvedDraftExtras = {};

  const requestedSkills = (spec.skills ?? []).map(trimToken).filter(Boolean);
  if (requestedSkills.length > 0) {
    const rows = await skillRepository
      .listVisible({
        ...(requesterId ? { userId: requesterId } : {}),
        ...(orgId ? { orgId } : {}),
      })
      .catch(() => []);
    const byKey = new Map<string, { id: string; name: string; description: string }>();
    for (const row of rows) {
      byKey.set(row.name.toLowerCase(), row);
      byKey.set(row.slug.toLowerCase(), row);
    }
    const matched: AgentSkill[] = [];
    const unknown: string[] = [];
    const seen = new Set<string>();
    for (const token of requestedSkills) {
      const hit = byKey.get(token.toLowerCase());
      if (!hit) {
        unknown.push(token);
        continue;
      }
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      matched.push({
        id: hit.id,
        name: hit.name,
        ...(hit.description ? { description: hit.description } : {}),
      });
    }
    if (matched.length > 0) extras.skills = matched;
    if (unknown.length > 0) extras.unknownSkills = unknown;
  }

  const rawProviders = spec.providerOrder ?? [];
  if (rawProviders.length > 0) {
    const { providers, unknown } = normalizeProviderOrder(rawProviders);
    if (providers.length > 0) extras.providerOrder = providers;
    if (unknown.length > 0) extras.unknownProviders = unknown;
  }

  const collections = (spec.knowledge?.collections ?? []).map(trimToken).filter(Boolean);
  if (collections.length > 0) {
    const seen = new Set<string>();
    const sources = collections
      .filter((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((name) => ({ id: name, name, kind: "collection" as const }));
    if (sources.length > 0) extras.knowledgeSources = sources;
  }

  return extras;
}

export function identityFromDraftSpec(
  spec: DraftAgentSpec,
  resolved: ResolvedCapabilities,
  builtBy?: string,
  extras?: ResolvedDraftExtras,
): AgentIdentity {
  const knowledge: AgentKnowledge = {
    ...(spec.knowledge?.scope ? { scope: spec.knowledge.scope } : {}),
    ...(extras?.knowledgeSources && extras.knowledgeSources.length > 0
      ? { sources: extras.knowledgeSources }
      : {}),
  };

  return agentIdentity({
    name: spec.name,
    slug: spec.slug,
    ...(builtBy ? { builtBy } : {}),
    description: spec.description,
    systemPrompt: spec.systemPrompt,
    ...(spec.modelId ? { modelId: spec.modelId } : {}),
    ...(spec.color ? { color: spec.color } : {}),
    ...(spec.scope ? { scope: spec.scope } : {}),
    ...(extras?.providerOrder && extras.providerOrder.length > 0
      ? { providerOrder: extras.providerOrder }
      : {}),
    ...(spec.memory ? { memory: spec.memory } : {}),
    ...(extras?.skills && extras.skills.length > 0 ? { skills: extras.skills } : {}),
    ...(Object.keys(knowledge).length > 0 ? { knowledge } : {}),
    capabilities: resolved.capabilities,
    // No Identifier/Model rows: the card renders slug + model in its header line,
    // and repeating them here showed the same two facts twice. `details` stays as
    // the extension point for rows that have nowhere else to go.
  });
}

/** Structural view of the agent row the profile surface renders. */
export interface AgentRowLike {
  name: string;
  slug: string;
  description?: string | null;
  systemPrompt: string;
  modelId?: string | null;
  color?: string | null;
  scope?: string | null;
}

/**
 * Identity for a LIVE agent, read from its row.
 *
 * Authority note: a profile card is built from the DB, never from text an agent
 * supplied — an agent must not be able to narrate capabilities it does not have
 * onto an official-looking card. The caller passes the row; the agent only ever
 * names which one.
 */
export function identityFromAgentRow(
  row: AgentRowLike,
  resolved: ResolvedCapabilities,
  builtBy?: string,
  owner?: { name?: string | null; id?: string | null },
): AgentIdentity {
  return agentIdentity({
    name: row.name,
    slug: row.slug,
    ...(builtBy ? { builtBy } : {}),
    ...(owner?.name ? { ownedBy: owner.name } : {}),
    ...(owner?.id ? { ownedById: owner.id } : {}),
    ...(row.scope ? { scope: row.scope } : {}),
    description: row.description ?? "",
    systemPrompt: row.systemPrompt,
    ...(row.modelId ? { modelId: row.modelId } : {}),
    ...(row.color ? { color: row.color } : {}),
    capabilities: resolved.capabilities,
    // Same as the draft path — slug + model live in the card header.
  });
}

// ── Decision path ────────────────────────────────────────────────────────────

export type AgentDraftResolution =
  | {
      ok: true;
      status: "approved" | "rejected";
      /** Re-rendered identity for the decided card (approved = what was granted). */
      identity: AgentIdentity;
      toolSelection: ReturnType<typeof toConfigTools>;
      note?: string;
      /** True when someone/something already decided this draft (replay, race). */
      alreadyResolved: boolean;
    }
  | { ok: false; code: 400 | 403 | 404 | 409 | 500; error: string };

export interface AgentDraftEdits {
  toolSelection?: {
    subagents?: string[];
    direct?: string[];
    gateway?: string[];
    custom?: string[];
    callableAgents?: string[];
  };
  /** "" clears the pin back to the workspace default. */
  modelId?: string;
  providerOrder?: string[];
}

const MAX_MODEL_ID = 120;
const MAX_EDITED_TOOLS = 120;

const stringArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : [];

export function parseAgentDraftEdits(raw: unknown): AgentDraftEdits | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const edits: AgentDraftEdits = {};

  const rawSelection = record["toolSelection"];
  if (rawSelection && typeof rawSelection === "object" && !Array.isArray(rawSelection)) {
    const selection = rawSelection as Record<string, unknown>;
    const bucket = (key: string): string[] => stringArray(selection[key]).slice(0, MAX_EDITED_TOOLS);
    edits.toolSelection = {
      subagents: bucket("subagents"),
      direct: bucket("direct"),
      gateway: bucket("gateway"),
      custom: bucket("custom"),
      callableAgents: bucket("callableAgents"),
    };
  }

  if (typeof record["modelId"] === "string") {
    edits.modelId = record["modelId"].trim().slice(0, MAX_MODEL_ID);
  } else if (record["modelId"] === null) {
    edits.modelId = "";
  }

  const rawProviders = record["providerOrder"];
  if (Array.isArray(rawProviders)) edits.providerOrder = stringArray(rawProviders).slice(0, 8);

  return Object.keys(edits).length > 0 ? edits : undefined;
}

export function flattenToolSelection(selection: AgentDraftEdits["toolSelection"]): string[] {
  if (!selection) return [];
  return [
    ...(selection.subagents ?? []),
    ...(selection.direct ?? []),
    ...(selection.gateway ?? []),
    ...(selection.custom ?? []),
    ...(selection.callableAgents ?? []),
  ];
}

export function narrowToKeptCapabilities(
  requested: string[],
  keptCapabilityIds: string[] | undefined,
  shownIds: Iterable<string>,
): string[] {
  if (!keptCapabilityIds) return requested;
  const shown = new Set(shownIds);
  const kept = new Set(keptCapabilityIds);
  return requested.filter((token) => !shown.has(token) || kept.has(token));
}

export interface AppliedDraftEdits {
  requestedTools?: string[];
  modelId?: string;
  providerOrder: string[];
  unknownProviders: string[];
}

export function applyDraftEdits(
  spec: DraftAgentSpec,
  extras: ResolvedDraftExtras,
  edits?: AgentDraftEdits,
): AppliedDraftEdits {
  const applied: AppliedDraftEdits = {
    providerOrder: extras.providerOrder ?? [],
    unknownProviders: extras.unknownProviders ?? [],
    ...(spec.modelId ? { modelId: spec.modelId } : {}),
  };

  if (edits?.toolSelection) {
    const seen = new Set<string>();
    applied.requestedTools = flattenToolSelection(edits.toolSelection).filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
  }

  if (edits?.modelId !== undefined) applied.modelId = edits.modelId;

  if (edits?.providerOrder !== undefined) {
    const { providers, unknown } = normalizeProviderOrder(edits.providerOrder);
    applied.providerOrder = providers;
    applied.unknownProviders = unknown;
  }

  return applied;
}

export function parseDraftSpec(raw: string | null): DraftAgentSpec | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftAgentSpec>;
    if (!parsed || typeof parsed.name !== "string" || typeof parsed.slug !== "string") return null;
    if (typeof parsed.systemPrompt !== "string" || parsed.systemPrompt.trim().length === 0) return null;
    return {
      name: parsed.name,
      slug: parsed.slug,
      description: typeof parsed.description === "string" ? parsed.description : "",
      systemPrompt: parsed.systemPrompt,
      ...(typeof parsed.modelId === "string" ? { modelId: parsed.modelId } : {}),
      ...(typeof parsed.color === "string" ? { color: parsed.color } : {}),
      tools: Array.isArray(parsed.tools) ? parsed.tools.filter((t): t is string => typeof t === "string") : [],
      ...(Array.isArray(parsed.mcps)
        ? { mcps: parsed.mcps.filter((v): v is string => typeof v === "string") }
        : {}),
      ...(Array.isArray(parsed.skills)
        ? { skills: parsed.skills.filter((v): v is string => typeof v === "string") }
        : {}),
      ...(parsed.knowledge && typeof parsed.knowledge === "object"
        ? {
            knowledge: {
              ...(parsed.knowledge.scope === "USER" || parsed.knowledge.scope === "COLLECTIONS"
                ? { scope: parsed.knowledge.scope }
                : {}),
              ...(Array.isArray(parsed.knowledge.collections)
                ? {
                    collections: parsed.knowledge.collections.filter(
                      (v): v is string => typeof v === "string",
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(Array.isArray(parsed.providerOrder)
        ? { providerOrder: parsed.providerOrder.filter((v): v is string => typeof v === "string") }
        : {}),
      ...(parsed.memory && typeof parsed.memory.enabled === "boolean"
        ? {
            memory: {
              enabled: parsed.memory.enabled,
              ...(typeof parsed.memory.requiresApproval === "boolean"
                ? { requiresApproval: parsed.memory.requiresApproval }
                : {}),
            },
          }
        : {}),
      ...(parsed.scope === "global" || parsed.scope === "personal" ? { scope: parsed.scope } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Approve or reject a drafted agent.
 *
 * Everything authoritative is re-read here: the spec comes from the AgentRequest
 * row (never the card), the catalog is re-resolved (it may have changed since
 * the draft), and the slug is re-checked for collisions (another agent may have
 * taken it meanwhile). `keptCapabilityIds` — the user's chip selection, which
 * arrives from the browser — can only NARROW the server-resolved set, never add
 * to it.
 *
 * Concurrency: the pending→decided flip is an atomic compare-and-set, so a
 * double-click or two open tabs produce exactly one agent; the loser gets
 * `alreadyResolved`. A failure after the claim rolls the row back to pending so
 * the user can retry rather than being stuck approved-with-no-agent.
 */
export async function resolveAgentDraft(
  requestId: string,
  callerUserId: string,
  decision: "approve" | "reject",
  keptCapabilityIds?: string[],
  /** Drafting agent's slug, so the decided card keeps its "Built by" credit. */
  builtBy?: string,
  edits?: AgentDraftEdits,
): Promise<AgentDraftResolution> {
  const request = await agentRequestRepository.findById(requestId);
  if (!request || request.requestType !== "agent_create") {
    return { ok: false, code: 404, error: "This agent draft no longer exists." };
  }

  // Self-approval (the drafter's own request), re-checked against the row and
  // not just the card — the card is client-supplied.
  if (request.requesterId !== callerUserId) {
    return { ok: false, code: 403, error: "Only the person who requested this agent can decide it." };
  }

  const spec = parseDraftSpec(request.proposedContent);
  if (!spec) {
    return { ok: false, code: 400, error: "This draft is unreadable and can't be created. Ask for the agent again." };
  }

  const catalog = await buildCatalogFor(request.orgId);
  const expandedMcps = expandMcpRequests(spec.mcps, catalog);
  const specTools = [...spec.tools, ...expandedMcps.tokens];
  const extras = await resolveDraftExtras(spec, request.orgId, request.requesterId);
  const callableOptions = await listCallableAgentOptions(
    request.orgId,
    request.requesterId,
    spec.slug,
  );
  const buildIdentity = async (
    grantedIds?: string[],
    applied?: AppliedDraftEdits,
  ): Promise<{ identity: AgentIdentity; resolved: ResolvedCapabilities }> => {
    const resolved = await resolveAgentCapabilities(
      grantedIds ?? specTools,
      catalog,
      request.requesterId,
      callableOptions,
    );
    const effectiveSpec = applied ? { ...spec, ...(applied.modelId ? { modelId: applied.modelId } : { modelId: "" }) } : spec;
    const effectiveExtras = applied
      ? { ...extras, providerOrder: applied.providerOrder, unknownProviders: applied.unknownProviders }
      : extras;
    return { identity: identityFromDraftSpec(effectiveSpec, resolved, builtBy, effectiveExtras), resolved };
  };

  // Already decided (replay, or the other tab won): report the settled state
  // with a re-rendered card instead of creating anything.
  if (request.status !== "pending") {
    const { identity, resolved } = await buildIdentity();
    return {
      ok: true,
      status: request.status === "approved" ? "approved" : "rejected",
      identity,
      toolSelection: toConfigTools(resolved),
      alreadyResolved: true,
      ...(request.reviewNote ? { note: request.reviewNote } : {}),
    };
  }

  const claimed = await agentRequestRepository.claimPendingAgentCreate(
    requestId,
    decision === "approve" ? "approved" : "rejected",
    callerUserId,
  );
  if (claimed.count !== 1) {
    const fresh = await agentRequestRepository.findById(requestId);
    const { identity, resolved } = await buildIdentity();
    return {
      ok: true,
      status: fresh?.status === "approved" ? "approved" : "rejected",
      identity,
      toolSelection: toConfigTools(resolved),
      alreadyResolved: true,
      ...(fresh?.reviewNote ? { note: fresh.reviewNote } : {}),
    };
  }

  if (decision === "reject") {
    const { identity, resolved } = await buildIdentity();
    log.info(`[agent-card] draft ${spec.slug} rejected by ${callerUserId} (request=${requestId})`);
    return {
      ok: true,
      status: "rejected",
      identity,
      toolSelection: toConfigTools(resolved),
      alreadyResolved: false,
    };
  }

  // ── Approve: create the agent ──────────────────────────────────────────────
  try {
    const existing = await agentRepository.findBySlug(spec.slug, request.orgId);
    if (existing) {
      await agentRequestRepository.revertAgentCreateToPending(requestId).catch(() => {});
      return {
        ok: false,
        code: 409,
        error: `An agent with the identifier "${spec.slug}" now exists — nothing was created.`,
      };
    }

    const applied = applyDraftEdits(spec, extras, edits);
    const full = await buildIdentity(specTools, applied);
    const grantedIds =
      applied.requestedTools ??
      narrowToKeptCapabilities(
        specTools,
        keptCapabilityIds,
        (full.identity.capabilities ?? []).map((c) => c.id),
      );
    const unchanged =
      applied.requestedTools === undefined && grantedIds.length === specTools.length;
    const { identity, resolved } = unchanged ? full : await buildIdentity(grantedIds, applied);

    // Global agents are org-wide, so the same admin gate the REST create route
    // applies has to apply here — a drafted spec must not be a way around it.
    const admin = await isClawAdmin(callerUserId).catch(() => false);
    const effectiveScope = spec.scope === "global" && admin ? "global" : "personal";
    if (spec.scope === "global" && !admin) {
      log.info(`[agent-card] draft ${spec.slug} asked for global scope; downgraded to personal (approver is not an admin)`);
    }
    // Anything other than USER falls back to COLLECTIONS, matching the route —
    // a typo must not hand the agent the approver's whole knowledge base.
    const effectiveKbScope = spec.knowledge?.scope === "USER" ? "USER" : "COLLECTIONS";
    const providerOrder = applied.providerOrder;

    const created = await agentRepository.create({
      slug: spec.slug,
      name: spec.name,
      description: spec.description ?? "",
      systemPrompt: spec.systemPrompt,
      scope: effectiveScope,
      kbScope: effectiveKbScope,
      color: spec.color?.trim() || "#6366f1",
      modelId: applied.modelId?.trim() ?? "",
      config: {
        tools: toConfigTools(resolved),
        ...(providerOrder.length > 0 ? { providerOrder } : {}),
      },
      owner: { connect: { id: request.requesterId } },
      org: { connect: { id: request.orgId } },
    });

    // Skills were resolved to ids when the draft was built; attach them the same
    // way the REST route does. A failure here must not undo the agent, so each
    // attach is logged and skipped rather than thrown.
    for (const skill of extras.skills ?? []) {
      await agentRepository.upsertSkill(created.id, skill.id).catch((err: unknown) => {
        log.warn(`[agent-card] could not attach skill ${skill.id} to ${spec.slug}: ${errMsg(err)}`);
      });
    }

    await agentRequestRepository.recordAgentCreateResult(requestId, created.id).catch(() => {});
    await writeAuditLog({
      actorUserId: callerUserId,
      eventType: "AGENT_CREATED",
      targetId: created.id,
      description: `agent-authored agent "${spec.name}" (${spec.slug}) approved from a draft card`,
      metadata: {
        requestId,
        subagents: resolved.subagents,
        custom: resolved.custom,
        callableAgents: resolved.callableAgents,
        skills: (extras.skills ?? []).map((skill) => skill.id),
        scope: effectiveScope,
        kbScope: effectiveKbScope,
      },
    });
    log.info(
      `[agent-card] created agent ${spec.slug} (id=${created.id}) owner=${request.requesterId} org=${request.orgId} tools=${resolved.subagents.length + resolved.custom.length}`,
    );

    const note = draftNote(
      unknownToolsNote(resolved.unknown),
      unknownMcpsNote(expandedMcps.unknown),
      unknownProvidersNote(applied.unknownProviders),
    );
    return {
      ok: true,
      status: "approved",
      identity,
      toolSelection: toConfigTools(resolved),
      alreadyResolved: false,
      ...(note ? { note } : {}),
    };
  } catch (err) {
    // Roll the claim back so the card stays approvable instead of dead.
    await agentRequestRepository.revertAgentCreateToPending(requestId).catch(() => {});
    log.error(
      `[agent-card] create failed for ${spec.slug} (request=${requestId}): ${errMsg(err)}`,
    );
    return { ok: false, code: 500, error: "Couldn't create the agent just now — please try approving again." };
  }
}

/** Catalog fetch isolated so the resolver stays testable and the import stays lazy. */
async function buildCatalogFor(orgId: string): Promise<AvailableToolsCatalog> {
  const { buildAvailableToolsCatalog } = await import("../routes/tools.js");
  return buildAvailableToolsCatalog(undefined, orgId);
}

export async function listCallableAgentOptions(
  orgId: string | null,
  requesterId?: string,
  excludeSlug?: string,
): Promise<CallableAgentOption[]> {
  if (!orgId) return [];
  const rows = await agentRepository
    .listVisible({ ...(requesterId ? { userId: requesterId } : {}), orgId })
    .catch(() => []);
  return rows
    .filter((row) => row.enabled && row.slug !== excludeSlug)
    .map((row) => ({ slug: row.slug, name: row.name, description: row.description }));
}
