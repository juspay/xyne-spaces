import { beforeEach, describe, expect, it, vi } from "vitest";

/** Redis with just enough SET NX / EX for the progress throttle. */
const store = new Map<string, { value: string; expiresAt: number | null }>();
const redis = {
  get: async (k: string) => {
    const hit = store.get(k);
    if (!hit) return null;
    if (hit.expiresAt !== null && hit.expiresAt <= Date.now()) {
      store.delete(k);
      return null;
    }
    return hit.value;
  },
  set: async (k: string, v: string, ...rest: unknown[]) => {
    if (rest.includes("NX") && (await redis.get(k)) !== null) return null;
    const ex = rest.indexOf("EX");
    store.set(k, { value: v, expiresAt: ex >= 0 ? Date.now() + Number(rest[ex + 1]) * 1000 : null });
    return "OK";
  },
};
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => redis } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const created = vi.fn(async (..._args: unknown[]) => ({ id: "m1" }));
vi.mock("../../repositories/index.js", () => ({ chatMessageRepository: { create: created } }));

const isSlotBusy = vi.fn(async (..._args: unknown[]) => false);
vi.mock("../../lib/message-queue.js", () => ({ isSlotBusy }));

/** The plan state Spaces keeps, as plain maps. */
const activePlans = new Map<string, Record<string, unknown>>();
const execMeta = new Map<string, Record<string, unknown>>();
const k = (conv: string, slug: string) => `${conv}:${slug}`;
vi.mock("../../lib/session-context.js", () => ({
  normalizePlanTitle: (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase(),
  setActivePlanCard: async (c: string, s: string, card: Record<string, unknown>) => void activePlans.set(k(c, s), card),
  getActivePlanCard: async (c: string, s: string) => activePlans.get(k(c, s)) ?? null,
  clearActivePlanCard: async (c: string, s: string) => void activePlans.delete(k(c, s)),
  setPlanExecMeta: async (c: string, s: string, meta: Record<string, unknown>) => void execMeta.set(k(c, s), meta),
  clearPlanExecMeta: async (c: string, s: string) => void execMeta.delete(k(c, s)),
}));

const continueInChat = vi.fn(async (..._args: unknown[]) => undefined);
const dispatchGoalTurn = vi.fn(async (..._args: unknown[]) => "sess-2" as string | null);
vi.mock("./busy.js", () => ({ continueInChat, dispatchGoalTurn }));

let tokenSeq = 0;
const parkOptions = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./cards.js", () => ({ newCardToken: () => `tok${++tokenSeq}`, parkOptions }));

const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const deliverChannelResult = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./delivery.js", () => ({ enqueueOutbound, deliverChannelResult }));

const resolveIdentity = vi.fn(async (..._args: unknown[]) => null as string | null);
vi.mock("./identity.js", () => ({ resolveIdentity }));

const {
  renderPlanProposal,
  renderPlanProgress,
  planDecisionCard,
  deliverChannelPlan,
  redeemPlanDecision,
  sendChannelPlanProgress,
  agentPlanModeOn,
  PROGRESS_INTERVAL_S,
} = await import("./plans.js");

const target = {
  channel: "whatsapp-cloud" as const,
  connectedSurfaceId: "acc-1",
  accountKey: "acct_1",
  chatId: "15550000001",
  senderId: "15550000001",
  isGroup: false,
};
const account = { id: "acc-1", orgId: "org-1", surfaceId: "whatsapp-cloud", accountKey: "acct_1", channel: "whatsapp-cloud" } as never;
const conv = "whatsapp-cloud-acct_1-assistant-15550000001";
const todos = [
  { id: "a", title: "Read the open tickets" },
  { id: "b", title: "Draft a summary" },
];
const proposal = { title: "Ticket digest", desc: "Summarise this week's tickets.", todos, trivial: false };

/** The text and card items queued so far, in order. */
const sent = () => enqueueOutbound.mock.calls.map((call) => call[1] as Record<string, unknown>);

beforeEach(() => {
  store.clear();
  activePlans.clear();
  execMeta.clear();
  tokenSeq = 0;
  vi.clearAllMocks();
  isSlotBusy.mockResolvedValue(false);
  resolveIdentity.mockResolvedValue(null);
  dispatchGoalTurn.mockResolvedValue("sess-2");
});

describe("rendering", () => {
  it("numbers a proposed plan and says nothing runs until approved", () => {
    expect(renderPlanProposal(proposal)).toBe(
      [
        "**Proposed plan: Ticket digest**",
        "Summarise this week's tickets.",
        "",
        "1. Read the open tickets",
        "2. Draft a summary",
        "",
        "_Nothing runs until you approve._",
      ].join("\n"),
    );
  });

  it("says a trivial plan is already running, and drops a generic title", () => {
    const text = renderPlanProposal({ title: "Plan", todos, trivial: true });
    expect(text.split("\n")[0]).toBe("**Plan**");
    expect(text).toContain("_Quick one — running it now._");
  });

  it("marks each step's status and counts what is done", () => {
    const text = renderPlanProgress("Ticket digest", [
      { id: "a", title: "Read the open tickets", status: "completed" },
      { id: "b", title: "Draft a summary", status: "in_progress" },
      { id: "c", title: "Send it", status: "pending" },
      { id: "d", title: "File it", status: "failed" },
    ]);
    expect(text).toBe(
      [
        "**Plan: Ticket digest**",
        "",
        "1. Read the open tickets ✓",
        "2. Draft a summary — working on it",
        "3. Send it",
        "4. File it — failed",
        "",
        "_1 of 4 done_",
      ].join("\n"),
    );
  });

  it("offers Approve then Reject, so on Baileys 1 approves and 2 rejects", () => {
    const card = planDecisionCard("yes", "no");
    expect(card).toMatchObject({ kind: "buttons", buttons: [{ id: "yes", title: "Approve" }, { id: "no", title: "Reject" }] });
  });

  it("reads plan mode off the agent's own config", () => {
    expect(agentPlanModeOn({ planMode: true })).toBe(true);
    expect(agentPlanModeOn({ planMode: "true" })).toBe(false);
    expect(agentPlanModeOn(null)).toBe(false);
  });
});

describe("deliverChannelPlan", () => {
  const owner = { target, userId: "u1", conversationId: conv, agentSlug: "assistant", orgId: "org-1" };

  it("sends the list as the answer, then an Approve/Reject card bound to this proposal", async () => {
    const turn2 = await deliverChannelPlan({ ...owner, plan: proposal });
    expect(turn2).toBeNull();
    expect(deliverChannelResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", result: renderPlanProposal(proposal) }),
    );
    const active = activePlans.get(k(conv, "assistant"));
    expect(active).toMatchObject({ todos, title: "Ticket digest" });
    const parked = parkOptions.mock.calls[0]?.[1] as Array<{ token: string; option: Record<string, unknown> }>;
    expect(parked.map((p) => p.option["action"])).toEqual([
      { kind: "plan", decision: "approve", planId: active?.["messageId"] },
      { kind: "plan", decision: "reject", planId: active?.["messageId"] },
    ]);
    expect(parked[0]?.option).toMatchObject({ chatId: target.chatId, senderId: target.senderId, userId: "u1", conversationId: conv });
    const card = sent().find((item) => item["kind"] === "card")?.["card"] as Record<string, unknown>;
    expect(card["buttons"]).toEqual([
      { id: parked[0]?.token, title: "Approve" },
      { id: parked[1]?.token, title: "Reject" },
    ]);
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant", content: renderPlanProposal(proposal) }));
    expect(dispatchGoalTurn).not.toHaveBeenCalled();
  });

  it("runs a trivial plan at once and hands back its session so the slot is kept", async () => {
    const turn2 = await deliverChannelPlan({ ...owner, plan: { ...proposal, trivial: true } });
    expect(turn2).toBe("sess-2");
    expect(parkOptions).not.toHaveBeenCalled();
    expect(execMeta.get(k(conv, "assistant"))).toMatchObject({
      autoApproved: true,
      approvedTitles: ["read the open tickets", "draft a summary"],
    });
    expect(dispatchGoalTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSlug: "assistant",
        task: "Execute this approved plan:\n1. Read the open tickets\n2. Draft a summary",
        plan: { phase: "execute", todos },
      }),
    );
  });

  it("says so when a trivial plan could not be started", async () => {
    dispatchGoalTurn.mockResolvedValueOnce(null);
    expect(await deliverChannelPlan({ ...owner, plan: { ...proposal, trivial: true } })).toBeNull();
    expect(sent().at(-1)).toMatchObject({ kind: "text", text: "I couldn't start that plan — please ask again." });
  });
});

