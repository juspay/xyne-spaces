import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { ORG_LEVEL_TENANT_ID } from "../store.js";

vi.stubEnv("ENCRYPTION_KEY", "00".repeat(32));

const mocks = vi.hoisted(() => ({
  acceptedSecrets: new Set<string>(),
  connectedSigningSecret: null as string | null,
  parseInbound: vi.fn(() => null as Record<string, unknown> | null),
  resolveInboundForTenant: vi.fn(
    async (): Promise<{ orgId: string; userId: string | null; publicOnly: boolean }> => ({
      orgId: "org-1",
      userId: null,
      publicOnly: true,
    }),
  ),
  adminOrgs: new Set<string>(),
  platformAdmin: false,
  orgConnection: null as Record<string, unknown> | null,
  workspaceConnections: [] as Array<Record<string, unknown>>,
  surfaceAgent: null as Record<string, any> | null,
  install: null as Record<string, any> | null,
  surfaceAgentStatuses: [] as Array<Record<string, any>>,
  challengeSecrets: [] as Array<{ signingSecret: string | null }>,
  workspaceFindManyArgs: null as Record<string, unknown> | null,
  challengeFindManyArgs: [] as Array<Record<string, unknown>>,
  userFindFirstArgs: null as Record<string, unknown> | null,
  connectedUpsert: vi.fn(async () => ({})),
  surfaceAgentUpsert: vi.fn(async () => ({ id: "surface-agent-1" })),
  surfaceAgentUpdate: vi.fn(async () => ({})),
  installUpsert: vi.fn(async () => ({})),
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
  slack: {
    postMessage: vi.fn(),
    manifestExport: vi.fn(),
    manifestUpdate: vi.fn(),
    manifestCreate: vi.fn(),
    oauthAccess: vi.fn(),
    usersInfo: vi.fn(),
    filesUploadV2: vi.fn(),
  },
}));

vi.mock("../api.js", async (importOriginal) => {
  const client = {
    chat: { postMessage: mocks.slack.postMessage },
    apps: {
      manifest: {
        export: mocks.slack.manifestExport,
        update: mocks.slack.manifestUpdate,
        create: mocks.slack.manifestCreate,
      },
    },
    oauth: { v2: { access: mocks.slack.oauthAccess } },
    users: { info: mocks.slack.usersInfo },
    filesUploadV2: mocks.slack.filesUploadV2,
  };
  return {
    ...(await importOriginal<typeof import("../api.js")>()),
    slackClient: () => client,
    slackClientWithoutToken: () => client,
  };
});

vi.mock("../../../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../../lib/surface-adapter.js", () => ({
  getSurfaceAdapter: () => ({
    key: "slack",
    verifySignature: vi.fn((_raw: unknown, _headers: unknown, secret: string) =>
      mocks.acceptedSecrets.has(secret),
    ),
    parseInbound: mocks.parseInbound,
  }),
}));

vi.mock("../../../lib/agent-provider-config.js", () => ({
  resolveAgentProviderConfigs: mocks.resolveProviders,
  resolveSubagentProviderMode: vi.fn(() => "spaces"),
}));

vi.mock("../../../lib/session-context.js", () => ({ setSession: mocks.setSession }));

// Hermetic Redis: oauth-state stores pending install context here.
vi.mock("../../../redis.js", () => {
  const store = new Map<string, string>();
  return {
    redisService: {
      getConnection: () => ({
        set: async (key: string, value: string) => { store.set(key, value); return "OK"; },
        get: async (key: string) => store.get(key) ?? null,
        del: async (key: string) => (store.delete(key) ? 1 : 0),
        multi() {
          const ops: Array<() => unknown> = [];
          const chain = {
            get(key: string) { ops.push(() => store.get(key) ?? null); return chain; },
            del(key: string) { ops.push(() => (store.delete(key) ? 1 : 0)); return chain; },
            async exec() { return ops.map((op) => [null, op()]); },
          };
          return chain;
        },
      }),
    },
  };
});

