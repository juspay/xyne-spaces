import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const mocks = vi.hoisted(() => ({
  acceptedSecrets: new Set<string>(),
  parseInbound: vi.fn(() => null as Record<string, unknown> | null),
  resolveInboundForTenant: vi.fn(async (): Promise<{ orgId: string; userId: string | null; publicOnly: boolean }> => ({
    orgId: "org-1", userId: null, publicOnly: true,
  })),
  adminOrgs: new Set<string>(),
  platformAdmin: false,
  orgConnection: null as Record<string, unknown> | null,
  workspaceConnections: [] as Array<Record<string, unknown>>,
  surfaceAgent: null as Record<string, any> | null,
  surfaceAgentStatuses: [] as Array<Record<string, any>>,
  challengeSecrets: [] as Array<{ signingSecret: string | null }>,
  workspaceFindManyArgs: null as Record<string, unknown> | null,
  challengeFindManyArgs: [] as Array<Record<string, unknown>>,
  userFindFirstArgs: null as Record<string, unknown> | null,
  connectedUpsert: vi.fn(async () => ({})),
  surfaceAgentUpsert: vi.fn(async () => ({ id: "surface-agent-1" })),
  surfaceAgentUpdate: vi.fn(async () => ({})),
  rotateRefresh: vi.fn(async () => ({
    accessToken: "xoxe.xoxp-fresh",
    refreshToken: "xoxe-1-fresh",
    expiresAt: null,
  })),
  rotateStored: vi.fn(async () => "xoxe.xoxp-manifest"),
  setSession: vi.fn(async () => undefined),
  resolveProviders: vi.fn(async () => ({
    parent: "claude",
    providerConfigs: { claude: { apiKey: "provider-key", model: "claude-sonnet-4-5" } },
    providerOrder: ["claude"],
  })),
  userByEmail: null as { id: string; orgId: string } | null,
  identityCreate: vi.fn(async () => ({})),
  identityRow: null as { userId: string | null; orgId: string; status: string } | null,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../lib/surface-adapter.js", () => ({
  getSurfaceAdapter: () => ({
    key: "slack",
    verifySignature: vi.fn((_raw: unknown, _headers: unknown, secret: string) => mocks.acceptedSecrets.has(secret)),
    parseInbound: mocks.parseInbound,
  }),
}));

vi.mock("../lib/agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: mocks.resolveProviders,
  resolveSubagentProviderMode: vi.fn(() => "spaces"),
}));

vi.mock("./webhook.js", () => ({ setSession: mocks.setSession }));

vi.mock("../lib/surface-resolver.js", () => {
  class SurfaceResolverError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    SurfaceResolverError,
    resolveSurfaceTenant: vi.fn(async () => ({
      surface: { id: "surface-slack", key: "slack", identityMode: "USER_ID" },
      connectedSurface: { id: "workspace-connection", orgId: "org-1", surfaceTenantId: "T123", config: null },
    })),
    getConnectedSurfaceSigningSecret: vi.fn(() => null),
    resolveInboundForTenant: mocks.resolveInboundForTenant,
    encryptSurfaceSecret: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decryptSurfaceSecret: vi.fn((encrypted: string) => {
      if (!encrypted.startsWith("encrypted:")) throw new Error("malformed");
      return encrypted.slice("encrypted:".length);
    }),
  };
});

vi.mock("../services/slackConfigTokenService.js", () => {
  class SlackConfigTokenError extends Error {}
  return {
    SlackConfigTokenError,
    rotateSlackRefreshToken: mocks.rotateRefresh,
    rotateStoredSlackConfigToken: mocks.rotateStored,
    hasUsableSlackConfigToken: (connection: { config?: Record<string, unknown> | null }) =>
      connection.config?.["configTokenStatus"] !== "expired"
      && typeof connection.config?.["configAccessToken"] === "string"
      && typeof connection.config?.["configRefreshToken"] === "string",
    configWithRotatedTokens: (_existing: unknown, tokens: { accessToken: string; refreshToken: string }) => ({
      configAccessToken: `encrypted:${tokens.accessToken}`,
      configRefreshToken: `encrypted:${tokens.refreshToken}`,
      configTokenRotatedAt: "2026-07-22T00:00:00.000Z",
      configTokenStatus: "valid",
    }),
  };
});