describe("redeemPlanDecision", () => {
  const owner = { target, userId: "u1", conversationId: conv, agentSlug: "assistant", orgId: "org-1" };
  const optionFor = (decision: "approve" | "reject", planId: string) => ({
    action: { kind: "plan" as const, decision, planId },
    chatId: target.chatId,
    senderId: target.senderId,
    userId: "u1",
    conversationId: conv,
    agentSlug: "assistant",
  });
  async function propose(): Promise<string> {
    await deliverChannelPlan({ ...owner, plan: proposal });
    vi.clearAllMocks();
    return activePlans.get(k(conv, "assistant"))?.["messageId"] as string;
  }

  it("approves: records the approved steps and starts Turn 2 in this chat", async () => {
    const planId = await propose();
    await redeemPlanDecision({ account, option: optionFor("approve", planId), target });
    expect(activePlans.has(k(conv, "assistant"))).toBe(false);
    expect(execMeta.get(k(conv, "assistant"))).toMatchObject({ autoApproved: false, title: "Ticket digest" });
    expect(sent()[0]).toMatchObject({ kind: "text", text: "Approved — running 2 step(s)…" });
    expect(continueInChat).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        userId: "u1",
        agentSlug: "assistant",
        task: "Execute this approved plan:\n1. Read the open tickets\n2. Draft a summary",
        plan: { phase: "execute", todos },
      }),
    );
  });

  it("rejects: drops the plan, runs nothing, and notes it in the conversation", async () => {
    const planId = await propose();
    await redeemPlanDecision({ account, option: optionFor("reject", planId), target });
    expect(activePlans.has(k(conv, "assistant"))).toBe(false);
    expect(continueInChat).not.toHaveBeenCalled();
    expect(sent()[0]).toMatchObject({ text: "Plan rejected — nothing was run." });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ role: "user", content: "Rejected the plan." }));
  });

  it("refuses a plan the agent has since replaced", async () => {
    const first = await propose();
    await propose();
    await redeemPlanDecision({ account, option: optionFor("approve", first), target });
    expect(continueInChat).not.toHaveBeenCalled();
    expect(sent()[0]).toMatchObject({ text: "This plan is no longer active. Ask me again for a new plan." });
  });

  it("re-offers the choice instead of racing a run still working here", async () => {
    const planId = await propose();
    isSlotBusy.mockResolvedValueOnce(true);
    await redeemPlanDecision({ account, option: optionFor("approve", planId), target });
    expect(continueInChat).not.toHaveBeenCalled();
    expect(activePlans.has(k(conv, "assistant"))).toBe(true);
    const card = sent()[0]?.["card"] as Record<string, unknown>;
    expect(card["body"]).toContain("approve the plan once I'm done");
    const reparked = parkOptions.mock.calls[0]?.[1] as Array<{ option: { action: unknown } }>;
    expect(reparked[0]?.option.action).toEqual({ kind: "plan", decision: "approve", planId });
  });

  it("will not let someone whose link changed approve another person's plan", async () => {
    const planId = await propose();
    resolveIdentity.mockResolvedValueOnce("someone-else");
    await redeemPlanDecision({ account, option: optionFor("approve", planId), target });
    expect(continueInChat).not.toHaveBeenCalled();
    expect(sent()[0]).toMatchObject({ text: "This plan isn't yours to approve." });
  });
});

