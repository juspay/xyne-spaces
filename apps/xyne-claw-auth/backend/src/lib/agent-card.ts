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
  normalizePermissionMode,
  permissionModeLabel,
  type AgentCapability,
  type AgentIdentity,
  type AgentPermissionMode,
} from "xyne-claw-shared";
import { errMsg } from "./errors.js";
import type { AvailableToolsCatalog } from "../routes/tools.js";
import { agentRepository, agentRequestRepository, skillRepository } from "../repositories/index.js";
import { availableServerTypesSafe } from "./connector-availability.js";
import { writeAuditLog } from "./audit.js";
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
export async function resolveAgentCapabilities(
  requested: string[],
  catalog: AvailableToolsCatalog,
  connectedFor?: string,
): Promise<ResolvedCapabilities> {
  const subagentByName = new Map(catalog.subagents.map((s) => [s.name, s]));
  const customBySlug = new Map(
    catalog.customGroups.flatMap((g) => g.tools.map((t) => [t.slug, t] as const)),
  );
  const directBySlug = new Map(
    catalog.integrations.flatMap((integration) =>
      [...integration.readTools, ...integration.writeTools].map((tool) => [tool.slug, { integration, tool }] as const),
    ),
  );
  const gatewayBySlug = new Map(
    catalog.integrations
      .filter((integration) => integration.kind === "gateway")
      .map((integration) => [integration.slug, integration] as const),
  );

  const subagents: string[] = [];
  const direct: string[] = [];
  const gateway: string[] = [];
  const custom: string[] = [];
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
        ...(match?.integration.slug ? { iconKey: match.integration.slug } : {}),
      };
    }),
    ...gateway.map((slug) => ({
      id: slug,
      label: gatewayBySlug.get(slug)?.label ?? slug,
      kind: "tool" as const,
    })),
    ...custom.map((slug) => ({
      id: slug,
      label: customBySlug.get(slug)?.name ?? slug,
      kind: "tool" as const,
    })),
  ];

  return { capabilities, subagents, direct, gateway, custom, unknown };
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
  return [...read("subagents"), ...read("direct"), ...read("gateway"), ...read("custom")];
}

/** The `config.tools` object, omitting empty buckets so a tool-less agent gets `{}`. */
export function toConfigTools(resolved: Pick<ResolvedCapabilities, "subagents" | "direct" | "gateway" | "custom">): {
  subagents?: string[];
  direct?: string[];
  gateway?: string[];
  custom?: string[];
} {
  return {
    ...(resolved.subagents.length > 0 ? { subagents: resolved.subagents } : {}),
    ...(resolved.direct.length > 0 ? { direct: resolved.direct } : {}),
    ...(resolved.gateway.length > 0 ? { gateway: resolved.gateway } : {}),
    ...(resolved.custom.length > 0 ? { custom: resolved.custom } : {}),
  };
}

