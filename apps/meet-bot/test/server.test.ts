import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { createBotServer, type RunningSession } from "../src/server.js";
import type { SessionRequest, SessionStatus } from "../src/session.js";

const config: Config = {
  port: 0,
  apiKey: "secret",
  botName: "Xyne Automatic",
  sso: null,
  allowGuest: true,
  chromePath: undefined,
  browserChannel: undefined,
  muteAudio: true,
  backendUrlOverride: undefined,
  livekitUrlOverride: undefined,
  maxConcurrentSessions: 1,
  waitingRoomTimeoutMs: 1_000,
  aloneTimeoutMs: 1_000,
  maxMeetingMs: 1_000,
};

class FakeSession implements RunningSession {
  status: SessionStatus = "joining";
  cancelled = false;
  constructor(readonly request: SessionRequest) {}
  get isActive() {
    return !this.cancelled;
  }
  async run() {}
  cancel() {
    this.cancelled = true;
  }
}

const started: FakeSession[] = [];
let close: (() => void) | null = null;

async function startServer(): Promise<string> {
  const server = createBotServer(config, (request) => {
    const session = new FakeSession(request);
    started.push(session);
    return session;
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  close = () => server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const body = {
  sessionId: "call-1",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  callbackUrl: "https://backend.example/api/meet-bot/sessions/call-1",
};

function post(base: string, payload: unknown, key = "secret") {
  return fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(payload),
  });
}

afterEach(() => {
  close?.();
  started.length = 0;
});

describe("bot server", () => {
  it("serves health without a key but rejects sessions without one", async () => {
    const base = await startServer();
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await post(base, body, "wrong")).status).toBe(401);
    expect(started).toHaveLength(0);
  });

  it("starts a session with a normalised Meet link", async () => {
    const base = await startServer();
    const response = await post(base, { ...body, meetingUrl: "meet.google.com/ABC-defg-hij?x=1" });
    expect(response.status).toBe(202);
    expect(started[0]?.request.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("validates the request and enforces capacity", async () => {
    const base = await startServer();
    expect((await post(base, { ...body, meetingUrl: "https://zoom.us/j/1" })).status).toBe(400);
    expect((await post(base, { ...body, callbackUrl: "" })).status).toBe(400);
    expect((await post(base, { ...body, callbackUrl: "file:///etc/passwd" })).status).toBe(400);
    expect((await post(base, body)).status).toBe(202);
    expect((await post(base, body)).status).toBe(409);
    expect((await post(base, { ...body, sessionId: "call-2" })).status).toBe(503);
  });

  it("cancels a session on DELETE", async () => {
    const base = await startServer();
    await post(base, body);
    const response = await fetch(`${base}/sessions/call-1`, { method: "DELETE", headers: { "x-api-key": "secret" } });
    expect(response.status).toBe(202);
    expect(started[0]?.cancelled).toBe(true);
  });
});
