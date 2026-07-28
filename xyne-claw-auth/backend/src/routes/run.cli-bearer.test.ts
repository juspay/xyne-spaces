import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  agentFindUniqueArgs: null as unknown,
  fetchBodies: [] as Array<Record<string, unknown>>,
  startInputs: [] as Array<Record<string, unknown>>,
  sessionContexts: [] as Array<{ sessionId: string; context: Record<string, unknown>; options?: Record<string, unknown> }>,
  order: [] as string[],
  config: {
    selfUrl: "https://auth.example.internal",
    xyneClawUrl: "http://claw.local",
    xyneClawS2sKey: "s2s-secret",
    clawSseTransport: false,
    internalUrl: "http://auth.local",
    encryptionKey: Buffer.alloc(32, 7),
  },
}));

vi.mock("../config.js", () => ({
  CONFIG: state.config,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../middleware/require-auth.js", () => ({
  requireAuth: vi.fn((req, res, next) => {
    if (req.headers.authorization === "Bearer xyne_cli_real") {
      req.headers["x-user-id"] = "token-owner";
      req.headers["x-org-id"] = "org-token";
      next();
      return;
    }
    if (req.headers.authorization === "Bearer xyne_svc_real") {
      req.headers["x-user-id"] = "token-owner";
      req.headers["x-org-id"] = "org-token";
      res.locals = res.locals ?? {};
      res.locals["accessToken"] = {
        userId: "token-owner",
        orgId: "org-token",
        client: "service",
        scopes: ["runs:write", "agent:agent-a"],
      };
      next();
      return;
    }
    res.status(401).json({ success: false, error: "Authentication required" });
  }),
  requireUserAuth: vi.fn((req, _res, next) => {
    req.headers["x-user-id"] = "token-owner";
    req.headers["x-org-id"] = "org-token";
    next();
  }),
  requireStrictS2S: vi.fn((_req, _res, next) => next()),
  requireResultToken: vi.fn(() => (_req: Request, _res: Response, next: () => void) => next()),
  s2sKeyMatches: vi.fn((value: unknown) => value === "s2s-secret"),
}));

vi.mock("../db.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        name: "Owner User",
        email: "owner@example.com",
        orgId: "org-token",
      })),
    },
    agent: {
      findUnique: vi.fn(async (args: unknown) => {
        state.agentFindUniqueArgs = args;
        return {
          id: "agent-id",
          systemPrompt: "agent prompt",
          modelId: null,
          config: {},
          orgId: "org-token",
          spacesAppId: null,
          enabled: true,
          skills: [],
        };
      }),
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock("../repositories/index.js", () => ({
  chatMessageRepository: { create: vi.fn(async () => ({})) },
  agentRunRepository: {
    start: vi.fn(async (input: Record<string, unknown>) => {
      state.startInputs.push(input);
      return {};
    }),
    findBySessionId: vi.fn(async () => null),
  },
  chatAttachmentRepository: { linkToMessage: vi.fn(async () => ({})) },
  // run.ts calls isClawAdmin (agent-acl) on the dispatch path for the A2A
  // callable-agents resolution (2026-07); agent-acl reads this repository.
  userRoleRepository: { findByUserAndRole: vi.fn(async () => null) },
}));

vi.mock("../services/agentCatalogService.js", () => ({
  buildAgentCatalog: vi.fn(async () => ""),
}));

vi.mock("../services/gcsService.js", () => ({
  gcsService: { uploadFile: vi.fn(async () => undefined) },
}));

vi.mock("../services/agentChatContextService.js", () => ({
  normalizeAttachedContext: vi.fn(() => ({ items: [] })),
  buildAttachedContextPayload: vi.fn(async () => ({ contextFiles: [] })),
}));

vi.mock("../mcp/attached-context-injector.js", () => ({
  storeForSession: vi.fn(async () => undefined),
}));

vi.mock("../lib/subagent-resolver.js", () => ({
  resolveCustomSubagentsForRun: vi.fn(async () => []),
}));

vi.mock("../lib/agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: vi.fn(async () => ({ providerConfigs: {}, providerOrder: [] })),
  // run.ts also imports these (fast-mode work, 2026-07-15); a vi.mock factory
  // replaces the WHOLE module, so any unmocked import is undefined and the
  // handler 502s on a TypeError.
  resolveSubagentProviderMode: vi.fn(() => "spaces"),
}));