/** Muted card footnote naming what could not be granted. */
export function unknownToolsNote(unknown: string[]): string | undefined {
  if (unknown.length === 0) return undefined;
  const shown = unknown.slice(0, 6).join(", ");
  const more = unknown.length > 6 ? ` (+${unknown.length - 6} more)` : "";
  return `Not granted — no such tool in this workspace: ${shown}${more}. Add them from the agent's settings.`;
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
  permissionMode?: AgentPermissionMode;
  skillSlugs?: string[];
  deniedTools?: string[];
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
export function identityFromDraftSpec(
  spec: DraftAgentSpec,
  resolved: ResolvedCapabilities,
  builtBy?: string,
): AgentIdentity {
  const permissionMode = normalizePermissionMode(spec.permissionMode);
  const details: NonNullable<AgentIdentity["details"]> = [
    { label: "Permission", value: permissionModeLabel(permissionMode) },
  ];
  if (spec.skillSlugs && spec.skillSlugs.length > 0) {
    details.push({ label: "Skills", value: spec.skillSlugs.join(", ") });
  }
  if (spec.deniedTools && spec.deniedTools.length > 0) {
    details.push({ label: "Denied tools", value: spec.deniedTools.join(", ") });
  }
  return agentIdentity({
    name: spec.name,
    slug: spec.slug,
    ...(builtBy ? { builtBy } : {}),
    description: spec.description,
    systemPrompt: spec.systemPrompt,
    ...(spec.modelId ? { modelId: spec.modelId } : {}),
    ...(spec.color ? { color: spec.color } : {}),
    capabilities: resolved.capabilities,
    details,
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
      note?: string;
      /** True when someone/something already decided this draft (replay, race). */
      alreadyResolved: boolean;
    }
  | { ok: false; code: 400 | 403 | 404 | 409 | 500; error: string };

function parseDraftSpec(raw: string | null): DraftAgentSpec | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftAgentSpec>;
    if (!parsed || typeof parsed.name !== "string" || typeof parsed.slug !== "string") return null;
    if (typeof parsed.systemPrompt !== "string" || parsed.systemPrompt.trim().length === 0) return null;
    const skillSlugs = Array.isArray(parsed.skillSlugs)
      ? parsed.skillSlugs.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    const deniedTools = Array.isArray(parsed.deniedTools)
      ? parsed.deniedTools.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    return {
      name: parsed.name,
      slug: parsed.slug,
      description: typeof parsed.description === "string" ? parsed.description : "",
      systemPrompt: parsed.systemPrompt,
      permissionMode: normalizePermissionMode(parsed.permissionMode),
      ...(typeof parsed.modelId === "string" ? { modelId: parsed.modelId } : {}),
      ...(typeof parsed.color === "string" ? { color: parsed.color } : {}),
      tools: Array.isArray(parsed.tools) ? parsed.tools.filter((t): t is string => typeof t === "string") : [],
      ...(skillSlugs.length > 0 ? { skillSlugs } : {}),
      ...(deniedTools.length > 0 ? { deniedTools } : {}),
    };
  } catch {
    return null;
  }
}

/** Dual-control canvas payload from the dashboard (flow-state `values.agent`). */
export interface AgentCreateCanvasOverlay {
  name?: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  toolIds?: string[];
  skillIds?: string[];
  permissionMode?: AgentPermissionMode;
  kbScope?: "COLLECTIONS" | "USER";
  knowledgeBase?: Array<{ collectionId: string; fileId?: string | null }>;
}

export function parseAgentCanvasValue(raw: unknown): {
  keptCapabilityIds?: string[];
  overlay?: AgentCreateCanvasOverlay;
} {
  if (Array.isArray(raw)) {
    return {
      keptCapabilityIds: raw.filter((value): value is string => typeof value === "string"),
    };
  }
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const selected = Array.isArray(record["selected"])
    ? record["selected"].filter((value): value is string => typeof value === "string")
    : undefined;
  const overlay: AgentCreateCanvasOverlay = {};
  if (typeof record["name"] === "string") overlay.name = record["name"];
  if (typeof record["slug"] === "string") overlay.slug = record["slug"];
  if (typeof record["description"] === "string") overlay.description = record["description"];
  if (typeof record["systemPrompt"] === "string") overlay.systemPrompt = record["systemPrompt"];
  const toolIds = Array.isArray(record["toolIds"])
    ? record["toolIds"].filter((value): value is string => typeof value === "string")
    : selected;
  if (toolIds) overlay.toolIds = toolIds;
  if (Array.isArray(record["skillIds"])) {
    overlay.skillIds = record["skillIds"].filter((value): value is string => typeof value === "string");
  }
  if (record["kbScope"] === "USER" || record["kbScope"] === "COLLECTIONS") {
    overlay.kbScope = record["kbScope"];
  }
  if (
    record["permissionMode"] === "ask-first" ||
    record["permissionMode"] === "read-only" ||
    record["permissionMode"] === "can-write"
  ) {
    overlay.permissionMode = record["permissionMode"];
  }
  if (Array.isArray(record["knowledgeBase"])) {
    overlay.knowledgeBase = record["knowledgeBase"].flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row["collectionId"] !== "string" || !row["collectionId"].trim()) return [];
      return [
        {
          collectionId: row["collectionId"].trim(),
          fileId: typeof row["fileId"] === "string" ? row["fileId"] : null,
        },
      ];
    });
  }
  return { ...(selected ? { keptCapabilityIds: selected } : {}), overlay };
}

