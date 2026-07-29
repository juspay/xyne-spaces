import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  surface: null as Record<string, unknown> | null,
  connected: [] as Array<Record<string, unknown>>,
  identity: null as Record<string, unknown> | null,
  identityWhere: null as Record<string, unknown> | null,
  verifiedToken: null as { userId: string; orgId: string; scopes: string[] } | null,
}));

vi.mock("../config.js", () => ({
  CONFIG: { encryptionKey: Buffer.alloc(32, 7) },
}));

vi.mock("./cli-tokens.js", () => ({
  verify: vi.fn(async () => state.verifiedToken),
}));

vi.mock("../db.js", () => ({
  prisma: {
    surface: { findUnique: vi.fn(async () => state.surface) },
    connectedSurface: { findMany: vi.fn(async () => state.connected) },
    userSurfaceIdentity: {
      findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
        state.identityWhere = args.where;
        return state.identity;
      }),
    },
  },
}));

function activeSurface(): Record<string, unknown> {
  return {
    id: "surface-slack",
    key: "slack",
    identityMode: "USER_ID",
    supportsUserResolution: true,
    capabilities: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function activeConnection(orgId = "org-1"): Record<string, unknown> {
  return {
    id: `connection-${orgId}`,
    orgId,
    surfaceId: "surface-slack",
    surfaceTenantId: "T123",
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    config: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("surface resolver", () => {
  beforeEach(() => {
    state.surface = activeSurface();
    state.connected = [activeConnection()];
    state.identity = null;
    state.identityWhere = null;
    state.verifiedToken = null;
  });

  it("resolves a known tenant to its owning organization", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    await expect(resolveInbound({ surfaceKey: "slack", surfaceTenantId: "T123", surfaceUserId: "U1" }))
      .resolves.toMatchObject({ orgId: "org-1", userId: null, publicOnly: true });
  });

  it("throws a typed error for an unknown tenant", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    state.connected = [];
    await expect(resolveInbound({ surfaceKey: "slack", surfaceTenantId: "T404", surfaceUserId: "U1" }))
      .rejects.toMatchObject({ code: "UNKNOWN_TENANT" });
  });

  it("hard-fails when multiple active organizations match one tenant", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    state.connected = [activeConnection("org-1"), activeConnection("org-2")];
    await expect(resolveInbound({ surfaceKey: "slack", surfaceTenantId: "T123", surfaceUserId: "U1" }))
      .rejects.toMatchObject({ code: "AMBIGUOUS_TENANT" });
  });

  it("resolves a linked ACTIVE identity using the schema's exact compound key", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    state.identity = { status: "ACTIVE", orgId: "org-1", userId: "user-1" };
    await expect(resolveInbound({ surfaceKey: "slack", surfaceTenantId: "T123", surfaceUserId: "U1" }))
      .resolves.toMatchObject({ orgId: "org-1", userId: "user-1", publicOnly: false });
    expect(state.identityWhere).toEqual({
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: "surface-slack",
        surfaceWorkspaceId: "T123",
        surfaceUserId: "U1",
      },
    });
  });

  it("leaves an unlinked user public-only without an ambient user", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    await expect(resolveInbound({ surfaceKey: "slack", surfaceTenantId: "T123", surfaceUserId: "U-unlinked" }))
      .resolves.toMatchObject({ userId: null, publicOnly: true });
  });

  it("carries an authenticated per-app agent binding into the resolved context", async () => {
    const { resolveInboundForTenant } = await import("./surface-resolver.js");
    const tenant = { surface: state.surface, connectedSurface: state.connected[0] } as never;
    await expect(resolveInboundForTenant(tenant, "U-unlinked", {
      surfaceAgentId: "surface-agent-1",
      agentId: "agent-1",
      agentSlug: "helper",
    })).resolves.toMatchObject({
      orgId: "org-1",
      userId: null,
      surfaceAgentId: "surface-agent-1",
      agentId: "agent-1",
      agentSlug: "helper",
    });
  });

  it("refuses to resolve a cross-org identity", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    state.identity = { status: "ACTIVE", orgId: "org-2", userId: "user-attacker" };
    await expect(resolveInbound({ surfaceKey: "slack", surfaceTenantId: "T123", surfaceUserId: "U1" }))
      .resolves.toMatchObject({ orgId: "org-1", userId: null, publicOnly: true });
  });

  it("delegates ACCESS_TOKEN identity to the existing CLI token verifier", async () => {
    const { resolveInbound } = await import("./surface-resolver.js");
    state.surface = { ...activeSurface(), key: "cli", identityMode: "ACCESS_TOKEN" };
    state.verifiedToken = { userId: "user-cli", orgId: "org-cli", scopes: ["runs:write"] };

    await expect(resolveInbound({ surfaceKey: "cli", accessToken: "xyne_cli_valid" })).resolves.toMatchObject({
      connectedSurface: null,
      orgId: "org-cli",
      userId: "user-cli",
      publicOnly: false,
    });
  });
});