describe("sendChannelPlanProgress", () => {
  const step = (status: "pending" | "in_progress" | "completed") => [
    { id: "a", title: "Read the open tickets", status: "completed" as const },
    { id: "b", title: "Draft a summary", status },
  ];
  const send = (todos: ReturnType<typeof step>, allDone = false) =>
    sendChannelPlanProgress({ target, conversationId: conv, title: "Ticket digest", todos, allDone });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("sends the first list, then holds further changes until the gap has passed", async () => {
    expect(await send(step("pending"))).toBe(true);
    expect(await send(step("in_progress"))).toBe(false);
    vi.advanceTimersByTime(PROGRESS_INTERVAL_S * 1000);
    expect(await send(step("in_progress"))).toBe(true);
    expect(enqueueOutbound).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("never re-sends an unchanged list, even after the gap", async () => {
    expect(await send(step("in_progress"))).toBe(true);
    vi.advanceTimersByTime(PROGRESS_INTERVAL_S * 1000);
    expect(await send(step("in_progress"))).toBe(false);
    vi.useRealTimers();
  });

  it("always sends the finished list, however soon it comes", async () => {
    expect(await send(step("in_progress"))).toBe(true);
    expect(await send(step("completed"), true)).toBe(true);
    expect(await send(step("completed"), true)).toBe(false);
    const last = sent().at(-1);
    expect(last).toMatchObject({ kind: "text", chatId: target.chatId });
    expect(last?.["text"]).toContain("_2 of 2 done_");
    vi.useRealTimers();
  });

  it("keeps each conversation's limit to itself", async () => {
    expect(await send(step("pending"))).toBe(true);
    expect(
      await sendChannelPlanProgress({ target, conversationId: `${conv}-other`, todos: step("pending"), allDone: false }),
    ).toBe(true);
    vi.useRealTimers();
  });
});
