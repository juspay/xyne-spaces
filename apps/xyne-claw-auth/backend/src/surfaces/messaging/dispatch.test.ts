import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/run-attachment-store.js", () => ({ runAttachmentRefsEnabled: () => false, uploadRunAttachment: vi.fn() }));
vi.mock("../../lib/agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: vi.fn(async () => ({ providerOrder: [], providerConfigs: {} })),
  resolveSubagentProviderMode: vi.fn(),
}));
vi.mock("../../lib/session-context.js", () => ({ setSession: vi.fn() }));
vi.mock("./plugin.js", () => ({
  MESSAGING_CHANNEL_KEYS: ["whatsapp", "whatsapp-cloud"],
  getChannel: () => ({
    accountScope: "org",
    capabilities: { groups: false, reactions: true, typing: true, media: true, maxTextChars: 4096, interactive: { buttons: 3 } },
  }),
}));

const { buildChannelRun, channelAgentConfig, channelSurfaceInstructions } = await import("./dispatch.js");
const { channelOfConversationId, channelConversationId } = await import("./ids.js");

describe("channelAgentConfig", () => {
  const chatTools = ["whatsapp_cloud_send_message", "whatsapp_cloud_send_document", "whatsapp_cloud_react"];

  it("adds the chat's own tools as direct picks on top of an existing selection", () => {
    const out = channelAgentConfig({ tools: { subagents: ["github"], custom: ["ask-question"], direct: ["x"] }, model: "m" }, "whatsapp-cloud");
    expect(out).toMatchObject({ model: "m", planTracking: false, citationReflection: false });
    expect(out["tools"]).toEqual({ subagents: ["github"], custom: ["ask-question"], direct: ["x", ...chatTools] });
  });

  it("gives a standard agent with no selection just the chat's tools", () => {
    expect(channelAgentConfig({ citationReflection: true }, "whatsapp-cloud", "standard")).toEqual({
      citationReflection: false,
      planTracking: false,
      tools: { direct: chatTools },
    });
  });

  it("leaves an unrestricted orchestrator unrestricted", () => {
    expect(channelAgentConfig(null, "whatsapp-cloud", "orchestrator")).toEqual({ citationReflection: false, planTracking: false });
  });

  it("keeps the step list off by default, but on for an approved plan's run and where the owner asked for it", () => {
    expect(channelAgentConfig({}, "whatsapp", "orchestrator", { planExecution: true })["planTracking"]).toBe(true);
    expect(channelAgentConfig({ planTracking: "always" }, "whatsapp", "orchestrator")["planTracking"]).toBe("always");
    expect(channelAgentConfig({ planTracking: true }, "whatsapp", "orchestrator")["planTracking"]).toBe(true);
    expect(channelAgentConfig({ planTracking: false }, "whatsapp", "orchestrator", { planExecution: true })["planTracking"]).toBe(false);
  });
});

describe("buildChannelRun plan phases", () => {
  const agent = { id: "a1", slug: "assistant", orgId: "org-1", config: {}, delegationTier: "orchestrator" } as never;
  const target = {
    channel: "whatsapp-cloud",
    connectedSurfaceId: "acc-1",
    accountKey: "acct_1",
    chatId: "15550000001",
    senderId: "15550000001",
    isGroup: false,
  } as const;
  const base = { agent, userId: "u1", task: "t", conversationId: "c1", eventType: "DIRECT_MESSAGE" as const, idempotencyKey: "k", target };

  it("dispatches a proposal in plan mode, as a Spaces mention does", async () => {
    const run = await buildChannelRun({ ...base, plan: { phase: "propose" } });
    expect(run.body["mode"]).toBe("plan");
    expect(run.sessionContext.mode).toBe("plan");
  });

  it("dispatches an approved plan in auto mode with planContinuation and the approved steps", async () => {
    const todos = [{ id: "1", title: "Search the inbox" }];
    const run = await buildChannelRun({ ...base, plan: { phase: "execute", todos } });
    expect(run.body).toMatchObject({ mode: "auto", planContinuation: true });
    expect((run.body["agentConfig"] as Record<string, unknown>)["planTracking"]).toBe(true);
    expect(run.sessionContext).toMatchObject({ mode: "auto", pendingPlan: { todos } });
  });

  it("leaves an ordinary run alone", async () => {
    const run = await buildChannelRun(base);
    expect(run.body["mode"]).toBeUndefined();
    expect(run.body["planContinuation"]).toBeUndefined();
    expect(run.sessionContext.mode).toBeUndefined();
  });
});

describe("channelSurfaceInstructions", () => {
  it("tells the model how to text and what actually renders here", () => {
    const text = channelSurfaceInstructions("whatsapp-cloud");
    expect(text).toContain("Match their length");
    expect(text).toContain("whatsapp_cloud_send_document");
    expect(text).toContain("tap-to-answer buttons");
    expect(text).toContain("Connect link");
    expect(text).toContain("[clf-…]");
    expect(text).toContain("24 hours");
  });
});

describe("channelOfConversationId", () => {
  it("recognises chat conversations, the longer key first", () => {
    expect(channelOfConversationId(channelConversationId("whatsapp-cloud", "acct_1", "assistant", "919"))).toBe("whatsapp-cloud");
    expect(channelOfConversationId(channelConversationId("whatsapp", "acct_2", "assistant", "919@s.whatsapp.net"))).toBe("whatsapp");
    expect(channelOfConversationId("scheduled_job_123")).toBeNull();
    expect(channelOfConversationId("whatsapp-notes")).toBeNull();
    expect(channelOfConversationId(null)).toBeNull();
  });
});
