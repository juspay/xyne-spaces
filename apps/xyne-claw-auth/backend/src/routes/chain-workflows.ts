import { Prisma } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { Router, type Request, type Response } from "express";
import { agentChainWorkflowRepository, agentRepository } from "../repositories/index.js";
import { getRequesterId, getOrgId, isClawAdmin , requireRequester} from "../middleware/agent-acl.js";
import { requireS2S } from "../middleware/require-auth.js";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { getSpacesAuthForUser, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { setSession, type SessionContext } from "./webhook.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { getAdminOrgScope, getOrgNameMap, withOrgLabel } from "../lib/admin-org-scope.js";

import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, HttpError } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("chain-workflows");

/* ------------------------------------------------------------------ */
/*  Workflow definition types                                           */
/* ------------------------------------------------------------------ */

interface WorkflowNode {
  id: string;
  agentSlug: string;
  taskTemplate?: string;
}

interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode?: "always" | "tools" | "judge";
  toolsMustInclude?: string[];
  toolsMustExclude?: string[];
  judgeContext?: string;
  taskTemplate?: string;
}

interface WorkflowDefinition {
  version?: number;
  maxDepth?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/* ------------------------------------------------------------------ */
/*  Trigger JSON types (stored on agent_chain_workflows.triggers)      */
/* ------------------------------------------------------------------ */

interface TriggerChannel {
  channelId: string;
  spacesAutomationId: string | null;
  // For webhook-backed triggers (GitHub/Bitbucket): the full Spaces webhook URL
  // (with secret) the user pastes into their repo's webhook settings. The
  // secret is only returned by Spaces on first issue, so we persist it here.
  webhookUrl?: string | null;
}

interface WorkflowTrigger {
  id: string;
  type: string;
  channels: TriggerChannel[];
  configValues?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Request payload types                                               */
/* ------------------------------------------------------------------ */

interface TriggerPayloadItem {
  id?: string;         // DB id — present when editing an existing trigger
  type: string;
  channelIds: string[];
  configValues?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const router = Router();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parseWorkflowDefinition(definition: unknown): WorkflowDefinition | null {
  if (!definition || typeof definition !== "object") return null;

  const raw = definition as Record<string, unknown>;
  if (!Array.isArray(raw["nodes"]) || !Array.isArray(raw["edges"])) return null;

  const nodes = raw["nodes"]
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((n) => typeof n["id"] === "string" && typeof n["agentSlug"] === "string")
    .map((n) => ({
      id: n["id"] as string,
      agentSlug: n["agentSlug"] as string,
      ...(typeof n["taskTemplate"] === "string" ? { taskTemplate: n["taskTemplate"] } : {}),
    }));

  const edges = raw["edges"]
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .filter((e) => typeof e["id"] === "string" && typeof e["fromNodeId"] === "string" && typeof e["toNodeId"] === "string")
    .map((e) => {
      const edge: WorkflowEdge = {
        id: e["id"] as string,
        fromNodeId: e["fromNodeId"] as string,
        toNodeId: e["toNodeId"] as string,
      };
      const mode = e["mode"];
      if (mode === "always" || mode === "tools" || mode === "judge") edge.mode = mode;
      if (isStringArray(e["toolsMustInclude"])) edge.toolsMustInclude = e["toolsMustInclude"];
      if (isStringArray(e["toolsMustExclude"])) edge.toolsMustExclude = e["toolsMustExclude"];
      if (typeof e["judgeContext"] === "string") edge.judgeContext = e["judgeContext"];
      if (typeof e["taskTemplate"] === "string") edge.taskTemplate = e["taskTemplate"];
      return edge;
    });

  if (nodes.length === 0) return null;

  return {
    nodes,
    edges,
    ...(typeof raw["version"] === "number" ? { version: raw["version"] } : {}),
    ...(typeof raw["maxDepth"] === "number" ? { maxDepth: raw["maxDepth"] } : {}),
  };
}

function validateWorkflowDefinition(definition: WorkflowDefinition): string | null {
  if (definition.nodes.length === 0) return "workflow must include at least one node";

  const nodeIdSet = new Set<string>();
  for (const node of definition.nodes) {
    if (!node.id.trim()) return "node id is required";
    if (!node.agentSlug.trim()) return "node agentSlug is required";
    if (nodeIdSet.has(node.id)) return `duplicate node id: ${node.id}`;
    nodeIdSet.add(node.id);
  }

  for (const edge of definition.edges) {
    if (!nodeIdSet.has(edge.fromNodeId) || !nodeIdSet.has(edge.toNodeId)) {
      return `edge ${edge.id} references missing nodes`;
    }
  }

  if (definition.maxDepth !== undefined && (definition.maxDepth < 1 || definition.maxDepth > 50)) {
    return "maxDepth must be between 1 and 50";
  }

  return null;
}

function parseTriggers(raw: unknown): WorkflowTrigger[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .filter((t) => typeof t["id"] === "string" && typeof t["type"] === "string")
    .map((t) => ({
      id: t["id"] as string,
      type: t["type"] as string,
      channels: Array.isArray(t["channels"])
        ? (t["channels"] as Record<string, unknown>[])
            .filter((c) => typeof c["channelId"] === "string")
            .map((c) => ({
              channelId: c["channelId"] as string,
              spacesAutomationId: typeof c["spacesAutomationId"] === "string" ? c["spacesAutomationId"] : null,
            }))
        : [],
      ...(t["configValues"] && typeof t["configValues"] === "object" && !Array.isArray(t["configValues"])
        ? { configValues: t["configValues"] as Record<string, string> }
        : {}),
    }));
}

async function canAccessWorkflow(requesterId: string, createdByUserId: string): Promise<boolean> {
  if (requesterId === createdByUserId) return true;
  return isClawAdmin(requesterId);
}

/* ------------------------------------------------------------------ */
/*  Spaces automation proxy                                             */
/* ------------------------------------------------------------------ */

interface SpacesAutomationResult {
  id?: string;
  /** Populated by the POST /:id/webhook issue endpoint. */
  url?: string;
}

async function callSpacesAutomations(
  userId: string,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<SpacesAutomationResult | null> {
  try {
    // Prefer a LIVE token from the Spaces session DB — getSpacesAuthForUser
    // refreshes an expired access token via /api/auth/refresh-session. Without
    // this, the automation create/update/delete calls silently 401 once the
    // user's stored MCP token expires (same defect as resolveUserSpacesAuth).
    // Fall back to the cached MCP-connection token if the live lookup misses.
    let token = "";
    let baseUrl = "";
    let sessionId = "";
    let workspaceId = "";
    const live = await getSpacesAuthForUser(userId, "require-auth").catch(() => null);
    if (live?.token) {
      token = live.token;
      baseUrl = CONFIG.spacesInternalUrl;
      sessionId = live.sessionId;
      workspaceId = live.workspaceId;
    } else {
      const connection = await prisma.userMcpConnection.findFirst({
        where: { userId, mcpServer: { type: "xyne-spaces" } },
      });
      if (!connection) return null;
      const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
      const credentials = JSON.parse(decrypted) as Record<string, unknown>;
      token = typeof credentials["token"] === "string" ? credentials["token"].trim() : "";
      sessionId = typeof credentials["sessionId"] === "string" ? credentials["sessionId"].trim() : "";
      workspaceId = typeof credentials["workspaceId"] === "string" ? credentials["workspaceId"].trim() : "";
      baseUrl = typeof credentials["url"] === "string" && credentials["url"].trim()
        ? credentials["url"].trim()
        : CONFIG.spacesInternalUrl;
    }
    if (!token) return null;
    if (!workspaceId) {
      workspaceId = await getWorkspaceIdForUser(userId, "require-auth").catch(() => null) ?? "";
      if (workspaceId) log.info(`[chain-workflows] resolved workspaceId=${workspaceId} from user row for automation userId=${userId}`);
    }
    const cookieParts: string[] = [];
    if (sessionId) {
      cookieParts.push(`user_session_id=${sessionId}`);
      cookieParts.push(`xyne_session=${sessionId}`);
    }
    if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
    const cookieHeader = cookieParts.join("; ");

    const url = `${baseUrl}/api/automations${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(sessionId ? { "x-session-id": sessionId } : {}),
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.error(`[chain-workflows] Spaces automation ${method} ${url} failed ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    if (method === "DELETE") return { id: path.replace("/", "") };

    // Two response shapes: create/update → { data: { automation: { id } } };
    // webhook-issue (POST /:id/webhook) → { data: { url } }.
    const json = (await res.json()) as {
      success: boolean;
      data?: { automation?: { id?: string }; url?: string | null };
    };
    const id = json?.data?.automation?.id;
    const webhookUrl = json?.data?.url ?? undefined;
    if (!id && !webhookUrl) return null;
    return { ...(id ? { id } : {}), ...(webhookUrl ? { url: webhookUrl } : {}) };
  } catch (err) {
    log.error(`[chain-workflows] callSpacesAutomations error:`, err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Trigger + binding sync helpers                                      */
/* ------------------------------------------------------------------ */

// VCS template trigger types the claw UI offers. They don't exist as native
// Spaces triggers — Spaces won't add them — so we compile them down to the
// GENERIC `WEBHOOK` trigger (which Spaces supports) plus a `RUN_AGENT` step.
// The user pastes the issued webhook URL into their GitHub/Bitbucket repo.
const VCS_TEMPLATE_TYPES = new Set(["GITHUB_EVENT", "BITBUCKET_EVENT"]);

export function isVcsTemplateTrigger(triggerType: string): boolean {
  return VCS_TEMPLATE_TYPES.has(triggerType);
}

/**
 * Build the Spaces automation `config` (trigger + steps) for one trigger×channel.
 *
 * Only types Spaces actually supports are emitted:
 *  - GITHUB_EVENT / BITBUCKET_EVENT → generic `WEBHOOK` trigger (empty bodySchema
 *    so every delivery returns 202 — clean repo-webhook hygiene; the agent reads
 *    the event type/payload and decides relevance) + `RUN_AGENT`.
 *  - any native Spaces trigger (TICKET_*, EMAIL_*, MESSAGE_RECEIVED, WEBHOOK) →
 *    that trigger + `RUN_AGENT`.
 *
 * The step is always `RUN_AGENT` targeting the workflow's entry agent. Spaces
 * has no `TRIGGER_CHAIN_WORKFLOW` step (the previous emission here was rejected
 * by Spaces validation), and a pausing step like RUN_AGENT can't be nested in a
 * conditional — so multi-node chain hops beyond the entry agent aren't driven
 * from here; the entry agent is what fires.
 */
function buildSpacesConfig(
  triggerType: string,
  channelId: string,
  entryAgentSlug: string,
  requesterId: string,
  configValues?: Record<string, string>,
) {
  const isVcs = isVcsTemplateTrigger(triggerType);
  const nativeTriggerConfig =
    channelId === "*"
      ? triggerType === "MESSAGE_RECEIVED"
        ? { fromUserIds: [requesterId] }
        : {}
      : { channelIds: [channelId] };

  const trigger = isVcs
    ? { type: "WEBHOOK", config: { bodySchema: {}, headerSchema: {} } }
    : {
        type: triggerType,
        config: nativeTriggerConfig,
      };

  // Event-aware prompt so the agent can short-circuit irrelevant deliveries.
  const provider = triggerType === "GITHUB_EVENT" ? "GitHub" : triggerType === "BITBUCKET_EVENT" ? "Bitbucket" : null;
  // Default prompt per trigger type. For MESSAGE_RECEIVED we inject the message
  // via {{trigger.*}} variable-refs (the Spaces RUN_AGENT step resolves them from
  // the trigger payload before running) so the agent gets the actual message, not
  // a generic "an event fired". The agent also receives channelId/conversationId
  // out-of-band (resolveVisibleConversationContext) so it can read the full thread.
  const defaultPrompt = provider
    ? [
        `A ${provider} webhook event was received.`,
        configValues?.["eventTypes"]?.trim() ? `Act only on these event types: ${configValues["eventTypes"].trim()} (ignore others).` : "",
        configValues?.["repoName"]?.trim() ? `Repository filter: ${configValues["repoName"].trim()}.` : "",
        "Decide whether this event is relevant, and if so handle it.",
      ].filter(Boolean).join("\n")
    : triggerType === "MESSAGE_RECEIVED"
      ? [
          "A new message was posted in this channel:",
          "",
          '"{{trigger.message.content}}"',
          "",
          "From: {{trigger.author.name}} · thread: {{trigger.conversationId}}",
          "Handle this message according to this workflow.",
        ].join("\n")
      : [
          `An automation event (${triggerType}) fired.`,
          "The trigger payload is available — handle the event according to this workflow.",
        ].join("\n");

  // User-authored context from the trigger's Configure panel wins when provided.
  // It supports the same {{trigger.*}} variable-refs (the UI's variable picker is
  // driven by the trigger's output schema), so users can phrase the agent's task
  // and pull in exactly the trigger fields they want.
  const userContext = configValues?.["context"]?.trim();
  const prompt = userContext && userContext.length > 0 ? userContext : defaultPrompt;

  const runAgentStep = {
    id: "step-1",
    type: "RUN_AGENT",
    config: { agentSlug: entryAgentSlug, prompt, outputSchema: { result: "string" } },
  };
  const steps =
    triggerType === "MESSAGE_RECEIVED"
      ? [
          runAgentStep,
          {
            id: "step-2",
            type: "REPLY_ON_MESSAGE",
            config: {
              conversationId: "{{trigger.conversationId}}",
              // The executor stores a step's output under `<id>.output` (see
              // automation-executor: context.steps[id] = { type, output }), so the
              // agent's `result` field is at step-1.output.result — NOT step-1.result
              // (which resolves to undefined → REPLY_ON_MESSAGE content fails its
              // z.string().min(1) validation).
              content: "{{step-1.output.result}}",
            },
          },
        ]
      : [runAgentStep];

  return { trigger, steps };
}

// Upsert a binding row for chain executor, and remove stale bindings for deleted channels.
async function syncBindings(
  workflowId: string,
  entryAgentSlug: string,
  oldChannelIds: Set<string>,
  newChannelIds: Set<string>,
  createdByUserId: string,
): Promise<void> {
  await agentChainWorkflowRepository.deleteStaleBindingsForWorkflow(
    workflowId,
    [...newChannelIds],
    entryAgentSlug,
    "*",
  );
  for (const channelId of oldChannelIds) {
    if (!newChannelIds.has(channelId)) {
      log.info(`[chain-workflows] removed stale binding channelId=${channelId} workflowId=${workflowId}`);
    }
  }
  for (const channelId of newChannelIds) {
    // Event-trigger bindings are channel-wide: an automation event (e.g. a
    // Bitbucket push) isn't attributed to a specific user, so bind with the
    // userId="*" sentinel so findActiveWorkflowForChannel matches regardless
    // of which user the trigger is dispatched as.
    await agentChainWorkflowRepository.upsertBinding(channelId, entryAgentSlug, workflowId, createdByUserId, true, "*");
    log.info(`[chain-workflows] upserted binding channelId=${channelId} entryAgent=${entryAgentSlug}`);
  }
}

function collectChannelIds(triggers: WorkflowTrigger[]): Set<string> {
  const set = new Set<string>();
  for (const t of triggers) {
    for (const c of t.channels) set.add(c.channelId);
  }
  return set;
}

/**
 * Create/update/delete the Spaces automations for a workflow's triggers, persist
 * the resulting triggers JSON, and sync channel bindings. Pass the FULL desired
 * trigger set (`newTriggers`); automations for removed channels/triggers are
 * deleted. Shared by the chain-workflow update route AND the agent-page triggers
 * endpoint (which manages a single-node backing workflow).
 */
/**
 * Create a Spaces automation, then immediately submit it for admin approval.
 *
 * Spaces' `POST /api/automations` creates a DRAFT, which is invisible to
 * admins and never fires (the automation event-router only matches ACTIVE).
 * `POST /:id/submit` moves it DRAFT → PENDING_APPROVAL and DMs the automations
 * admins (approval.service.ts → notifyAdminsOfSubmission); an admin then
 * approves it to ACTIVE. So a create without a submit produces a trigger that
 * silently never runs. Submit is best-effort: on failure we keep the DRAFT
 * (an admin can submit it from Spaces) and log, rather than failing the whole
 * workflow save. A failed create is fatal because there is no trigger to run.
 */
async function createAndSubmitSpacesAutomation(
  requesterId: string,
  name: string,
  config: Record<string, unknown>,
  opts?: { issueWebhook?: boolean },
): Promise<{ id: string | null; webhookUrl: string | null }> {
  const created = await callSpacesAutomations(requesterId, "POST", "", { name, config });
  const id = created?.id ?? null;
  if (!id) {
    throw new Error(`Spaces rejected automation config for "${name}"`);
  }
  let webhookUrl: string | null = null;
  const submitted = await callSpacesAutomations(requesterId, "POST", `/${id}/submit`);
  if (!submitted) {
    log.warn(`[chain-workflows] automation ${id} created but submit-for-approval failed — left as DRAFT, submit manually from Spaces`);
  }
  // For webhook-backed triggers (GitHub/Bitbucket), issue the webhook secret
  // once and capture the full URL — Spaces only returns it on first issue, so
  // we persist it on the trigger channel for the UI to display.
  if (opts?.issueWebhook) {
    const issued = await callSpacesAutomations(requesterId, "POST", `/${id}/webhook`);
    webhookUrl = issued?.url ?? null;
    if (!webhookUrl) {
      log.warn(`[chain-workflows] automation ${id}: webhook URL issue returned no url`);
    }
  }
  return { id, webhookUrl };
}

export async function syncWorkflowTriggers(params: {
  workflowId: string;
  workflowName: string;
  entryAgentSlug: string;
  requesterId: string;
  existingTriggers: WorkflowTrigger[];
  newTriggers: TriggerPayloadItem[] | null;
}): Promise<void> {
  const { workflowId, workflowName, entryAgentSlug, requesterId, existingTriggers, newTriggers } = params;
  const existingById = new Map(existingTriggers.map((t) => [t.id, t]));
  const oldChannelIds = collectChannelIds(existingTriggers);
  const newTriggersJson: WorkflowTrigger[] = [];
  const newChannelIds = new Set<string>();

  if (newTriggers && newTriggers.length > 0) {
    for (const t of newTriggers) {
      if (!t.type?.trim() || !Array.isArray(t.channelIds)) continue;

      const existing_t = t.id ? existingById.get(t.id) : undefined;
      const existingChannelMap = new Map(existing_t?.channels.map((c) => [c.channelId, c]) ?? []);
      const newChannelSet = new Set(t.channelIds.filter(Boolean));
      const channels: TriggerChannel[] = [];

      // Delete automations for removed channels.
      for (const [channelId, ch] of existingChannelMap) {
        if (!newChannelSet.has(channelId) && ch.spacesAutomationId) {
          await callSpacesAutomations(requesterId, "DELETE", `/${ch.spacesAutomationId}`);
        }
      }
      // Create or keep automations for current channels.
      for (const channelId of newChannelSet) {
        const existingChannel = existingChannelMap.get(channelId);
        if (existingChannel) {
          channels.push(existingChannel);
        } else {
          const { id, webhookUrl } = await createAndSubmitSpacesAutomation(
            requesterId,
            `${workflowName} — ${t.type}`,
            buildSpacesConfig(t.type, channelId, entryAgentSlug, requesterId, t.configValues),
            { issueWebhook: isVcsTemplateTrigger(t.type) },
          );
          channels.push({ channelId, spacesAutomationId: id, webhookUrl });
        }
        newChannelIds.add(channelId);
      }

      newTriggersJson.push({
        id: t.id ?? crypto.randomUUID(),
        type: t.type,
        channels,
        ...(t.configValues && Object.keys(t.configValues).length > 0 ? { configValues: t.configValues } : {}),
      });
    }
  } else {
    // newTriggers null/[] → delete all existing automations.
    for (const t of existingTriggers) {
      for (const c of t.channels) {
        if (c.spacesAutomationId) await callSpacesAutomations(requesterId, "DELETE", `/${c.spacesAutomationId}`);
      }
    }
  }

  // Delete automations for entirely removed triggers.
  for (const [id, et] of existingById) {
    const stillExists = (newTriggers ?? []).some((t) => t.id === id);
    if (!stillExists) {
      for (const c of et.channels) {
        if (c.spacesAutomationId) await callSpacesAutomations(requesterId, "DELETE", `/${c.spacesAutomationId}`);
      }
    }
  }

  await agentChainWorkflowRepository.updateWorkflow(workflowId, {
    triggers: newTriggersJson as unknown as Prisma.InputJsonValue,
  });

  if (entryAgentSlug) {
    await syncBindings(workflowId, entryAgentSlug, oldChannelIds, newChannelIds, requesterId);
  }
}

/**
 * Find (or lazily create) the single-node backing workflow that holds an agent's
 * page-level triggers. Entry node = the agent; no edges. Marked with
 * `agentTriggerSlug` so it stays hidden from the Workflows list.
 */
export async function findOrCreateAgentTriggerWorkflow(agentSlug: string, requesterId: string) {
  const existing = await prisma.agentChainWorkflow.findUnique({ where: { agentTriggerSlug: agentSlug } });
  if (existing) return existing;
  const definition: WorkflowDefinition = {
    version: 1,
    nodes: [{ id: "node-1", agentSlug }],
    edges: [],
  };
  return agentChainWorkflowRepository.createWorkflow({
    name: `Agent triggers: ${agentSlug}`,
    definition: JSON.parse(JSON.stringify(definition)) as Prisma.InputJsonValue,
    triggers: [],
    isPublished: true,
    agentTriggerSlug: agentSlug,
    createdByUser: { connect: { id: requesterId } },
  });
}

export { parseTriggers as parseWorkflowTriggers };

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const channelId = typeof req.query["channelId"] === "string" ? req.query["channelId"] : undefined;
  if (channelId) {
    const rows = await agentChainWorkflowRepository.listByChannel(channelId);
    const admin = await isClawAdmin(requesterId);
    const visible = admin
      ? rows
      : rows.filter((row) => row.createdByUserId === requesterId || row.workflow.createdByUserId === requesterId);
    ok(res, visible);
    return;
  }

  const rows = await agentChainWorkflowRepository.listByUser(requesterId);
  ok(res, rows);
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const { name, definition, isPublished, triggers, useCreatorCredentials } = req.body as {
    name?: string;
    definition?: unknown;
    isPublished?: boolean;
    triggers?: TriggerPayloadItem[];
    useCreatorCredentials?: boolean;
  };

  if (!name?.trim()) throw badRequest("name is required");

  const parsed = parseWorkflowDefinition(definition);
  if (!parsed) throw badRequest("definition is invalid");

  const validationError = validateWorkflowDefinition(parsed);
  if (validationError) throw badRequest(validationError);

  // Build trigger JSON: for each trigger, for each channel → create one Spaces automation.
  const triggersJson: WorkflowTrigger[] = [];
  const allNewChannelIds = new Set<string>();

  // Names are unique per creator (the default "New Channel Workflow" makes
  // collisions the norm), so auto-suffix to the first free "… (n)" instead of
  // failing the create on a unique violation.
  const uniqueName = await agentChainWorkflowRepository.resolveUniqueName(requesterId, name);

  // Create the workflow first so we have its id for Spaces config.
  const workflow = await agentChainWorkflowRepository.createWorkflow({
    name: uniqueName,
    definition: JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue,
    triggers: [],
    ...(typeof isPublished === "boolean" ? { isPublished } : {}),
    // Consent is self-asserted by the credential owner: the creator opts in
    // to lending THEIR own creds, so we pin credentialUserId to requesterId.
    ...(useCreatorCredentials === true ? { credentialUserId: requesterId } : {}),
    createdByUser: { connect: { id: requesterId } },
  });

  if (Array.isArray(triggers)) {
    for (const t of triggers) {
      if (!t.type?.trim() || !Array.isArray(t.channelIds)) continue;
      const channels: TriggerChannel[] = [];
      const entryAgentSlug = parsed.nodes[0]!.agentSlug;
      for (const channelId of t.channelIds) {
        if (!channelId?.trim()) continue;
        const { id, webhookUrl } = await createAndSubmitSpacesAutomation(
          requesterId,
          `${name.trim()} — ${t.type}`,
          buildSpacesConfig(t.type, channelId, entryAgentSlug, requesterId, t.configValues),
          { issueWebhook: isVcsTemplateTrigger(t.type) },
        );
        channels.push({ channelId, spacesAutomationId: id, webhookUrl });
        allNewChannelIds.add(channelId);
      }
      triggersJson.push({
        id: crypto.randomUUID(),
        type: t.type,
        channels,
        ...(t.configValues && Object.keys(t.configValues).length > 0 ? { configValues: t.configValues } : {}),
      });
    }
  }

  // Persist triggers JSON.
  await agentChainWorkflowRepository.updateWorkflow(workflow.id, {
    triggers: triggersJson as unknown as Prisma.InputJsonValue,
  });

  // Sync bindings for chain executor.
  await syncBindings(workflow.id, parsed.nodes[0]!.agentSlug, new Set(), allNewChannelIds, requesterId);

  const created = await agentChainWorkflowRepository.findWorkflowById(workflow.id);
  res.status(201).json({ success: true, data: created });
}));

router.put("/bindings/upsert", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const { channelId, channelIds, entryAgentSlug, workflowId, enabled, userId } = req.body as {
      // Single channel (legacy). Either this or `channelIds` is required.
      channelId?: string;
      // Multiple channels. Pass the reserved sentinel "*" (alone or as an
      // entry) to bind across ALL channels.
      channelIds?: string[];
      entryAgentSlug?: string;
      workflowId?: string;
      enabled?: boolean;
      // User this binding applies to. Omit to bind for yourself (the default,
      // per-user). Pass the reserved sentinel "*" to bind for any user.
      // Anything else must be a real user id.
      userId?: string;
    };

    // Normalize to a deduped channel list — supports the legacy single
    // `channelId`, the new `channelIds[]`, and the "*" = all-channels sentinel.
    const channels = Array.from(
      new Set(
        (Array.isArray(channelIds) ? channelIds : channelId ? [channelId] : [])
          .map((c) => (typeof c === "string" ? c.trim() : ""))
          .filter(Boolean),
      ),
    );

    if (channels.length === 0 || !entryAgentSlug?.trim() || !workflowId?.trim()) {
      res.status(400).json({ success: false, error: "channelId(s), entryAgentSlug, workflowId are required" });
      return;
    }

    // Default to the requester so a binding is per-user unless explicitly
    // scoped (e.g. an admin binding for another user, or "*" for any user).
    const targetUserId = userId?.trim() || requesterId;

    if (targetUserId !== requesterId && !(await isClawAdmin(requesterId))) {
      res.status(403).json({ success: false, error: "Only an admin can bind a workflow for another user" });
      return;
    }

    const workflow = await agentChainWorkflowRepository.findWorkflowById(workflowId.trim());
    if (!workflow) { res.status(404).json({ success: false, error: "Workflow not found" }); return; }

    const allowed = await canAccessWorkflow(requesterId, workflow.createdByUserId);
    if (!allowed) { res.status(403).json({ success: false, error: "Not allowed to bind this workflow" }); return; }

    await agentChainWorkflowRepository.deleteStaleBindingsForWorkflow(
      workflowId.trim(),
      channels,
      entryAgentSlug.trim(),
      targetUserId,
    );

    const rows = await Promise.all(
      channels.map((c) =>
        agentChainWorkflowRepository.upsertBinding(
          c,
          entryAgentSlug.trim(),
          workflowId.trim(),
          requesterId,
          enabled ?? true,
          targetUserId,
        ),
      ),
    );

    // Back-compat: legacy single-channel callers get a single object; the new
    // multi-channel shape returns the array.
    res.json({ success: true, data: Array.isArray(channelIds) ? rows : rows[0] });
  } catch (err) {
    log.error("[chain-workflows] upsert binding error:", err);
    const msg = errMsg(err);
    res.status(500).json({ success: false, error: msg });
  }
});

router.patch("/bindings/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const binding = await agentChainWorkflowRepository.findBindingById(req.params.id);
  if (!binding) throw notFound("Binding not found");

  const allowed = await canAccessWorkflow(requesterId, binding.workflow.createdByUserId);
  if (!allowed) throw forbidden("Not allowed to update this binding");

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") throw badRequest("enabled (boolean) is required");

  const row = await agentChainWorkflowRepository.setBindingEnabled(req.params.id, enabled);
  ok(res, row);
}));

