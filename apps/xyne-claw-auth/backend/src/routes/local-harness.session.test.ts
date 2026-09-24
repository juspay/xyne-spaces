import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import type { LocalHarnessRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  run: null as LocalHarnessRun | null,
  session: null as Record<string, unknown> | null,
  archives: [] as Array<Record<string, unknown>>,
  uploads: [] as Array<{ path: string; mime: string; size: number }>,
  exists: true,
  streamBody: "session-line-1\n",
}));

vi.mock("../config.js", () => ({
  CONFIG: { localHarnessEnabled: true, localHarnessPollTimeoutMs: 1000, internalUrl: "http://auth.local" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: vi.fn(() => "user-1"),
  getOrgId: vi.fn(() => "org-1"),
  isOrgAdmin: vi.fn(async () => false),
}));

vi.mock("../repositories/localHarnessRepository.js", () => ({
  isDeviceOnline: vi.fn(() => true),
  authenticatedProviders: vi.fn(() => ["codex-cli"]),
  localHarnessRepository: {
    findDeviceByToken: vi.fn(async () => ({ id: "device-1", userId: "user-1", orgId: "org-1", lastSeenAt: new Date() })),
    touchDevice: vi.fn(async () => ({})),
    findOwnedRun: vi.fn(async () => state.run),
    setCliSessionId: vi.fn(async () => undefined),
  },
}));

vi.mock("../repositories/localHarnessSessionRepository.js", () => ({
  localHarnessSessionRepository: {
    find: vi.fn(async () => state.session),
    upsertSessionId: vi.fn(async () => ({})),
    upsertArchive: vi.fn(async (args: Record<string, unknown>) => {
      state.archives.push(args);
      return {};
    }),
  },
}));

vi.mock("../services/storageService.js", () => ({
  gcsService: {
    uploadFile: vi.fn(async (buffer: Buffer, path: string, mime: string) => {
      state.uploads.push({ path, mime, size: buffer.length });
    }),
    exists: vi.fn(async () => state.exists),
    createReadStream: vi.fn(() => Readable.from([Buffer.from(state.streamBody)])),
  },
}));

vi.mock("../lib/local-harness.js", () => ({
  TURN_HANDOFF_SUMMARY_FALLBACK: "I paused this task to handle your new message.",
  isLocalHarnessInterruptRequested: vi.fn(async () => false),
  clearLocalHarnessInterrupt: vi.fn(async () => undefined),
  callToolForRun: vi.fn(async () => ({ ok: true, content: "" })),
  listToolsForRun: vi.fn(async () => []),
  localHarnessProviderLabel: vi.fn((p: string) => p),
  recoverFailedLocalRun: vi.fn(async () => true),
  relayProgress: vi.fn(async () => undefined),
  relayResult: vi.fn(async () => undefined),
}));

function makeRun(): LocalHarnessRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    userId: "user-1",
    orgId: "org-1",
    agentSlug: "assistant",
    provider: "codex-cli",
    model: null,
    status: "running",
    deviceId: "device-1",
    envelope: { conversationId: "conv-1" },
    pendingAction: null,
    pendingActionId: null,
  } as unknown as LocalHarnessRun;
}

interface Capture {
  res: Response;
  done: Promise<void>;
  status: number;
  json: Record<string, unknown> | null;
  headers: Record<string, string>;
  chunks: Buffer[];
}

function makeResponse(): Capture {
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => { resolveDone = r; });
  const capture: Capture = { res: null as unknown as Response, done, status: 200, json: null, headers: {}, chunks: [] };
  const res = {
    json: vi.fn(function json(this: Response, body: Record<string, unknown>) {
      capture.json = body;
      resolveDone();
      return this;
    }),
    status: vi.fn(function status(this: Response, code: number) {
      capture.status = code;
      return this;
    }),
    setHeader: vi.fn((name: string, value: string) => { capture.headers[name] = value; }),
    getHeader: vi.fn(),
    removeHeader: vi.fn(),
    write: vi.fn((chunk: Buffer | string) => {
      capture.chunks.push(Buffer.from(chunk));
      return true;
    }),
    end: vi.fn((chunk?: Buffer | string) => {
      if (chunk) capture.chunks.push(Buffer.from(chunk));
      resolveDone();
    }),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    headersSent: false,
    locals: {},
  } as unknown as Response;
  capture.res = res;
  return capture;
}