vi.mock("../middleware/require-auth.js", () => ({
  requireUserAuth: async (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.headers["x-user-id"] !== "string") {
      res.status(401).json({ success: false, error: "User session required" });
      return;
    }
    next();
  },
}));

vi.mock("../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"] as string | undefined,
  getOrgId: (req: Request) => req.headers["x-org-id"] as string | undefined,
  isOrgAdmin: vi.fn(async (_userId: string, orgId: string) => mocks.adminOrgs.has(orgId)),
  isClawAdmin: vi.fn(async () => mocks.platformAdmin),
}));

vi.mock("../db.js", () => ({
  prisma: {
    surface: { findUnique: vi.fn(async () => ({ id: "surface-slack", key: "slack" })) },
    agent: {
      findFirst: vi.fn(async ({ where }: { where: { slug: string; orgId: string } }) => ({
        id: "agent-1", slug: where.slug, name: "Helper Agent", orgId: where.orgId,
      })),
    },
    connectedSurface: {
      findUnique: vi.fn(async () => mocks.orgConnection),
      findMany: vi.fn(async ({ where }: { where: { surfaceTenantId?: string; NOT?: unknown } }) => {
        mocks.workspaceFindManyArgs = where;
        // The umbrella-app lookup excludes the org-level row via NOT.
        return where.surfaceTenantId || where.NOT ? mocks.workspaceConnections : [];
      }),
      upsert: mocks.connectedUpsert,
    },
    surfaceAgent: {
      upsert: mocks.surfaceAgentUpsert,
      update: mocks.surfaceAgentUpdate,
      findUnique: vi.fn(async () => mocks.surfaceAgent),
      findFirst: vi.fn(async () => mocks.surfaceAgent),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ("agent" in where) return mocks.surfaceAgentStatuses;
        mocks.challengeFindManyArgs.push(where);
        return mocks.challengeSecrets;
      }),
    },
    user: { findFirst: vi.fn(async (args: Record<string, unknown>) => {
      mocks.userFindFirstArgs = args;
      return mocks.userByEmail;
    }) },
    userSurfaceIdentity: {
      create: mocks.identityCreate,
      findUnique: vi.fn(async () => mocks.identityRow),
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  },
}));

async function request(
  method: "GET" | "POST",
  url: string,
  options: { body?: Record<string, unknown>; userId?: string; orgId?: string } = {},
): Promise<{ status: number; body: any; location?: string }> {
  const { surfacesSlackRouter } = await import("./surfaces-slack.js");
  const parsed = new URL(url, "http://localhost");
  const body = options.body ?? {};
  const rawBody = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url: `${parsed.pathname}${parsed.search}`,
      originalUrl: `${parsed.pathname}${parsed.search}`,
      headers: {
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=fake",
        ...(options.userId ? { "x-user-id": options.userId } : {}),
        ...(options.orgId ? { "x-org-id": options.orgId } : {}),
      },
      query: Object.fromEntries(parsed.searchParams.entries()),
      body,
      rawBody,
    } as unknown as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(payload: unknown) { resolve({ status: statusCode, body: payload }); return this; },
      redirect(location: string) { resolve({ status: 302, body: undefined, location }); return this; },
      sendStatus(code: number) { resolve({ status: code, body: undefined }); return this; },
    } as unknown as Response;
    (surfacesSlackRouter as unknown as { handle: Function }).handle(req, res, (error?: unknown) => {
      if (error) reject(error); else resolve({ status: 404, body: undefined });
    });
  });
}

