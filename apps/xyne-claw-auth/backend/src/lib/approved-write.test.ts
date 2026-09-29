import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn(async (_params: Record<string, unknown>) => "labels updated");
const prepareOAuthCustomTool = vi.fn();
const markUsedUserTokenByConversation = vi.fn(async () => undefined);

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../routes/mcp.js", () => ({ verifyActionSignatureAny: () => true }));
vi.mock("../repositories/index.js", () => ({ agentRunRepository: { markUsedUserTokenByConversation } }));
vi.mock("./agent-tools-apply.js", () => ({ AGENT_TOOL_SLUGS: new Set<string>() }));
vi.mock("./oauth-custom-tool.js", () => ({
  isOAuthProvider: (s: string) => s === "google" || s === "microsoft",
  prepareOAuthCustomTool,
}));

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
