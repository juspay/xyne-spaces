import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import type { LocalHarnessRun } from "@prisma/client";

const state = vi.hoisted(() => ({
  run: null as LocalHarnessRun | null,
  redis: new Map<string, string>(),
  relayed: [] as Array<Record<string, unknown>>,
}));

vi.mock("../config.js", () => ({
  CONFIG: { localHarnessEnabled: true, localHarnessPollTimeoutMs: 1000, internalUrl: "http://auth.local", localHarnessRunTimeoutMs: 600000 },
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
    finishRun: vi.fn(async () => true),
    markAwaitingApproval: vi.fn(async () => true),
    clearPendingAction: vi.fn(async () => true),
  },
}));

vi.mock("../repositories/localHarnessSessionRepository.js", () => ({
  localHarnessSessionRepository: {
    find: vi.fn(async () => null),
    upsertSessionId: vi.fn(async () => ({})),
    upsertArchive: vi.fn(async () => ({})),
  },
}));

vi.mock("../services/storageService.js", () => ({
  gcsService: {
    uploadFile: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    createReadStream: vi.fn(() => Readable.from([])),
  },
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      get: vi.fn(async (key: string) => state.redis.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        state.redis.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => (state.redis.delete(key) ? 1 : 0)),
    }),
  },
}));

vi.mock("../lib/session-tokens.js", () => ({ mintSessionToken: vi.fn(() => "token") }));

vi.mock("../db.js", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ name: "Ann", email: "ann@x.com" })) } } }));

vi.mock("../lib/conversation-artifact-signals.js", () => ({ ingestArtifactSignals: vi.fn(async () => undefined) }));

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
    callbackUrl: "http://auth.local/callback",
    progressUrl: "http://auth.local/progress",
    pendingAction: null,
    pendingActionId: null,
  } as unknown as LocalHarnessRun;
}

interface Capture {
  res: Response;
  done: Promise<void>;
  status: number;
  json: Record<string, unknown> | null;
}

function makeResponse(): Capture {
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => { resolveDone = r; });
  const capture: Capture = { res: null as unknown as Response, done, status: 200, json: null };
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
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    removeHeader: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(() => { resolveDone(); }),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    headersSent: false,
    locals: {},
  } as unknown as Response;
  capture.res = res;
  return capture;
}

function makeRequest(args: { url: string; body: unknown }): Request {
  const raw = Buffer.from(JSON.stringify(args.body));
  const stream = Readable.from([raw]);
  return Object.assign(stream, {
    method: "POST",
    url: args.url,
    originalUrl: args.url,
    baseUrl: "",
    headers: {
      authorization: "Bearer device-token",
      "content-type": "application/json",
      "content-length": String(raw.length),
    },
    query: {},
    params: {},
    body: args.body,
    _body: true,
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

function file(name: string, bytes: number): { fileName: string; mimeType: string; data: string } {
  return { fileName: name, mimeType: "text/html", data: Buffer.alloc(bytes, 97).toString("base64") };
}

describe("local harness deliver bridge route", () => {
  beforeEach(() => {
    vi.resetModules();
    state.run = makeRun();
    state.redis = new Map();
    state.relayed = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body === "string") state.relayed.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  it("stashes delivered files and appends on a second call", async () => {
    const first = await dispatch(makeRequest({ url: "/runs/run-1/deliver", body: { files: [file("a.html", 10)] } }));
    expect(first.json).toEqual({ success: true, data: { count: 1 } });

    const second = await dispatch(makeRequest({ url: "/runs/run-1/deliver", body: { files: [file("b.html", 10)] } }));
    expect(second.json).toEqual({ success: true, data: { count: 2 } });

    const stash = JSON.parse(state.redis.get("local-harness-deliver:run-1")!) as Array<{ fileName: string }>;
    expect(stash.map((f) => f.fileName)).toEqual(["a.html", "b.html"]);
  });

  it("sanitises the file name to a basename", async () => {
    await dispatch(makeRequest({ url: "/runs/run-1/deliver", body: { files: [{ ...file("x.html", 4), fileName: "../../etc/passwd" }] } }));
    const stash = JSON.parse(state.redis.get("local-harness-deliver:run-1")!) as Array<{ fileName: string }>;
    expect(stash[0]!.fileName).toBe("passwd");
  });

  it("rejects more than 20 files", async () => {
    const capture = await dispatch(
      makeRequest({ url: "/runs/run-1/deliver", body: { files: Array.from({ length: 21 }, (_v, i) => file(`f${i}.html`, 4)) } }),
    );
    expect(capture.status).toBe(400);
    expect(state.redis.size).toBe(0);
  });

  it("rejects a payload over 25MB", async () => {
    const capture = await dispatch(
      makeRequest({ url: "/runs/run-1/deliver", body: { files: [file("big.html", 26 * 1024 * 1024)] } }),
    );
    expect(capture.status).toBe(400);
    expect(state.redis.size).toBe(0);
  });

  it("relays the stash as callback attachments and clears it", async () => {
    await dispatch(makeRequest({ url: "/runs/run-1/deliver", body: { files: [file("a.html", 10)] } }));

    await dispatch(
      makeRequest({ url: "/runs/run-1/result", body: { status: "done", text: "all done" } }),
    );

    await vi.waitFor(() => expect(state.relayed.length).toBeGreaterThan(0));
    const callback = state.relayed[state.relayed.length - 1]!;
    expect(callback["status"]).toBe("completed");
    const attachments = callback["attachments"] as Array<{ fileName: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.fileName).toBe("a.html");
    await vi.waitFor(() => expect(state.redis.has("local-harness-deliver:run-1")).toBe(false));
  });
});