describe("Slack surfaces route", () => {
  beforeEach(() => {
    mocks.acceptedSecrets.clear();
    mocks.parseInbound.mockReset().mockReturnValue(null);
    mocks.resolveInboundForTenant.mockClear();
    mocks.adminOrgs = new Set(["org-1"]);
    mocks.platformAdmin = false;
    mocks.orgConnection = null;
    mocks.workspaceConnections = [];
    mocks.surfaceAgent = null;
    mocks.surfaceAgentStatuses = [];
    mocks.challengeSecrets = [];
    mocks.workspaceFindManyArgs = null;
    mocks.challengeFindManyArgs = [];
    mocks.userFindFirstArgs = null;
    mocks.connectedUpsert.mockClear();
    mocks.surfaceAgentUpsert.mockReset().mockResolvedValue({ id: "surface-agent-1" });
    mocks.surfaceAgentUpdate.mockClear();
    mocks.rotateRefresh.mockClear();
    mocks.rotateStored.mockReset().mockResolvedValue("xoxe.xoxp-manifest");
    mocks.setSession.mockClear();
    mocks.resolveProviders.mockClear();
    mocks.userByEmail = null;
    mocks.identityCreate.mockReset().mockResolvedValue({});
    mocks.identityRow = null;
    mocks.resolveInboundForTenant.mockReset().mockResolvedValue({ orgId: "org-1", userId: "user-1", publicOnly: false });
    process.env["SLACK_CLIENT_ID"] = "legacy-client";
    process.env["SLACK_CLIENT_SECRET"] = "legacy-secret";
    delete process.env["SLACK_SIGNING_SECRET"];
    vi.unstubAllGlobals();
  });

  it("rotates and stores the current encrypted configuration token pair", async () => {
    const response = await request("POST", "/config-token", {
      userId: "admin-1", orgId: "org-1",
      body: { orgId: "org-1", accessToken: "xoxe.xoxp-original", refreshToken: "xoxe-1-single-use" },
    });
    expect(response.status).toBe(200);
    expect(mocks.rotateRefresh).toHaveBeenCalledWith("xoxe-1-single-use");
    expect(mocks.connectedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        surfaceTenantId: "",
        config: expect.objectContaining({
          configAccessToken: "encrypted:xoxe.xoxp-fresh",
          configRefreshToken: "encrypted:xoxe-1-fresh",
          configTokenStatus: "valid",
        }),
      }),
    }));
    expect(JSON.stringify(mocks.connectedUpsert.mock.calls)).not.toContain("xoxe-1-single-use");
  });

  it.each([null, { id: "org-slack", config: { configTokenStatus: "expired", configAccessToken: "a", configRefreshToken: "r" } }])(
    "returns 503 when the org configuration token is missing or expired",
    async (connection) => {
      mocks.orgConnection = connection;
      const response = await request("POST", "/agents/helper/create-app", {
        userId: "admin-1", orgId: "org-1", body: { orgId: "org-1" },
      });
      expect(response).toMatchObject({ status: 503, body: { error: "Connect Slack with an app configuration token first" } });
    },
  );

  it("returns the not-found response when create-app authorization fails", async () => {
    mocks.adminOrgs.clear();
    const response = await request("POST", "/agents/helper/create-app", {
      userId: "member-1", orgId: "org-1", body: { orgId: "org-2" },
    });
    expect(response).toEqual({
      status: 404,
      body: { success: false, error: "Agent not found" },
    });
  });

  it("creates a dedicated app, encrypts credentials, and returns an install URL", async () => {
    mocks.orgConnection = {
      id: "org-slack", config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      app_id: "A-PER-AGENT",
      credentials: {
        client_id: "client-per-agent",
        client_secret: "client-secret-per-agent",
        signing_secret: "signing-secret-per-agent",
        verification_token: "verification",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1", orgId: "org-1", body: { orgId: "org-1" },
    });
    expect(response.status).toBe(200);
    expect(mocks.rotateStored).toHaveBeenCalledWith("org-slack");
    expect(mocks.surfaceAgentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        signingSecret: "encrypted:signing-secret-per-agent",
        config: expect.objectContaining({
          appId: "A-PER-AGENT",
          clientId: "client-per-agent",
          clientSecret: "encrypted:client-secret-per-agent",
          status: "created",
        }),
      }),
    }));
    const install = new URL(response.body.data.installUrl);
    expect(install.searchParams.get("client_id")).toBe("client-per-agent");
    expect(install.searchParams.get("scope")?.split(",")).toContain("chat:write.customize");
    expect(install.searchParams.get("state")).toBeTruthy();
  });

  it("returns created and installed per-agent app status without leaking secrets", async () => {
    mocks.surfaceAgentStatuses = [
      {
        id: "surface-agent-created",
        agent: { id: "agent-created", slug: "created-agent" },
        signingSecret: "encrypted:must-not-leak",
        config: {
          appId: "A-CREATED",
          clientId: "client-created",
          clientSecret: "encrypted:must-not-leak",
          status: "created",
        },
      },
      {
        id: "surface-agent-installed",
        agent: { id: "agent-installed", slug: "installed-agent" },
        config: {
          appId: "A-INSTALLED",
          clientId: "client-installed",
          clientSecret: "encrypted:must-not-leak",
          status: "installed",
          installs: {
            T123: {
              teamName: "Acme",
              installedAt: "2026-07-22T01:02:03.000Z",
              encryptedBotToken: "encrypted:xoxb-must-not-leak",
              botUserId: "U-BOT",
            },
          },
        },
      },
    ];

    const response = await request("GET", "/agents/status?orgId=org-1", {
      userId: "admin-1", orgId: "org-1",
    });

    expect(response).toMatchObject({
      status: 200,
      body: {
        success: true,
        data: [
          {
            agentId: "agent-created",
            agentSlug: "created-agent",
            appId: "A-CREATED",
            status: "created",
            installs: [],
          },
          {
            agentId: "agent-installed",
            agentSlug: "installed-agent",
            appId: "A-INSTALLED",
            status: "installed",
            installs: [{ teamId: "T123", teamName: "Acme", installedAt: "2026-07-22T01:02:03.000Z" }],
          },
        ],
      },
    });
    for (const status of response.body.data) {
      expect(new URL(status.installUrl).searchParams.get("state")).toBeTruthy();
    }
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("clientSecret");
    expect(serialized).not.toContain("signingSecret");
    expect(serialized).not.toContain("BotToken");
    expect(serialized).not.toContain("xoxb-");
  });

  it("reuses an existing per-agent app without invoking Slack again", async () => {
    mocks.orgConnection = {
      id: "org-slack", config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      app_id: "A-ORIGINAL",
      credentials: { client_id: "client-original", client_secret: "secret", signing_secret: "signing" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1", orgId: "org-1", body: { orgId: "org-1" },
    });
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      config: { appId: first.body.data.appId, clientId: "client-original", clientSecret: "encrypted:secret" },
    };
    fetchMock.mockClear();
    mocks.rotateStored.mockClear();

    const second = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1", orgId: "org-1", body: { orgId: "org-1" },
    });

    expect(second).toMatchObject({ status: 200, body: { data: { appId: "A-ORIGINAL", reused: true } } });
    // The reuse path probes apps.manifest.export (console deletions emit no
    // webhook) but must never call apps.manifest.create again.
    const calledUrls = (fetchMock.mock.calls as unknown as Array<[string]>).map((call) => String(call[0]));
    expect(calledUrls).toContain("https://slack.com/api/apps.manifest.export");
    expect(calledUrls).not.toContain("https://slack.com/api/apps.manifest.create");
    // One rotation for the liveness probe only.
    expect(mocks.rotateStored).toHaveBeenCalledTimes(1);
  });

  it("mints a new per-agent app when recreate is true", async () => {
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      config: { appId: "A-OLD", clientId: "client-old", clientSecret: "encrypted:old-secret" },
    };
    mocks.orgConnection = {
      id: "org-slack", config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      app_id: "A-NEW",
      credentials: { client_id: "client-new", client_secret: "new-secret", signing_secret: "new-signing" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1", orgId: "org-1", body: { orgId: "org-1", recreate: true },
    });

    expect(response).toMatchObject({ status: 200, body: { data: { appId: "A-NEW", reused: false } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.surfaceAgentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ config: expect.objectContaining({ appId: "A-NEW" }) }),
    }));
  });

  it("uses per-app OAuth credentials and stores the bot install on SurfaceAgent", async () => {
    mocks.orgConnection = {
      id: "org-slack", config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true, app_id: "A-PER-AGENT",
        credentials: { client_id: "client-per-agent", client_secret: "client-secret", signing_secret: "signing-secret" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true, app_id: "A-PER-AGENT", access_token: "xoxb-bot-secret", bot_user_id: "U-BOT",
        team: { id: "T123", name: "Acme" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const created = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1", orgId: "org-1", body: { orgId: "org-1" },
    });
    const state = new URL(created.body.data.installUrl).searchParams.get("state")!;
    mocks.surfaceAgent = {
      id: "surface-agent-1", agentId: "agent-1", surfaceId: "surface-slack", signingSecret: "encrypted:signing-secret",
      config: { appId: "A-PER-AGENT", clientId: "client-per-agent", clientSecret: "encrypted:client-secret", status: "created" },
      agent: { orgId: "org-1", slug: "helper" },
    };
    const callback = await request("GET", `/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(302);
    expect(mocks.workspaceFindManyArgs).toMatchObject({
      surfaceId: "surface-slack",
      surfaceTenantId: "T123",
      status: "ACTIVE",
    });
    const oauthBody = fetchMock.mock.calls[1]![1]!.body as URLSearchParams;
    expect(oauthBody.get("client_id")).toBe("client-per-agent");
    expect(oauthBody.get("client_secret")).toBe("client-secret");
    expect(mocks.surfaceAgentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { config: expect.objectContaining({
        status: "installed",
        installs: { T123: expect.objectContaining({ encryptedBotToken: "encrypted:xoxb-bot-secret", teamName: "Acme" }) },
      }) },
    }));
  });

  it("verifies normal events with the per-app signing secret and attaches agent context", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-1", signingSecret: "encrypted:per-app-secret",
      config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token", botUserId: "U-BOT" } } },
      agent: { id: "agent-1", slug: "helper", name: "Helper Agent", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "DIRECT_MESSAGE", surfaceTenantId: "T123", surfaceUserId: "U123",
      channelId: "D123", text: "hello", eventId: "EvPerApp", raw: { event: { ts: "100.01" } },
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/internal/run")) {
        return new Response(JSON.stringify({ success: true, sessionId: "session-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const response = await request("POST", "/events", {
      body: { type: "event_callback", api_app_id: "A-PER-AGENT", team_id: "T123", event_id: "EvPerApp", event: {} },
    });
    expect(response.status).toBe(200);
    expect(mocks.resolveInboundForTenant).toHaveBeenCalledWith(expect.anything(), "U123", {
      surfaceAgentId: "surface-agent-1", agentId: "agent-1", agentSlug: "helper",
    });
    await vi.waitFor(() => expect(mocks.setSession).toHaveBeenCalledWith("session-1", expect.anything()));
  });

  it("acks before dispatch completes and attaches providers plus Slack session delivery", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-dispatch", signingSecret: "encrypted:per-app-secret",
      config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token", botUserId: "U-BOT" } } },
      agent: { id: "agent-1", slug: "helper", name: "Helper Agent", orgId: "org-1", config: { provider: "claude" } },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "APP_MENTIONED", surfaceTenantId: "T123", surfaceUserId: "U123",
      channelId: "C123", text: "<@U-BOT> please help", eventId: "EvDispatch", raw: { event: { ts: "101.01" } },
    });
    let finishRun!: (response: globalThis.Response) => void;
    const pendingRun = new Promise<globalThis.Response>((resolve) => { finishRun = resolve; });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("/internal/run")) return pendingRun;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("POST", "/events", {
      body: { type: "event_callback", api_app_id: "A-PER-AGENT", team_id: "T123", event_id: "EvDispatch", event: {} },
    });
    expect(response.status).toBe(200);
    expect(mocks.setSession).not.toHaveBeenCalled();

    finishRun(new Response(JSON.stringify({ success: true, sessionId: "slack-session" }), { status: 200 }));
    await vi.waitFor(() => expect(mocks.setSession).toHaveBeenCalledTimes(1));
    const runCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/internal/run"))!;
    const runBody = JSON.parse(String(runCall[1]?.body));
    expect(runBody).toMatchObject({
      task: "please help",
      conversationId: "slack-T123-C123-101_01",
      eventType: "APP_MENTIONED",
      triggerSource: "slack",
      provider: "claude",
      providerConfigs: { claude: { apiKey: "provider-key" } },
    });
    expect(mocks.setSession).toHaveBeenCalledWith("slack-session", expect.objectContaining({
      agentId: "agent-1",
      agentOrgId: "org-1",
      responseMode: "conversation",
      slackDelivery: {
        surfaceAgentId: "surface-agent-dispatch", teamId: "T123", channelId: "C123",
        threadTs: "101.01", slackUserId: "U123",
      },
    }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("chat.postMessage"))).toBe(true));
  });

  it("auto-links an unresolved Slack user by tenant-matched work email", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.resolveInboundForTenant.mockResolvedValue({ orgId: "org-1", userId: null, publicOnly: true });
    mocks.userByEmail = { id: "email-user", orgId: "org-1" };
    mocks.surfaceAgent = {
      id: "surface-agent-email", signingSecret: "encrypted:per-app-secret",
      config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token", botUserId: "U-BOT" } } },
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "DIRECT_MESSAGE", surfaceTenantId: "T123", surfaceUserId: "U-EMAIL",
      channelId: "D123", text: "hello", eventId: "EvEmailLink", raw: { event: { ts: "102.01" } },
    });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("users.info")) {
        return new Response(JSON.stringify({ ok: true, user: { profile: { email: "worker@example.com" } } }), { status: 200 });
      }
      if (String(url).includes("/internal/run")) {
        return new Response(JSON.stringify({ success: true, sessionId: "email-session" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await request("POST", "/events", {
      body: { type: "event_callback", api_app_id: "A", team_id: "T123", event_id: "EvEmailLink", event: {} },
    })).status).toBe(200);
    await vi.waitFor(() => expect(mocks.identityCreate).toHaveBeenCalledTimes(1));
    expect(mocks.userFindFirstArgs).toMatchObject({
      where: { email: { equals: "worker@example.com", mode: "insensitive" }, orgId: "org-1" },
    });
    expect(mocks.identityCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      surfaceId: "surface-slack", surfaceWorkspaceId: "T123", surfaceUserId: "U-EMAIL",
      userId: "email-user", orgId: "org-1", status: "ACTIVE",
    }) });
    await vi.waitFor(() => expect(mocks.setSession).toHaveBeenCalledWith("email-session", expect.anything()));
  });

  it("replies with the linking instruction and does not dispatch when email misses", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.resolveInboundForTenant.mockResolvedValue({ orgId: "org-1", userId: null, publicOnly: true });
    mocks.surfaceAgent = {
      id: "surface-agent-miss", signingSecret: "encrypted:per-app-secret",
      config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token", botUserId: "U-BOT" } } },
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "DIRECT_MESSAGE", surfaceTenantId: "T123", surfaceUserId: "U-MISS",
      channelId: "D123", text: "hello", eventId: "EvEmailMiss", raw: { event: { ts: "103.01" } },
    });
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("users.info")) {
        return new Response(JSON.stringify({ ok: true, user: { profile: { email: "missing@example.com" } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await request("POST", "/events", {
      body: { type: "event_callback", api_app_id: "A", team_id: "T123", event_id: "EvEmailMiss", event: {} },
    });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("chat.postMessage"))).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/internal/run"))).toBe(false);
    const postCall = fetchMock.mock.calls.find(([url]) => String(url).includes("chat.postMessage"))!;
    expect(JSON.parse(String(postCall[1]?.body)).text).toContain("isn't linked");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("uses the same conversation id for a Slack thread and a new id for a new root", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-thread", signingSecret: "encrypted:per-app-secret",
      config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token", botUserId: "U-BOT" } } },
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    const runBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/internal/run")) {
        runBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ success: true, sessionId: `session-${runBodies.length}` }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const cases = [
      { id: "EvThread1", ts: "201.02", threadId: "200.01" },
      { id: "EvThread2", ts: "202.03", threadId: "200.01" },
      { id: "EvThread3", ts: "300.01", threadId: undefined },
    ];
    for (const item of cases) {
      mocks.parseInbound.mockReturnValue({
        eventType: "APP_MENTIONED", surfaceTenantId: "T123", surfaceUserId: "U123", channelId: "C123",
        text: "<@U-BOT> hi", eventId: item.id, ...(item.threadId ? { threadId: item.threadId } : {}),
        raw: { event: { ts: item.ts, ...(item.threadId ? { thread_ts: item.threadId } : {}) } },
      });
      await request("POST", "/events", {
        body: { type: "event_callback", api_app_id: "A", team_id: "T123", event_id: item.id, event: {} },
      });
      await vi.waitFor(() => expect(runBodies).toHaveLength(cases.indexOf(item) + 1));
    }
    expect(runBodies.map((body) => body["conversationId"])).toEqual([
      "slack-T123-C123-200_01",
      "slack-T123-C123-200_01",
      "slack-T123-C123-300_01",
    ]);
  });

  it("posts a threaded apology when asynchronous run dispatch fails", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-failure", signingSecret: "encrypted:per-app-secret",
      config: { installs: { T123: { encryptedBotToken: "encrypted:xoxb-token", botUserId: "U-BOT" } } },
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "APP_MENTIONED", surfaceTenantId: "T123", surfaceUserId: "U123",
      channelId: "C123", text: "<@U-BOT> help", eventId: "EvDispatchFailure",
      raw: { event: { ts: "401.01" } },
    });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("/internal/run")) {
        return new Response(JSON.stringify({ success: false, error: "unavailable" }), { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await request("POST", "/events", {
      body: { type: "event_callback", api_app_id: "A", team_id: "T123", event_id: "EvDispatchFailure", event: {} },
    })).status).toBe(200);

    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes("chat.postMessage")
      && JSON.parse(String(init?.body)).text === "Something went wrong dispatching this to the agent — please retry",
    )).toBe(true));
    const apologyCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("chat.postMessage")
      && JSON.parse(String(init?.body)).text.includes("Something went wrong"))!;
    expect(JSON.parse(String(apologyCall[1]?.body))).toMatchObject({ channel: "C123", thread_ts: "401.01" });
  });

  it("checks stored per-app secrets until one verifies a url_verification challenge", async () => {
    mocks.challengeSecrets = [
      { signingSecret: "encrypted:first-secret" },
      { signingSecret: "encrypted:matching-secret" },
    ];
    mocks.acceptedSecrets.add("matching-secret");
    const response = await request("POST", "/events", {
      body: { type: "url_verification", challenge: "challenge-token" },
    });
    expect(response).toEqual({ status: 200, body: { challenge: "challenge-token" } });
  });

  it("checks api_app_id-matched secrets before the url_verification fallback scan", async () => {
    mocks.challengeSecrets = [{ signingSecret: "encrypted:matching-secret" }];
    mocks.acceptedSecrets.add("matching-secret");
    const response = await request("POST", "/events", {
      body: { type: "url_verification", api_app_id: "A-MATCH", challenge: "challenge-token" },
    });
    expect(response.status).toBe(200);
    expect(mocks.challengeFindManyArgs[0]).toEqual({
      signingSecret: { not: null },
      config: { path: ["appId"], equals: "A-MATCH" },
    });
    expect(mocks.challengeFindManyArgs).toHaveLength(1);
  });
});

describe("Slack slash commands", () => {
  const usableToken = {
    configAccessToken: "encrypted:xoxe.xoxp-current",
    configRefreshToken: "encrypted:xoxe-1-current",
    configTokenStatus: "valid",
  };

  beforeEach(() => {
    mocks.adminOrgs = new Set(["org-1"]);
    mocks.platformAdmin = false;
    mocks.surfaceAgent = null;
    mocks.orgConnection = { id: "org-row", config: usableToken };
    mocks.workspaceConnections = [
      { id: "team-row", surfaceTenantId: "T123", status: "ACTIVE", config: { appId: "A_UMB" }, createdAt: new Date() },
    ];
    mocks.rotateStored.mockClear().mockResolvedValue("xoxe.xoxp-manifest");
    mocks.surfaceAgentUpsert.mockClear();
    mocks.setSession.mockClear();
    delete process.env["SLACK_SIGNING_SECRET"];
    vi.unstubAllGlobals();
  });

  it("registers a command on the umbrella app manifest and stores the binding", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
      calls.push({ url: String(url), body: init?.body as URLSearchParams });
      if (String(url).includes("apps.manifest.export")) {
        return new Response(JSON.stringify({
          ok: true,
          manifest: { display_information: { name: "Xyne Claw" }, features: { bot_user: { display_name: "xyne-claw" } } },
        }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }));

    const response = await request("POST", "/agents/helper/register-command", {
      userId: "user-1",
      orgId: "org-1",
      body: { commandName: "/helper" },
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ commandName: "/helper", appId: "A_UMB" });
    const update = calls.find((call) => call.url.includes("apps.manifest.update"));
    expect(update).toBeDefined();
    const manifest = JSON.parse(update!.body.get("manifest")!);
    expect(manifest.features.slash_commands).toEqual([
      expect.objectContaining({ command: "/helper", url: expect.stringContaining("/surfaces/slack/commands") }),
    ]);
    const upsert = (mocks.surfaceAgentUpsert.mock.calls as unknown as Array<[Record<string, any>]>)[0]![0];
    expect(upsert["update"].config).toMatchObject({
      commandName: "/helper",
      commandAppId: "A_UMB",
      commandConnectedSurfaceId: "team-row",
    });
  });

  it("rejects invalid command names", async () => {
    const response = await request("POST", "/agents/helper/register-command", {
      userId: "user-1",
      orgId: "org-1",
      body: { commandName: "/Bad Name!" },
    });
    expect(response.status).toBe(400);
  });

  it("dispatches a slash command through the run pipeline with the umbrella bot token", async () => {
    process.env["SLACK_SIGNING_SECRET"] = "umbrella-secret";
    mocks.acceptedSecrets.add("umbrella-secret");
    mocks.orgConnection = { id: "team-row", accessToken: "encrypted:xoxb-umbrella", config: null };
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      config: { commandName: "/helper", commandConnectedSurfaceId: "team-row" },
      agent: { id: "agent-1", slug: "helper", name: "Helper Agent", orgId: "org-1", config: null },
    };
    mocks.resolveInboundForTenant.mockResolvedValueOnce({ orgId: "org-1", userId: "claw-user-9", publicOnly: false });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("chat.postMessage")) {
        return new Response(JSON.stringify({ ok: true, ts: "111.222" }));
      }
      if (String(url).includes("/internal/run")) {
        return new Response(JSON.stringify({ success: true, sessionId: "sess-cmd-1" }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("POST", "/commands", {
      body: {
        team_id: "T123",
        command: "/helper",
        channel_id: "C42",
        user_id: "U777",
        text: "summarise today",
        response_url: "",
        trigger_id: "trig",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.response_type).toBe("ephemeral");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const runCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/internal/run"));
    expect(runCall).toBeDefined();
    const runBody = JSON.parse(((runCall as unknown as [string, { body: string }])[1]).body);
    expect(runBody).toMatchObject({
      task: "summarise today",
      agentSlug: "helper",
      triggerSource: "slack",
      conversationId: "slack-T123-C42-111_222",
      slackDelivery: expect.objectContaining({ connectedSurfaceId: "team-row", threadTs: "111.222" }),
    });
    expect(runBody.providerConfigs).toBeDefined();
    const ctx = (mocks.setSession.mock.calls as unknown as Array<[string, Record<string, any>]>)[0]![1];
    expect(ctx["slackDelivery"]).toMatchObject({ connectedSurfaceId: "team-row" });
  });

  it("answers unknown commands ephemerally without dispatching", async () => {
    process.env["SLACK_SIGNING_SECRET"] = "umbrella-secret";
    mocks.acceptedSecrets.add("umbrella-secret");
    mocks.surfaceAgent = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("POST", "/commands", {
      body: { team_id: "T123", command: "/ghost", channel_id: "C1", user_id: "U1", text: "hi" },
    });

    expect(response.status).toBe(200);
    expect(String(response.body.text)).toContain("No agent is registered");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
