import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  claimed: new Set<string>(),
  redisDown: false,
  target: null as Record<string, unknown> | null,
  prepareOk: true,
  prepareCalls: 0,
  posted: [] as unknown[],
  resolveArgs: [] as unknown[],
}));

vi.mock("../logger.js", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: vi.fn(async (key: string) => {
        if (state.redisDown) throw new Error("redis down");
        if (state.claimed.has(key)) return null;
        state.claimed.add(key);
        return "OK";
      }),
    }),
  },
}));
vi.mock("./agent-card-render.js", () => ({
  agentDraftLeadIn: (spec: { summary?: string }) => spec.summary ?? "Here's a draft agent for you to review.",
  prepareAgentDraftCard: vi.fn(async () => {
    state.prepareCalls++;
    return state.prepareOk
      ? { ok: true, flow: { id: "flow-1" }, requestId: "req-1" }
      : { ok: false, message: "You can't create global agents." };
  }),
}));
vi.mock("./flow-card-delivery.js", () => ({
  resolveXyneAiCardTarget: vi.fn(async (args: unknown) => {
    state.resolveArgs.push(args);
    return state.target;
  }),
  postFlowCard: vi.fn(async (flow: Record<string, unknown>) => {
    const stamped = { ...flow, surface: "xyne-ai" };
    state.posted.push(stamped);
    return stamped;
  }),
}));

const { deliverXyneAiAgentDraft, AGENT_DRAFT_DELIVERY_FAILED } = await import("./xyne-ai-agent-draft.js");

const spec = {
  name: "Spaces Demo Assistant",
  slug: "spaces-demo-assistant",
  description: "d",
  systemPrompt: "p",
  tools: ["spaces"],
  summary: "Drafted a read-only demo agent.",
};
const base = {
  pendingAgentCard: { variant: "draft", agent: spec },
  status: "completed",
  rawResult: "",
  assistantMessageId: "row-1",
  conversationId: "chat-1",
  agentSlug: "ask-ai",
  dedupKey: "agent-chat:agent-draft:row-1",
  logContext: "test",
};

beforeEach(() => {
  state.claimed.clear();
  state.redisDown = false;
  state.target = { conversationId: "chat-1", agentSlug: "ask-ai", userId: "u1", orgId: "o1", chatMessageId: "row-1" };
  state.prepareOk = true;
  state.prepareCalls = 0;
  state.posted = [];
  state.resolveArgs = [];
});

describe("deliverXyneAiAgentDraft", () => {
  it("posts the draft card and replaces the empty result with the lead-in", async () => {
    const out = await deliverXyneAiAgentDraft(base);
    expect(out).toEqual({ content: "Drafted a read-only demo agent.", flow: { id: "flow-1", surface: "xyne-ai" } });
    expect(state.posted).toHaveLength(1);
    expect(state.resolveArgs[0]).toEqual({ assistantMessageId: "row-1", conversationId: "chat-1", agentSlug: "ask-ai" });
  });

  it("a retried callback keeps the same text but creates no second request/card", async () => {
    await deliverXyneAiAgentDraft(base);
    const retry = await deliverXyneAiAgentDraft(base);
    expect(retry).toEqual({ content: "Drafted a read-only demo agent." });
    expect(state.prepareCalls).toBe(1);
    expect(state.posted).toHaveLength(1);
  });

  it("fails open when Redis is down", async () => {
    state.redisDown = true;
    const out = await deliverXyneAiAgentDraft(base);
    expect(out?.flow).toBeDefined();
  });

  it("ignores non-draft turns", async () => {
    expect(await deliverXyneAiAgentDraft({ ...base, pendingAgentCard: { variant: "profile", slug: "x" } })).toBeNull();
    expect(await deliverXyneAiAgentDraft({ ...base, pendingAgentCard: undefined })).toBeNull();
    expect(await deliverXyneAiAgentDraft({ ...base, status: "failed" })).toBeNull();
    expect(await deliverXyneAiAgentDraft({ ...base, rawResult: "some text" })).toBeNull();
    expect(state.posted).toHaveLength(0);
  });

  it("surfaces a clear message when the row can't be found", async () => {
    state.target = null;
    expect(await deliverXyneAiAgentDraft(base)).toEqual({ content: AGENT_DRAFT_DELIVERY_FAILED });
  });

  it("surfaces the policy message when the draft is rejected", async () => {
    state.prepareOk = false;
    expect(await deliverXyneAiAgentDraft(base)).toEqual({ content: "You can't create global agents." });
  });
});
