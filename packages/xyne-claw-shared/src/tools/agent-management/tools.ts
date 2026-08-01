/**
 * Agent- and subagent-management custom tools — let an agent author and revise
 * Claw agents and subagent definitions with human approval, reusing the exact
 * HITL machinery that backs create-skill / update-skill rather than a new
 * approval system. See xyne-claw-shared/src/tools/skill-management/tools.ts for
 * the sibling implementation these mirror.
 *
 *   create-agent     → WRITE tool. The pod signs a pending action; claw-auth's
 *   create-subagent    webhook renders an Approve/Decline card to the REQUESTER
 *                      (self-approval of a draft). On approve, flow-action's
 *                      `serverType==="agent"` / `"subagent"` branch persists the
 *                      row owned by the approver in their org. Nothing is written
 *                      until approval.
 *
 *   update-agent     → NON-write tools that PROPOSE a change. They cannot
 *   update-subagent    self-apply because the approver is the agent's / subagent's
 *                      OWNER, who may be a different user. execute() posts to
 *                      claw-auth's /agents/:slug/propose-update (or
 *                      /subagents/:name/propose-update), which applies the
 *                      systemPrompt edits + scalar changes to a working copy,
 *                      computes the diff, records an AgentRequest, and DMs the
 *                      owner a card showing the diff. The owner's click drives the
 *                      actual update via flow-action's `actionType==="agent-update"`
 *                      / `"subagent-update"`.
 *
 * As with skills, persistence is deliberately kept OUT of the pod: the pod never
 * has DB access, and centralizing the write in claw-auth keeps one source of
 * truth (and one place that enforces ownership + validation).
 */

import type { ToolDefinition, ToolExecutionContext, ToolInputSchema } from "../types.js";

// ── Result envelope ──────────────────────────────────────────────────────────
// Every execute() returns a JSON string the model parses. These two helpers are
// the only places that define its shape.

function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

function toolOk(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

// ── Param parsing ────────────────────────────────────────────────────────────

/** Slugs must be lowercase kebab so they map cleanly to the DB unique key. */
function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Optional string param → trimmed value, or undefined for absent/empty. */
function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Optional list of tool slugs / subagent names → trimmed + deduped, or undefined. */
function asNameList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  const deduped = [...new Set(names)];
  return deduped.length > 0 ? deduped : undefined;
}

/** An anchored replacement applied to the current systemPrompt. */
interface PromptEdit {
  oldText: string;
  newText: string;
}

function asPromptEdit(value: unknown): PromptEdit | null {
  if (value === null || typeof value !== "object") return null;
  const { oldText, newText } = value as { oldText?: unknown; newText?: unknown };
  if (typeof oldText !== "string" || oldText.length === 0) return null;
  if (typeof newText !== "string") return null;
  return { oldText, newText };
}

/**
 * Parse params["promptEdits"]. Malformed entries are an ERROR, not silently
 * dropped: skipping one edit out of several would propose a partial prompt
 * change the model never intended, and the owner would approve a wrong diff.
 */
function parsePromptEdits(raw: unknown): { edits: PromptEdit[] } | { error: string } {
  if (raw === undefined || raw === null) return { edits: [] };
  if (!Array.isArray(raw)) {
    return { error: "promptEdits must be an array of {oldText, newText} objects." };
  }
  const edits: PromptEdit[] = [];
  for (const [index, entry] of raw.entries()) {
    const edit = asPromptEdit(entry);
    if (!edit) {
      return { error: `promptEdits[${index}] is invalid: expected {oldText: non-empty string, newText: string}.` };
    }
    edits.push(edit);
  }
  return { edits };
}

/**
 * Collect the defined optional fields of `params` per a {field → parser} spec.
 * Only fields whose parser returns a value end up in the result — this replaces
 * per-field `...(x !== undefined ? { x } : {})` spreads at the call sites.
 */
type FieldParser = (value: unknown) => unknown;