router.delete("/bindings/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const binding = await agentChainWorkflowRepository.findBindingById(req.params.id);
  if (!binding) throw notFound("Binding not found");

  const allowed = await canAccessWorkflow(requesterId, binding.workflow.createdByUserId);
  if (!allowed) throw forbidden("Not allowed to delete this binding");

  await agentChainWorkflowRepository.deleteBinding(req.params.id);
  ok(res);
}));

router.get("/bindings/resolve", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const channelId = typeof req.query["channelId"] === "string" ? req.query["channelId"].trim() : "";
  const entryAgentSlug = typeof req.query["entryAgentSlug"] === "string" ? req.query["entryAgentSlug"].trim() : "";
  // Which user's binding to resolve — defaults to the requester (self).
  const userId = typeof req.query["userId"] === "string" && req.query["userId"].trim()
    ? req.query["userId"].trim()
    : requesterId;

  if (!channelId || !entryAgentSlug) {
    throw badRequest("channelId and entryAgentSlug are required");
  }

  const row = await agentChainWorkflowRepository.getBinding(channelId, entryAgentSlug, userId);
  if (!row) {
    ok(res, null);
    return;
  }

  const admin = await isClawAdmin(requesterId);
  if (!admin && row.createdByUserId !== requesterId && row.workflow.createdByUserId !== requesterId) {
    throw forbidden("Not allowed to read this binding");
  }

  ok(res, row);
}));

