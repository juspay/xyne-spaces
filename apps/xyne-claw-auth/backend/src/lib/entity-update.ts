/**
 * Shared machinery for the update-agent / update-subagent propose→approve flow,
 * the multi-field sibling of the skill-update flow in routes/skills.ts. Both
 * agent and subagent updates:
 *   - apply anchored systemPrompt edits (or a small full replacement) to a
 *     working copy, exactly like update-skill (tool args scale with the CHANGE,
 *     so a long prompt never gets truncated as one argument),
 *   - additionally carry scalar field changes (name/description/model/tools/…),
 *   - store the whole proposal as JSON in agent_requests.proposedContent, keyed
 *     by targetType + agentSlug (the slug for agents, the name for subagents),
 *   - DM the OWNER a diff card and apply only on their approval.
 *
 * The prompt diff/hash helpers are reused verbatim from the skill-diff package.
 */

import { normalizeSkillContent, hashSkillContent, computeSkillDiff, buildEntityUpdateApprovalFlow } from "xyne-claw-shared";
import { agentRepository, subagentDefinitionRepository, agentRequestRepository } from "../repositories/index.js";
import { buildAvailableToolsCatalog } from "../routes/tools.js";
import { categorizeToolSelection, toConfigTools } from "./agent-tool-selection.js";
import { getWorkspaceIdForUser } from "./spaces-db.js";
import { spacesAppFetch } from "./spaces-api.js";
import { writeAuditLog } from "./audit.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("entity-update");

export type EntityKind = "agent" | "subagent";

const FULL_REPLACEMENT_MAX_CHARS = 8_000;

export interface PromptEdit { oldText: string; newText: string }

export interface EntityUpdateBody {
  promptEdits?: Array<{ oldText?: string; newText?: string }>;
  systemPrompt?: string;
  // Agent scalars
  name?: string;
  modelId?: string;
  color?: string;
  // Shared scalar
  description?: string;
  // Subagent scalars
  paramName?: string;
  paramDescription?: string;
  // Selection (both) — a flat list that REPLACES the current tool selection
  tools?: string[];
  summary?: string;
}

/** JSON stored in agent_requests.proposedContent. */
interface EntityUpdatePayload {
  /** Final system prompt — present only when the prompt is being changed. */
  systemPrompt?: string;
  /** Changed scalar fields, verbatim (tools stays a flat string[]). */
  fields?: Record<string, string | string[]>;
}

export interface FieldChange { label: string; from: string; to: string }

type ComputeError = { ok: false; code: 400 | 409; error: string };
type ComputeOk = {
  ok: true;
  payload: EntityUpdatePayload;
  promptChanged: boolean;
  diff?: ReturnType<typeof computeSkillDiff>;
  fieldChanges: FieldChange[];
  baseContentHash: string;
};

/** Apply anchored {oldText,newText} edits to `current`, mirroring the skill
 *  route: each oldText must appear exactly once. */
function applyPromptEdits(current: string, edits: PromptEdit[]): { ok: true; content: string } | ComputeError {
  let working = normalizeSkillContent(current);
  for (const [i, e] of edits.entries()) {
    if (!e.oldText) return { ok: false, code: 400, error: `promptEdits[${i}].oldText is required` };
    const first = working.indexOf(e.oldText);
    if (first === -1) {
      return { ok: false, code: 400, error: `promptEdits[${i}].oldText not found in the current system prompt — copy it EXACTLY (read the current definition first; it may have changed).` };
    }
    if (working.indexOf(e.oldText, first + 1) !== -1) {
      return { ok: false, code: 400, error: `promptEdits[${i}].oldText matches more than once — include more surrounding context to make it unique.` };
    }
    working = working.slice(0, first) + e.newText + working.slice(first + e.oldText.length);
  }
  return { ok: true, content: working };
}

function normalizeEdits(raw: EntityUpdateBody["promptEdits"]): PromptEdit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is { oldText: string; newText: string } =>
      !!e && typeof e.oldText === "string" && e.oldText.length > 0 && typeof e.newText === "string")
    .map((e) => ({ oldText: e.oldText, newText: e.newText }));
}

/** Which scalar fields each kind accepts, as [payloadKey, label, currentValue]. */
function scalarSpecForKind(kind: EntityKind, current: CurrentEntity): Array<{ key: string; label: string; current: string }> {
  if (kind === "agent") {
    return [
      { key: "name", label: "Name", current: current.name },
      { key: "description", label: "Description", current: current.description },
      { key: "modelId", label: "Model", current: current.modelId ?? "" },
      { key: "color", label: "Color", current: current.color ?? "" },
    ];
  }
  return [
    { key: "description", label: "Description", current: current.description },
    { key: "paramName", label: "Input name", current: current.paramName ?? "" },
    { key: "paramDescription", label: "Input description", current: current.paramDescription ?? "" },
  ];
}

