import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn(async (_params: Record<string, unknown>) => "labels updated");
const prepareOAuthCustomTool = vi.fn();
const markUsedUserTokenByConversation = vi.fn(async () => undefined);

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
const verifyActionSignatureAny = vi.fn((_payloads: Array<Record<string, unknown>>, _signature: string) => true);
vi.mock("../routes/mcp.js", () => ({
  verifyActionSignatureAny,
  // Same shape as routes/mcp.ts writeActionPayload: subagentId only when bound.
  writeActionPayload: (a: Record<string, unknown>) => ({
    serverType: a["serverType"],
    tool: a["tool"],
    params: a["params"],
    userId: a["userId"],
    ...(a["subagentId"] ? { subagentId: a["subagentId"] } : {}),
  }),
}));
vi.mock("../repositories/index.js", () => ({ agentRunRepository: { markUsedUserTokenByConversation } }));
vi.mock("./agent-tools-apply.js", () => ({ AGENT_TOOL_SLUGS: new Set<string>() }));
const executeTool = vi.fn();
const findUnique = vi.fn(async () => ({ email: "sheetal@example.com" }) as { email: string } | null);
vi.mock("../mcpgateway/services/execution.js", () => ({ executeTool }));
vi.mock("../db.js", () => ({ prisma: { user: { findUnique } } }));
vi.mock("./oauth-custom-tool.js", () => ({
  isOAuthProvider: (s: string) => s === "google" || s === "microsoft",
  prepareOAuthCustomTool,
}));
const loadApprovedWriteCredentials = vi.fn();
const callTool = vi.fn(async () => ({ content: "payout created" }));
vi.mock("./credentials-loader.js", () => ({ loadApprovedWriteCredentials }));
vi.mock("../mcp/runner.js", () => ({ callTool }));
vi.mock("../mcp/connector-definitions.js", () => ({ hasConnectorDefinition: async () => true }));

const { executeApprovedWrite } = await import("./approved-write.js");

const action = {
  serverType: "google",
  tool: "google-gmail-modify-labels",
  params: { messageId: "m1", addLabelIds: ["STARRED"] },
  userId: "user-1",
  signature: "sig",
  agentSlug: "ask-ai",
};

describe("executeApprovedWrite — Google/Microsoft tools", () => {
  beforeEach(() => {
    run.mockClear();
    prepareOAuthCustomTool.mockReset();
    markUsedUserTokenByConversation.mockClear();
  });

  it("runs a Google tool approved from a messenger instead of sending it back to Spaces", async () => {
    prepareOAuthCustomTool.mockResolvedValue({ ok: true, label: "Google", run });

    const outcome = await executeApprovedWrite({ action, approverUserId: "user-1", conversationId: "conv-1" });

    expect(outcome).toMatchObject({ ok: true, resultText: "labels updated" });
    expect(prepareOAuthCustomTool).toHaveBeenCalledWith({ provider: "google", tool: action.tool, userId: "user-1" });
    expect(run).toHaveBeenCalledWith(action.params);
    expect(markUsedUserTokenByConversation).toHaveBeenCalledWith("conv-1", "ask-ai");
  });

  it("reports a missing connection without running anything", async () => {
    prepareOAuthCustomTool.mockResolvedValue({ ok: false, message: "No Google connection for user user-1" });

    const outcome = await executeApprovedWrite({ action, approverUserId: "user-1" });

    expect(outcome).toMatchObject({ ok: false, reason: "no-connection", message: "No Google connection for user user-1" });
    expect(run).not.toHaveBeenCalled();
  });

  it("still refuses when someone else approves", async () => {
    const outcome = await executeApprovedWrite({ action, approverUserId: "user-2" });

    expect(outcome).toMatchObject({ ok: false, reason: "signature" });
    expect(prepareOAuthCustomTool).not.toHaveBeenCalled();
  });
});