vi.mock("undici", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

vi.mock("../../../lib/surface-resolver.js", () => {
  class SurfaceResolverError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    SurfaceResolverError,
    resolveSurfaceTenant: vi.fn(async () => ({
      surface: { id: "surface-slack", key: "slack", identityMode: "USER_ID" },
      connectedSurface: { id: "workspace-connection", orgId: "org-1", surfaceTenantId: "T123", config: null },
    })),
    getConnectedSurfaceSigningSecret: vi.fn(() => mocks.connectedSigningSecret),
    resolveInboundForTenant: mocks.resolveInboundForTenant,
    encryptSurfaceSecret: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
    decryptSurfaceSecret: vi.fn((encrypted: string) => {
      if (!encrypted.startsWith("encrypted:")) throw new Error("malformed");
      return encrypted.slice("encrypted:".length);
    }),
  };
});

vi.mock("../config-tokens.js", () => {
  class SlackConfigTokenError extends Error {}
  return {
    SlackConfigTokenError,
    rotateSlackRefreshToken: mocks.rotateRefresh,
    rotateStoredSlackConfigToken: mocks.rotateStored,
    hasUsableSlackConfigToken: (connection: { config?: Record<string, unknown> | null }) =>
      connection.config?.["configTokenStatus"] !== "expired" &&
      typeof connection.config?.["configAccessToken"] === "string" &&
      typeof connection.config?.["configRefreshToken"] === "string",
    configWithRotatedTokens: (_existing: unknown, tokens: { accessToken: string; refreshToken: string }) => ({
      configAccessToken: `encrypted:${tokens.accessToken}`,
      configRefreshToken: `encrypted:${tokens.refreshToken}`,
      configTokenRotatedAt: "2026-07-22T00:00:00.000Z",
      configTokenStatus: "valid",
    }),
  };
});

vi.mock("../../../middleware/require-auth.js", () => ({
  requireUserAuth: async (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.headers["x-user-id"] !== "string") {
      res.status(401).json({ success: false, error: "User session required" });
      return;
    }
    next();
  },
}));

vi.mock("../../../middleware/agent-acl.js", () => ({
  getRequesterId: (req: Request) => req.headers["x-user-id"] as string | undefined,
  getOrgId: (req: Request) => req.headers["x-org-id"] as string | undefined,
  isOrgAdmin: vi.fn(async (_userId: string, orgId: string) => mocks.adminOrgs.has(orgId)),
  isClawAdmin: vi.fn(async () => mocks.platformAdmin),
}));

vi.mock("../../../db.js", () => ({
  prisma: {
    surface: { findUnique: vi.fn(async () => ({ id: "surface-slack", key: "slack" })) },
    agent: {
      findFirst: vi.fn(async ({ where }: { where: { slug: string; orgId: string } }) => ({
        id: "agent-1",
        slug: where.slug,
        name: "Helper Agent",
        orgId: where.orgId,
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
    surfaceAgentInstall: {
      findUnique: vi.fn(async () => mocks.install),
      upsert: mocks.installUpsert,
    },
    user: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        mocks.userFindFirstArgs = args;
        return mocks.userByEmail;
      }),
    },
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
  const { slackRouter } = await import("./index.js");
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
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
      redirect(location: string) {
        resolve({ status: 302, body: undefined, location });
        return this;
      },
      sendStatus(code: number) {
        resolve({ status: code, body: undefined });
        return this;
      },
    } as unknown as Response;
    (slackRouter as unknown as { handle: Function }).handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else resolve({ status: 404, body: undefined });
    });
  });
}