// ── "Push to global" request queue ────────────────────────────────────────
//   owner requests                → POST /:id/request-global
//   admin lists pending           → GET  /global-requests        (admin-only)
//   admin approves                → POST /global-requests/:id/approve (admin)
//   admin rejects                 → POST /global-requests/:id/reject  (admin)
//   owner cancels own pending     → POST /global-requests/:id/cancel
// NOTE: these are declared BEFORE the "/:id" routes so the literal
// "global-requests" path isn't captured as a workflow id.

router.post("/:id/request-global", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id required");
  }
  const workflow = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
  if (!workflow) {
    throw notFound("Workflow not found");
  }
  if (!(await canAccessWorkflow(requesterId, workflow.createdByUserId))) {
    throw forbidden("Not allowed to request promotion for this workflow");
  }
  if (workflow.global) {
    ok(res, { alreadyGlobal: true });
    return;
  }
  const request = await agentChainWorkflowRepository.createGlobalRequest(workflow.id, requesterId);
  ok(res, request);
}));

router.get("/global-requests", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId || !(await isClawAdmin(requesterId))) {
    throw forbidden("Admin access required");
  }
  const scope = getAdminOrgScope(req, "/chain-workflows/global-requests");
  // TODO(admin-org-scope): workflow_global_requests has no orgId; scope through requestedByUserId.
  const requestUserIds = scope.orgId
    ? await prisma.user.findMany({
      where: { orgId: scope.orgId },
      select: { id: true },
    }).then((users) => users.map((u) => u.id))
    : undefined;
  const rows = await agentChainWorkflowRepository.listPendingGlobalRequests(requestUserIds);
  // Attach requester display info (plain id → name/email).
  const userIds = Array.from(new Set(rows.map((r) => r.requestedByUserId)));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, orgId: true } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const orgNames = scope.allOrgs ? await getOrgNameMap(users.map((u) => u.orgId)) : new Map();
  ok(res, rows.map((r) => {
    const user = userMap.get(r.requestedByUserId);
    return {
      ...r,
      ...(scope.allOrgs ? withOrgLabel({ orgId: user?.orgId ?? null }, orgNames) : {}),
      requestedByUser: user ?? null,
    };
  }));
}));