describe("executeApprovedWrite — MCP gateway tools", () => {
  const gatewayAction = { ...action, serverType: "gateway:google-workspace:backend-1" };

  beforeEach(() => {
    executeTool.mockReset();
    findUnique.mockClear();
    process.env["ALLOWED_TENANTS"] = " , juspay-tenant ,other";
  });

  it("runs a gateway write approved from a messenger with the approver's email and tenant", async () => {
    executeTool.mockResolvedValue({ success: true, toolName: action.tool, backendId: "backend-1", result: { updated: 1 }, duration: 12 });

    const outcome = await executeApprovedWrite({ action: gatewayAction, approverUserId: "user-1" });

    expect(outcome).toEqual({ ok: true, message: `Done — ${action.tool} ran.`, resultText: '{"updated":1}' });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { email: true } });
    expect(executeTool).toHaveBeenCalledWith("juspay-tenant", "sheetal@example.com", {
      serviceName: "google-workspace",
      toolName: action.tool,
      arguments: action.params,
      backendId: "backend-1",
    });
  });

  it("accepts the service-only gateway form without a backend", async () => {
    executeTool.mockResolvedValue({ success: true, toolName: action.tool, backendId: "auto", result: "ok", duration: 1 });

    await executeApprovedWrite({ action: { ...action, serverType: "gateway:google-workspace" }, approverUserId: "user-1" });

    expect(executeTool.mock.calls[0]?.[2]).toEqual({ serviceName: "google-workspace", toolName: action.tool, arguments: action.params });
  });

  it("returns the gateway's own error, without urls, when the tool fails", async () => {
    executeTool.mockResolvedValue({
      success: false,
      toolName: action.tool,
      backendId: "backend-1",
      duration: 5,
      errorDetail: { responseMessage: "Label STARRED not found, see https://internal.example/x" },
    });

    const outcome = await executeApprovedWrite({ action: gatewayAction, approverUserId: "user-1" });

    expect(outcome).toEqual({ ok: false, reason: "failed", message: `${action.tool} failed: Label STARRED not found, see` });
  });

  it("points back to Spaces only when the gateway or the approver's email is unavailable", async () => {
    delete process.env["ALLOWED_TENANTS"];
    await expect(executeApprovedWrite({ action: gatewayAction, approverUserId: "user-1" })).resolves.toMatchObject({ ok: false, reason: "unsupported" });

    process.env["ALLOWED_TENANTS"] = "juspay-tenant";
    findUnique.mockResolvedValueOnce(null);
    await expect(executeApprovedWrite({ action: gatewayAction, approverUserId: "user-1" })).resolves.toMatchObject({ ok: false, reason: "no-connection" });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("still refuses Spaces-only writes such as skill changes", async () => {
    await expect(
      executeApprovedWrite({ action: { ...action, serverType: "skill", tool: "update-skill" }, approverUserId: "user-1" }),
    ).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });
});

describe("executeApprovedWrite — MCP connector write queued by a subagent", () => {
  const subagentAction = {
    serverType: "juspay-dashboard-stream",
    tool: "create_payout_order",
    params: { amount: 1, customerId: "c1" },
    userId: "user-1",
    signature: "sig",
    agentSlug: "ny-payments",
    spacesAppId: "app-1",
    subagentId: "sub-payouts",
  };

  beforeEach(() => {
    verifyActionSignatureAny.mockClear();
    loadApprovedWriteCredentials.mockReset();
    callTool.mockClear();
  });

  it("verifies the subagent id as signed and runs on that subagent's credential", async () => {
    loadApprovedWriteCredentials.mockResolvedValue({
      source: "subagent",
      connectionId: "conn-a",
      credentials: { apiKey: "KEY-A" },
      isUserOwned: false,
      instance: "subagent:conn-a",
      viaSubagent: "sub-payouts",
    });

    const outcome = await executeApprovedWrite({ action: subagentAction, approverUserId: "user-1" });

    expect(outcome).toMatchObject({ ok: true, resultText: "payout created" });
    const [payloads] = verifyActionSignatureAny.mock.calls[0]!;
    expect(payloads.every((p) => p["subagentId"] === "sub-payouts")).toBe(true);
    expect(loadApprovedWriteCredentials).toHaveBeenCalledWith({
      userId: "user-1",
      serverType: "juspay-dashboard-stream",
      agentSlug: "ny-payments",
      spacesAppId: "app-1",
      subagentId: "sub-payouts",
    });
    expect(callTool).toHaveBeenCalledWith(
      "user-1",
      "juspay-dashboard-stream",
      { apiKey: "KEY-A" },
      "create_payout_order",
      subagentAction.params,
      "ny-payments",
      undefined,
      "subagent:conn-a",
    );
  });

  it("reports a missing connection when nothing resolves", async () => {
    loadApprovedWriteCredentials.mockResolvedValue(null);

    const outcome = await executeApprovedWrite({ action: subagentAction, approverUserId: "user-1" });

    expect(outcome).toMatchObject({ ok: false, reason: "no-connection" });
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe("needsSpacesApproval for fork-to-conversation", () => {
  it("routes the fork to the Spaces approval path", async () => {
    const { needsSpacesApproval } = await import("./approved-write.js");
    expect(needsSpacesApproval("agent-tools", "fork-to-conversation")).toBe(true);
  });
});