export function applyCanvasOverlay(
  spec: DraftAgentSpec,
  overlay: AgentCreateCanvasOverlay | undefined,
): DraftAgentSpec {
  if (!overlay) return spec;
  const next: DraftAgentSpec = { ...spec, tools: [...spec.tools] };
  if (typeof overlay.name === "string" && overlay.name.trim()) {
    next.name = overlay.name.trim().slice(0, 80);
  }
  if (typeof overlay.slug === "string" && overlay.slug.trim()) {
    const slug = overlay.slug.trim().toLowerCase();
    if (isValidAgentSlug(slug)) next.slug = slug;
  }
  if (typeof overlay.description === "string") {
    next.description = overlay.description.trim().slice(0, 300);
  }
  if (typeof overlay.systemPrompt === "string" && overlay.systemPrompt.trim()) {
    next.systemPrompt = overlay.systemPrompt.trim().slice(0, 20_000);
  }
  if (overlay.permissionMode) {
    next.permissionMode = normalizePermissionMode(overlay.permissionMode);
  }
  if (Array.isArray(overlay.toolIds)) {
    next.tools = overlay.toolIds
      .filter((token): token is string => typeof token === "string" && token.trim().length > 0)
      .map((token) => token.trim())
      .filter((token, index, list) => list.indexOf(token) === index);
  }
  return next;
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
  canvasValue?: unknown,
  /** Drafting agent's slug, so the decided card keeps its "Built by" credit. */
  builtBy?: string,
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

  const parsedSpec = parseDraftSpec(request.proposedContent);
  if (!parsedSpec) {
    return { ok: false, code: 400, error: "This draft is unreadable and can't be created. Ask for the agent again." };
  }
  const parsedCanvas = parseAgentCanvasValue(canvasValue);
  const spec = applyCanvasOverlay(parsedSpec, parsedCanvas.overlay);

  const catalog = await buildCatalogFor(request.orgId);
  const buildIdentity = async (grantedIds?: string[]): Promise<{ identity: AgentIdentity; resolved: ResolvedCapabilities }> => {
    const resolved = await resolveAgentCapabilities(
      grantedIds ?? spec.tools,
      catalog,
      request.requesterId,
    );
    return { identity: identityFromDraftSpec(spec, resolved, builtBy), resolved };
  };

  // Already decided (replay, or the other tab won): report the settled state
  // with a re-rendered card instead of creating anything.
  if (request.status !== "pending") {
    const { identity } = await buildIdentity();
    return {
      ok: true,
      status: request.status === "approved" ? "approved" : "rejected",
      identity,
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
    const { identity } = await buildIdentity();
    return {
      ok: true,
      status: fresh?.status === "approved" ? "approved" : "rejected",
      identity,
      alreadyResolved: true,
      ...(fresh?.reviewNote ? { note: fresh.reviewNote } : {}),
    };
  }

  if (decision === "reject") {
    const { identity } = await buildIdentity();
    log.info(`[agent-card] draft ${spec.slug} rejected by ${callerUserId} (request=${requestId})`);
    return { ok: true, status: "rejected", identity, alreadyResolved: false };
  }

  // ── Approve: create the agent ──────────────────────────────────────────────
  try {
    const existing = await agentRepository.findBySlug(spec.slug, request.orgId);
    if (existing) {
      await agentRequestRepository.revertAgentCreateToPending(requestId).catch(() => {});
      return {
        ok: false,
        code: 409,
        error: `@${spec.slug} is taken. Rename the handle to create a new agent.`,
      };
    }

    const denied = new Set((spec.deniedTools ?? []).map((t) => t.trim()).filter(Boolean));
    // The user's chip selection can only remove capabilities: intersect it with
    // what the catalog actually grants rather than trusting it as the source.
    const grantedIds = (
      parsedCanvas.overlay?.toolIds
        ? spec.tools
        : parsedCanvas.keptCapabilityIds
          ? spec.tools.filter((token) => parsedCanvas.keptCapabilityIds!.includes(token))
          : spec.tools
    ).filter((token) => !denied.has(token));
    const { identity, resolved } = await buildIdentity(grantedIds);

    const permissionMode = normalizePermissionMode(spec.permissionMode);
    if (permissionMode === "read-only") {
      // read-only agents keep tools for reading; write tools are stripped at
      // runtime via config.permissionMode — still store resolved tools so the
      // agent can list them, but mark the mode for the gateway deny path.
    }

    const skillSlugs = [...new Set([...(spec.skillSlugs ?? [])])];
    const skillIdsFromSlugs: string[] = [];
    for (const skillSlug of skillSlugs) {
      const skill = await skillRepository.findBySlug(skillSlug, request.orgId);
      if (!skill) {
        await agentRequestRepository.revertAgentCreateToPending(requestId).catch(() => {});
        return {
          ok: false,
          code: 400,
          error: `Skill @${skillSlug} was not found. Create the skill first, or remove it from the draft.`,
        };
      }
      skillIdsFromSlugs.push(skill.id);
    }

    const created = await agentRepository.create({
      slug: spec.slug,
      name: spec.name,
      description: spec.description ?? "",
      systemPrompt: spec.systemPrompt,
      scope: "personal",
      color: spec.color?.trim() || "#6366f1",
      modelId: spec.modelId?.trim() ?? "",
      config: {
        tools: toConfigTools(resolved),
        permissionMode,
        ...(denied.size > 0 ? { deniedTools: [...denied] } : {}),
      },
      kbScope: parsedCanvas.overlay?.kbScope === "USER" ? "USER" : "COLLECTIONS",
      owner: { connect: { id: request.requesterId } },
      org: { connect: { id: request.orgId } },
    });

    await agentRequestRepository.recordAgentCreateResult(requestId, created.id).catch(() => {});

    const overlay = parsedCanvas.overlay;
    const skillIds = [
      ...skillIdsFromSlugs,
      ...(overlay?.skillIds ?? []).filter((id) => typeof id === "string" && id.length > 0),
    ];
    const uniqueSkillIds = [...new Set(skillIds)];
    for (const skillId of uniqueSkillIds) {
      await agentRepository.upsertSkill(created.id, skillId).catch((err) => {
        log.error(`[agent-card] skill attach failed for ${spec.slug} skill=${skillId}: ${errMsg(err)}`);
      });
    }
    if (
      overlay?.kbScope === "COLLECTIONS" &&
      overlay.knowledgeBase &&
      overlay.knowledgeBase.length > 0
    ) {
      try {
        const { validateKbGrants } = await import("./spaces-kb.js");
        const { accepted } = await validateKbGrants(callerUserId, overlay.knowledgeBase);
        if (accepted.length > 0) {
          await agentRepository.replaceCollections(created.id, accepted);
        }
      } catch (err) {
        log.error(`[agent-card] knowledge attach failed for ${spec.slug}: ${errMsg(err)}`);
      }
    }
    await writeAuditLog({
      actorUserId: callerUserId,
      eventType: "AGENT_CREATED",
      targetId: created.id,
      description: `agent-authored agent "${spec.name}" (${spec.slug}) approved from a draft card`,
      metadata: {
        requestId,
        subagents: resolved.subagents,
        custom: resolved.custom,
        permissionMode,
      },
    });
    log.info(
      `[agent-card] created agent ${spec.slug} (id=${created.id}) owner=${request.requesterId} org=${request.orgId} tools=${resolved.subagents.length + resolved.custom.length} permission=${permissionMode}`,
    );

    const note = unknownToolsNote(resolved.unknown);
    return { ok: true, status: "approved", identity, alreadyResolved: false, ...(note ? { note } : {}) };
  } catch (err) {
    // Roll the claim back so the card stays approvable instead of dead.
    await agentRequestRepository.revertAgentCreateToPending(requestId).catch(() => {});
    log.error(
      `[agent-card] create failed for ${spec.slug} (request=${requestId}): ${errMsg(err)}`,
    );
    return { ok: false, code: 500, error: `Couldn't create @${spec.slug}. Check the handle is unique and try Create Agent again. Your draft is still here.` };
  }
}

/** Catalog fetch isolated so the resolver stays testable and the import stays lazy. */
async function buildCatalogFor(orgId: string): Promise<AvailableToolsCatalog> {
  const { buildAvailableToolsCatalog } = await import("../routes/tools.js");
  return buildAvailableToolsCatalog(undefined, orgId);
}
