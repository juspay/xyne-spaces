import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { cliSessionId: string } | null,
  messages: [] as Array<Record<string, unknown>>,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../repositories/chatMessageRepository.js", () => ({
  chatMessageRepository: {
    findByConversationAndAgent: vi.fn(async () => state.messages),
  },
}));

vi.mock("../repositories/localHarnessSessionRepository.js", () => ({
  localHarnessSessionRepository: {
    find: vi.fn(async () => state.session),
  },
}));

function msg(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "m",
    role: "user",
    content: "hi",
    status: "completed",
    runProvider: null,
    ...overrides,
  };
}

describe("local harness continuation planning", () => {
  beforeEach(() => {
    vi.resetModules();
    state.session = null;
    state.messages = [];
  });

  it("sends the whole transcript when there is no stored session", async () => {
    state.messages = [
      msg({ id: "u1", role: "user", content: "first question" }),
      msg({ id: "a1", role: "assistant", content: "first answer", runProvider: "litellm" }),
    ];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({ conversationId: "c1", agentSlug: "a", provider: "codex-cli" });

    expect(plan.resumeSessionId).toBeNull();
    expect(plan.context).toContain("User: first question");
    expect(plan.context).toContain("Assistant: first answer");
    expect(plan.context).toContain("Earlier conversation in this thread");
  });

  it("only sends turns after the last same-provider assistant when resuming", async () => {
    state.session = { cliSessionId: "cli-1" };
    state.messages = [
      msg({ id: "u1", role: "user", content: "old question" }),
      msg({ id: "a1", role: "assistant", content: "codex answer", runProvider: "codex-cli" }),
      msg({ id: "u2", role: "user", content: "new question" }),
      msg({ id: "a2", role: "assistant", content: "litellm answer", runProvider: "litellm" }),
    ];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({ conversationId: "c1", agentSlug: "a", provider: "codex-cli" });

    expect(plan.resumeSessionId).toBe("cli-1");
    expect(plan.context).not.toContain("old question");
    expect(plan.context).not.toContain("codex answer");
    expect(plan.context).toContain("new question");
    expect(plan.context).toContain("litellm answer");
  });

  it("returns no context when the resumed session has already seen everything", async () => {
    state.session = { cliSessionId: "cli-1" };
    state.messages = [
      msg({ id: "u1", role: "user", content: "q" }),
      msg({ id: "a1", role: "assistant", content: "a", runProvider: "codex-cli" }),
    ];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({ conversationId: "c1", agentSlug: "a", provider: "codex-cli" });

    expect(plan.context).toBeNull();
  });

  it("skips excluded ids and running rows", async () => {
    state.messages = [
      msg({ id: "u1", role: "user", content: "kept question" }),
      msg({ id: "u2", role: "user", content: "current turn" }),
      msg({ id: "a2", role: "assistant", content: "", status: "running" }),
      msg({ id: "a3", role: "assistant", content: "streaming", status: "running" }),
    ];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({
      conversationId: "c1",
      agentSlug: "a",
      provider: "codex-cli",
      excludeMessageIds: ["u2", "a2"],
    });

    expect(plan.context).toContain("kept question");
    expect(plan.context).not.toContain("current turn");
    expect(plan.context).not.toContain("streaming");
  });

  it("truncates long histories and marks the omission", async () => {
    const { HARNESS_TRANSCRIPT_MAX_MESSAGES } = await import("./local-harness-continuation.js");
    state.messages = Array.from({ length: HARNESS_TRANSCRIPT_MAX_MESSAGES + 5 }, (_, i) =>
      msg({ id: `u${i}`, role: "user", content: `turn ${i}` }),
    );
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({ conversationId: "c1", agentSlug: "a", provider: "codex-cli" });

    expect(plan.context).toContain("(earlier messages omitted)");
    expect(plan.context).not.toContain("turn 0\n");
    expect(plan.context).toContain(`turn ${HARNESS_TRANSCRIPT_MAX_MESSAGES + 4}`);
  });

  it("truncates on the character cap too", async () => {
    const { HARNESS_TRANSCRIPT_MAX_CHARS } = await import("./local-harness-continuation.js");
    state.messages = [
      msg({ id: "u1", role: "user", content: "x".repeat(HARNESS_TRANSCRIPT_MAX_CHARS) }),
      msg({ id: "u2", role: "user", content: "the newest turn" }),
    ];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({ conversationId: "c1", agentSlug: "a", provider: "codex-cli" });

    expect(plan.context).toContain("(earlier messages omitted)");
    expect(plan.context).toContain("the newest turn");
  });

  it("plans no server catch-up when the conversation never ran on a harness", async () => {
    state.messages = [
      msg({ id: "u1", role: "user", content: "q" }),
      msg({ id: "a1", role: "assistant", content: "a", runProvider: "litellm" }),
    ];
    const { planServerContinuation } = await import("./local-harness-continuation.js");
    expect(await planServerContinuation({ conversationId: "c1", agentSlug: "a" })).toBeNull();
  });

  it("catches the server up on harness turns it never saw", async () => {
    state.messages = [
      msg({ id: "u1", role: "user", content: "server question" }),
      msg({ id: "a1", role: "assistant", content: "server answer", runProvider: "litellm" }),
      msg({ id: "u2", role: "user", content: "harness question" }),
      msg({ id: "a2", role: "assistant", content: "harness answer", runProvider: "codex-cli" }),
    ];
    const { planServerContinuation } = await import("./local-harness-continuation.js");
    const context = await planServerContinuation({ conversationId: "c1", agentSlug: "a" });

    expect(context).not.toContain("server question");
    expect(context).not.toContain("server answer");
    expect(context).toContain("harness question");
    expect(context).toContain("harness answer");
  });
});

