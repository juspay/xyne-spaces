import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowDefinition } from "xyne-claw-shared";

const state = vi.hoisted(() => ({
  row: null as null | { id: string; userId: string; conversationId: string; agentSlug: string },
  replaceCalls: [] as Array<{ id: string; screenId: string; flow: unknown }>,
  replaceResult: true,
  liveEvents: [] as Array<Record<string, unknown>>,
  liveToolCallsEnabled: true,
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    get liveToolCallsEnabled() {
      return state.liveToolCallsEnabled;
    },
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../db.js", () => ({
  prisma: { chatMessage: { findUnique: vi.fn(async () => state.row) } },
}));

vi.mock("../repositories/chatMessageRepository.js", () => ({
  chatMessageRepository: {
    appendUiFlow: vi.fn(async () => {}),
    replaceUiFlow: vi.fn(async (id: string, screenId: string, flow: unknown) => {
      state.replaceCalls.push({ id, screenId, flow });
      return state.replaceResult;
    }),
  },
}));

vi.mock("./live-conversation-bus.js", () => ({
  publishLiveEvent: vi.fn((_conversationId: string, event: Record<string, unknown>) => {
    state.liveEvents.push(event);
  }),
}));

vi.mock("./spaces-api.js", () => ({ spacesAppFetch: vi.fn(async () => ({})) }));

const { replaceFlowCardOnRow } = await import("./flow-card-delivery.js");

const FLOW = { version: "2.0", screenId: "ticket-PLAT-1", components: [] } as unknown as FlowDefinition;

beforeEach(() => {
  state.row = {
    id: "row-1",
    userId: "owner-1",
    conversationId: "chat-1",
    agentSlug: "ask-ai",
  };
  state.replaceCalls = [];
  state.replaceResult = true;
  state.liveEvents = [];
  state.liveToolCallsEnabled = true;
});

describe("replaceFlowCardOnRow", () => {
  it("replaces the card and publishes the live update for the row's owner", async () => {
    const ok = await replaceFlowCardOnRow({
      chatMessageId: "row-1",
      screenId: "ticket-proposal-abc",
      flow: FLOW,
      userId: "owner-1",
    });

    expect(ok).toBe(true);
    // Replaces by the OLD screenId: the new card has an id of its own.
    expect(state.replaceCalls).toEqual([
      { id: "row-1", screenId: "ticket-proposal-abc", flow: FLOW },
    ]);
    expect(state.liveEvents).toHaveLength(1);
    expect(state.liveEvents[0]).toMatchObject({
      type: "ui-flow",
      conversationId: "chat-1",
      userId: "owner-1",
    });
  });

  it("refuses a row belonging to someone else", async () => {
    const ok = await replaceFlowCardOnRow({
      chatMessageId: "row-1",
      screenId: "ticket-proposal-abc",
      flow: FLOW,
      userId: "attacker-1",
    });

    expect(ok).toBe(false);
    expect(state.replaceCalls).toEqual([]);
    expect(state.liveEvents).toEqual([]);
  });

  it("refuses a row that does not exist", async () => {
    state.row = null;

    const ok = await replaceFlowCardOnRow({
      chatMessageId: "missing",
      screenId: "ticket-proposal-abc",
      flow: FLOW,
      userId: "owner-1",
    });

    expect(ok).toBe(false);
    expect(state.replaceCalls).toEqual([]);
  });

  it("reports failure and skips the live event when the card is already gone", async () => {
    state.replaceResult = false;

    const ok = await replaceFlowCardOnRow({
      chatMessageId: "row-1",
      screenId: "ticket-proposal-stale",
      flow: FLOW,
      userId: "owner-1",
    });

    expect(ok).toBe(false);
    expect(state.liveEvents).toEqual([]);
  });

  it("still replaces when live events are switched off", async () => {
    state.liveToolCallsEnabled = false;

    const ok = await replaceFlowCardOnRow({
      chatMessageId: "row-1",
      screenId: "ticket-proposal-abc",
      flow: FLOW,
      userId: "owner-1",
    });

    expect(ok).toBe(true);
    expect(state.replaceCalls).toHaveLength(1);
    expect(state.liveEvents).toEqual([]);
  });
});
