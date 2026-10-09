import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const handleGmailPush = vi.fn(async () => 1);

vi.mock("../proactive/sources.js", () => ({
  handleGmailPush,
  enableGmailSource: vi.fn(),
  disableGmailSource: vi.fn(),
  deleteProactiveData: vi.fn(),
  ProactiveSetupError: class extends Error {},
}));
vi.mock("../proactive/sweep.js", () => ({ dismissLoop: vi.fn() }));
vi.mock("../db.js", () => ({ prisma: {} }));

describe("POST /public/gmail-push", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const { gmailPushRouter } = await import("./proactive-inbox.js");
    const app = express();
    app.use(express.json());
    app.use("/gmail-push", gmailPushRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gmail-push`;
  });

  afterAll(() => {
    server?.close();
    delete process.env["GMAIL_PUSH_TOKEN"];
  });

  beforeEach(() => {
    handleGmailPush.mockClear();
    handleGmailPush.mockResolvedValue(1);
  });

  const push = (query: string) =>
    fetch(`${base}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { data: Buffer.from("{}").toString("base64") } }),
    });

  it("is not served when no push token is configured", async () => {
    delete process.env["GMAIL_PUSH_TOKEN"];
    expect((await push("?token=x")).status).toBe(404);
    expect(handleGmailPush).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing token", async () => {
    process.env["GMAIL_PUSH_TOKEN"] = "secret-token";
    expect((await push("?token=wrong")).status).toBe(403);
    expect((await push("")).status).toBe(403);
    expect(handleGmailPush).not.toHaveBeenCalled();
  });

  it("accepts the right token and acks with 204", async () => {
    process.env["GMAIL_PUSH_TOKEN"] = "secret-token";
    expect((await push("?token=secret-token")).status).toBe(204);
    expect(handleGmailPush).toHaveBeenCalledTimes(1);
  });

  it("answers 500 so Pub/Sub retries when handling fails", async () => {
    process.env["GMAIL_PUSH_TOKEN"] = "secret-token";
    handleGmailPush.mockRejectedValueOnce(new Error("redis down"));
    expect((await push("?token=secret-token")).status).toBe(500);
  });
});
