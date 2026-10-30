import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { log } from "./log.js";
import { parseMeetingUrl } from "./meetingUrl.js";
import { backendClient } from "./backendClient.js";
import type { SessionBackend, SessionRequest, SessionStatus } from "./session.js";

/** The part of MeetSession the server needs; lets tests swap in a fake. */
export interface RunningSession {
  readonly request: SessionRequest;
  readonly status: SessionStatus;
  readonly isActive: boolean;
  run(): Promise<void>;
  cancel(): void;
}

export type SessionFactory = (request: SessionRequest, backend: SessionBackend) => RunningSession;

const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function keyMatches(given: string | string[] | undefined, expected: string): boolean {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be a JSON object");
  }
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required`);
  return value.trim();
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export type BotServer = Server & {
  /** Asks every running session to leave its meeting, waiting up to `timeoutMs`. */
  stopSessions(timeoutMs: number): Promise<void>;
};

export function createBotServer(config: Config, createSession: SessionFactory): BotServer {
  const sessions = new Map<string, RunningSession>();
  const activeCount = () => [...sessions.values()].filter((s) => s.isActive).length;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, {
        ok: true,
        activeSessions: activeCount(),
        maxSessions: config.maxConcurrentSessions,
        sso: !!config.sso,
      });
      return;
    }
    if (!keyMatches(req.headers["x-api-key"], config.apiKey)) throw new HttpError(401, "Unauthorized");

    if (req.method === "POST" && url.pathname === "/sessions") {
      const body = await readJson(req);
      const sessionId = requireString(body, "sessionId");
      const meeting = parseMeetingUrl(requireString(body, "meetingUrl"));
      if (!meeting) throw new HttpError(400, "meetingUrl must be a Google Meet or Microsoft Teams link");
      const request: SessionRequest = { sessionId, platform: meeting.platform, meetingUrl: meeting.url };
      const callbackUrl = requireString(body, "callbackUrl");
      if (!/^https?:\/\//i.test(callbackUrl)) throw new HttpError(400, "callbackUrl must be an http(s) URL");

      if (sessions.get(sessionId)?.isActive) throw new HttpError(409, "Session already running");
      if (activeCount() >= config.maxConcurrentSessions) throw new HttpError(503, "Bot is at capacity");

      const session = createSession(
        request,
        backendClient(callbackUrl, config.apiKey, {
          backendUrl: config.backendUrlOverride,
          livekitUrl: config.livekitUrlOverride,
        }),
      );
      sessions.set(sessionId, session);
      void session.run().catch((error: unknown) => log.error("session_crashed", { sessionId, error: String(error) }));
      log.info("session_started", { sessionId, platform: meeting.platform, meetingCode: meeting.code });
      send(res, 202, { sessionId, status: session.status });
      return;
    }

    const match = url.pathname.match(/^\/sessions\/([^/]+)$/);
    const session = match?.[1] ? sessions.get(decodeURIComponent(match[1])) : undefined;
    if (match && req.method === "GET") {
      if (!session) throw new HttpError(404, "Session not found");
      send(res, 200, { sessionId: session.request.sessionId, status: session.status });
      return;
    }
    if (match && req.method === "DELETE") {
      if (!session) throw new HttpError(404, "Session not found");
      session.cancel();
      send(res, 202, { sessionId: session.request.sessionId, status: session.status });
      return;
    }
    throw new HttpError(404, "Not found");
  }

  // Drop finished sessions after a while so the map doesn't grow forever.
  const sweep = setInterval(() => {
    for (const [id, session] of sessions) if (!session.isActive) sessions.delete(id);
  }, 10 * 60_000);
  sweep.unref();

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) log.error("request_failed", { path: req.url, error: String(error) });
      send(res, status, { error: error instanceof HttpError ? error.message : "Internal error" });
    });
  });
  server.on("close", () => clearInterval(sweep));
  return Object.assign(server, {
    async stopSessions(timeoutMs: number): Promise<void> {
      for (const session of sessions.values()) session.cancel();
      const deadline = Date.now() + timeoutMs;
      while (activeCount() > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    },
  });
}