function makeRequest(args: {
  method: string;
  query?: Record<string, string>;
  body?: Buffer;
  headers?: Record<string, string>;
}): Request {
  const stream = args.body ? Readable.from([args.body]) : Readable.from([]);
  return Object.assign(stream, {
    method: args.method,
    url: "/runs/run-1/session",
    originalUrl: "/runs/run-1/session",
    baseUrl: "",
    headers: { authorization: "Bearer device-token", ...(args.headers ?? {}) },
    query: args.query ?? {},
    params: {},
    ip: "127.0.0.1",
    ips: [],
    socket: { remoteAddress: "127.0.0.1" },
    app: { get: () => undefined },
  }) as unknown as Request;
}

async function dispatch(req: Request): Promise<Capture> {
  const { localHarnessBridgeRouter } = await import("./local-harness.js");
  const capture = makeResponse();
  (localHarnessBridgeRouter as unknown as { handle: (r: Request, s: Response, n: (e?: unknown) => void) => void })
    .handle(req, capture.res, (err?: unknown) => { if (err) throw err; });
  await capture.done;
  return capture;
}

describe("local harness native session bridge routes", () => {
  beforeEach(() => {
    vi.resetModules();
    state.run = makeRun();
    state.session = null;
    state.archives = [];
    state.uploads = [];
    state.exists = true;
  });

  it("stores an uploaded session and records the archive", async () => {
    const payload = Buffer.from('{"role":"user"}\n');
    const capture = await dispatch(
      makeRequest({
        method: "PUT",
        query: { sessionId: "cli-session-01" },
        body: payload,
        headers: { "content-type": "application/octet-stream", "content-length": String(payload.length) },
      }),
    );

    expect(capture.json).toEqual({ success: true, data: { sizeBytes: payload.length } });
    expect(state.uploads).toEqual([
      { path: "local-harness-sessions/user-1/conv-1/codex-cli.jsonl", mime: "application/x-ndjson", size: payload.length },
    ]);
    expect(state.archives[0]).toMatchObject({
      userId: "user-1",
      conversationId: "conv-1",
      provider: "codex-cli",
      cliSessionId: "cli-session-01",
      storagePath: "local-harness-sessions/user-1/conv-1/codex-cli.jsonl",
      sizeBytes: payload.length,
    });
  });

  it("rejects a malformed sessionId", async () => {
    const capture = await dispatch(
      makeRequest({
        method: "PUT",
        query: { sessionId: "bad id!" },
        body: Buffer.from("x"),
        headers: { "content-type": "application/octet-stream", "content-length": "1" },
      }),
    );

    expect(capture.status).toBe(400);
    expect(state.uploads).toHaveLength(0);
  });

  it("404s when nothing has been archived", async () => {
    const capture = await dispatch(makeRequest({ method: "GET" }));
    expect(capture.status).toBe(404);
    expect(capture.json).toEqual({ success: false, error: "No archived session" });
  });

  it("streams the archive with the session id header", async () => {
    state.session = {
      cliSessionId: "cli-session-01",
      storagePath: "local-harness-sessions/user-1/conv-1/codex-cli.jsonl",
    };
    const capture = await dispatch(makeRequest({ method: "GET" }));

    expect(capture.headers["content-type"]).toBe("application/octet-stream");
    expect(capture.headers["x-harness-session-id"]).toBe("cli-session-01");
    expect(Buffer.concat(capture.chunks).toString()).toBe(state.streamBody);
  });
});
