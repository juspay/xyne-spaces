import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const store = new Map<string, string>();
const redis = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  },
  del: (k: string) => Promise.resolve(store.delete(k) ? 1 : 0),
};
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => redis } }));
vi.mock("../../config.js", () => ({ CONFIG: { selfUrl: "https://claw.test", frontendUrl: "https://claw.test/claw/" } }));
vi.mock("../../middleware/rate-limiters.js", () => ({ oauthLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
const authorize = vi.fn(async (userId: string, opts?: { returnTo?: string }) => `https://accounts.google.test/auth?u=${userId}&r=${encodeURIComponent(opts?.returnTo ?? "")}`);
vi.mock("../../routes/oauth-token.js", () => ({
  getOAuthProvider: (type: string) => (type === "google" ? { authorize } : undefined),
}));
let connected = false;
vi.mock("../../db.js", () => ({ prisma: { userMcpConnection: { findFirst: async () => (connected ? { id: "c1" } : null) } } }));
const continueInChat = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./busy.js", () => ({ continueInChat }));

const { connectRouter, mintConnectLink } = await import("./connect.js");

const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "acct_1", chatId: "919", senderId: "919", isGroup: false } as const;
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/claw/api/v1/surfaces/:channel", connectRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  store.clear();
  connected = false;
  authorize.mockClear();
  continueInChat.mockClear();
});

const local = (url: string) => url.replace("https://claw.test", base);

describe("connect links", () => {
  it("starts the provider sign-in for the user the link was minted for, returning to /done", async () => {
    const url = await mintConnectLink({ userId: "u1", serverType: "google", serverName: "Google", target, agentSlug: "assistant" });
    expect(url).toMatch(/^https:\/\/claw\.test\/claw\/api\/v1\/surfaces\/whatsapp-cloud\/connect\/[A-Za-z0-9_-]+$/);
    const res = await fetch(local(url), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("accounts.google.test");
    expect(authorize).toHaveBeenCalledWith("u1", { returnTo: `${url}/done` });
  });

  it("sends connectors without a provider sign-in to the connector page", async () => {
    const url = await mintConnectLink({ userId: "u1", serverType: "jira", serverName: "Jira", target });
    const res = await fetch(local(url), { redirect: "manual" });
    expect(res.headers.get("location")).toBe("https://claw.test/claw/v3/mcp");
  });

  it("refuses an unknown token, or one used on another channel's path", async () => {
    expect((await fetch(`${base}/claw/api/v1/surfaces/whatsapp-cloud/connect/${"a".repeat(22)}`)).status).toBe(410);
    const url = await mintConnectLink({ userId: "u1", serverType: "google", serverName: "Google", target });
    expect((await fetch(local(url).replace("/whatsapp-cloud/", "/whatsapp/"))).status).toBe(410);
  });

  it("only continues the chat once a credential really exists, and only once", async () => {
    const url = await mintConnectLink({ userId: "u1", serverType: "google", serverName: "Google", target, agentSlug: "assistant" });
    // A forged "?google_connected=true" with no credential behind it.
    let page = await fetch(`${local(url)}/done?google_connected=true`);
    expect(await page.text()).toContain("Sign-in didn&#39;t finish");
    expect(continueInChat).not.toHaveBeenCalled();

    connected = true;
    page = await fetch(`${local(url)}/done`);
    expect(await page.text()).toContain("Google is connected");
    expect(continueInChat).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", agentSlug: "assistant", target, task: "I've connected Google. Carry on with what I asked." }),
    );
    // A reload: the link is spent.
    await fetch(`${local(url)}/done`);
    expect(continueInChat).toHaveBeenCalledTimes(1);
  });
});