describe("Slack surfaces route", () => {
  beforeEach(() => {
    mocks.acceptedSecrets.clear();
    mocks.connectedSigningSecret = null;
    mocks.parseInbound.mockReset().mockReturnValue(null);
    mocks.resolveInboundForTenant.mockClear();
    mocks.adminOrgs = new Set(["org-1"]);
    mocks.platformAdmin = false;
    mocks.orgConnection = null;
    mocks.workspaceConnections = [];
    mocks.surfaceAgent = null;
    mocks.install = {
      encryptedBotToken: "encrypted:xoxb-token",
      botUserId: "U-BOT",
    };
    mocks.surfaceAgentStatuses = [];
    mocks.challengeSecrets = [];
    mocks.workspaceFindManyArgs = null;
    mocks.challengeFindManyArgs = [];
    mocks.userFindFirstArgs = null;
    mocks.connectedUpsert.mockClear();
    mocks.surfaceAgentUpsert.mockReset().mockResolvedValue({ id: "surface-agent-1" });
    mocks.surfaceAgentUpdate.mockClear();
    mocks.installUpsert.mockClear();
    mocks.rotateRefresh.mockClear();
    mocks.rotateStored.mockReset().mockResolvedValue("xoxe.xoxp-manifest");
    mocks.setSession.mockClear();
    mocks.resolveProviders.mockClear();
    mocks.userByEmail = null;
    mocks.identityCreate.mockReset().mockResolvedValue({});
    mocks.identityRow = null;
    mocks.slack.postMessage.mockReset().mockResolvedValue({ ok: true, ts: "401.01" });
    mocks.slack.manifestExport.mockReset().mockResolvedValue({ ok: true, manifest: {} });
    mocks.slack.manifestUpdate.mockReset().mockResolvedValue({ ok: true, app_id: "A-PER-AGENT" });
    mocks.slack.manifestCreate.mockReset().mockResolvedValue({ ok: true, app_id: "A-NEW" });
    mocks.slack.oauthAccess.mockReset().mockResolvedValue({ ok: true });
    mocks.slack.usersInfo.mockReset().mockResolvedValue({ ok: true });
    mocks.slack.filesUploadV2.mockReset().mockResolvedValue({ ok: true });
    mocks.resolveInboundForTenant
      .mockReset()
      .mockResolvedValue({ orgId: "org-1", userId: "user-1", publicOnly: false });
    vi.stubEnv("SLACK_SIGNING_SECRET", "");
    vi.unstubAllGlobals();
  });

  it("rotates and stores the current encrypted configuration token pair", async () => {
    const response = await request("POST", "/config-token", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1", accessToken: "xoxe.xoxp-original", refreshToken: "xoxe-1-single-use" },
    });
    expect(response.status).toBe(200);
    expect(mocks.rotateRefresh).toHaveBeenCalledWith("xoxe-1-single-use");
    expect(mocks.connectedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          surfaceTenantId: ORG_LEVEL_TENANT_ID,
          config: expect.objectContaining({
            configAccessToken: "encrypted:xoxe.xoxp-fresh",
            configRefreshToken: "encrypted:xoxe-1-fresh",
            configTokenStatus: "valid",
          }),
        }),
      }),
    );
    expect(JSON.stringify(mocks.connectedUpsert.mock.calls)).not.toContain("xoxe-1-single-use");
  });

  it.each([
    null,
    {
      id: "org-slack",
      config: { configTokenStatus: "expired", configAccessToken: "a", configRefreshToken: "r" },
    },
  ])("returns 503 when the org configuration token is missing or expired", async (connection) => {
    mocks.orgConnection = connection;
    const response = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });
    expect(response).toMatchObject({
      status: 503,
      body: { error: "Connect Slack with an app configuration token first" },
    });
  });

  it("returns the not-found response when create-app authorization fails", async () => {
    mocks.adminOrgs.clear();
    const response = await request("POST", "/agents/helper/create-app", {
      userId: "member-1",
      orgId: "org-1",
      body: { orgId: "org-2" },
    });
    expect(response).toEqual({
      status: 404,
      body: { success: false, error: "Agent not found" },
    });
  });

  it("creates a dedicated app, encrypts credentials, and returns an install URL", async () => {
    mocks.orgConnection = {
      id: "org-slack",
      config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    mocks.slack.manifestCreate.mockResolvedValue({
      ok: true,
      app_id: "A-PER-AGENT",
      credentials: {
        client_id: "client-per-agent",
        client_secret: "client-secret-per-agent",
        signing_secret: "signing-secret-per-agent",
        verification_token: "verification",
      },
    });

    const response = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });
    expect(response.status).toBe(200);
    expect(mocks.rotateStored).toHaveBeenCalledWith("org-slack");
    expect(mocks.surfaceAgentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          externalAppId: "A-PER-AGENT",
          clientId: "client-per-agent",
          encryptedClientSecret: "encrypted:client-secret-per-agent",
          signingSecret: "encrypted:signing-secret-per-agent",
          status: "created",
          manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          manifestSyncedAt: expect.any(Date),
          config: { createdByUserId: "admin-1" },
        }),
        update: expect.objectContaining({
          externalAppId: "A-PER-AGENT",
          clientId: "client-per-agent",
          encryptedClientSecret: "encrypted:client-secret-per-agent",
          signingSecret: "encrypted:signing-secret-per-agent",
          status: "created",
          manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          manifestSyncedAt: expect.any(Date),
          config: { createdByUserId: "admin-1" },
        }),
      }),
    );
    const install = new URL(response.body.data.installUrl);
    expect(install.searchParams.get("client_id")).toBe("client-per-agent");
    expect(install.searchParams.get("scope")?.split(",")).toContain("chat:write.customize");
    expect(install.searchParams.get("state")).toBeTruthy();
  });

  it("syncs an existing app manifest, preserves config, and returns a fresh reinstall URL", async () => {
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      externalAppId: "A-PER-AGENT",
      clientId: "client-per-agent",
      commandName: "/helper",
      config: { createdByUserId: "admin-1" },
    };
    mocks.orgConnection = {
      id: "org-slack",
      config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    mocks.slack.manifestUpdate.mockResolvedValue({ ok: true, app_id: "A-PER-AGENT" });

    const response = await request("POST", "/agents/helper/sync-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });

    expect(response).toMatchObject({
      status: 200,
      body: { data: { appId: "A-PER-AGENT", scopesChanged: true } },
    });
    expect(mocks.rotateStored).toHaveBeenCalledWith("org-slack");
    expect(mocks.slack.manifestUpdate).toHaveBeenCalledTimes(1);
    const [updateArgs] = mocks.slack.manifestUpdate.mock.calls[0]!;
    expect(updateArgs.app_id).toBe("A-PER-AGENT");
    expect(updateArgs.manifest).toMatchObject({
      display_information: { name: "Helper Agent" },
      oauth_config: {
        scopes: {
          bot: expect.arrayContaining([
            "channels:read",
            "channels:history",
            "groups:read",
            "groups:history",
            "files:write",
          ]),
        },
      },
    });
    expect(mocks.surfaceAgentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "surface-agent-1" },
        data: {
          manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          manifestSyncedAt: expect.any(Date),
        },
      }),
    );
    const updateCalls = mocks.surfaceAgentUpdate.mock.calls as unknown as Array<
      [{ data: { manifestHash: string } }]
    >;
    const storedManifestHash = updateCalls[0]![0].data.manifestHash;
    const { createHash } = await import("node:crypto");
    expect(storedManifestHash).toBe(
      createHash("sha256").update(JSON.stringify(updateArgs.manifest)).digest("hex"),
    );
    const install = new URL(response.body.data.installUrl);
    expect(install.searchParams.get("client_id")).toBe("client-per-agent");
    expect(install.searchParams.get("state")).toBeTruthy();
  });

  it("returns 404 when sync-app has no existing app ID", async () => {
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      clientId: "client-per-agent",
      commandName: "/helper",
      config: {},
    };

    const response = await request("POST", "/agents/helper/sync-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });

    expect(response).toEqual({
      status: 404,
      body: { success: false, error: "Existing Slack app not found for agent" },
    });
    expect(mocks.rotateStored).not.toHaveBeenCalled();
  });

  it("returns created and installed per-agent app status without leaking secrets", async () => {
    mocks.surfaceAgentStatuses = [
      {
        id: "surface-agent-created",
        agent: { id: "agent-created", slug: "created-agent" },
        signingSecret: "encrypted:must-not-leak",
        externalAppId: "A-CREATED",
        clientId: "client-created",
        encryptedClientSecret: "encrypted:must-not-leak",
        status: "created",
        manifestHash: null,
        installs: [],
        config: {},
      },
      {
        id: "surface-agent-installed",
        agent: { id: "agent-installed", slug: "installed-agent" },
        externalAppId: "A-INSTALLED",
        clientId: "client-installed",
        encryptedClientSecret: "encrypted:must-not-leak",
        status: "installed",
        manifestHash: null,
        installs: [
          {
            surfaceTenantId: "T123",
            tenantName: "Acme",
            installedAt: new Date("2026-07-22T01:02:03.000Z"),
          },
        ],
        config: {},
      },
    ];

    const response = await request("GET", "/agents/status?orgId=org-1", {
      userId: "admin-1",
      orgId: "org-1",
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

  it("marks app manifests stale when the hash is absent and current when it matches", async () => {
    mocks.surfaceAgent = {
      id: "surface-agent-sync",
      externalAppId: "A-SYNC",
      clientId: "client-sync",
      config: {},
    };
    mocks.orgConnection = {
      id: "org-slack",
      config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await request("POST", "/agents/matching/sync-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });
    const updateCalls = mocks.surfaceAgentUpdate.mock.calls as unknown as Array<
      [{ data: { manifestHash: string } }]
    >;
    const matchingManifestHash = updateCalls[0]![0].data.manifestHash;
    mocks.surfaceAgentStatuses = [
      {
        id: "surface-agent-stale",
        agent: { id: "agent-stale", slug: "stale", name: "Stale Agent" },
        externalAppId: "A-STALE",
        clientId: "client-stale",
        manifestHash: null,
        installs: [],
        config: {},
      },
      {
        id: "surface-agent-matching",
        agent: { id: "agent-matching", slug: "matching", name: "Helper Agent" },
        externalAppId: "A-MATCHING",
        clientId: "client-matching",
        manifestHash: matchingManifestHash,
        installs: [],
        config: {},
      },
    ];

    const response = await request("GET", "/agents/status?orgId=org-1", {
      userId: "admin-1",
      orgId: "org-1",
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ agentId: "agent-stale", manifestStale: true }),
      expect.objectContaining({ agentId: "agent-matching", manifestStale: false }),
    ]);
  });

  it("reuses an existing per-agent app without invoking Slack again", async () => {
    mocks.orgConnection = {
      id: "org-slack",
      config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    mocks.slack.manifestCreate.mockResolvedValue({
      ok: true,
      app_id: "A-ORIGINAL",
      credentials: { client_id: "client-original", client_secret: "secret", signing_secret: "signing" },
    });
    const first = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      externalAppId: first.body.data.appId,
      clientId: "client-original",
      encryptedClientSecret: "encrypted:secret",
      config: {},
    };
    mocks.slack.manifestExport.mockClear();
    mocks.slack.manifestCreate.mockClear();
    mocks.rotateStored.mockClear();

    const second = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });

    expect(second).toMatchObject({ status: 200, body: { data: { appId: "A-ORIGINAL", reused: true } } });
    // The reuse path probes apps.manifest.export (console deletions emit no
    // webhook) but must never call apps.manifest.create again.
    expect(mocks.slack.manifestExport).toHaveBeenCalled();
    expect(mocks.slack.manifestCreate).not.toHaveBeenCalled();
    // One rotation for the liveness probe only.
    expect(mocks.rotateStored).toHaveBeenCalledTimes(1);
  });

  it("mints a new per-agent app when recreate is true", async () => {
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      externalAppId: "A-OLD",
      clientId: "client-old",
      encryptedClientSecret: "encrypted:old-secret",
      config: {},
    };
    mocks.orgConnection = {
      id: "org-slack",
      config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    mocks.slack.manifestCreate.mockResolvedValue({
      ok: true,
      app_id: "A-NEW",
      credentials: { client_id: "client-new", client_secret: "new-secret", signing_secret: "new-signing" },
    });

    const response = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1", recreate: true },
    });

    expect(response).toMatchObject({ status: 200, body: { data: { appId: "A-NEW", reused: false } } });
    expect(mocks.slack.manifestCreate).toHaveBeenCalledTimes(1);
    expect(mocks.surfaceAgentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          externalAppId: "A-NEW",
          config: { createdByUserId: "admin-1" },
        }),
      }),
    );
  });

  it("uses per-app OAuth credentials and stores the bot install on SurfaceAgent", async () => {
    mocks.orgConnection = {
      id: "org-slack",
      config: { configTokenStatus: "valid", configAccessToken: "a", configRefreshToken: "r" },
    };
    mocks.slack.manifestCreate.mockResolvedValue({
      ok: true,
      app_id: "A-PER-AGENT",
      credentials: {
        client_id: "client-per-agent",
        client_secret: "client-secret",
        signing_secret: "signing-secret",
      },
    });
    mocks.slack.oauthAccess.mockResolvedValue({
      ok: true,
      app_id: "A-PER-AGENT",
      access_token: "xoxb-bot-secret",
      bot_user_id: "U-BOT",
      team: { id: "T123", name: "Acme" },
    });
    const created = await request("POST", "/agents/helper/create-app", {
      userId: "admin-1",
      orgId: "org-1",
      body: { orgId: "org-1" },
    });
    const state = new URL(created.body.data.installUrl).searchParams.get("state")!;
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      agentId: "agent-1",
      surfaceId: "surface-slack",
      signingSecret: "encrypted:signing-secret",
      externalAppId: "A-PER-AGENT",
      clientId: "client-per-agent",
      encryptedClientSecret: "encrypted:client-secret",
      status: "created",
      config: {},
      agent: { orgId: "org-1", slug: "helper" },
    };
    const callback = await request(
      "GET",
      `/oauth/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(302);
    expect(mocks.workspaceFindManyArgs).toMatchObject({
      surfaceId: "surface-slack",
      surfaceTenantId: "T123",
      status: "ACTIVE",
    });
    // The per-agent app's OWN credentials must be used for the exchange, not
    // the umbrella app's — that separation is the point of per-agent apps.
    expect(mocks.slack.oauthAccess).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "client-per-agent", client_secret: "client-secret" }),
    );
    expect(mocks.installUpsert).toHaveBeenCalledWith({
      where: {
        surfaceAgentId_surfaceTenantId: {
          surfaceAgentId: "surface-agent-1",
          surfaceTenantId: "T123",
        },
      },
      create: {
        surfaceAgentId: "surface-agent-1",
        surfaceTenantId: "T123",
        encryptedBotToken: "encrypted:xoxb-bot-secret",
        tenantName: "Acme",
        botUserId: "U-BOT",
        installedByUserId: "admin-1",
      },
      update: {
        encryptedBotToken: "encrypted:xoxb-bot-secret",
        tenantName: "Acme",
        botUserId: "U-BOT",
        installedByUserId: "admin-1",
        installedAt: expect.any(Date),
      },
    });
    expect(mocks.surfaceAgentUpdate).toHaveBeenCalledWith({
      where: { id: "surface-agent-1" },
      data: {
        externalAppId: "A-PER-AGENT",
        status: "installed",
      },
    });
  });

  it("verifies normal events with the per-app signing secret and attaches agent context", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      signingSecret: "encrypted:per-app-secret",
      config: {},
      agent: { id: "agent-1", slug: "helper", name: "Helper Agent", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "DIRECT_MESSAGE",
      surfaceTenantId: "T123",
      surfaceUserId: "U123",
      channelId: "D123",
      text: "hello",
      eventId: "EvPerApp",
      raw: { event: { ts: "100.01" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/internal/run")) {
          return new Response(JSON.stringify({ success: true, sessionId: "session-1" }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const response = await request("POST", "/events", {
      body: {
        type: "event_callback",
        api_app_id: "A-PER-AGENT",
        team_id: "T123",
        event_id: "EvPerApp",
        event: {},
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.resolveInboundForTenant).toHaveBeenCalledWith(expect.anything(), "U123", {
      surfaceAgentId: "surface-agent-1",
      agentId: "agent-1",
      agentSlug: "helper",
    });
    await vi.waitFor(() => expect(mocks.setSession).toHaveBeenCalledWith("session-1", expect.anything()));
  });

  it("acks before dispatch completes and attaches providers plus Slack session delivery", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-dispatch",
      signingSecret: "encrypted:per-app-secret",
      config: {},
      agent: {
        id: "agent-1",
        slug: "helper",
        name: "Helper Agent",
        orgId: "org-1",
        config: { provider: "claude" },
      },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "APP_MENTIONED",
      surfaceTenantId: "T123",
      surfaceUserId: "U123",
      channelId: "C123",
      text: "<@U-BOT> please help",
      eventId: "EvDispatch",
      raw: { event: { ts: "101.01" } },
    });
    let finishRun!: (response: globalThis.Response) => void;
    const pendingRun = new Promise<globalThis.Response>((resolve) => {
      finishRun = resolve;
    });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("/internal/run")) return pendingRun;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("POST", "/events", {
      body: {
        type: "event_callback",
        api_app_id: "A-PER-AGENT",
        team_id: "T123",
        event_id: "EvDispatch",
        event: {},
      },
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
    expect(mocks.setSession).toHaveBeenCalledWith(
      "slack-session",
      expect.objectContaining({
        agentId: "agent-1",
        agentOrgId: "org-1",
        responseMode: "conversation",
        slackDelivery: {
          surfaceAgentId: "surface-agent-dispatch",
          teamId: "T123",
          channelId: "C123",
          threadTs: "101.01",
          slackUserId: "U123",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.slack.postMessage).toHaveBeenCalled(),
    );
  });

  it("auto-links an unresolved Slack user by tenant-matched work email", async () => {
    mocks.slack.usersInfo.mockResolvedValue({
      ok: true,
      user: { profile: { email: "worker@example.com" } },
    });
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.resolveInboundForTenant.mockResolvedValue({ orgId: "org-1", userId: null, publicOnly: true });
    mocks.userByEmail = { id: "email-user", orgId: "org-1" };
    mocks.surfaceAgent = {
      id: "surface-agent-email",
      signingSecret: "encrypted:per-app-secret",
      config: {},
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "DIRECT_MESSAGE",
      surfaceTenantId: "T123",
      surfaceUserId: "U-EMAIL",
      channelId: "D123",
      text: "hello",
      eventId: "EvEmailLink",
      raw: { event: { ts: "102.01" } },
    });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("/internal/run")) {
        return new Response(JSON.stringify({ success: true, sessionId: "email-session" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (
        await request("POST", "/events", {
          body: {
            type: "event_callback",
            api_app_id: "A",
            team_id: "T123",
            event_id: "EvEmailLink",
            event: {},
          },
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(() => expect(mocks.identityCreate).toHaveBeenCalledTimes(1));
    expect(mocks.userFindFirstArgs).toMatchObject({
      where: { email: { equals: "worker@example.com", mode: "insensitive" }, orgId: "org-1" },
    });
    expect(mocks.identityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        surfaceId: "surface-slack",
        surfaceWorkspaceId: "T123",
        surfaceUserId: "U-EMAIL",
        userId: "email-user",
        orgId: "org-1",
        status: "ACTIVE",
      }),
    });
    await vi.waitFor(() => expect(mocks.setSession).toHaveBeenCalledWith("email-session", expect.anything()));
  });

  it("replies with the linking instruction and does not dispatch when email misses", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.resolveInboundForTenant.mockResolvedValue({ orgId: "org-1", userId: null, publicOnly: true });
    mocks.surfaceAgent = {
      id: "surface-agent-miss",
      signingSecret: "encrypted:per-app-secret",
      config: {},
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "DIRECT_MESSAGE",
      surfaceTenantId: "T123",
      surfaceUserId: "U-MISS",
      channelId: "D123",
      text: "hello",
      eventId: "EvEmailMiss",
      raw: { event: { ts: "103.01" } },
    });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("__never_users_info__")) {
        return new Response(
          JSON.stringify({ ok: true, user: { profile: { email: "missing@example.com" } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await request("POST", "/events", {
      body: { type: "event_callback", api_app_id: "A", team_id: "T123", event_id: "EvEmailMiss", event: {} },
    });
    await vi.waitFor(() =>
      expect(mocks.slack.postMessage).toHaveBeenCalled(),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/internal/run"))).toBe(false);
    const [linkingPost] = mocks.slack.postMessage.mock.calls.at(-1)!;
    expect(linkingPost.text).toContain("isn't linked");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("uses the same conversation id for a Slack thread and a new id for a new root", async () => {
    mocks.acceptedSecrets.add("per-app-secret");
    mocks.surfaceAgent = {
      id: "surface-agent-thread",
      signingSecret: "encrypted:per-app-secret",
      config: {},
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    const runBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/internal/run")) {
        runBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ success: true, sessionId: `session-${runBodies.length}` }), {
          status: 200,
        });
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
        eventType: "APP_MENTIONED",
        surfaceTenantId: "T123",
        surfaceUserId: "U123",
        channelId: "C123",
        text: "<@U-BOT> hi",
        eventId: item.id,
        ...(item.threadId ? { threadId: item.threadId } : {}),
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
      id: "surface-agent-failure",
      signingSecret: "encrypted:per-app-secret",
      config: {},
      agent: { id: "agent-1", slug: "helper", name: "Helper", orgId: "org-1", config: {} },
    };
    mocks.parseInbound.mockReturnValue({
      eventType: "APP_MENTIONED",
      surfaceTenantId: "T123",
      surfaceUserId: "U123",
      channelId: "C123",
      text: "<@U-BOT> help",
      eventId: "EvDispatchFailure",
      raw: { event: { ts: "401.01" } },
    });
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes("/internal/run")) {
        return new Response(JSON.stringify({ success: false, error: "unavailable" }), { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (
        await request("POST", "/events", {
          body: {
            type: "event_callback",
            api_app_id: "A",
            team_id: "T123",
            event_id: "EvDispatchFailure",
            event: {},
          },
        })
      ).status,
    ).toBe(200);

    await vi.waitFor(() =>
      expect(
        mocks.slack.postMessage.mock.calls.some(
          ([args]) =>
            args.text === "Something went wrong dispatching this to the agent — please retry",
        ),
      ).toBe(true),
    );
    const [apology] = mocks.slack.postMessage.mock.calls.find(([args]) =>
      args.text.includes("Something went wrong"),
    )!;
    expect(apology).toMatchObject({ channel: "C123", thread_ts: "401.01" });
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
      {
        id: "team-row",
        surfaceTenantId: "T123",
        status: "ACTIVE",
        config: { appId: "A_UMB" },
        createdAt: new Date(),
      },
    ];
    mocks.rotateStored.mockClear().mockResolvedValue("xoxe.xoxp-manifest");
    mocks.surfaceAgentUpsert.mockClear();
    mocks.setSession.mockClear();
    vi.stubEnv("SLACK_SIGNING_SECRET", "");
    vi.unstubAllGlobals();
  });

  it("registers a command on the umbrella app manifest and stores the binding", async () => {
    // The command is appended to the umbrella app's EXISTING manifest, so the
    // export must return a realistic one to prove nothing else is dropped.
    mocks.slack.manifestExport.mockResolvedValue({
      ok: true,
      manifest: {
        display_information: { name: "Xyne Claw" },
        features: { bot_user: { display_name: "xyne-claw" } },
      },
    });

    const response = await request("POST", "/agents/helper/register-command", {
      userId: "user-1",
      orgId: "org-1",
      body: { commandName: "/helper" },
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ commandName: "/helper", appId: "A_UMB" });
    expect(mocks.slack.manifestUpdate).toHaveBeenCalledTimes(1);
    const [{ manifest }] = mocks.slack.manifestUpdate.mock.calls[0]!;
    expect(manifest.features.slash_commands).toEqual([
      expect.objectContaining({
        command: "/helper",
        url: expect.stringContaining("/surfaces/slack/commands"),
      }),
    ]);
    const upsert = (mocks.surfaceAgentUpsert.mock.calls as unknown as Array<[Record<string, any>]>)[0]![0];
    // commandConnectedSurfaceId is a COLUMN (it is read on every inbound
    // command to pick the replying bot token); only provenance stays in config.
    expect(upsert["update"]).toEqual({
      commandName: "/helper",
      commandConnectedSurfaceId: "team-row",
      config: {
        commandAppId: "A_UMB",
        commandRegisteredByUserId: "user-1",
      },
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
    mocks.connectedSigningSecret = "umbrella-secret";
    mocks.acceptedSecrets.add("umbrella-secret");
    mocks.orgConnection = { id: "team-row", accessToken: "encrypted:xoxb-umbrella", config: null };
    mocks.surfaceAgent = {
      id: "surface-agent-1",
      commandName: "/helper",
      // A column, not config: the reply must go out on the SAME connection the
      // command was registered against, not whichever one resolved inbound.
      commandConnectedSurfaceId: "team-row",
      config: {},
      agent: {
        id: "agent-1",
        slug: "helper",
        name: "Helper Agent",
        orgId: "org-1",
        config: { tools: { subagents: ["spaces"] } },
      },
    };
    mocks.resolveInboundForTenant.mockResolvedValueOnce({
      orgId: "org-1",
      userId: "claw-user-9",
      publicOnly: false,
    });
    mocks.slack.postMessage.mockResolvedValue({ ok: true, ts: "111.222" });
    mocks.slack.usersInfo.mockResolvedValue({
      ok: true,
      user: { profile: { email: "worker@example.com" } },
    });
    const fetchMock = vi.fn(async (url: string) => {
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
    const runBody = JSON.parse((runCall as unknown as [string, { body: string }])[1].body);
    expect(runBody).toMatchObject({
      task: "summarise today",
      agentSlug: "helper",
      triggerSource: "slack",
      conversationId: "slack-T123-C42-111_222",
      slackDelivery: expect.objectContaining({ connectedSurfaceId: "team-row", threadTs: "111.222" }),
      agentConfig: { tools: { subagents: ["spaces", "slack"] } },
    });
    expect(runBody.providerConfigs).toBeDefined();
    const ctx = (mocks.setSession.mock.calls as unknown as Array<[string, Record<string, any>]>)[0]![1];
    expect(ctx["slackDelivery"]).toMatchObject({ connectedSurfaceId: "team-row" });
  });

  it("answers unknown commands ephemerally without dispatching", async () => {
    mocks.connectedSigningSecret = "umbrella-secret";
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
