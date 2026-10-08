import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchBodies: [] as Array<Record<string, unknown>>,
  runResponse: { ok: true, body: { success: true, sessionId: "sess-1" } } as {
    ok: boolean;
    body: { success: boolean; sessionId?: string };
  },
  created: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  tracked: [] as Array<Record<string, unknown>>,
  lockHeld: 0,
}));

vi.mock("../config.js", () => ({
  CONFIG: { internalUrl: "http://auth.local", xyneClawS2sKey: "s2s-secret" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../redis.js", () => ({
  redisService: { getConnection: () => ({ exists: vi.fn(async () => state.lockHeld) }) },
}));

vi.mock("../repositories/index.js", () => ({
  chatMessageRepository: {
    create: vi.fn(async (data: Record<string, unknown>) => {
      state.created.push(data);
      return { id: "assistant-row-1" };
    }),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => {
      state.updates.push({ id, data });
    }),
    latestMessageId: vi.fn(async () => "fallback-parent"),
  },
  agentRunRepository: {
    start: vi.fn(async (data: Record<string, unknown>) => {
      state.tracked.push(data);
    }),
  },
}));

vi.mock("./agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: vi.fn(async () => null),
}));

vi.mock("./fast-mode.js", () => ({ resolveFastMode: vi.fn(async () => false) }));

const { dispatchXyneAiContinuationRun } = await import("./xyne-ai-continuation.js");

const BASE = {
  agent: { id: "agent-1", orgId: "org-1" },
  agentSlug: "ask-ai",
  conversationId: "chat-1",
  userId: "user-1",
  orgId: "org-1",
  chatMessageId: "card-row-1",
};

beforeEach(() => {
  state.fetchBodies = [];
  state.created = [];
  state.updates = [];
  state.tracked = [];
  state.lockHeld = 0;
  state.runResponse = { ok: true, body: { success: true, sessionId: "sess-1" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      state.fetchBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return {
        ok: state.runResponse.ok,
        status: state.runResponse.ok ? 200 : 500,
        json: async () => state.runResponse.body,
      };
    }),
  );
});

describe("dispatchXyneAiContinuationRun", () => {
  it("sends the caller's prompt and omits context when there is none (question card)", async () => {
    await dispatchXyneAiContinuationRun({
      ...BASE,
      prompt: "The user answered your questions. Continue the task based on these answers:\nA: b",
      idempotencyKey: "user_answer_q-1",
      failureMessage: "Could not continue after your answers.",
    });

    expect(state.fetchBodies).toHaveLength(1);
    const body = state.fetchBodies[0]!;
    expect(body["task"]).toContain("The user answered your questions.");
    // Absent, not undefined: the answer path never sent a context field.
    expect("context" in body).toBe(false);
    expect(body["idempotencyKey"]).toBe("user_answer_q-1");
    expect(body["detached"]).toBe(true);
    expect(body["__persistedByCaller"]).toBe(true);
  });

  it("marks the continuation as a Xyne AI card surface so claw keeps card tools (propose-agent)", async () => {
    await dispatchXyneAiContinuationRun({
      ...BASE,
      prompt: "The user answered your questions. Continue the task based on these answers:\nName: u decide",
      idempotencyKey: "user_answer_q-2",
      failureMessage: "failed",
    });
    expect(state.fetchBodies[0]!["cardSurface"]).toBe("xyne-ai");
  });

  it("forwards context as a separate field when the caller supplies it (write card)", async () => {
    await dispatchXyneAiContinuationRun({
      ...BASE,
      prompt: 'The "spaces-create-ticket" action you requested was approved and executed successfully. Continue the task using its result.',
      context: "Approved tool: spaces-create-ticket\nTool result (DATA...):\nxyneId: PLAT-1",
      idempotencyKey: "write_continue_ticket-proposal-abc",
      failureMessage: "Could not continue after spaces-create-ticket.",
    });

    const body = state.fetchBodies[0]!;
    expect(body["task"]).toContain("was approved and executed successfully");
    expect(body["context"]).toContain("xyneId: PLAT-1");
    expect(body["idempotencyKey"]).toBe("write_continue_ticket-proposal-abc");
  });

  it("sanitises and caps the idempotency key", async () => {
    await dispatchXyneAiContinuationRun({
      ...BASE,
      prompt: "continue",
      idempotencyKey: `write_continue_${"x".repeat(200)}/bad key!`,
      failureMessage: "failed",
    });

    const key = state.fetchBodies[0]!["idempotencyKey"] as string;
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("chains the pre-created row onto the card's turn", async () => {
    await dispatchXyneAiContinuationRun({
      ...BASE,
      prompt: "continue",
      idempotencyKey: "k",
      failureMessage: "failed",
    });

    expect(state.created[0]).toMatchObject({
      conversationId: "chat-1",
      agentSlug: "ask-ai",
      role: "assistant",
      status: "running",
      parentId: "card-row-1",
    });
    expect(state.tracked[0]).toMatchObject({ sessionId: "sess-1", conversationId: "chat-1" });
  });

  it("writes the caller's failure message onto the row when dispatch fails", async () => {
    state.runResponse = { ok: false, body: { success: false } };

    await dispatchXyneAiContinuationRun({
      ...BASE,
      prompt: "continue",
      idempotencyKey: "k",
      failureMessage: "Could not continue after spaces-create-ticket.",
    });

    expect(state.updates).toEqual([
      {
        id: "assistant-row-1",
        data: { status: "failed", content: "Could not continue after spaces-create-ticket." },
      },
    ]);
    expect(state.tracked).toHaveLength(0);
  });
});
