import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: [] as string[], configured: true, respond: (_p: string): unknown => ({}) }));
vi.mock("./spaces-agent-client.js", () => {
  class SpacesAgentError extends Error {
    constructor(msg: string, readonly status: number) { super(msg); }
  }
  return {
    SpacesAgentError,
    agentCallsConfigured: () => m.configured,
    serviceCall: vi.fn(async (_method: string, path: string) => {
      m.calls.push(path);
      const r = m.respond(path);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
});
vi.mock("../surfaces/spaces/client.js", () => ({ spacesAppFetch: vi.fn(async () => ({ channelId: "dm1" })) }));
vi.mock("../db.js", () => ({ prisma: { user: { findUnique: vi.fn(async () => null) }, userSurfaceIdentity: { findMany: vi.fn(async () => []) } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { getSpacesGroupByAlias, getSpacesUserById, getSpacesUsersByName, getWorkspaceIdForUser, spacesDbAvailable } from "./spaces-db.js";
import { SpacesAgentError } from "./spaces-agent-client.js";

beforeEach(() => { m.calls = []; m.configured = true; });

describe("Spaces directory (no database access)", () => {
  it("looks users up through signed Spaces service routes", async () => {
    m.respond = () => ({ user: { id: "u1", email: "a@x.io", name: "Ada", spacesOrgMemberId: null, workspaceId: "ws1", spacesOrgId: "o1" } });
    expect((await getSpacesUserById("u1"))?.workspaceId).toBe("ws1");
    expect(await getWorkspaceIdForUser("u1")).toBe("ws1");
    expect(m.calls.every((p) => p.startsWith("/api/claw-agents/service/users/u1"))).toBe(true);
  });

  it("mention lookups pass the workspace through", async () => {
    m.respond = (p) => (p.includes("/groups") ? { groups: [{ id: "g1", name: "G", alias: "g" }] } : { users: [{ id: "u1", name: "Ada" }] });
    expect(await getSpacesUsersByName("Ada", "ws1")).toEqual([{ id: "u1", name: "Ada" }]);
    expect(await getSpacesGroupByAlias("g", "ws1")).toHaveLength(1);
    expect(m.calls).toEqual(["/api/claw-agents/service/users?name=Ada&workspaceId=ws1", "/api/claw-agents/service/groups?alias=g&workspaceId=ws1"]);
  });

  it("a missing user is null, not an error; no signing key means no lookups", async () => {
    m.respond = () => new SpacesAgentError("not found", 404);
    expect(await getSpacesUserById("nobody")).toBeNull();
    m.configured = false;
    m.calls = [];
    expect(spacesDbAvailable()).toBe(false);
    expect(await getSpacesUsersByName("Ada")).toEqual([]);
    expect(m.calls).toEqual([]);
  });
});