router.post("/global-requests/:id/approve", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId || !(await isClawAdmin(requesterId))) {
    throw forbidden("Admin access required");
  }
  const result = await agentChainWorkflowRepository.approveGlobalRequest(req.params.id, requesterId);
  if (!result) {
    throw new HttpError(409, "Request not found or no longer pending");
  }
  ok(res, result);
}));

router.post("/global-requests/:id/reject", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId || !(await isClawAdmin(requesterId))) {
    throw forbidden("Admin access required");
  }
  const note = typeof (req.body as { note?: unknown })?.note === "string" ? (req.body as { note: string }).note : undefined;
  const result = await agentChainWorkflowRepository.rejectGlobalRequest(req.params.id, requesterId, note);
  ok(res, result);
}));

router.post("/global-requests/:id/cancel", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id required");
  }
  const reqRow = await agentChainWorkflowRepository.findGlobalRequestById(req.params.id);
  if (!reqRow) {
    throw notFound("Request not found");
  }
  const isAdmin = await isClawAdmin(requesterId);
  if (!isAdmin && reqRow.requestedByUserId !== requesterId) {
    throw forbidden("Not allowed to cancel this request");
  }
  const result = await agentChainWorkflowRepository.cancelGlobalRequest(req.params.id);
  ok(res, result);
}));

