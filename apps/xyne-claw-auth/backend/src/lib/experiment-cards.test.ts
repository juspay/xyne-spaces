import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentEpoch, ExperimentRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  enabled: true,
  chat: false,
  run: null as ExperimentRun | null,
  epochs: new Map<string, ExperimentEpoch>(),
  calls: [] as Array<{ path: string; body: Record<string, unknown> }>,
  uploads: [] as Array<Record<string, unknown>>,
  nextMessage: 0,
  recoveryRoots: {} as Record<string, string>,
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    get experimentCardsEnabled() { return state.enabled; },
    experimentStatusCardGapMs: 0,
    experimentEpochCardGapMs: 0,
    experimentEpochOpenWaitMs: 600,
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("./experiment.js", () => ({
  formatDuration: (ms: number) => `${Math.round(ms / 3_600_000)}h`,
}));

vi.mock("../queue/run-recovery-worker.js", () => ({
  getRecoveryRootSessionId: vi.fn(async (sessionId: string) => state.recoveryRoots[sessionId] ?? null),
}));

vi.mock("../surfaces/messaging/commands.js", () => ({
  chatTargetFor: vi.fn(async () => (state.chat ? { chatId: "c" } : null)),
}));

vi.mock("../surfaces/spaces/client.js", () => ({
  decryptStoredField: (value: string) => `plain:${value}`,
  spacesAppFetch: vi.fn(async (path: string, body: Record<string, unknown>) => {
    state.calls.push({ path, body });
    if (path === "/chat/postMessage") return { messageId: `msg_${++state.nextMessage}` };
    return {};
  }),
  spacesAppFetchMultipart: vi.fn(async (_path: string, form: FormData) => {
    const entry: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) entry[key] = typeof value === "string" ? value : (value as File).name;
    state.uploads.push(entry);
    return { messageId: entry["messageId"] ?? "msg_files" };
  }),
}));

vi.mock("../repositories/index.js", () => {
  const epochRepo = {
    create: vi.fn(async (args: { experimentId: string; epoch: number; sessionId: string }) => {
      const row = {
        id: `e_${args.sessionId}`, experimentId: args.experimentId, epoch: args.epoch, sessionId: args.sessionId,
        messageId: null, status: "running", hypothesis: null, plan: null, previewUrl: null, codeUrl: null,
        terminalUrl: null, retries: 0, error: null, summary: null, attachmentNames: [], needsYou: [],
        startedAt: new Date(), endedAt: null, updatedAt: new Date(),
      } as ExperimentEpoch;
      state.epochs.set(args.sessionId, row);
      return row;
    }),
    findBySessionId: vi.fn(async (sessionId: string) => state.epochs.get(sessionId) ?? null),
    update: vi.fn(async (sessionId: string, data: Record<string, unknown>) => {
      const row = state.epochs.get(sessionId);
      if (!row) throw new Error("missing epoch");
      const next = { ...row } as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        next[key] = value && typeof value === "object" && "increment" in (value as object)
          ? (row as unknown as Record<string, number>)[key]! + (value as { increment: number }).increment
          : value;
      }
      state.epochs.delete(sessionId);
      state.epochs.set(next["sessionId"] as string, next as unknown as ExperimentEpoch);
      return next as unknown as ExperimentEpoch;
    }),
    listByExperiment: vi.fn(async () => [...state.epochs.values()]),
    listRunning: vi.fn(async () => [...state.epochs.values()].filter((epoch) => epoch.status === "running")),
  };
  return {
    experimentEpochRepository: epochRepo,
    experimentRepository: {
      findById: vi.fn(async () => state.run),
      findActiveByConversation: vi.fn(async () => state.run),
      listFindings: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      update: vi.fn(async (_id: string, data: Partial<ExperimentRun>) => {
        state.run = { ...state.run!, ...data };
        return state.run;
      }),
    },
    agentRepository: {
      findBySlug: vi.fn(async () => ({ spacesAppToken: "tok", spacesAppUserId: "bot_1", spacesAppId: "app_1" })),
    },
    agentRunRepository: {
      findBySessionId: vi.fn(async () => ({ llmRetries: 2 })),
    },
  };
});