vi.mock("xyne-claw-shared", () => ({
  ClawSseParser: class {
    feed() {
      return [];
    }
  },
  parseToolsConfig: vi.fn(() => ({ subagents: [] })),
  stripPlatformConfigKeys: vi.fn((value: Record<string, unknown>) => value),
}));

vi.mock("../lib/session-tokens.js", () => ({
  mintSessionToken: vi.fn(() => "session-token"),
}));

vi.mock("../lib/consume-claw-stream.js", () => ({
  consumeAlreadyOpenStream: vi.fn(async () => undefined),
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      publish: vi.fn(async () => 1),
      // resolveFastMode reads the per-thread override; null = no override.
      get: vi.fn(async () => null),
      set: vi.fn(async () => "OK"),
      expire: vi.fn(async () => 1),
    }),
  },
}));

vi.mock("../lib/spaces-db.js", () => ({
  getWorkspaceIdForUser: vi.fn(async () => null),
}));

vi.mock("./webhook.js", () => ({
  setSession: vi.fn(async (sessionId: string, context: Record<string, unknown>, options?: Record<string, unknown>) => {
    state.order.push("setSession");
    state.sessionContexts.push({ sessionId, context, ...(options ? { options } : {}) });
  }),
}));

async function postRun(
  body: Record<string, unknown>,
  options: { s2s?: boolean; serviceToken?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { runRouter } = await import("./run.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: "POST",
      url: "/run",
      originalUrl: "/run",
      baseUrl: "",
      headers: {
        authorization: options.serviceToken ? "Bearer xyne_svc_real" : "Bearer xyne_cli_real",
        ...(options.s2s ? { "x-s2s-key": "s2s-secret" } : {}),
      },
      body,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as Response;
    (runRouter as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void })
      .handle(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve({ status: 404, body: {} });
      });
  });
}