interface CurrentEntity {
  systemPrompt: string;
  name: string;
  description: string;
  modelId?: string | null;
  color?: string | null;
  paramName?: string | null;
  paramDescription?: string | null;
  /** Current flat tool selection, for the tools field-change display. */
  currentToolSelection: string[];
}

/**
 * Pure: turn an update body + the current entity into a proposal payload, the
 * prompt diff, and the human-readable field changes. No DB writes.
 */
export function computeEntityUpdate(kind: EntityKind, current: CurrentEntity, body: EntityUpdateBody): ComputeOk | ComputeError {
  // 1) System prompt
  const edits = normalizeEdits(body.promptEdits);
  let proposedPrompt = current.systemPrompt;
  let promptChanged = false;
  if (edits.length > 0) {
    const applied = applyPromptEdits(current.systemPrompt, edits);
    if (!applied.ok) return applied;
    proposedPrompt = applied.content;
    promptChanged = normalizeSkillContent(proposedPrompt) !== normalizeSkillContent(current.systemPrompt);
  } else if (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) {
    if (normalizeSkillContent(current.systemPrompt).length > FULL_REPLACEMENT_MAX_CHARS) {
      return { ok: false, code: 400, error: `This system prompt is ${current.systemPrompt.length} chars — too large for full-replacement mode (tool arguments get truncated). Use \`promptEdits\` (anchored {oldText,newText}) instead.` };
    }
    proposedPrompt = body.systemPrompt;
    promptChanged = normalizeSkillContent(proposedPrompt) !== normalizeSkillContent(current.systemPrompt);
  }

  // Shrink guard — a proposal that deletes most of the prompt is almost always
  // a truncated "full replacement" (mirrors the skill route's hard guard).
  if (promptChanged) {
    const baseLen = normalizeSkillContent(current.systemPrompt).length;
    const newLen = normalizeSkillContent(proposedPrompt).length;
    if (baseLen > 2_000 && newLen < baseLen * 0.6) {
      return { ok: false, code: 400, error: `Proposed system prompt is ${newLen} chars vs the current ${baseLen} — it removes over 40% of the prompt. If intentional, make the deletions via explicit \`promptEdits\` so the diff shows exactly what is removed.` };
    }
  }

  // 2) Scalar fields
  const payload: EntityUpdatePayload = {};
  const fieldChanges: FieldChange[] = [];
  const fields: Record<string, string | string[]> = {};
  for (const spec of scalarSpecForKind(kind, current)) {
    const proposed = body[spec.key as keyof EntityUpdateBody];
    if (typeof proposed === "string") {
      const next = proposed.trim();
      if (next !== spec.current) {
        fields[spec.key] = next;
        fieldChanges.push({ label: spec.label, from: spec.current, to: next });
      }
    }
  }

  // 3) Tools — a flat list that REPLACES the current selection.
  if (Array.isArray(body.tools)) {
    const nextTools = [...new Set(body.tools.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()))];
    const cur = [...current.currentToolSelection].sort();
    const nxt = [...nextTools].sort();
    if (JSON.stringify(cur) !== JSON.stringify(nxt)) {
      fields["tools"] = nextTools;
      fieldChanges.push({ label: "Tools", from: current.currentToolSelection.join(", "), to: nextTools.join(", ") });
    }
  }

  if (promptChanged) payload.systemPrompt = normalizeSkillContent(proposedPrompt);
  if (Object.keys(fields).length > 0) payload.fields = fields;

  if (!promptChanged && Object.keys(fields).length === 0) {
    return { ok: false, code: 409, error: "Your update is identical to the current definition — nothing to propose." };
  }

  return {
    ok: true,
    payload,
    promptChanged,
    ...(promptChanged ? { diff: computeSkillDiff(current.systemPrompt, proposedPrompt) } : {}),
    fieldChanges,
    baseContentHash: hashSkillContent(current.systemPrompt),
  };
}

/** Flatten an agent's config.tools (subagents + custom) into a display list. */
export function agentToolSelectionFromConfig(config: unknown): string[] {
  const tools = (config && typeof config === "object" && !Array.isArray(config))
    ? (config as Record<string, unknown>)["tools"]
    : undefined;
  const rec = (tools && typeof tools === "object" && !Array.isArray(tools)) ? (tools as Record<string, unknown>) : {};
  const out: string[] = [];
  for (const key of ["subagents", "custom"]) {
    const list = rec[key];
    if (Array.isArray(list)) for (const v of list) if (typeof v === "string") out.push(v);
  }
  return out;
}

