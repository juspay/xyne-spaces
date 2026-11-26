import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../repositories/index.js", () => ({
  userProviderCredentialsRepository: { listByUser: async () => [{ provider: "codex", encryptedKey: "encrypted", model: "test-model" }] },
  sharedProviderCredentialRepository: {},
  agentProviderCredentialsRepository: {},
}));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../config.js", () => ({ CONFIG: {}, CLAUDE_OAUTH: {}, claudeOAuthConfigured: () => false }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock("../middleware/agent-acl.js", () => ({ getRequesterId: () => "u1", requireRequester: () => "u1", isClawAdmin: () => false }));
vi.mock("../middleware/rate-limiters.js", () => ({ oauthLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../crypto.js", () => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("../redis.js", () => ({ redisService: {} }));
vi.mock("./agents.js", () => ({ fetchAnthropicModels: vi.fn() }));
vi.mock("../lib/provider-credential-verify.js", () => ({ extractProviderMessage: vi.fn(), modelServedBy: vi.fn(), providerNeedsKey: vi.fn(), verifyProviderCredential: vi.fn() }));
vi.mock("../mcpgateway/services/http-client.js", () => ({ assertSafeOutboundUrl: vi.fn() }));
vi.mock("../lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }));

import { settingsRouter } from "./settings.js";

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/settings", settingsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/settings`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

describe("Settings without per-user subagent model assignments", () => {
  it.each([
    ["GET", "/subagent-routing"],
    ["PUT", "/subagent-routing/spaces"],
    ["DELETE", "/subagent-routing/spaces"],
  ])("does not expose %s %s", async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(404);
  });

  it("still lists provider connections without exposing their encrypted keys", async () => {
    const response = await fetch(`${baseUrl}/provider-credentials`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: [{ provider: "codex", model: "test-model", hasApiKey: true }],
    });
  });
});