describe("/run CLI bearer path", () => {
  beforeEach(() => {
    state.agentFindUniqueArgs = null;
    state.fetchBodies = [];
    state.startInputs = [];
    state.sessionContexts = [];
    state.order = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      let body: Record<string, unknown> | undefined;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
        state.fetchBodies.push(body);
      }
      state.order.push("fetch");
      return new Response(JSON.stringify({ success: true, sessionId: "claw-session" }), {
        status: body?.["detached"] === true ? 202 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
  });

  it("proceeds with no body userId by resolving the Bearer-authenticated x-user-id and org", async () => {
    const response = await postRun({
      agentSlug: "agent-a",
      task: "do work",
      triggerSource: "api",
    });

    expect(response).toEqual({ status: 200, body: { success: true, sessionId: "claw-session" } });
    expect(state.agentFindUniqueArgs).toMatchObject({
      where: { orgId_slug: { orgId: "org-token", slug: "agent-a" } },
    });
    expect(state.fetchBodies).toHaveLength(1);
    expect(state.fetchBodies[0]).toMatchObject({
      userId: "token-owner",
      userName: "Owner User",
      userEmail: "owner@example.com",
      task: "do work",
      agentSlug: "agent-a",
    });
  });

  it("rejects body userId escalation when it does not match the Bearer-authenticated user", async () => {
    const response = await postRun({
      userId: "other-user",
      agentSlug: "agent-a",
      task: "do work",
      triggerSource: "api",
    });

    expect(response.status).toBe(403);
    expect(response.body["error"]).toBe("Body userId does not match authenticated session");
    expect(state.fetchBodies).toHaveLength(0);
    expect(state.agentFindUniqueArgs).toBeNull();
  });

  it("interposes and persists an external callback for detached runs", async () => {
    const response = await postRun({
      agentSlug: "agent-a",
      task: "do detached work",
      triggerSource: "api",
      detached: true,
      callbackUrl: "https://qa.example.com/results",
      callbackSecret: "qa-callback-secret",
    });

    expect(response).toEqual({ status: 202, body: { success: true, sessionId: "claw-session" } });
    expect(state.fetchBodies[0]?.["callbackUrl"]).toBe("http://auth.local/claw/api/v1/webhook/result");
    expect(JSON.stringify(state.fetchBodies[0])).not.toContain("qa.example.com");
    expect(JSON.stringify(state.fetchBodies[0])).not.toContain("qa-callback-secret");

    const metadata = state.startInputs[0]?.["metadata"] as {
      externalResultCallback: { url: string; encryptedSecret: string };
    };
    expect(metadata.externalResultCallback.url).toBe("https://qa.example.com/results");
    expect(metadata.externalResultCallback.encryptedSecret).not.toContain("qa-callback-secret");
    const { decryptSurfaceSecret } = await import("../lib/surface-resolver.js");
    expect(decryptSurfaceSecret(metadata.externalResultCallback.encryptedSecret)).toBe("qa-callback-secret");
    expect(state.sessionContexts[0]?.context["externalResultCallback"]).toEqual(metadata.externalResultCallback);
  });

  it("interposes external callbacks for non-detached runs too", async () => {
    const response = await postRun({
      agentSlug: "agent-a",
      task: "do regular work",
      triggerSource: "api",
      conversationId: "external-conversation",
      callbackUrl: "https://qa.example.com/results",
    });

    expect(response).toEqual({ status: 200, body: { success: true, sessionId: "claw-session" } });
    expect(state.fetchBodies[0]?.["callbackUrl"]).toBe("http://auth.local/claw/api/v1/webhook/result");
    expect(JSON.stringify(state.fetchBodies[0])).not.toContain("qa.example.com");
    expect(state.startInputs[0]?.["metadata"]).toEqual({
      externalResultCallback: { url: "https://qa.example.com/results" },
    });
    expect(state.sessionContexts[0]?.options).toEqual({ skipConversationIndex: true });
  });

  it("rejects Slack delivery context from a non-S2S caller", async () => {
    const slackDelivery = {
      surfaceAgentId: "surface-agent-1",
      teamId: "T123",
      channelId: "C123",
      threadTs: "100.01",
      slackUserId: "U123",
    };
    const response = await postRun({
      agentSlug: "agent-a",
      task: "from Slack",
      triggerSource: "slack",
      conversationId: "slack:T123:C123:100.01",
      slackDelivery,
    });

    expect(response).toMatchObject({ status: 400, body: { error: "slackDelivery requires internal service authentication" } });
    expect(state.sessionContexts).toHaveLength(0);
    expect(state.fetchBodies).toHaveLength(0);
  });

  it("stores Slack delivery context from an S2S caller before forwarding the run", async () => {
    const slackDelivery = {
      surfaceAgentId: "surface-agent-1",
      teamId: "T123",
      channelId: "C123",
      threadTs: "100.01",
      slackUserId: "U123",
    };
    const response = await postRun({
      agentSlug: "agent-a",
      task: "from Slack",
      triggerSource: "slack",
      conversationId: "slack:T123:C123:100.01",
      slackDelivery,
    }, { s2s: true });

    expect(response.status).toBe(200);
    expect(state.order.slice(0, 2)).toEqual(["setSession", "fetch"]);
    expect(state.sessionContexts[0]?.context["slackDelivery"]).toEqual(slackDelivery);
    expect(state.fetchBodies[0]?.["callbackUrl"]).toBe("http://auth.local/claw/api/v1/webhook/result");
  });

  it("rejects a disallowed external callback target at submit time", async () => {
    const response = await postRun({
      agentSlug: "agent-a",
      task: "do work",
      triggerSource: "api",
      callbackUrl: "http://169.254.169.254/latest/meta-data",
    });

    expect(response).toMatchObject({ status: 400, body: { error: "callbackUrl is not an allowed target" } });
    expect(state.fetchBodies).toHaveLength(0);
  });

  it("service token: strips non-contract body fields before dispatch", async () => {
    const response = await postRun({
      agentSlug: "agent-a",
      task: "do work",
      triggerSource: "api",
      providerOverride: "codex",
      eventType: "automation",
      cwd: "/tmp/evil",
    }, { serviceToken: true });

    expect(response.status).toBe(200);
    expect(state.fetchBodies).toHaveLength(1);
    const forwarded = state.fetchBodies[0]!;
    expect(forwarded["providerOverride"]).toBeUndefined();
    expect(forwarded["cwd"]).toBeUndefined();
    // eventType must come from the platform default, not the caller's spoof.
    expect(forwarded["eventType"]).not.toBe("automation");
  });

  it("service token: denies agents outside the token's agent scopes", async () => {
    const response = await postRun({
      agentSlug: "agent-b",
      task: "do work",
      triggerSource: "api",
    }, { serviceToken: true });

    expect(response.status).toBe(403);
    expect(String(response.body["error"])).toContain("not scoped");
    expect(state.fetchBodies).toHaveLength(0);
  });

  it("service token: allows agents named by an agent scope", async () => {
    const response = await postRun({
      agentSlug: "agent-a",
      task: "do work",
      triggerSource: "api",
    }, { serviceToken: true });

    expect(response.status).toBe(200);
    expect(state.fetchBodies).toHaveLength(1);
  });
});