/** Flatten a subagent's tools JSON (custom only) into a display list. */
export function subagentToolSelectionFromConfig(tools: unknown): string[] {
  const rec = (tools && typeof tools === "object" && !Array.isArray(tools)) ? (tools as Record<string, unknown>) : {};
  const list = rec["custom"];
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
}

type ResolveResult =
  | { ok: true; status: "approved" | "rejected"; alreadyResolved?: boolean }
  | { ok: false; code: 400 | 403 | 404 | 409; error: string };

/**
 * Apply (or reject) an agent/subagent update request on the owner's decision.
 * Re-reads the LIVE definition, re-derives the approver from it (never trusts
 * the card), verifies the proposal integrity hash, and applies atomically after
 * an idempotent claim. Called by flow-action.ts and the REST parity routes.
 */
export async function resolveEntityUpdateRequest(kind: EntityKind, requestId: string, callerUserId: string, decision: "approve" | "reject"): Promise<ResolveResult> {
  const requestType = `${kind}_update`;
  const request = await agentRequestRepository.findById(requestId);
  if (!request || request.requestType !== requestType || !request.agentSlug) {
    return { ok: false, code: 404, error: `${kind} update request not found` };
  }
  const orgId = request.orgId;
  const targetKey = request.agentSlug;

  // Re-derive the owner from the LIVE row.
  let ownerUserId: string | null;
  let displayName: string;
  if (kind === "agent") {
    const agent = await agentRepository.findBySlug(targetKey, orgId);
    if (!agent) return { ok: false, code: 404, error: "Agent not found" };
    ownerUserId = agent.ownerUserId ?? null;
    displayName = agent.name;
  } else {
    const sub = await subagentDefinitionRepository.findByName(targetKey, orgId);
    if (!sub) return { ok: false, code: 404, error: "Subagent not found" };
    ownerUserId = sub.createdByUserId ?? null;
    displayName = sub.name;
  }
  if (!ownerUserId) return { ok: false, code: 409, error: `This ${kind} has no owner to approve an update.` };
  if (callerUserId !== ownerUserId) return { ok: false, code: 403, error: "Only the owner can approve this update." };

  if (request.status !== "pending") {
    return { ok: true, status: request.status === "approved" ? "approved" : "rejected", alreadyResolved: true };
  }
  const alreadyResolved = async (): Promise<ResolveResult> => {
    const fresh = await agentRequestRepository.findById(request.id);
    return { ok: true, status: fresh?.status === "approved" ? "approved" : "rejected", alreadyResolved: true };
  };

  if (decision === "reject") {
    const claim = await agentRequestRepository.claimPendingEntityUpdate(request.id, requestType, "rejected", callerUserId);
    if (claim.count === 0) return alreadyResolved();
    await writeAuditLog({ actorUserId: callerUserId, eventType: "REQUEST_REJECTED", targetId: targetKey, description: `Rejected ${kind} update of "${displayName}"` });
    return { ok: true, status: "rejected" };
  }

  const claim = await agentRequestRepository.claimPendingEntityUpdate(request.id, requestType, "approved", callerUserId);
  if (claim.count === 0) return alreadyResolved();

  try {
    const proposedRaw = request.proposedContent ?? "";
    if (hashSkillContent(proposedRaw) !== (request.proposedContentHash ?? "")) {
      await agentRequestRepository.revertEntityUpdateToPending(request.id).catch(() => {});
      return { ok: false, code: 409, error: "Proposed content failed integrity check" };
    }
    let payload: EntityUpdatePayload;
    try { payload = JSON.parse(proposedRaw) as EntityUpdatePayload; }
    catch {
      await agentRequestRepository.revertEntityUpdateToPending(request.id).catch(() => {});
      return { ok: false, code: 409, error: "Proposed content is not valid JSON" };
    }
    await applyEntityPayload(kind, targetKey, orgId, payload);
  } catch (err) {
    await agentRequestRepository.revertEntityUpdateToPending(request.id).catch(() => {});
    throw err;
  }

  await writeAuditLog({ actorUserId: callerUserId, eventType: "REQUEST_APPROVED", targetId: targetKey, description: `Approved ${kind} update of "${displayName}" proposed by ${request.requesterId}` });
  return { ok: true, status: "approved" };
}

/** Persist an approved payload. tools[] is re-categorized against the CURRENT
 *  catalog at apply time (so a token that became valid since propose still
 *  wires up); config.tools is merged so non-tools config keys survive. */
