import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

/**
 * XYNE-66874: the one-shot sandbox preview announce on /webhook/progress must
 * not post to Spaces for Slack or messaging-channel (WhatsApp, …) runs. Those
 * runs carry responseMode "conversation" but their channelId/conversationId
 * are the chat's ids and appToken is empty, so postAgentMessage only fails.
 * The ownership row is still recorded on every surface.
 *
 * Drives the REAL webhookRouter; the module graph is mocked the same way as
 * webhook-unsigned-s2s.security.test.ts, plus the three collaborators of the
 * preview branch (session lookup, ownership ingest, Spaces post).
 */
const S2S_KEY = vi.hoisted(() => "test-s2s-key");

const mocks = vi.hoisted(() => ({
  resolveSessionContext: vi.fn(),
  ingestSandboxPreviewSignals: vi.fn(),
  postAgentMessage: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    xyneClawS2sKey: S2S_KEY,
    internalUrl: "http://claw.invalid",
    encryptionKey: "test-encryption-key-32-bytes-aaaaaa",
    spacesEncryptionKey: "",
    selfUrl: "https://auth.example.internal",
    xyneClawUrl: "http://claw.local",
    clawSseTransport: false,
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: mocks.logInfo, debug: vi.fn() }),
  createTraceId: () => "test-trace-id",
}));

vi.mock("../db.js", () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({ config: {} })),
    },
  },
}));

vi.mock("../repositories/index.js", () => ({
  agentRepository: {},
  userRepository: {},
  userAgentConfigRepository: {},
  agentShareRepository: {},
  agentRunRepository: {},
  chatMessageRepository: {},
  agentChainWorkflowRepository: {},
  activeGoalRepository: {},
  experimentRepository: {},
  agentRequestRepository: {},
}));

vi.mock("../crypto.js", () => ({
  decrypt: vi.fn(() => "plaintext-test-secret"),
  decryptSpacesCbc: vi.fn(() => "plaintext-test-secret"),
  encrypt: vi.fn(() => "aa:bb:cc"),
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => {
      throw new Error("no redis in test");
    },
  },
}));

vi.mock("../lib/users-jit.js", () => ({
  orgIdForSpacesUser: vi.fn(async () => null),
  ensureUserExists: vi.fn(async () => null),
}));

vi.mock("./servers.js", () => ({
  isVisibleToUser: vi.fn(() => true),
  parseConnectorMeta: vi.fn(() => ({})),
}));

vi.mock("./tools.js", () => ({
  buildAvailableToolsCatalog: vi.fn(() => ({})),
}));

vi.mock("@prisma/client", () => ({
  Prisma: { JsonNull: Symbol("JsonNull") },
  PrismaClient: class MockPrismaClient {},
}));

vi.mock("../services/storageService.js", () => ({
  gcsService: {
    uploadFile: vi.fn(async () => ({})),
    getSignedUrl: vi.fn(async () => "https://storage.invalid/signed"),
    downloadFile: vi.fn(async () => Buffer.alloc(0)),
    deleteFile: vi.fn(async () => undefined),
  },
}));

vi.mock("../lib/session-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/session-context.js")>()),
  resolveSessionContext: mocks.resolveSessionContext,
}));

vi.mock("../lib/conversation-artifact-signals.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/conversation-artifact-signals.js")>()),
  ingestSandboxPreviewSignals: mocks.ingestSandboxPreviewSignals,
}));

vi.mock("../surfaces/spaces/post-message.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../surfaces/spaces/post-message.js")>()),
  postAgentMessage: mocks.postAgentMessage,
}));

import { webhookRouter } from "./webhook.js";

let baseUrl: string;
let listener: { close: (cb: () => void) => void } | undefined;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/webhook", webhookRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  listener = server;
});

afterAll(async () => {
  if (listener) await new Promise<void>((resolve) => listener!.close(() => resolve()));
});

beforeEach(() => {
  mocks.resolveSessionContext.mockReset();
  mocks.ingestSandboxPreviewSignals.mockReset().mockResolvedValue({ recorded: true });
  mocks.postAgentMessage.mockReset().mockResolvedValue({});
  mocks.logInfo.mockReset();
});

const baseCtx = {
  mentionedUserId: "user-fake-1",
  senderId: "user-fake-1",
  responseMode: "conversation",
  agentSlug: "fake-agent",
  agentName: "Fake Agent",
  agentOrgId: "org-fake-1",
};

async function postPreview(sessionId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/webhook/progress`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-s2s-key": S2S_KEY },
    body: JSON.stringify({
      sessionId,
      sandboxId: `sbx-${sessionId}`,
      sandboxPreviewUrl: `https://sandbox.example.invalid/${sessionId}`,
    }),
  });
  expect(res.status).toBe(200);
}

function loggedInfo(fragment: string): boolean {
  return mocks.logInfo.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes(fragment));
}

describe("/webhook/progress sandbox preview is posted to Spaces only for Spaces runs (XYNE-66874)", () => {
  it("skips the Spaces post for a WhatsApp run but still records ownership", async () => {
    mocks.resolveSessionContext.mockResolvedValue({
      ...baseCtx,
      conversationId: "conv-wa-fake",
      channelId: "15550000000@s.whatsapp.net",
      spacesAppUserId: "",
      appToken: "",
      triggerSource: "whatsapp",
      channelDelivery: {
        channel: "whatsapp",
        connectedSurfaceId: "surface-fake-1",
        accountKey: "account-fake-1",
        chatId: "15550000000@s.whatsapp.net",
        senderId: "15550000000@s.whatsapp.net",
        isGroup: false,
      },
    });

    await postPreview("sess-wa-1");

    await vi.waitFor(() => expect(loggedInfo("run delivered via whatsapp")).toBe(true));
    expect(mocks.ingestSandboxPreviewSignals).toHaveBeenCalledTimes(1);
    expect(mocks.postAgentMessage).not.toHaveBeenCalled();
  });

  it("skips the Spaces post for a Slack run but still records ownership", async () => {
    mocks.resolveSessionContext.mockResolvedValue({
      ...baseCtx,
      conversationId: "conv-slack-fake",
      channelId: "C0FAKE",
      spacesAppUserId: "",
      appToken: "",
      triggerSource: "slack",
      slackDelivery: {
        surfaceAgentId: "surface-agent-fake",
        teamId: "T0FAKE",
        channelId: "C0FAKE",
        threadTs: "1700000000.000100",
        slackUserId: "U0FAKE",
      },
    });

    await postPreview("sess-slack-1");

    await vi.waitFor(() => expect(loggedInfo("run delivered via slack")).toBe(true));
    expect(mocks.ingestSandboxPreviewSignals).toHaveBeenCalledTimes(1);
    expect(mocks.postAgentMessage).not.toHaveBeenCalled();
  });

  it("still posts the preview link for a Spaces run", async () => {
    mocks.resolveSessionContext.mockResolvedValue({
      ...baseCtx,
      conversationId: "conv-spaces-fake",
      channelId: "channel-spaces-fake",
      spacesAppUserId: "app-user-fake",
      appToken: "app-token-fake",
      triggerSource: "spaces",
    });

    await postPreview("sess-spaces-1");

    await vi.waitFor(() => expect(mocks.postAgentMessage).toHaveBeenCalledTimes(1));
    const [, message] = mocks.postAgentMessage.mock.calls[0]!;
    expect(message).toMatchObject({ channelId: "channel-spaces-fake", conversationId: "conv-spaces-fake" });
    expect((message as { markdownText: string }).markdownText).toContain("https://sandbox.example.invalid/sess-spaces-1");
  });
});
