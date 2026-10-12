import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/run-attachment-store.js", () => ({ runAttachmentRefsEnabled: () => false, uploadRunAttachment: vi.fn() }));
vi.mock("../../lib/agent-provider-config.js", () => ({ resolveAgentProviderConfigs: vi.fn(), resolveSubagentProviderMode: vi.fn() }));
vi.mock("../../lib/session-context.js", () => ({ setSession: vi.fn() }));
vi.mock("./plugin.js", () => ({
  MESSAGING_CHANNEL_KEYS: ["whatsapp", "whatsapp-cloud"],
  getChannel: () => ({
    accountScope: "org",
    capabilities: { groups: false, reactions: true, typing: true, media: true, maxTextChars: 4096, interactive: { buttons: 3 } },
  }),
}));

const { channelAgentConfig, channelSurfaceInstructions } = await import("./dispatch.js");
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
