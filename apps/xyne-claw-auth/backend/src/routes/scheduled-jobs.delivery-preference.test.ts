/**
 * Scheduled-job results, failure notices and approval cards routed through the
 * person's delivery preference (XYNE-66911): the fallback order, and the
 * unchanged routing for people who never chose.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("../logger.js", () => ({ createLogger: () => logs }));
vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: "k" } }));
vi.mock("../crypto.js", () => ({ decrypt: () => "app-token" }));
vi.mock("../repositories/index.js", () => ({
  agentRunRepository: { finalize: vi.fn(async () => undefined), findBySessionId: vi.fn(async () => ({ conversationId: "scheduled_conv-1" })) },
  chatMessageRepository: { create: vi.fn(async () => ({ id: "msg-1" })) },
}));
vi.mock("../repositories/agentRunRepository.js", () => ({ clawMetricsFields: () => ({}) }));
const spacesAppFetch = vi.fn(async (path: string, ..._rest: unknown[]) => (path === "/channel/openDm" ? { channelId: "dm-1" } : {}));
vi.mock("../lib/spaces-api.js", () => ({ spacesAppFetch, spacesAppFetchMultipart: vi.fn() }));
vi.mock("../middleware/agent-acl.js", () => ({ getRequesterId: vi.fn(), getOrgId: vi.fn(), isClawAdmin: vi.fn(), getAgentEditAccess: vi.fn() }));
vi.mock("../middleware/pin-user-id-param.js", () => ({ getRequesterAliases: vi.fn(), matchesAuthenticatedUserId: vi.fn() }));
vi.mock("../lib/users-jit.js", () => ({
  resolveCanonicalUserIdOrSelf: vi.fn(),
  spacesUserIdForClawUser: vi.fn(async () => "spaces-user-1"),
  userIdAliasesFor: vi.fn(),
}));
vi.mock("./scheduled-jobs-auth.js", () => ({ assertCanControlScheduledJob: vi.fn() }));
vi.mock("../middleware/require-auth.js", () => ({ requireStrictS2S: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../lib/spaces-db.js", () => ({
  getSpacesAuthForUser: vi.fn(async () => null),
  getWorkspaceIdForUser: vi.fn(async () => null),
  requestWorkspaceHint: vi.fn(),
}));
vi.mock("../lib/mention-transform.js", () => ({ expandSpacesMentions: (t: string) => t, resolveUnboundMentions: async (t: string) => t }));
vi.mock("../lib/mention-lookups.js", () => ({ buildSpacesMentionLookups: vi.fn(), buildSpacesMentionLookupsDb: vi.fn() }));
vi.mock("../queue/scheduled-jobs-queue.js", () => ({ enqueueDelayedJob: vi.fn(), enqueueCronJob: vi.fn(), cancelJob: vi.fn(), cancelCronJob: vi.fn() }));
vi.mock("../queue/run-recovery-worker.js", () => ({ handleRunCompletion: vi.fn(async () => null) }));
vi.mock("../services/dashboardShareRefreshService.js", () => ({ isDashboardTask: () => false, refreshScheduledDashboardShare: vi.fn() }));
vi.mock("./design-shares.js", () => ({ designShareUrl: vi.fn() }));
vi.mock("xyne-claw-shared", () => ({ buildScheduledJobApprovalFlow: vi.fn(), withSpacesAppId: vi.fn() }));

const cloudAccount = { id: "acc-cloud", orgId: "org-1", channel: "whatsapp-cloud", accountKey: "acct-key", surfaceId: "surf-wa", config: {}, channelConfig: {} };
let whatsapp: { account: typeof cloudAccount; chatId: string; via: "identity" | "own-device" } | null = null;
const findNotifyTarget = vi.fn(async (_u: string, _o: string, opts?: { verifiedIdentityOnly?: boolean }) =>
  whatsapp && (!opts?.verifiedIdentityOnly || whatsapp.via === "identity") ? whatsapp : null,
);
const notifyUser = vi.fn(async (..._args: unknown[]): Promise<{ ok: true; viaTemplate: boolean } | { ok: false; error: string }> => ({ ok: true, viaTemplate: false }));
vi.mock("../surfaces/messaging/agent-tools.js", () => ({ findNotifyTarget, notifyUser }));
const enqueueAndWait = vi.fn(async (..._args: unknown[]): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
vi.mock("../surfaces/messaging/delivery.js", () => ({ enqueueAndWait }));
const enqueueApprovalCards = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../surfaces/messaging/approvals.js", () => ({ enqueueApprovalCards }));

const baseRow = {
  id: "job-1",
  userId: "user-1",
  agentSlug: "assistant",
  orgId: "org-1",
  channelId: "chan-1",
  conversationId: "conv-1",
  workspaceId: "ws-1",
  replyMode: "thread",
  targetChannelId: null as string | null,
  type: "once",
  nextRunAt: null,
  cronExpression: null,
  status: "completed",
  task: "daily report",
};
let row = { ...baseRow };
let storedOrder: unknown = null;
const prisma = {
  scheduledJobRun: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  scheduledJob: { findUnique: vi.fn(async () => row), update: vi.fn() },
  agent: { findFirst: vi.fn(async () => ({ spacesAppToken: "a:b:c", spacesAppId: "app-1", spacesAppUserId: "bot-1" })) },
  deliveryPreference: { findUnique: vi.fn(async () => (storedOrder === null ? null : { order: storedOrder })) },
};
vi.mock("../db.js", () => ({ prisma }));

let server: Server;
let base = "";

beforeAll(async () => {
  const { scheduledJobsRouter } = await import("./scheduled-jobs.js");
  const app = express();
  app.use(express.json());
  app.use("/jobs", scheduledJobsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jobs`;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  row = { ...baseRow };
  storedOrder = null;
  whatsapp = null;
  for (const fn of [spacesAppFetch, notifyUser, enqueueAndWait, enqueueApprovalCards, findNotifyTarget, logs.info, logs.warn, logs.error]) fn.mockClear();
  notifyUser.mockImplementation(async () => ({ ok: true, viaTemplate: false }));
  enqueueAndWait.mockImplementation(async () => ({ ok: true }));
});

/** The handler answers first and delivers after; wait for its last word. */
async function postResult(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${base}/job-1/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-1", status: "completed", ...body }),
  });
  expect(res.status).toBe(200);
  await vi.waitFor(() => {
    const done = [...logs.info.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].some(([m]) =>
      /Posted result|DM'd result|delivered on WhatsApp|not delivered|failure notice|nothing to post/.test(String(m)),
    );
    expect(done).toBe(true);
  });
}

