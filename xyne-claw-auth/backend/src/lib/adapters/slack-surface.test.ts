import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { slackSurfaceAdapter } from "./slack-surface.js";

function signed(body: string, secret: string, timestamp: number): Record<string, string> {
  return {
    "x-slack-request-timestamp": String(timestamp),
    "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
  };
}

describe("slack surface adapter signature verification", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts a valid Slack v0 signature", () => {
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    const body = '{"type":"event_callback"}';
    const timestamp = Math.floor(Date.now() / 1000);
    expect(slackSurfaceAdapter.verifySignature(body, signed(body, "right-secret", timestamp), "right-secret"))
      .toBe(true);
  });

  it("rejects a tampered body", () => {
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signed('{"ok":true}', "right-secret", timestamp);
    expect(slackSurfaceAdapter.verifySignature('{"ok":false}', headers, "right-secret")).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    const body = "{}";
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    expect(slackSurfaceAdapter.verifySignature(body, signed(body, "right-secret", timestamp), "right-secret"))
      .toBe(false);
  });

  it("rejects a signature made with another install's secret", () => {
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    const body = "{}";
    const timestamp = Math.floor(Date.now() / 1000);
    expect(slackSurfaceAdapter.verifySignature(body, signed(body, "org-a-secret", timestamp), "org-b-secret"))
      .toBe(false);
  });
});

describe("slack surface adapter inbound parsing", () => {
  it("maps app_mention", () => {
    const payload = {
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev1",
      event: { type: "app_mention", user: "U123", channel: "C123", thread_ts: "171.1", text: "<@BOT> hi" },
    };
    expect(slackSurfaceAdapter.parseInbound(payload)).toEqual({
      eventType: "APP_MENTIONED",
      surfaceTenantId: "T123",
      surfaceUserId: "U123",
      channelId: "C123",
      threadId: "171.1",
      text: "<@BOT> hi",
      eventId: "Ev1",
      raw: payload,
    });
  });

  it("maps an IM message", () => {
    const payload = {
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev2",
      event: { type: "message", channel_type: "im", user: "U123", channel: "D123", text: "hello" },
    };
    expect(slackSurfaceAdapter.parseInbound(payload)).toMatchObject({
      eventType: "DIRECT_MESSAGE",
      surfaceTenantId: "T123",
      surfaceUserId: "U123",
      channelId: "D123",
      text: "hello",
      eventId: "Ev2",
    });
  });

  it.each([
    { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "bot", bot_id: "B1" },
    { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "edit", subtype: "message_changed" },
    { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "join", subtype: "channel_join" },
  ])("ignores bot echoes and message subtypes", (event) => {
    expect(slackSurfaceAdapter.parseInbound({
      type: "event_callback",
      team_id: "T123",
      event_id: "EvIgnored",
      event,
    })).toBeNull();
  });
});