async function applyEntityPayload(kind: EntityKind, targetKey: string, orgId: string, payload: EntityUpdatePayload): Promise<void> {
  const fields = payload.fields ?? {};
  if (kind === "agent") {
    const data: Record<string, unknown> = {};
    if (typeof payload.systemPrompt === "string") data["systemPrompt"] = payload.systemPrompt;
    if (typeof fields["name"] === "string") data["name"] = fields["name"];
    if (typeof fields["description"] === "string") data["description"] = fields["description"];
    if (typeof fields["modelId"] === "string") data["modelId"] = fields["modelId"];
    if (typeof fields["color"] === "string") data["color"] = fields["color"];
    if (Array.isArray(fields["tools"])) {
      const agent = await agentRepository.findBySlug(targetKey, orgId);
      const existingConfig = (agent?.config && typeof agent.config === "object" && !Array.isArray(agent.config))
        ? (agent.config as Record<string, unknown>) : {};
      const catalog = await buildAvailableToolsCatalog(undefined, orgId);
      const sel = categorizeToolSelection(fields["tools"] as string[], catalog, { allowSubagents: true });
      if (sel.unknown.length > 0) log.info(`[entity-update] agent ${targetKey} apply: skipped unknown tools ${sel.unknown.join(",")}`);
      data["config"] = { ...existingConfig, tools: toConfigTools(sel) };
    }
    await agentRepository.update(targetKey, orgId, data);
    return;
  }
  const data: Record<string, unknown> = {};
  if (typeof payload.systemPrompt === "string") data["systemPrompt"] = payload.systemPrompt;
  if (typeof fields["description"] === "string") data["description"] = fields["description"];
  if (typeof fields["paramName"] === "string") data["paramName"] = fields["paramName"];
  if (typeof fields["paramDescription"] === "string") data["paramDescription"] = fields["paramDescription"];
  if (Array.isArray(fields["tools"])) {
    const catalog = await buildAvailableToolsCatalog(undefined, orgId);
    const sel = categorizeToolSelection(fields["tools"] as string[], catalog, { allowSubagents: false });
    if (sel.unknown.length > 0) log.info(`[entity-update] subagent ${targetKey} apply: skipped unknown tools ${sel.unknown.join(",")}`);
    data["tools"] = sel.custom.length > 0 ? { custom: sel.custom } : {};
  }
  await subagentDefinitionRepository.update(targetKey, orgId, data);
}

/**
 * DM the OWNER a diff card, posting AS the given (already authorized) agent —
 * the sibling of notifyApproverOfSkillUpdateInSpaces. Best-effort: the request
 * row is authoritative, so a failed DM only skips the card.
 */
export async function notifyApproverOfEntityUpdateInSpaces(args: {
  kind: EntityKind;
  approverUserId: string;
  requestId: string;
  targetKey: string;
  targetName: string;
  proposerName: string;
  diff?: ReturnType<typeof computeSkillDiff>;
  fieldChanges: FieldChange[];
  summary?: string | null;
  agent: { slug: string; spacesAppId: string | null; spacesAppToken: string | null; spacesAppUserId: string | null };
}): Promise<void> {
  try {
    const { agent } = args;
    if (!agent.spacesAppId || !agent.spacesAppToken || !agent.spacesAppUserId) {
      log.info(`[entity-update] owner DM skipped for ${args.targetKey}: agent ${agent.slug} not Spaces-registered`);
      return;
    }
    const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
    if (!ciphertext || !iv || !authTag) return;
    const token = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);

    const workspaceId = (await getWorkspaceIdForUser(args.approverUserId, `${args.kind}-update-owner-dm`)) ?? "";
    if (!workspaceId) {
      log.warn(`[entity-update] owner DM skipped for ${args.targetKey}: no workspaceId for approver ${args.approverUserId}`);
      return;
    }
    const dm = (await spacesAppFetch("/channel/openDm", { targetUserId: args.approverUserId, workspaceId }, token)) as { channelId: string };

    const flow = buildEntityUpdateApprovalFlow({
      kind: args.kind,
      requestId: args.requestId,
      approverUserId: args.approverUserId,
      targetKey: args.targetKey,
      targetName: args.targetName,
      proposerName: args.proposerName,
      ...(args.diff ? { diff: args.diff } : {}),
      fieldChanges: args.fieldChanges,
      ...(args.summary ? { summary: args.summary } : {}),
      agentSlug: agent.slug,
      spacesAppId: agent.spacesAppId,
      spacesBaseUrl: CONFIG.spacesAppUrl,
    });

    await spacesAppFetch("/chat/postMessage", { channelId: dm.channelId, flow, userId: agent.spacesAppUserId }, token);
    log.info(`[entity-update] sent ${args.kind}-update DM to approver ${args.approverUserId} for ${args.targetKey}`);
  } catch (err) {
    log.warn(`[entity-update] owner DM failed for ${args.targetKey}:`, err instanceof Error ? err.message : String(err));
  }
}