const cards = await import("./experiment-cards.js");

function makeRun(): ExperimentRun {
  return {
    id: "run_1", conversationId: "conv_1", channelId: "ch_1", agentSlug: "architect", userId: "u_1", orgId: "org_1",
    focus: "quality", provider: null, modelId: null, kind: "experiment", status: "running", epoch: 1,
    deadlineAt: new Date(Date.now() + 7 * 3_600_000), currentHypothesis: null, currentSessionId: "sess_1",
    lastEpochEndedAt: null, sandboxNote: null, deliveredArtifacts: [], checkerSessionIds: [], finalReport: null,
    statusMessageId: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

const epochCtx = { isExperiment: true, conversationId: "conv_1" };
const flowType = (body: Record<string, unknown>): string | undefined => {
  const flow = (body["flow"] ?? body["flowJSON"]) as { components?: Array<{ type: string }> } | undefined;
  return flow?.components?.[0]?.type;
};

beforeEach(() => {
  state.enabled = true;
  state.chat = false;
  state.run = makeRun();
  state.epochs.clear();
  state.calls = [];
  state.uploads = [];
  state.nextMessage = 0;
  state.recoveryRoots = {};
});

describe("experiment status card", () => {
  it("posts once, remembers the message, then edits it in place", async () => {
    expect(await cards.postExperimentStatusCard("run_1")).toBe(true);
    expect(state.run!.statusMessageId).toBe("msg_1");
    await cards.refreshExperimentStatusCard("run_1");
    expect(state.calls.map((call) => [call.path, flowType(call.body)])).toEqual([
      ["/chat/postMessage", "experiment_status"],
      ["/chat/updateMessage", "experiment_status"],
    ]);
    expect(state.calls[1]!.body["messageId"]).toBe("msg_1");
    expect((state.calls[0]!.body["flow"] as { data: Record<string, unknown> }).data["spacesAppId"]).toBe("app_1");
  });

  it("stays out of the way when cards are off or the run lives in a chat", async () => {
    state.enabled = false;
    expect(await cards.postExperimentStatusCard("run_1")).toBe(false);
    state.enabled = true;
    state.chat = true;
    expect(await cards.postExperimentStatusCard("run_1")).toBe(false);
    expect(state.calls).toEqual([]);
  });
});

describe("experiment epoch card", () => {
  it("opens a card per epoch and folds the plan and preview into it", async () => {
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    expect(await cards.routeExperimentPlan("sess_1", epochCtx, [{ id: "1", title: "Measure", status: "in_progress" }])).toBe(true);
    expect(await cards.routeExperimentPreview("sess_1", epochCtx, { previewUrl: "https://x/p/" })).toBe(true);
    await cards.refreshExperimentEpochCard("sess_1");
    const epochCalls = state.calls.filter((call) => flowType(call.body) === "experiment_epoch");
    expect(epochCalls[0]!.path).toBe("/chat/postMessage");
    expect(epochCalls.slice(1).every((call) => call.path === "/chat/updateMessage" && call.body["messageId"] === "msg_1")).toBe(true);
    const last = epochCalls.at(-1)!.body["flowJSON"] as { components: Array<{ props: Record<string, unknown> }> };
    expect(last.components[0]!.props["plan"]).toEqual([{ id: "1", text: "Measure", status: "running" }]);
    expect(last.components[0]!.props["links"]).toEqual({ preview: "https://x/p/" });
  });

  it("leaves non-experiment sessions and runs without cards to the normal path", async () => {
    expect(await cards.routeExperimentPlan("sess_x", { isExperiment: false }, [])).toBe(false);
    expect(await cards.routeExperimentPlan("sess_x", { isExperiment: true, conversationId: "conv_1" }, [])).toBe(false);
  });

  it("keeps an unknown session of a carded run (a checker racing its context) out of the thread", async () => {
    await cards.postExperimentStatusCard("run_1");
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    await cards.refreshExperimentStatusCard("run_1");
    const before = state.calls.length;
    expect(await cards.routeExperimentPlan("sess_checker", epochCtx, [{ id: "c", title: "Verify", status: "in_progress" }])).toBe(true);
    expect(state.epochs.get("sess_1")!.plan).toBeNull();
    expect(state.calls.length).toBe(before);
  });

  it("swallows a checker's plan and preview without posting", async () => {
    const checker = { isExperiment: true, suppressThreadReply: true, conversationId: "conv_1" };
    expect(await cards.routeExperimentPlan("sess_c", checker, [])).toBe(true);
    expect(await cards.routeExperimentPreview("sess_c", checker, { previewUrl: "https://x/p/" })).toBe(true);
    expect(state.calls).toEqual([]);
  });

  it("waits for a fresh epoch's own card instead of taking the previous epoch's", async () => {
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    const early = cards.routeExperimentPlan("sess_2", epochCtx, [{ id: "1", title: "Next", status: "in_progress" }]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await cards.openExperimentEpochCard({ ...state.run!, epoch: 2 }, "sess_2");
    expect(await early).toBe(true);
    expect(state.epochs.get("sess_1")!.retries).toBe(0);
    expect(state.epochs.get("sess_1")!.plan).toBeNull();
    expect(state.epochs.get("sess_2")!.plan).toEqual([{ id: "1", title: "Next", status: "in_progress" }]);
  });

  it("adopts the running epoch when recovery replays it under a new session", async () => {
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    state.recoveryRoots = { sess_1: "sess_1", sess_1b: "sess_1" };
    expect(await cards.routeExperimentPlan("sess_1b", epochCtx, [{ id: "1", title: "Retry", status: "pending" }])).toBe(true);
    const adopted = state.epochs.get("sess_1b")!;
    expect(adopted.messageId).toBe("msg_1");
    expect(adopted.retries).toBe(1);
  });

  it("records the result on the card, attaches files to it and pings mentioned people separately", async () => {
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    const span = '<span data-mention="" data-mention-type="user" data-user-id="u9" data-username="Sid" class="chat-input-mention">@Sid</span>';
    const handled = await cards.finishExperimentEpoch("sess_1", epochCtx, {
      status: "done",
      text: `Bundle −70%.\n${span} please review PR #2726.`,
      attachments: [{ fileName: "proof.md", mimeType: "text/markdown", data: Buffer.from("# proof").toString("base64") }],
    });
    expect(handled).toBe(true);
    expect(state.uploads[0]).toMatchObject({ messageId: "msg_1", files: "proof.md", channelId: "ch_1", conversationId: "conv_1" });
    const row = state.epochs.get("sess_1")!;
    expect(row.status).toBe("done");
    expect(row.summary).toBe("Bundle −70%.\n@Sid please review PR #2726.");
    expect(row.needsYou).toEqual(["@Sid please review PR #2726."]);
    expect(row.attachmentNames).toEqual(["proof.md"]);
    expect(row.retries).toBe(2);
    const mention = state.calls.find((call) => call.path === "/chat/postMessage" && typeof call.body["markdownText"] === "string");
    expect(mention!.body["markdownText"]).toBe(`${span} please review PR #2726.`);
  });

  it("leaves a step the epoch never closed as pending, not running, once it ends", async () => {
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    await cards.routeExperimentPlan("sess_1", epochCtx, [
      { id: "a", title: "Measure", status: "completed" },
      { id: "b", title: "Split", status: "in_progress" },
    ]);
    await cards.finishExperimentEpoch("sess_1", epochCtx, { status: "done", text: "Done." });
    expect(state.epochs.get("sess_1")!.plan).toEqual([
      { id: "a", title: "Measure", status: "completed" },
      { id: "b", title: "Split", status: "pending" },
    ]);
  });

  it("marks running epochs cancelled when the run is settled", async () => {
    await cards.openExperimentEpochCard(state.run!, "sess_1");
    await cards.settleExperimentCards("run_1");
    expect(state.epochs.get("sess_1")!.status).toBe("cancelled");
  });
});
