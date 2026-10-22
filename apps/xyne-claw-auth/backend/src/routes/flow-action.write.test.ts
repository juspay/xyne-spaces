import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    signatureOk: true,
    automationCard: false,
    legacyCard: false,
    users: new Map<string, { orgId: string; name?: string }>(),
    agent: {
      id: "agent-1",
      orgId: "org-1",
      slug: "doctor",
      name: "Doctor",
      spacesAppToken: "c:i:t",
      spacesAppUserId: "bot-user",
      spacesAppId: "app-1",
    } as Record<string, unknown> | null,
    connector: true,
    credentials: { credentials: { token: "x" }, source: "user", instance: "i" } as unknown,
    callTool: vi.fn(async () => ({ content: "Created ticket XYNE-1" })),
    harnessHandled: false,
    fetchCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
    agentToolOutcome: { ok: true, message: "Agent updated" } as Record<string, unknown>,
    skillOutcome: { status: "created", id: "s1", slug: "skill", name: "Skill", message: "Skill created" } as Record<string, unknown>,
  };
  return { state };
});

vi.mock("../config.js", () => ({
  CONFIG: { spacesInternalUrl: "http://spaces", internalUrl: "http://claw-auth", encryptionKey: "k", xyneClawS2sKey: "s2s" },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../db.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.state.users.get(where.id) ?? null),
    },
    agent: {
      findFirst: vi.fn(async () => h.state.agent),
      findMany: vi.fn(async () => (h.state.agent ? [h.state.agent] : [])),
    },
  },
}));
vi.mock("../crypto.js", () => ({ decrypt: vi.fn(() => "app-token") }));
vi.mock("../redis.js", () => ({ redisService: { setNX: vi.fn(async () => true), get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock("../repositories/index.js", () => ({
  agentRunRepository: {},
  chatMessageRepository: { resolvePendingAction: vi.fn(async () => undefined) },
}));
vi.mock("../middleware/verify-spaces-signature.js", () => ({
  verifySpacesSignature: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/agent-acl.js", () => ({ isClawAdmin: vi.fn(async () => false) }));
vi.mock("../lib/users-jit.js", () => ({ resolveClawUserIdForSpacesIdentity: vi.fn(async (id: string) => id) }));
vi.mock("../lib/oauth-custom-tool.js", () => ({ isOAuthProvider: () => false, prepareOAuthCustomTool: vi.fn() }));
vi.mock("../lib/twin-approval-delivery.js", () => ({ executeTwinApprovalDelivery: vi.fn(), twinDeliveryContextFromFlowData: vi.fn() }));
vi.mock("../lib/ticket-card.js", () => ({
  fetchTicketForCard: vi.fn(async () => null),
  parseSentEmailFromToolResult: vi.fn(() => null),
  parseXyneIdFromToolResult: vi.fn(() => null),
}));
vi.mock("../services/twinResponseFeedback.js", () => ({ recordTwinApprovalOutcome: vi.fn() }));
vi.mock("../lib/session-context.js", () => ({
  clearActivePlanCard: vi.fn(),
  getActivePlanCard: vi.fn(),
  setPlanExecMeta: vi.fn(),
  clearPlanExecMeta: vi.fn(),
  normalizePlanTitle: vi.fn(),
}));
vi.mock("../mcpgateway/services/execution.js", () => ({ executeTool: vi.fn() }));
vi.mock("../lib/gateway-approval.js", () => ({
  defaultGatewayTenant: vi.fn(),
  formatGatewayApprovalExecutionError: vi.fn(),
  parseGatewayServerTypeForApproval: vi.fn(() => null),
  sanitizeApprovalToolError: (s: string) => s,
}));
vi.mock("../lib/agent-widget-binding.js", () => ({
  findPlanBindingByMessageId: vi.fn(),
  readPlanBindingData: vi.fn(),
  consumePlanBinding: vi.fn(),
}));
vi.mock("../lib/message-queue.js", () => ({
  QUEUE_CAP: 10,
  enqueueMessage: vi.fn(),
  tryAcquireSlot: vi.fn(),
  isSlotBusy: vi.fn(),
}));
vi.mock("../lib/callable-agent-resolver.js", () => ({ visibleAgentWhereForRunningUser: vi.fn() }));
vi.mock("../surfaces/spaces/client.js", () => ({ emitAgentWorkingSignal: vi.fn() }));
vi.mock("../lib/fast-mode.js", () => ({ resolveFastMode: vi.fn() }));
vi.mock("../lib/xyne-ai-continuation.js", () => ({ dispatchXyneAiContinuationRun: vi.fn() }));
vi.mock("../lib/skill-apply.js", () => ({
  applyCreateSkill: vi.fn(async () => h.state.skillOutcome),
  isCreateSkillAction: (serverType: string, tool: string) => tool === "create-skill" && (serverType === "skill" || serverType === "agent-tools"),
}));
vi.mock("../lib/artifact-app-apply.js", () => ({ applyArtifactAppAction: vi.fn(), isArtifactAppAction: () => false }));
vi.mock("../lib/agent-tools-apply.js", () => ({
  applyAgentToolAction: vi.fn(async () => h.state.agentToolOutcome),
  AGENT_TOOL_SLUGS: new Set(["update-agent"]),
}));
vi.mock("../lib/conversation-fork.js", () => ({ applyConversationFork: vi.fn() }));
vi.mock("../queue/run-recovery-worker.js", () => ({ registerRunRecovery: vi.fn() }));
vi.mock("../queue/scheduled-jobs-queue.js", () => ({ enqueueDelayedJob: vi.fn(), enqueueCronJob: vi.fn() }));
vi.mock("../queue/provider-retry-worker.js", () => ({ retryNowByToken: vi.fn(), cancelProviderRetry: vi.fn() }));
vi.mock("./mcp.js", () => ({
  writeActionPayload: (a: Record<string, unknown>) => ({ ...a }),
  verifyActionSignature: vi.fn(() => h.state.signatureOk),
  verifyActionSignatureAny: vi.fn((payloads: Array<Record<string, unknown>>) => {
    if (!h.state.signatureOk) return false;
    return payloads.some((p) => {
      if (p["automation"] === true) return h.state.automationCard;
      if (!("agentSlug" in p)) return h.state.legacyCard;
      return !h.state.automationCard && !h.state.legacyCard;
    });
  }),
}));
vi.mock("../mcp/runner.js", () => ({ callTool: h.state.callTool }));
vi.mock("../mcp/connector-definitions.js", () => ({ hasConnectorDefinition: vi.fn(async () => h.state.connector) }));
vi.mock("../lib/credentials-loader.js", () => ({
  loadApprovedWriteCredentials: vi.fn(async () => h.state.credentials),
  isPrivateUserCredential: vi.fn(() => false),
}));
vi.mock("../lib/local-harness-approval.js", () => ({
  resumeLocalHarnessRunForAction: vi.fn(async () => ({ handled: h.state.harnessHandled })),
  rejectionResultText: (tool: string) => `${tool} was declined`,
}));
vi.mock("../lib/flow-card-delivery.js", () => ({ replaceFlowCardOnRow: vi.fn(async () => true) }));
vi.mock("./webhook.js", () => ({ setSession: vi.fn(async () => undefined) }));

const { flowActionRouter } = await import("./flow-action.js");

type Handler = (req: unknown, res: unknown) => Promise<void>;
const routeLayer = (flowActionRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }> }).stack.find(
  (l) => l.route?.path === "/action",
);
const handler = routeLayer!.route!.stack.at(-1)!.handle;

function writeCard(overrides: Record<string, unknown> = {}) {
  return {
    screenId: "write-approval-1",
    data: {
      actionType: "write",
      serverType: "jira",
      tool: "jira-create-issue",
      params: JSON.stringify({ summary: "Bug" }),
      userId: "user-1",
      signature: "sig",
      agentSlug: "doctor",
      spacesAppId: "app-1",
      channelId: "ch-1",
      conversationId: "conv-1",
      ...overrides,
    },
  };
}

async function click(actionId: string, flowJSON = writeCard(), callerUserId: string | null = "user-1") {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  const req = {
    body: { actionId, type: "submit", values: {}, context: { flowJSON, messageId: "msg-1", conversationId: "conv-1", userId: callerUserId } },
    headers: {},
    params: {},
  };
  await handler(req, res);
  await new Promise((r) => setTimeout(r, 0));
  return out;
}

function cardUpdates() {
  return h.state.fetchCalls.filter((c) => c.url.endsWith("/chat/updateMessage"));
}

function continuationRuns() {
  return h.state.fetchCalls.filter((c) => c.url.endsWith("/internal/run"));
}

beforeEach(() => {
  h.state.signatureOk = true;
  h.state.automationCard = false;
  h.state.legacyCard = false;
  h.state.users = new Map([
    ["user-1", { orgId: "org-1", name: "One" }],
    ["user-2", { orgId: "org-2", name: "Two" }],
  ]);
  h.state.connector = true;
  h.state.credentials = { credentials: { token: "x" }, source: "user", instance: "i" };
  h.state.callTool.mockReset();
  h.state.callTool.mockResolvedValue({ content: "Created ticket XYNE-1" });
  h.state.harnessHandled = false;
  h.state.fetchCalls = [];
  h.state.agentToolOutcome = { ok: true, message: "Agent updated" };
  h.state.skillOutcome = { status: "created", id: "s1", slug: "skill", name: "Skill", message: "Skill created" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      h.state.fetchCalls.push({ url, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
      return new Response(JSON.stringify({ success: true, sessionId: "sess-2" }), { status: 200 });
    }),
  );
});

describe("write approval: who may act", () => {
  it("refuses a card whose signature does not verify, and runs nothing", async () => {
    h.state.signatureOk = false;
    const out = await click("approve-write");
    expect((out.body as { code?: string }).code).toBe("INTEGRITY_FAILED");
    expect(h.state.callTool).not.toHaveBeenCalled();
    expect(cardUpdates()).toHaveLength(0);
  });

  it("refuses a caller who is not the card's user", async () => {
    const out = await click("approve-write", writeCard(), "user-2");
    expect(out.status).toBe(403);
    expect(h.state.callTool).not.toHaveBeenCalled();
  });

  it("refuses a click with no caller identity", async () => {
    const out = await click("approve-write", writeCard(), null);
    expect(out.status).toBe(403);
    expect(h.state.callTool).not.toHaveBeenCalled();
  });

  it("lets anyone in the automation's org approve an automation card, but not another org", async () => {
    h.state.automationCard = true;
    h.state.users.set("user-3", { orgId: "org-1", name: "Three" });
    const ok = await click("approve-write", writeCard(), "user-3");
    expect(ok.status).toBe(200);
    expect(h.state.callTool).toHaveBeenCalledTimes(1);

    h.state.callTool.mockClear();
    const denied = await click("approve-write", writeCard(), "user-2");
    expect(denied.status).toBe(403);
    expect(h.state.callTool).not.toHaveBeenCalled();
  });
});

describe("write approval: outcomes", () => {
  it("decline runs nothing and replaces the card with a declined note", async () => {
    const out = await click("decline-write");
    expect(out.body).toEqual({ type: "close_screen", finalMessage: "Action declined." });
    expect(h.state.callTool).not.toHaveBeenCalled();
    const updates = cardUpdates();
    expect(updates).toHaveLength(1);
    expect(String(updates[0]!.body["markdownText"])).toContain("Action declined");
  });

  it("approve runs the tool as the card's user and turns the card into a completed result", async () => {
    const out = await click("approve-write");
    expect(out.body).toEqual({ type: "close_screen", finalMessage: "jira-create-issue ran successfully." });
    expect(h.state.callTool).toHaveBeenCalledWith("user-1", "jira", { token: "x" }, "jira-create-issue", { summary: "Bug" }, "doctor", undefined, "i");
    const updates = cardUpdates();
    expect(updates).toHaveLength(1);
    const flow = updates[0]!.body["flowJSON"] as { title?: string };
    expect(JSON.stringify(flow)).toContain("Action Completed");
    expect(continuationRuns()).toHaveLength(0);
  });

  it("approve & continue also starts a continuation run seeded with the result", async () => {
    await click("approve-continue");
    const runs = continuationRuns();
    expect(runs).toHaveLength(1);
    expect(String(runs[0]!.body["context"])).toContain("Created ticket XYNE-1");
    expect(runs[0]!.body["conversationId"]).toBe("conv-1");
  });

  it("a failed tool answers 422 and turns the card into a failure with Retry", async () => {
    h.state.callTool.mockRejectedValueOnce(new Error("boom"));
    const out = await click("approve-write");
    expect(out.status).toBe(422);
    const updates = cardUpdates();
    expect(updates).toHaveLength(1);
    const flow = JSON.stringify(updates[0]!.body["flowJSON"]);
    expect(flow).toContain("Action Failed");
    expect(flow).toContain("retry-write");
    expect(continuationRuns()).toHaveLength(0);
  });

  it("asks to connect when the user has no credential for the connector", async () => {
    h.state.credentials = null;
    const out = await click("approve-write");
    expect((out.body as { code?: string }).code).toBe("CONNECTION_REQUIRED");
    expect(h.state.callTool).not.toHaveBeenCalled();
  });

  it("reports a misconfigured connector without running anything", async () => {
    h.state.connector = false;
    const out = await click("approve-write");
    expect((out.body as { code?: string }).code).toBe("MISCONFIGURED");
    expect(h.state.callTool).not.toHaveBeenCalled();
  });

  it("a local-harness run is resumed instead of starting a continuation", async () => {
    h.state.harnessHandled = true;
    await click("approve-continue");
    expect(continuationRuns()).toHaveLength(0);
  });
});

describe("write approval: non-MCP tools", () => {
  it("agent tools apply directly and replace the card with the message", async () => {
    const out = await click("approve-write", writeCard({ serverType: "agent-tools", tool: "update-agent" }));
    expect(out.body).toEqual({ type: "close_screen", finalMessage: "Agent updated" });
    expect(h.state.callTool).not.toHaveBeenCalled();
    expect(String(cardUpdates()[0]!.body["markdownText"])).toContain("Agent updated");
  });

  it("a duplicate skill is reported on the card, not as a crash", async () => {
    h.state.skillOutcome = { status: "duplicate", error: "Skill already exists" };
    const out = await click("approve-write", writeCard({ serverType: "agent-tools", tool: "create-skill" }));
    expect(out.body).toEqual({ type: "close_screen", finalMessage: "Skill already exists" });
    expect(String(cardUpdates()[0]!.body["markdownText"])).toContain("Skill already exists");
  });
});
