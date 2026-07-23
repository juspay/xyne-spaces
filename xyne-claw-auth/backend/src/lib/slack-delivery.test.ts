import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAgent: { config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token" } } } } as Record<string, unknown> | null,
}));

vi.mock("../db.js", () => ({
  prisma: { surfaceAgent: { findUnique: vi.fn(async () => mocks.surfaceAgent) } },
}));

vi.mock("./surface-resolver.js", () => ({
  decryptSurfaceSecret: vi.fn((value: string) => value.replace("encrypted:", "")),
}));

import { deliverSlackResult } from "./slack-delivery.js";

describe("Slack result delivery", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("posts the converted result into the originating thread", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await deliverSlackResult({
      target: { surfaceAgentId: "sa-1", teamId: "T123", channelId: "C123", threadTs: "100.01", slackUserId: "U123" },
      status: "completed",
      result: "## Answer\n**yes** [source](https://example.com)",
    });

    const request = fetchMock.mock.calls[0]!;
    expect(request[0]).toBe("https://slack.com/api/chat.postMessage");
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      channel: "C123",
      thread_ts: "100.01",
      text: "Answer\n*yes* <https://example.com|source>",
    });
  });

  it("posts a short failure message instead of the raw error", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await deliverSlackResult({
      target: { surfaceAgentId: "sa-1", teamId: "T123", channelId: "C123", threadTs: "100.01", slackUserId: "U123" },
      status: "failed",
      result: "sensitive stack trace",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.text).toContain("couldn't complete");
    expect(body.text).not.toContain("sensitive");
  });

  it("uploads result attachments via the external upload flow into the thread", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, ...(init ? { init } : {}) });
      if (u.includes("files.getUploadURLExternal")) {
        return new Response(JSON.stringify({ ok: true, upload_url: "https://uploads.slack.com/u/1", file_id: "F123" }));
      }
      if (u.includes("uploads.slack.com")) return new Response("OK", { status: 200 });
      return new Response(JSON.stringify({ ok: true, ts: "101.01" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await deliverSlackResult({
      target: { surfaceAgentId: "sa-1", teamId: "T123", channelId: "C123", threadTs: "100.01", slackUserId: "U123" },
      status: "completed",
      result: "report attached",
      attachments: [{ fileName: "test.txt", mimeType: "text/plain", data: Buffer.from("hello").toString("base64") }],
    });

    const urls = calls.map((c) => c.url);
    expect(urls).toEqual([
      "https://slack.com/api/chat.postMessage",
      "https://slack.com/api/files.getUploadURLExternal",
      "https://uploads.slack.com/u/1",
      "https://slack.com/api/files.completeUploadExternal",
    ]);
    const complete = JSON.parse(String(calls[3]!.init?.body));
    expect(complete).toEqual({
      files: [{ id: "F123", title: "test.txt" }],
      channel_id: "C123",
      thread_ts: "100.01",
    });
  });
});
