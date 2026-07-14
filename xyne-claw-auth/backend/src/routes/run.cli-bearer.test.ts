import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  agentFindUniqueArgs: null as unknown,
  fetchBodies: [] as Array<Record<string, unknown>>,
  config: {
    xyneClawUrl: "http://claw.local",
    xyneClawS2sKey: "s2s-secret",
    clawSseTransport: false,
    internalUrl: "http://auth.local",
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
    res.status(401).json({ success: false, error: "Authentication required" });
  }),
  requireUserAuth: vi.fn((req, _res, next) => {
    req.headers["x-user-id"] = "token-owner";
    req.headers["x-org-id"] = "org-token";
    next();
  }),
  requireStrictS2S: vi.fn((_req, _res, next) => next()),
  requireResultToken: vi.fn(() => (_req: Request, _res: Response, next: () => void) => next()),
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
    start: vi.fn(async () => ({})),
    findBySessionId: vi.fn(async () => null),
  },
  chatAttachmentRepository: { linkToMessage: vi.fn(async () => ({})) },
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
    }),
  },
}));

vi.mock("../lib/spaces-db.js", () => ({
  getWorkspaceIdForUser: vi.fn(async () => null),
}));

async function postRun(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const { runRouter } = await import("./run.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: "POST",
      url: "/run",
      originalUrl: "/run",
      baseUrl: "",
      headers: {
        authorization: "Bearer xyne_cli_real",
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
    vi.stubGlobal("fetch", vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.body && typeof init.body === "string") {
        state.fetchBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return new Response(JSON.stringify({ success: true, sessionId: "claw-session" }), {
        status: 200,
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
});