function collectDefined(
  params: Record<string, unknown>,
  spec: Record<string, FieldParser>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, parse] of Object.entries(spec)) {
    const value = parse(params[field]);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

// ── claw-auth transport ──────────────────────────────────────────────────────
// Env is read lazily inside execute() (not at module load) so the values are
// picked up from the pod environment at call time and are trivially stubbable
// in tests.

function authUrl(): string {
  return (process.env["XYNE_CLAW_AUTH_URL"] ?? "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003").replace(/\/$/, "");
}

function s2sKey(): string {
  return process.env["XYNE_CLAW_S2S_KEY"] ?? "";
}

/** Who is proposing, and as which agent — read from the tool context. */
function resolveProposer(
  context: ToolExecutionContext | undefined,
): { userId: string; agentSlug: string | undefined } | { error: string } {
  const userId = context?.meta?.["userId"];
  if (!userId) return { error: "Cannot propose update: missing requesting user id in tool context." };
  return { userId, agentSlug: context?.meta?.["agentSlug"] };
}

/**
 * POST to a claw-auth propose-update route. Both update tools speak the same
 * request shape (systemPrompt edits + scalar overrides + tools + summary) and
 * interpret the same status codes, so the transport lives here once.
 */
async function proposeUpdate(
  path: string,
  targetLabel: "Agent" | "Subagent",
  body: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<string> {
  const proposer = resolveProposer(context);
  if ("error" in proposer) return toolError(proposer.error);
  const key = s2sKey();
  if (!key) {
    return toolError("XYNE_CLAW_S2S_KEY not set in claw-pod environment — the update tool cannot authenticate to claw-auth.");
  }

  const url = `${authUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-s2s-key": key,
        "x-user-id": proposer.userId,
      },
      body: JSON.stringify({ ...body, agentSlug: proposer.agentSlug }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to reach claw-auth at ${url}: ${msg}`);
  }

  const text = await res.text();
  let json: { success?: boolean; error?: string; data?: unknown } = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }

  if (res.status === 404) return toolError(`${targetLabel} not found in your org. Check the slug/name.`);
  if (res.status === 409) return toolError(json.error ?? "Your update is identical to the current definition — nothing to propose.");
  if (!res.ok || json.success === false) return toolError(json.error ?? `propose-update failed (HTTP ${res.status})`);

  return toolOk({
    status: "proposed",
    message: `Update proposed. The ${targetLabel.toLowerCase()} owner has been sent a DM showing the diff and can approve or decline it.`,
    data: json.data ?? null,
  });
}

// ── Shared schema fragments (identical across the two update tools) ──────────

const PROMPT_EDITS_SCHEMA = {
  type: "array",
  description: "PREFERRED for system-prompt changes. Anchored replacements applied in order to the CURRENT system prompt. Each oldText must appear exactly once.",
  items: {
    type: "object",
    properties: {
      oldText: { type: "string", description: "Exact snippet copied from the current system prompt (unique within it)." },
      newText: { type: "string", description: "Replacement text (empty string deletes the snippet)." },
    },
    required: ["oldText", "newText"],
  },
} as const;

const SYSTEM_PROMPT_SCHEMA = {
  type: "string",
  description: "Full system-prompt replacement — small prompts (<~8K chars) only; rejected for larger ones. Prefer `promptEdits`.",
} as const;

const SUMMARY_SCHEMA = {
  type: "string",
  description: "Optional short note describing what changed and why — shown to the owner alongside the diff.",
} as const;

function toolListSchema(description: string): Record<string, unknown> {
  return { type: "array", description, items: { type: "string" } };
}

// ── Shared update executor ───────────────────────────────────────────────────

/**
 * Build the execute() for an update tool. The two tools differ only in how the
 * target is identified, which scalar fields they accept, and which route they
 * post to — everything else (promptEdits parsing, nothing-to-update guard,
 * transport) is identical.
 */
function makeUpdateExecute(opts: {
  targetLabel: "Agent" | "Subagent";
  /** Param that identifies the target ("slug" or "name") + how to clean it. */
  idParam: "slug" | "name";
  cleanId: (raw: string) => string;
  /** Optional body fields: {field → parser}. `summary` is included here but is
   *  a note, not a change — see the nothing-to-update guard. */
  bodyFields: Record<string, FieldParser>;
  /** Human list of the change-carrying fields, for the nothing-to-update error. */
  changeFieldsHint: string;
  routeFor: (id: string) => string;
}): ToolDefinition["execute"] {
  return async (params, context) => {
    const rawId = typeof params[opts.idParam] === "string" ? (params[opts.idParam] as string) : "";
    const id = opts.cleanId(rawId);
    if (!id) return toolError(`${opts.idParam} is required`);

    const parsed = parsePromptEdits(params["promptEdits"]);
    if ("error" in parsed) return toolError(parsed.error);

    const body = collectDefined(params, opts.bodyFields);
    if (parsed.edits.length > 0) body["promptEdits"] = parsed.edits;

    // `summary` annotates a change; alone it is not one.
    const hasChange = parsed.edits.length > 0 || Object.keys(body).some((field) => field !== "summary");
    if (!hasChange) {
      return toolError(`Nothing to update: provide promptEdits/systemPrompt and/or a scalar field (${opts.changeFieldsHint}).`);
    }

    return proposeUpdate(opts.routeFor(id), opts.targetLabel, body, context);
  };
}