describe("multi-agent harness continuation", () => {
  const HARNESS = "local-harness:claude";
  let t = 0;
  const row = (id: string, role: "user" | "assistant", agentSlug: string, parentId: string | null, runProvider: string | null = null) => {
    t += 1;
    return { id, role, agentSlug, parentId, runProvider, content: `${id} text`, status: "completed", createdAt: new Date(t * 1000) };
  };

  beforeEach(() => {
    state.session = { cliSessionId: "cli-1" };
    state.messages = [];
  });

  it("does not resume a CLI session another agent owns, and sends the whole path", async () => {
    const messages = [row("u1", "user", "alpha", null), row("a1", "assistant", "alpha", "u1", HARNESS)];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({
      conversationId: "chat-1",
      agentSlug: "beta",
      provider: HARNESS,
      multiAgent: { messages, leafId: "a1" },
    });
    expect(plan.resumeSessionId).toBeNull();
    expect(plan.context).toContain("[@alpha (another agent)]: a1 text");
  });

  it("resumes the agent's own CLI session with only what it missed", async () => {
    const messages = [
      row("u1", "user", "alpha", null),
      row("a1", "assistant", "alpha", "u1", HARNESS),
      row("u2", "user", "beta", "a1"),
      row("b2", "assistant", "beta", "u2", "spaces"),
    ];
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({
      conversationId: "chat-1",
      agentSlug: "alpha",
      provider: HARNESS,
      multiAgent: { messages, leafId: "b2" },
    });
    expect(plan.resumeSessionId).toBe("cli-1");
    expect(plan.context).toContain("b2 text");
    expect(plan.context).not.toContain("a1 text");
  });

  it("falls back to the single-agent plan when the path holds one agent", async () => {
    const messages = [row("u1", "user", "alpha", null), row("a1", "assistant", "alpha", "u1", HARNESS)];
    state.messages = messages;
    const { planHarnessContinuation } = await import("./local-harness-continuation.js");
    const plan = await planHarnessContinuation({
      conversationId: "chat-1",
      agentSlug: "alpha",
      provider: HARNESS,
      multiAgent: { messages, leafId: "a1" },
    });
    expect(plan.resumeSessionId).toBe("cli-1");
    expect(plan.context).toBeNull();
  });
});
