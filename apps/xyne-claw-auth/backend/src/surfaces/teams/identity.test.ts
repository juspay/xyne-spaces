/**
 * Linking a Teams sender by what Microsoft Graph asserts, against a fake
 * Graph and a fake database. Tenant, object ids, addresses and secrets are
 * invented; nothing here reaches Microsoft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const findManyUsers = vi.fn(async (_args: Record<string, unknown>) => [{ id: "user-1" }] as Array<{ id: string }>);
vi.mock("../../db.js", () => ({ prisma: { user: { findMany: findManyUsers } } }));

const redisKeys = new Set<string>();
vi.mock("../../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (key: string, _v: string, ...rest: unknown[]) => {
        if (rest.includes("NX") && redisKeys.has(key)) return null;
        redisKeys.add(key);
        return "OK";
      },
    }),
  },
}));

const writeAuditLog = vi.fn(async (_entry: Record<string, unknown>) => undefined);
vi.mock("../../lib/audit.js", () => ({ writeAuditLog }));

const linkSenderToUser = vi.fn(async (_input: Record<string, unknown>) => new Date());
vi.mock("../messaging/store.js", () => ({ linkSenderToUser }));

const orgForTenant = vi.fn(async (_tenantId: string) => "org-1" as string | null);
vi.mock("./tenants.js", () => ({ orgForTenant }));

const graphToken = vi.fn(async (_input: Record<string, unknown>) => "fake-graph-token");
vi.mock("./auth.js", () => ({ botFrameworkAuth: { graphToken } }));

const { assertedEmailOf, linkTeamsSender } = await import("./identity.js");

const TENANT = "11111111-2222-3333-4444-555555555555";
const OID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SENDER = `${TENANT}:${OID}`;

const authState = {
  get: async (category: string) => ({ "app-id": "00000000-0000-0000-0000-0000000000a1", "app-password": "fake-secret" })[category] ?? null,
} as never;

const account = { id: "acc-teams", orgId: "org-1", surfaceId: "teams" };

const input = (over: Record<string, unknown> = {}) =>
  ({ account, authState, tenantId: TENANT, aadObjectId: OID, senderId: SENDER, ...over }) as never;

const graphUser = (over: Record<string, unknown> = {}) => ({
  id: OID,
  userPrincipalName: "Ada.Lovelace@contoso.example",
  userType: "Member",
  accountEnabled: true,
  ...over,
});

function graph(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: Record<string, unknown>) => ({ ok: status < 400, status, json: async () => body }));
}

beforeEach(() => {
  vi.clearAllMocks();
  redisKeys.clear();
  orgForTenant.mockResolvedValue("org-1");
  findManyUsers.mockResolvedValue([{ id: "user-1" }]);
});

describe("assertedEmailOf", () => {
  it("vouches for a member's UPN, lower-cased", () => {
    expect(assertedEmailOf(graphUser())).toBe("ada.lovelace@contoso.example");
  });

  it("refuses guests, disabled accounts and anything that is not one address", () => {
    expect(assertedEmailOf(graphUser({ userType: "Guest" }))).toBeNull();
    expect(assertedEmailOf(graphUser({ userPrincipalName: "ada_fabrikam.example#EXT#@contoso.example" }))).toBeNull();
    expect(assertedEmailOf(graphUser({ accountEnabled: false }))).toBeNull();
    expect(assertedEmailOf(graphUser({ userPrincipalName: "" }))).toBeNull();
    expect(assertedEmailOf(graphUser({ userPrincipalName: "no-at-sign" }))).toBeNull();
  });
});

describe("linkTeamsSender", () => {
  it("links the sender to the org user whose email is the UPN Graph returns, and audits it", async () => {
    const http = graph(200, graphUser());
    expect(await linkTeamsSender(input(), { http })).toBe("user-1");

    expect(graphToken).toHaveBeenCalledWith({ appId: "00000000-0000-0000-0000-0000000000a1", appPassword: "fake-secret", tenantId: TENANT });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(`https://graph.microsoft.com/v1.0/users/${OID}?$select=id,userPrincipalName,userType,accountEnabled`);
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe("Bearer fake-graph-token");
    expect(findManyUsers.mock.calls[0]?.[0]).toMatchObject({
      where: { orgId: "org-1", email: { equals: "ada.lovelace@contoso.example", mode: "insensitive" } },
    });
    expect(linkSenderToUser).toHaveBeenCalledWith({ surfaceId: "teams", senderId: SENDER, orgId: "org-1", userId: "user-1" });
    expect(writeAuditLog.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: "user-1",
      eventType: "CHANNEL_IDENTITY_LINKED",
      targetId: SENDER,
      metadata: { channel: "teams", tenantId: TENANT, aadObjectId: OID, method: "entra-graph-upn" },
    });
  });

  it("never looks anyone up for a tenant that is not bound to this org", async () => {
    orgForTenant.mockResolvedValue("org-2");
    const http = graph(200, graphUser());
    expect(await linkTeamsSender(input(), { http })).toBeNull();
    orgForTenant.mockResolvedValue(null);
    expect(await linkTeamsSender(input(), { http })).toBeNull();
    expect(graphToken).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(linkSenderToUser).not.toHaveBeenCalled();
  });

  it("refuses a sender id that is not the signed tenant and object id", async () => {
    const http = graph(200, graphUser());
    expect(await linkTeamsSender(input({ senderId: `${TENANT}:bf:29:fake` }), { http })).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });

  it("leaves the sender unlinked when no org user has that email, or more than one does", async () => {
    findManyUsers.mockResolvedValueOnce([]);
    expect(await linkTeamsSender(input(), { http: graph(200, graphUser()) })).toBeNull();
    redisKeys.clear();
    findManyUsers.mockResolvedValueOnce([{ id: "user-1" }, { id: "user-2" }]);
    expect(await linkTeamsSender(input(), { http: graph(200, graphUser()) })).toBeNull();
    expect(linkSenderToUser).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("leaves a guest unlinked even when their address matches someone", async () => {
    expect(await linkTeamsSender(input(), { http: graph(200, graphUser({ userType: "Guest" })) })).toBeNull();
    expect(findManyUsers).not.toHaveBeenCalled();
  });

  it("refuses an answer about a different object id", async () => {
    expect(await linkTeamsSender(input(), { http: graph(200, graphUser({ id: "ffffffff-0000-0000-0000-000000000000" })) })).toBeNull();
    expect(linkSenderToUser).not.toHaveBeenCalled();
  });

  it("stays unlinked, without throwing, when the tenant has not consented", async () => {
    expect(await linkTeamsSender(input(), { http: graph(403, { error: { code: "Authorization_RequestDenied" } }) })).toBeNull();
    redisKeys.clear();
    graphToken.mockRejectedValueOnce(new Error("Teams bot token request failed: invalid_client"));
    expect(await linkTeamsSender(input(), { http: graph(200, graphUser()) })).toBeNull();
    expect(linkSenderToUser).not.toHaveBeenCalled();
  });

  it("looks a sender up at most once a minute", async () => {
    findManyUsers.mockResolvedValue([]);
    const http = graph(200, graphUser());
    await linkTeamsSender(input(), { http });
    await linkTeamsSender(input(), { http });
    expect(http).toHaveBeenCalledTimes(1);
  });
});