// ── create-agent / create-subagent ───────────────────────────────────────────

/** Fallback body for approval-gated write tools — the pod intercepts these in
 *  xyne-claw/custom-tools.ts BEFORE execute runs (it signs a pending action
 *  instead). This must never persist; the real create happens in claw-auth's
 *  flow-action branch after approval. */
function approvalGatedStub(what: string): ToolDefinition["execute"] {
  return async () =>
    `${what} is an approval-gated write tool: the user will receive an Approve/Decline card. The ${what.replace("create-", "")} is only created after they approve.`;
}

export const createAgentTool: ToolDefinition = {
  slug: "create-agent",
  name: "Create Agent",
  description:
    "Draft a NEW Claw agent and submit it for approval. " +
    "The user sees an Approve/Decline card with the agent name, description and system prompt; NOTHING is saved until they approve. " +
    "On approval the agent is created as a PERSONAL agent owned by the approving user in their org. " +
    "Provide: name (human title), slug (optional — auto-derived from name if omitted), description (one line shown in the agent picker), systemPrompt (the agent's instructions), and optionally modelId, color, and tools. " +
    "`tools` is a flat list of tool slugs (e.g. 'web-search') and/or subagent names to grant the agent; unknown entries are reported back and skipped. " +
    "Use this when the user asks you to 'create an agent', 'build me an agent', or 'set up a new agent'.",
  source: "custom:agent",
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable agent title, e.g. 'Ticket Triage'. Required." },
      slug: { type: "string", description: "Optional kebab-case slug, e.g. 'ticket-triage'. Auto-derived from name when omitted." },
      description: { type: "string", description: "One-line description shown in the agent picker. Required." },
      systemPrompt: { type: "string", description: "The agent's system prompt / instructions. Required." },
      modelId: { type: "string", description: "Optional model id (e.g. 'claude-sonnet-5'). Defaults to the org default when omitted." },
      color: { type: "string", description: "Optional hex color for the agent avatar, e.g. '#6366f1'." },
      tools: toolListSchema("Optional flat list of tool slugs and/or subagent names to grant this agent. Unknown entries are skipped and reported."),
    },
    required: ["name", "description", "systemPrompt"],
  },
  execute: approvalGatedStub("create-agent"),
};

export const createSubagentTool: ToolDefinition = {
  slug: "create-subagent",
  name: "Create Subagent",
  description:
    "Draft a NEW Claw subagent definition and submit it for approval. A subagent is a specialised worker an agent can delegate a single task to. " +
    "The user sees an Approve/Decline card; NOTHING is saved until they approve. On approval it is created in the approver's org, authored by them. " +
    "Provide: name (unique per org, used as the delegation tool name), description, systemPrompt (the subagent's instructions), paramName (the single input parameter name the caller passes, e.g. 'task'), paramDescription (what that parameter should contain), and optionally tools (a flat list of tool slugs the subagent may use). " +
    "Use this when the user asks you to 'create a subagent' or 'add a specialised worker'.",
  source: "custom:agent",
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Unique subagent name (per org), used as the delegation tool name, e.g. 'log-summarizer'. Required." },
      description: { type: "string", description: "One-line description of what the subagent does. Required." },
      systemPrompt: { type: "string", description: "The subagent's system prompt / instructions. Required." },
      paramName: { type: "string", description: "Name of the single input parameter the caller passes, e.g. 'task'. Required." },
      paramDescription: { type: "string", description: "What the input parameter should contain. Required." },
      tools: toolListSchema("Optional flat list of tool slugs the subagent may use. Unknown entries are skipped and reported."),
    },
    required: ["name", "description", "systemPrompt", "paramName", "paramDescription"],
  },
  execute: approvalGatedStub("create-subagent"),
};

// ── update-agent / update-subagent ───────────────────────────────────────────

