import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  replaceCalls: [] as Array<{ screenId: string; status: unknown }>,
  appendCalls: [] as Array<{ screenId: string; status: unknown }>,
  cardOnRow: false,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("./flow-card-delivery.js", () => ({
  replaceFlowCardOnRow: vi.fn(async (input: { screenId: string; flow: { components: Array<{ props?: Record<string, unknown> }> } }) => {
    state.replaceCalls.push({ screenId: input.screenId, status: input.flow.components[0]?.props?.["status"] });
    return state.cardOnRow;
  }),
  deliverXyneAiFlow: vi.fn(async (flow: { screenId: string; components: Array<{ props?: Record<string, unknown> }> }) => {
    state.appendCalls.push({ screenId: flow.screenId, status: flow.components[0]?.props?.["status"] });
    return flow;
  }),
}));

const { readPrProgressFact, renderXyneAiPrCard } = await import("./pr-card-render.js");

const TARGET = {
  kind: "xyne-ai" as const,
  chatMessageId: "row-1",
  conversationId: "chat-1",
  agentSlug: "ask-ai",
  userId: "user-1",
  orgId: "org-1",
  spacesAppId: "app-1",
};

const FACT = {
  provider: "github",
  status: "created",
  title: "Add retry to the webhook client",
  url: "https://github.com/acme/api/pull/42",
  repo: "acme/api",
  number: 42,
};

beforeEach(() => {
  state.replaceCalls = [];
  state.appendCalls = [];
  state.cardOnRow = false;
});

describe("readPrProgressFact", () => {
  it("reads the fact claw puts on the wire", () => {
    expect(readPrProgressFact(FACT)).toMatchObject({
      provider: "github",
      status: "created",
      title: "Add retry to the webhook client",
      repo: "acme/api",
      number: 42,
    });
  });

  it("accepts a string PR number", () => {
    expect(readPrProgressFact({ ...FACT, number: " 42 " })).toMatchObject({ number: "42" });
  });

  it("rejects anything missing the fields the card needs", () => {
    expect(readPrProgressFact({ ...FACT, provider: "svn" })).toBeNull();
    expect(readPrProgressFact({ ...FACT, status: "rebased" })).toBeNull();
    expect(readPrProgressFact({ ...FACT, title: "  " })).toBeNull();
    expect(readPrProgressFact(null)).toBeNull();
    expect(readPrProgressFact("pr")).toBeNull();
  });
});

describe("renderXyneAiPrCard", () => {
  it("appends when this PR has no card on the row yet", async () => {
    const flow = await renderXyneAiPrCard({ pr: readPrProgressFact(FACT)!, target: TARGET });

    expect(flow).not.toBeNull();
    expect(state.replaceCalls).toHaveLength(1);
    expect(state.appendCalls).toHaveLength(1);
    expect(state.appendCalls[0]!.status).toBe("created");
  });

  it("updates in place on merged instead of appending a duplicate", async () => {
    // created — nothing on the row yet
    await renderXyneAiPrCard({ pr: readPrProgressFact(FACT)!, target: TARGET });
    const createdScreenId = state.appendCalls[0]!.screenId;

    // merged — the card is now there
    state.cardOnRow = true;
    state.appendCalls = [];
    await renderXyneAiPrCard({
      pr: readPrProgressFact({ ...FACT, status: "merged" })!,
      target: TARGET,
    });

    expect(state.appendCalls).toEqual([]);
    const merged = state.replaceCalls.at(-1)!;
    expect(merged.status).toBe("merged");
    // Same PR identity ⇒ same deterministic screenId, which is what makes the
    // replace hit the existing card.
    expect(merged.screenId).toBe(createdScreenId);
  });

  it("keys the card on PR identity, so a different PR gets its own card", async () => {
    await renderXyneAiPrCard({ pr: readPrProgressFact(FACT)!, target: TARGET });
    await renderXyneAiPrCard({
      pr: readPrProgressFact({ ...FACT, number: 43, url: "https://github.com/acme/api/pull/43" })!,
      target: TARGET,
    });

    const [first, second] = state.appendCalls;
    expect(first!.screenId).not.toBe(second!.screenId);
  });

  it("returns null rather than throwing when delivery fails", async () => {
    const { replaceFlowCardOnRow } = await import("./flow-card-delivery.js");
    vi.mocked(replaceFlowCardOnRow).mockRejectedValueOnce(new Error("row gone"));

    await expect(
      renderXyneAiPrCard({ pr: readPrProgressFact(FACT)!, target: TARGET }),
    ).resolves.toBeNull();
  });
});
