import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";

/**
 * SECURITY: the unsigned-S2S bypass on the webhook routes must be gone.
 *
 * `verifySpacesSignature`'s contract: "The webhook handler trusts payload
 * identity and can run agents with that user's credentials, so an unsigned or
 * invalid callback must never reach a downstream handler." Until 2026-09-15
 * both `POST /webhook/app/:spacesAppId` and `POST /webhook/:agentSlug`
 * skipped that verification entirely when the caller presented a valid
 * `x-s2s-key` and NO `x-xyne-signature` header (the 2026-08-10 TEMPORARY
 * bypass) — so any holder of the shared S2S key could invoke automation
 * dispatch without the per-app HMAC. Prod logs showed zero uses of the
 * bypass in its final 30 days, and it was removed.
 *
 * These tests wire the REAL webhookRouter, the REAL verifySpacesSignature
 * and the REAL constant-time s2sKeyMatches exactly like the production mount
 * (http/routes.ts:247 — no mount-level auth by design), mocking only the
 * module graph (config/db/repositories/crypto/redis/users-jit).
 */
const S2S_KEY = vi.hoisted(() => "test-s2s-key");

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
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  createTraceId: () => "test-trace-id",
}));

vi.mock("../db.js", () => ({
  prisma: {
    agent: {
      // verifySpacesSignature agent lookups: a resolvable agent WITH a stored
      // (3-part GCM) secret, so verification reaches the signature-header
      // check instead of failing earlier on no_stored_secret.
      findFirst: vi.fn(async () => ({ id: "agent-1", signingSecret: "aa:bb:cc" })),
      findMany: vi.fn(async () => [{ id: "agent-1", signingSecret: "aa:bb:cc", orgId: "org-1" }]),
    },
  },
}));

vi.mock("../repositories/index.js", () => ({
  agentRepository: {
    // On the vulnerable code the /app route's post-bypass dispatch misses
    // here (404) — proving the request got PAST signature verification.
    findBySpacesAppId: vi.fn(async () => null),
    findBySlug: vi.fn(async () => null),
    findByAppUserId: vi.fn(async () => null),
    findBySlugWithRelations: vi.fn(async () => null),
  },
  userRepository: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
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

// servers.ts value-imports `Prisma` from @prisma/client (enum namespace),
// which requires the generated client; neither of its exports used by
// webhook.ts is exercised by these tests, so stub the module.
vi.mock("./servers.js", () => ({
  isVisibleToUser: vi.fn(() => true),
  parseConnectorMeta: vi.fn(() => ({})),
}));

vi.mock("./tools.js", () => ({
  buildAvailableToolsCatalog: vi.fn(() => ({})),
}));

// Several modules in webhook.ts's import graph (agent-widget-binding,
// spaces-db, goalRelooper, …) value-import from "@prisma/client", which
// requires the generated client; these tests never exercise those paths,
// so stub the package. Prisma.JsonNull and PrismaClient are the only
// runtime values the graph touches at module scope.
vi.mock("@prisma/client", () => ({
  Prisma: { JsonNull: Symbol("JsonNull") },
  PrismaClient: class MockPrismaClient {},
}));

// storageService instantiates a GCS client at module scope (needs a real
// bucket config); webhook.ts's graph only pulls it in transitively and these
// tests never touch storage.
vi.mock("../services/storageService.js", () => ({
  gcsService: {
    uploadFile: vi.fn(async () => ({})),
    getSignedUrl: vi.fn(async () => "https://storage.invalid/signed"),
    downloadFile: vi.fn(async () => Buffer.alloc(0)),
    deleteFile: vi.fn(async () => undefined),
  },
}));

import { webhookRouter } from "./webhook.js";

let baseUrl: string;
let server: ReturnType<typeof express>;

beforeAll(async () => {
  server = express();
  // main.ts sets req.rawBody via the json `verify` callback — the HMAC runs
  // over these exact bytes, so the test app must do the same.
  server.use(
    express.json({
      verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  server.use("/webhook", webhookRouter);
  const listener = server.listen(0);
  await new Promise<void>((resolve) => listener.on("listening", resolve));
  const address = listener.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  // Keep the handle for afterAll.
  (server as unknown as { _listener: unknown })._listener = listener;
});

afterAll(async () => {
  const listener = (server as unknown as { _listener?: { close: (cb: () => void) => void } })._listener;
  if (listener) await new Promise<void>((resolve) => listener.close(() => resolve()));
});

describe("unsigned-S2S bypass is removed from webhook routes", () => {
  it("rejects a valid s2s key with NO signature on /webhook/app/:spacesAppId", async () => {
    const res = await fetch(`${baseUrl}/webhook/app/app-1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-s2s-key": S2S_KEY },
      body: JSON.stringify({ task: "run the thing" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing X-Xyne-Signature");
  });

  it("rejects a valid s2s key with NO signature on /webhook/:agentSlug", async () => {
    const res = await fetch(`${baseUrl}/webhook/legacy-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-s2s-key": S2S_KEY },
      body: JSON.stringify({ task: "run the thing" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing X-Xyne-Signature");
  });

  it("still rejects a PRESENT but invalid signature (parity: the bypass never covered this)", async () => {
    const res = await fetch(`${baseUrl}/webhook/app/app-1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-s2s-key": S2S_KEY,
        "x-xyne-signature": "deadbeef",
      },
      body: JSON.stringify({ task: "run the thing" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid signature");
  });

  it("still rejects a non-s2s caller with no signature (parity)", async () => {
    const res = await fetch(`${baseUrl}/webhook/app/app-1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "run the thing" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing X-Xyne-Signature");
  });
});