router.get("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const row = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
  if (!row) throw notFound("Workflow not found");

  const allowed = await canAccessWorkflow(requesterId, row.createdByUserId);
  if (!allowed) throw forbidden("Not allowed to read this workflow");

  ok(res, row);
}));

router.put("/:id", asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");

  const existing = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
  if (!existing) throw notFound("Workflow not found");

  const allowed = await canAccessWorkflow(requesterId, existing.createdByUserId);
  if (!allowed) throw forbidden("Not allowed to update this workflow");

  const { name, definition, isPublished, triggers, useCreatorCredentials } = req.body as {
    name?: string;
    definition?: unknown;
    isPublished?: boolean;
    triggers?: TriggerPayloadItem[] | null;
    useCreatorCredentials?: boolean;
  };

  // Credential consent can only be CHANGED by the credential owner (the
  // workflow creator) — an admin editing someone else's workflow must not be
  // able to consent on the owner's behalf. Only enforce/apply when the
  // requested value actually differs from the stored state, so that an admin
  // saving other fields (and echoing back the same flag) isn't blocked.
  const hasConsent = existing.credentialUserId != null;
  const consentChanged = useCreatorCredentials !== undefined && useCreatorCredentials !== hasConsent;
  if (consentChanged && requesterId !== existing.createdByUserId) {
    throw forbidden("Only the workflow owner can change credential consent");
  }

  // Names are unique per creator. On an explicit rename, reject a collision
  // with a clear 409 (rather than auto-suffixing — the user typed this name on
  // purpose). Checked against the OWNER's namespace, since an admin may edit
  // someone else's workflow. No-op renames (same name) are allowed.
  if (name !== undefined && name.trim() !== existing.name) {
    const taken = await agentChainWorkflowRepository.nameTaken(
      existing.createdByUserId,
      name.trim(),
      existing.id,
    );
    if (taken) {
      throw new HttpError(409, `A workflow named "${name.trim()}" already exists`);
    }
  }

  let parsedDefinition: WorkflowDefinition | undefined;
  if (definition !== undefined) {
    parsedDefinition = parseWorkflowDefinition(definition) ?? undefined;
    if (!parsedDefinition) throw badRequest("definition is invalid");
    const validationError = validateWorkflowDefinition(parsedDefinition);
    if (validationError) throw badRequest(validationError);
  }

  const updateData: Prisma.AgentChainWorkflowUpdateInput = {
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(parsedDefinition !== undefined ? { definition: JSON.parse(JSON.stringify(parsedDefinition)) as Prisma.InputJsonValue } : {}),
    ...(typeof isPublished === "boolean" ? { isPublished } : {}),
    ...(consentChanged
      ? { credentialUserId: useCreatorCredentials ? existing.createdByUserId : null }
      : {}),
  };

  await agentChainWorkflowRepository.updateWorkflow(req.params.id, updateData);

  // Sync triggers if provided.
  if (triggers !== undefined) {
    const entryAgentSlug = parsedDefinition?.nodes[0]?.agentSlug
      ?? parseWorkflowDefinition(existing.definition)?.nodes[0]?.agentSlug
      ?? "";
    await syncWorkflowTriggers({
      workflowId: req.params.id,
      workflowName: name?.trim() || existing.name,
      entryAgentSlug,
      requesterId,
      existingTriggers: parseTriggers(existing.triggers),
      newTriggers: triggers,
    });
  }

  const row = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
  ok(res, row);
}));

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const existing = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
    if (!existing) { res.status(404).json({ success: false, error: "Workflow not found" }); return; }

    const allowed = await canAccessWorkflow(requesterId, existing.createdByUserId);
    if (!allowed) { res.status(403).json({ success: false, error: "Not allowed to delete this workflow" }); return; }

    // Delete all linked Spaces automations BEFORE removing the workflow. If any
    // fails (expired Spaces token, Spaces unreachable), abort the workflow delete
    // and surface it — otherwise the automation is orphaned: still firing in
    // Spaces, with no claw workflow left to retry the cleanup from.
    const existingTriggers = parseTriggers(existing.triggers);
    const failed: string[] = [];
    for (const t of existingTriggers) {
      for (const c of t.channels) {
        if (!c.spacesAutomationId) continue;
        const result = await callSpacesAutomations(requesterId, "DELETE", `/${c.spacesAutomationId}`);
        if (!result) failed.push(c.spacesAutomationId);
      }
    }
    if (failed.length > 0) {
      log.error(
        `[chain-workflows] delete ${req.params.id}: ${failed.length} Spaces automation(s) failed to archive (${failed.join(", ")}) — aborting workflow delete so it can be retried`,
      );
      res.status(502).json({
        success: false,
        error: `Couldn't remove ${failed.length} linked Spaces automation(s). The workflow was NOT deleted — please retry.`,
        data: { failedSpacesAutomationIds: failed },
      });
      return;
    }

    await agentChainWorkflowRepository.deleteWorkflow(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }
    log.error("[chain-workflows] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

function buildTriggerInitialMessage(triggerPayload: Record<string, unknown> | undefined): string {
  if (!triggerPayload) return "Automation event triggered.";
  const type = triggerPayload["type"] as string | undefined;
  if (type === "BITBUCKET_EVENT") {
    const eventType = triggerPayload["eventType"] as string | undefined;
    const pr = triggerPayload["pr"] as Record<string, unknown> | null | undefined;
    const repo = triggerPayload["repository"] as Record<string, unknown> | undefined;
    if (pr && repo) {
      return `Bitbucket ${eventType ?? "event"}: PR #${pr["id"]} — ${pr["title"]} (${repo["projectKey"]}/${repo["name"]})`;
    }
    return `Bitbucket event: ${eventType ?? "unknown"}`;
  }
  return `Automation event triggered: ${type ?? "unknown"}`;
}

router.post("/:id/trigger", requireS2S, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { userId, triggerPayload, conversationId: bodyConversationId, targetChannelId } = req.body as {
    userId?: string;
    triggerPayload?: Record<string, unknown>;
    conversationId?: string;
    targetChannelId?: string;
  };

  if (!userId) throw badRequest("userId is required");

  const workflow = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
  if (!workflow) throw notFound("Workflow not found");

  // Credential-resolution identity. If the owner consented to lend their
  // creds (credentialUserId set), the run resolves tools/MCP as THAT user —
  // independent of whatever identity the trigger supplied. Otherwise fall
  // back to the trigger-supplied userId.
  const effectiveUserId = workflow.credentialUserId ?? userId;
  const workflowOrgId = getOrgId(req)
    ?? (await prisma.user.findUnique({
      where: { id: workflow.credentialUserId ?? workflow.createdByUserId },
      select: { orgId: true },
  }))?.orgId;
  if (!workflowOrgId) {
    log.error(`[chain-workflows/trigger] orgId is required workflowId=${workflow.id} routeWorkflowId=${req.params.id} userId=${userId} effectiveUserId=${effectiveUserId} ownerUserId=${workflow.createdByUserId} credentialUserId=${workflow.credentialUserId ?? "none"} conversationId=${bodyConversationId ?? "none"} targetChannelId=${targetChannelId ?? "none"}`);
    throw badRequest("orgId is required");
  }

  const definition = parseWorkflowDefinition(workflow.definition);
  if (!definition || definition.nodes.length === 0) {
    throw badRequest("Workflow has no nodes");
  }

  const entryAgentSlug = definition.nodes[0]!.agentSlug;

  const msgPayload = triggerPayload?.["message"] as Record<string, unknown> | undefined;
  const emailPayload = triggerPayload?.["email"] as Record<string, unknown> | undefined;
  const callPayload = triggerPayload?.["call"] as Record<string, unknown> | undefined;
  const ticketPayload = triggerPayload?.["ticket"] as Record<string, unknown> | undefined;
  const authorPayload = triggerPayload?.["author"] as Record<string, unknown> | undefined;
  const requesterPayload = triggerPayload?.["requester"] as Record<string, unknown> | undefined;

  let conversationId: string | undefined =
    (triggerPayload?.["conversationId"] as string | undefined) ??
    (msgPayload?.["conversationId"] as string | undefined) ??
    (emailPayload?.["conversationId"] as string | undefined) ??
    (callPayload?.["conversationId"] as string | undefined) ??
    (ticketPayload?.["conversationId"] as string | undefined) ??
    bodyConversationId;

  let channelId: string =
    (msgPayload?.["channelId"] as string | undefined) ??
    (emailPayload?.["channelId"] as string | undefined) ??
    (callPayload?.["channelId"] as string | undefined) ??
    (ticketPayload?.["channelId"] as string | undefined) ??
    targetChannelId ?? "";

  const senderId =
    (triggerPayload?.["authorId"] as string | undefined) ??
    (requesterPayload?.["email"] as string | undefined) ??
    userId;

  const senderName =
    (authorPayload?.["name"] as string | undefined) ??
    (requesterPayload?.["name"] as string | undefined) ??
    userId;

  const task = triggerPayload
    ? `Automation event triggered. Payload: ${JSON.stringify(triggerPayload)}`
    : "Automation event triggered.";

  if (!conversationId) {
    try {
      // Resolve channelId from workflow bindings if not in payload.
      if (!channelId) {
        const bindings = await agentChainWorkflowRepository.findBindingsByWorkflowId(req.params.id);
        if (bindings.length > 0) {
          channelId = bindings[0]!.channelId;
          log.info(`[chain-workflows/trigger] resolved channelId=${channelId} from workflow binding`);
        }
      }

      // Fallback: look up first channel from triggers JSON.
      if (!channelId) {
        const triggers = parseTriggers(workflow.triggers);
        for (const t of triggers) {
          if (t.channels.length > 0) {
            channelId = t.channels[0]!.channelId;
            log.info(`[chain-workflows/trigger] resolved channelId=${channelId} from trigger JSON`);
            break;
          }
        }
      }

      if (channelId) {
        const agentRecord = await agentRepository.findBySlug(entryAgentSlug, workflowOrgId);
        if (agentRecord?.spacesAppToken) {
          const [ciphertext, iv, authTag] = agentRecord.spacesAppToken.split(":");
          const appToken = ciphertext && iv && authTag
            ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey) : "";
          if (appToken) {
            const initialMessage = buildTriggerInitialMessage(triggerPayload);
            const postResult = (await spacesAppFetch("/chat/postMessage", {
              channelId, text: initialMessage,
            }, appToken)) as { conversationId?: string };
            if (postResult.conversationId) {
              conversationId = postResult.conversationId;
              log.info(`[chain-workflows/trigger] created conversation ${conversationId} in channel ${channelId}`);
            }
          }
        }
      }
    } catch (err) {
      log.warn(`[chain-workflows/trigger] could not auto-create conversation:`,
        errMsg(err));
    }
  }

  const entryAgentRecord = await agentRepository.findBySlug(entryAgentSlug, workflowOrgId);
  if (!entryAgentRecord) {
    log.warn(`[chain-workflows/trigger] agent org-scoped miss slug=${entryAgentSlug} orgId=${workflowOrgId ?? "none"} workflowId=${workflow.id} userId=${userId}`);
    throw notFound(`agent "${entryAgentSlug}" not found`);
  }
  const dispatchOrgId = entryAgentRecord.orgId;

  log.info(`[chain-workflows/trigger] workflowId=${req.params.id} entryAgent=${entryAgentSlug} userId=${effectiveUserId}${workflow.credentialUserId ? " (creator-creds consent)" : ""} conversationId=${conversationId} channelId=${channelId}`);

  const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      userId: effectiveUserId, task, agentSlug: entryAgentSlug,
      orgId: dispatchOrgId,
      context: triggerPayload ?? {}, conversationId,
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => "");
    log.error(`[chain-workflows] /run failed ${runRes.status}: ${text.slice(0, 200)}`);
    throw new HttpError(500, "Failed to start agent run");
  }

  const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };

  if (runBody.sessionId && conversationId) {
    try {
      if (entryAgentRecord?.spacesAppToken && entryAgentRecord.spacesAppId) {
        const [ciphertext, iv, authTag] = entryAgentRecord.spacesAppToken.split(":");
        const appToken = ciphertext && iv && authTag
          ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey) : "";
        const sessionContext: SessionContext = {
          mentionedUserId: entryAgentRecord.spacesAppUserId ?? userId,
          senderId, senderName, channelId,
          channelName: channelId, conversationId,
          task, agentSlug: entryAgentSlug,
          agentId: entryAgentRecord.id,
          agentOrgId: entryAgentRecord.orgId,
          responseMode: "conversation", appToken,
          spacesAppId: entryAgentRecord.spacesAppId,
          spacesAppUserId: entryAgentRecord.spacesAppUserId ?? "",
        };
        await setSession(runBody.sessionId, sessionContext);
        log.info(`[chain-workflows/trigger] stored session ctx sessionId=${runBody.sessionId} conversationId=${conversationId}`);
      }
    } catch (sessionErr) {
      log.error(`[chain-workflows/trigger] failed to store session context:`, sessionErr);
    }
  }

  ok(res, { sessionId: runBody.sessionId });
}));

export { router as chainWorkflowsRouter };