export const updateAgentTool: ToolDefinition = {
  slug: "update-agent",
  name: "Update Agent",
  description:
    "Propose an update to an EXISTING Claw agent. You do not apply the change directly — the agent's owner receives a DM showing the diff and approves or declines it. " +
    "For the system prompt, PREFER `promptEdits`: an array of {oldText, newText} anchored replacements. oldText must be copied EXACTLY from the current prompt and be unique within it; newText replaces it. Edits scale with the CHANGE size, so they work on prompts of any length. " +
    "`systemPrompt` (full replacement) is a convenience for SMALL prompts only (<~8K chars); the server rejects full replacements of larger prompts because a big body does not survive as a tool argument (it gets truncated). " +
    "Scalar fields — description, modelId, color, name — may be given directly as new values; omit a field to leave it unchanged. " +
    "`tools` (a flat list of tool slugs / subagent names) REPLACES the agent's tool selection when provided. " +
    "Always read the current agent first so your oldText anchors are exact. Re-proposing is safe: a new proposal replaces your earlier still-pending one for the same agent.",
  source: "custom:agent",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Slug of the existing agent to update, e.g. 'ticket-triage'. Required." },
      promptEdits: PROMPT_EDITS_SCHEMA,
      systemPrompt: SYSTEM_PROMPT_SCHEMA,
      name: { type: "string", description: "Optional new human-readable title." },
      description: { type: "string", description: "Optional new one-line description." },
      modelId: { type: "string", description: "Optional new model id." },
      color: { type: "string", description: "Optional new hex color." },
      tools: toolListSchema("Optional flat list of tool slugs / subagent names — REPLACES the agent's current tool selection when provided."),
      summary: SUMMARY_SCHEMA,
    },
    required: ["slug"],
  },
  execute: makeUpdateExecute({
    targetLabel: "Agent",
    idParam: "slug",
    cleanId: normalizeSlug,
    bodyFields: {
      systemPrompt: asTrimmedString,
      name: asTrimmedString,
      description: asTrimmedString,
      modelId: asTrimmedString,
      color: asTrimmedString,
      tools: asNameList,
      summary: asTrimmedString,
    },
    changeFieldsHint: "name, description, modelId, color, tools",
    routeFor: (slug) => `/claw/api/v1/agents/${encodeURIComponent(slug)}/propose-update`,
  }),
};

export const updateSubagentTool: ToolDefinition = {
  slug: "update-subagent",
  name: "Update Subagent",
  description:
    "Propose an update to an EXISTING Claw subagent definition. You do not apply the change directly — the subagent's owner receives a DM showing the diff and approves or declines it. " +
    "For the system prompt, PREFER `promptEdits`: an array of {oldText, newText} anchored replacements copied EXACTLY from the current prompt (each unique). `systemPrompt` full replacement is allowed for SMALL prompts only (<~8K chars); larger full replacements are rejected (truncation risk). " +
    "Scalar fields — description, paramName, paramDescription — may be given directly as new values; omit to leave unchanged. `tools` (a flat list of tool slugs) REPLACES the subagent's tool selection when provided. " +
    "Identify the subagent by its `name`. Always read the current subagent first so your oldText anchors are exact. Re-proposing replaces your earlier still-pending proposal for the same subagent.",
  source: "custom:agent",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the existing subagent to update, e.g. 'log-summarizer'. Required." },
      promptEdits: PROMPT_EDITS_SCHEMA,
      systemPrompt: SYSTEM_PROMPT_SCHEMA,
      description: { type: "string", description: "Optional new one-line description." },
      paramName: { type: "string", description: "Optional new input parameter name." },
      paramDescription: { type: "string", description: "Optional new input parameter description." },
      tools: toolListSchema("Optional flat list of tool slugs — REPLACES the subagent's current tool selection when provided."),
      summary: SUMMARY_SCHEMA,
    },
    required: ["name"],
  },
  execute: makeUpdateExecute({
    targetLabel: "Subagent",
    idParam: "name",
    cleanId: (raw) => raw.trim(),
    bodyFields: {
      systemPrompt: asTrimmedString,
      description: asTrimmedString,
      paramName: asTrimmedString,
      paramDescription: asTrimmedString,
      tools: asNameList,
      summary: asTrimmedString,
    },
    changeFieldsHint: "description, paramName, paramDescription, tools",
    routeFor: (name) => `/claw/api/v1/subagents/${encodeURIComponent(name)}/propose-update`,
  }),
};