const postedTo = () => spacesAppFetch.mock.calls.map(([path, body]) => `${path}:${(body as { channelId?: string }).channelId ?? ""}`);

describe("scheduled-job result routing", () => {
  it("no preference: a thread job posts to its Spaces thread, never WhatsApp", async () => {
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ result: "Report ready" });
    expect(postedTo()).toEqual(["/chat/postMessage:chan-1"]);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("no preference: a WhatsApp-born job goes to WhatsApp only, with no new Spaces fallback", async () => {
    row = { ...baseRow, replyMode: "whatsapp", channelId: "whatsapp-cloud:chat" };
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    notifyUser.mockImplementation(async () => ({ ok: false, error: "window closed" }));
    await postResult({ result: "Report ready" });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(spacesAppFetch).not.toHaveBeenCalled();
  });

  it("WhatsApp first: a thread job is delivered on the verified WhatsApp instead of Spaces", async () => {
    storedOrder = ["whatsapp", "spaces"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ result: "Report ready" });
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", text: "Report ready", target: whatsapp }));
    expect(spacesAppFetch).not.toHaveBeenCalled();
  });

  it("WhatsApp send fails: falls back to the Spaces thread", async () => {
    storedOrder = ["whatsapp"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    notifyUser.mockImplementation(async () => ({ ok: false, error: "window closed" }));
    await postResult({ result: "Report ready" });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(postedTo()).toEqual(["/chat/postMessage:chan-1"]);
  });

  it("Teams first and WhatsApp not linked: both skipped, Spaces gets it", async () => {
    storedOrder = ["teams", "whatsapp"];
    await postResult({ result: "Report ready" });
    expect(notifyUser).not.toHaveBeenCalled();
    expect(postedTo()).toEqual(["/chat/postMessage:chan-1"]);
  });

  it("Spaces chosen for a WhatsApp-born job: DM'd in Spaces (its channelId is a phone chat)", async () => {
    row = { ...baseRow, replyMode: "whatsapp", channelId: "whatsapp-cloud:chat" };
    storedOrder = ["spaces"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ result: "Report ready" });
    expect(notifyUser).not.toHaveBeenCalled();
    expect(postedTo()).toEqual(["/channel/openDm:", "/chat/postMessage:dm-1"]);
  });

  it("a channel broadcast is never rerouted to someone's phone", async () => {
    row = { ...baseRow, replyMode: "channel", targetChannelId: "chan-team" };
    storedOrder = ["whatsapp"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ result: "Team report" });
    expect(notifyUser).not.toHaveBeenCalled();
    expect(postedTo()).toEqual(["/chat/postMessage:chan-team"]);
  });

  it("the failure notice follows the same order", async () => {
    storedOrder = ["whatsapp"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ status: "failed", error: "tool timed out" });
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("tool timed out"), target: whatsapp }));
    expect(spacesAppFetch).not.toHaveBeenCalled();
  });
});

describe("scheduled-job approval prompts", () => {
  const action = (userId: string) => ({ serverType: "spaces", tool: "spaces-create-ticket", userId, signature: "sig", params: { title: "t" } });

  it("no preference: nothing new is sent (as before)", async () => {
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ result: "done", pendingActions: [action("user-1")] });
    expect(enqueueApprovalCards).not.toHaveBeenCalled();
  });

  it("WhatsApp chosen and verified by code: cards go to that number, only for the owner's actions", async () => {
    storedOrder = ["whatsapp"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    await postResult({ result: "done", pendingActions: [action("user-1"), action("someone-else")] });
    await vi.waitFor(() => expect(enqueueApprovalCards).toHaveBeenCalledTimes(1));
    expect(enqueueApprovalCards).toHaveBeenCalledWith({
      target: { channel: "whatsapp-cloud", connectedSurfaceId: "acc-cloud", accountKey: "acct-key", chatId: "910000000001", senderId: "910000000001", isGroup: false },
      userId: "user-1",
      pendingActions: [action("user-1")],
      conversationId: "scheduled_conv-1",
      agentSlug: "assistant",
    });
  });

  it("never sends an approval to the own-device fallback", async () => {
    storedOrder = ["whatsapp"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "own-device" };
    await postResult({ result: "done", pendingActions: [action("user-1")] });
    expect(enqueueApprovalCards).not.toHaveBeenCalled();
    expect(enqueueAndWait).not.toHaveBeenCalled();
  });

  it("a closed WhatsApp window means no card (the free-form intro fails first)", async () => {
    storedOrder = ["whatsapp"];
    whatsapp = { account: cloudAccount, chatId: "910000000001", via: "identity" };
    enqueueAndWait.mockImplementation(async () => ({ ok: false, error: "More than 24 hours" }));
    await postResult({ result: "done", pendingActions: [action("user-1")] });
    expect(enqueueApprovalCards).not.toHaveBeenCalled();
  });
});
