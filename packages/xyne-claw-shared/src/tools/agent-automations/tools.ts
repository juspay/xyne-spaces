import type { ToolDefinition } from "../types.js";

/**
 * propose-automation — an agent proposes a self-wakeup automation bound to the
 * CURRENT thread. It does NOT activate anything: the proposal lands in
 * PENDING_APPROVAL and a human must approve it before the webhook URL is issued.
 * This is the HITL gate — an agent can never open its own live endpoint.
 *
 * On approval, a generic signed webhook wakes this agent INSIDE this same
 * conversation each time a matching event arrives. The proposal captures the
 * event contract (declared body/header schema + optional predicate) and,
 * optionally, per-source signature verification.
 *
 * Same config + S2S transport as schedule-task: POST to claw-auth with x-s2s-key,
 * identity (userId/agentSlug/conversationId/channelId) sourced from meta.
 */

export const AGENT_AUTOMATIONS_CONFIG_SCHEMA = {
  XYNE_CLAW_AUTH_URL: {
    label: "Claw Auth Service URL",
    default: "http://localhost:3003",
    required: true as const,
    placeholder: "http://localhost:3003",
  },
  XYNE_CLAW_S2S_KEY: {
    label: "Claw S2S Key (for /agent-automations auth)",
    default: "",
    required: false as const,
    placeholder: "Shared secret between xyne-claw and xyne-claw-auth",
  },
};

export const proposeAutomation: ToolDefinition = {
  slug: "propose-automation",
  name: "Propose Automation",
  description:
    "Propose an event-driven automation that wakes YOU (this agent) on THIS thread when a " +
    "matching external event arrives — e.g. 'when a comment is added to PR #123, resume here and " +
    "summarise it'. This does NOT activate anything: it creates a PENDING proposal that a human " +
    "must approve. Only on approval is a unique signed webhook URL issued; each matching delivery " +
    "then resumes you inside this same conversation with the event payload as context.\n\n" +
    "Provide `taskTemplate`: the instruction you should run on each wakeup (write it so it makes " +
    "sense with the event body available). Optionally constrain what is accepted:\n" +
    "- `bodySchema` / `headerSchema`: declared field→type shape; non-matching payloads are rejected (400).\n" +
    "- `matchPredicate`: flat dot-path→value equality to scope to ONE resource (e.g. {\"pull_request.number\": 123}).\n" +
    "- `verifySource` + `signingSecret`: optional signature check on top of the URL secret " +
    "(github-hmac-sha256 | hmac-sha256 | header-token).\n" +
    "- `maxRuns` / `expiresInDays`: bound the lifetime.\n\n" +
    "Call this once with the full proposal; then tell the user it is pending their approval.",
  source: "custom:agent-automations",
  configSchema: AGENT_AUTOMATIONS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskTemplate: {
        type: "string",
        description: "The instruction the agent runs on each event wakeup, in this thread.",
      },
      summary: {
        type: "string",
        description: "One line shown to the user describing what this automation does and why.",
      },
      source: {
        type: "string",
        description: "Free-form event source label (e.g. 'github', 'stripe', 'generic'). Does not change behavior.",
      },
      eventType: {
        type: "string",
        description: "Free-form event type label (e.g. 'pull_request.comment'). Does not change behavior.",
      },
      bodySchema: {
        type: "object",
        description: "Declared body shape: nested record of field→type ('string'|'number'|'boolean'|'object'|'array'). Payloads that don't match are rejected.",
        additionalProperties: true,
      },
      headerSchema: {
        type: "object",
        description: "Declared header shape, same format as bodySchema.",
        additionalProperties: true,
      },
      matchPredicate: {
        type: "object",
        description: "Flat dot-path→value equality map scoping to one resource, e.g. {\"pull_request.number\": 123}. All pairs must match (AND).",
        additionalProperties: true,
      },
      verifySource: {
        type: "string",
        enum: ["github-hmac-sha256", "hmac-sha256", "header-token"],
        description: "Optional signature verifier applied on top of the URL secret. Requires signingSecret.",
      },
      signingSecret: {
        type: "string",
        description: "Shared secret for the chosen verifySource. Stored encrypted; required if verifySource is set.",
      },
      signatureHeader: {
        type: "string",
        description: "Header carrying the signature/token; overrides the verifier's default (e.g. x-hub-signature-256).",
      },
      maxRuns: {
        type: "number",
        description: "Optional cap on total wakeups before the automation stops.",
      },
      expiresInDays: {
        type: "number",
        description: "Optional lifetime in days; after this the automation expires and stops matching.",
      },
    },
    required: ["taskTemplate"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const meta = context.meta ?? {};
    const userId = meta["userId"];
    const agentSlug = meta["agentSlug"];
    const conversationId = meta["conversationId"];

    if (!userId)
      return "Error: Cannot propose automation — no user identity available in execution context.";
    if (!agentSlug)
      return "Error: Cannot propose automation — no agent slug available in execution context.";
    if (!conversationId)
      return "Error: Cannot propose automation — no conversation to bind the wakeup to.";

    const verifySource = params["verifySource"] as string | undefined;
    if (verifySource && !params["signingSecret"]) {
      return "Error: signingSecret is required when verifySource is set.";
    }

    const expiresInDays = params["expiresInDays"] as number | undefined;
    const expiresAt =
      typeof expiresInDays === "number" && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
        : undefined;

    const authUrl = context.config["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003";
    const s2sKey = context.config["XYNE_CLAW_S2S_KEY"] ?? "";

    const body: Record<string, unknown> = {
      userId,
      agentSlug,
      conversationId,
      channelId: meta["channelId"],
      workspaceId: meta["workspaceId"],
      taskTemplate: params["taskTemplate"],
      source: params["source"] ?? "generic",
      eventType: params["eventType"] ?? "webhook",
      bodySchema: params["bodySchema"],
      headerSchema: params["headerSchema"],
      matchPredicate: params["matchPredicate"],
      verifySource,
      signingSecret: params["signingSecret"],
      signatureHeader: params["signatureHeader"],
      maxRuns: params["maxRuns"],
      expiresAt,
    };

    try {
      const res = await fetch(`${authUrl}/claw/api/v1/agent-automations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        id?: string;
        status?: string;
        error?: string;
      } | null;

      if (!res.ok || !data?.success) {
        return `Error proposing automation: ${data?.error ?? res.statusText}`;
      }

      const summary = (params["summary"] as string) ?? (params["taskTemplate"] as string);
      return (
        `Proposed automation "${summary}" (id: ${data.id}, status: ${data.status ?? "PENDING_APPROVAL"}). ` +
        "It is NOT active yet — a human must approve it, after which a unique signed webhook URL is " +
        "issued and each matching event will resume this agent on this thread. Tell the user it is " +
        "pending their approval."
      );
    } catch (err) {
      return `Error proposing automation: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
