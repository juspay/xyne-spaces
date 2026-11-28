import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const state = vi.hoisted(() => ({
  requesterId: undefined as string | undefined,
  orgId: undefined as string | undefined,
  workspaceForUser: null as string | null,
}));

vi.mock("../../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../../config.js", () => ({
  CONFIG: { spacesInternalUrl: "http://spaces.local" },
}));

vi.mock("../../lib/spaces-db.js", () => ({
  getWorkspaceIdForUser: vi.fn(async () => state.workspaceForUser),
}));

vi.mock("../../middleware/agent-acl.js", () => ({
  getRequesterId: () => state.requesterId,
  getOrgId: () => state.orgId,
}));

vi.mock("../../lib/start-run.js", () => ({
  startRunInProcess: vi.fn(),
}));

const { IDENTITY_FIELDS, rejectIdentityFields, stripIdentityFields } = await import("./schema.js");
const {
  resolveSpacesActor,
  extractSpacesUserToken,
  extractSpacesWorkspaceId,
  resolveSpacesAuthFromRequest,
} = await import("./identity.js");
const { authorizeSpacesRun } = await import("./dispatch.js");

const jwt = (tag: string) => `h-${tag}.p-${tag}.s-${tag}`;

const req = (init: { headers?: Record<string, string>; body?: Record<string, unknown> }): Request =>
  ({ headers: init.headers ?? {}, body: init.body }) as unknown as Request;

const agent = (privacy?: { mode: string; whitelist?: string[] }) => ({
  slug: "pokemon-dex",
  config: privacy ? { privacy } : null,
});

beforeEach(() => {
  state.requesterId = "u-1";
  state.orgId = "org-1";
  state.workspaceForUser = null;
});

describe("spaces surface — dispatch body schema", () => {
  it("accepts a body carrying no identity fields", () => {
    const result = rejectIdentityFields({ task: "hi", agentSlug: "pokemon-dex" });
    expect(result.ok).toBe(true);
  });

  it("rejects a single identity field with 400 and names it", () => {
    const result = rejectIdentityFields({ task: "hi", userId: "u-9" });
    expect(result).toMatchObject({ ok: false, status: 400, offending: ["userId"] });
  });

  it("names every identity field present, in declaration order", () => {
    const result = rejectIdentityFields({
      senderId: "s",
      workspaceId: "w",
      userId: "u",
      orgId: "o",
      userEmail: "e",
      spacesUserId: "su",
      userName: "n",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.offending).toEqual([...IDENTITY_FIELDS]);
  });

  it("treats an explicitly undefined identity key as absent", () => {
    const result = rejectIdentityFields({ task: "hi", userId: undefined });
    expect(result.ok).toBe(true);
  });

  it("strips every identity field and keeps the rest", () => {
    const stripped = stripIdentityFields({
      task: "hi",
      agentSlug: "pokemon-dex",
      userId: "u",
      userName: "n",
      userEmail: "e",
      orgId: "o",
      workspaceId: "w",
      spacesUserId: "su",
      senderId: "s",
    });
    expect(stripped).toEqual({ task: "hi", agentSlug: "pokemon-dex" });
  });

  it("returns a fresh object rather than mutating the caller's body", () => {
    const body = { task: "hi", userId: "u" };
    const stripped = stripIdentityFields(body);
    expect(stripped).not.toBe(body);
    expect(body.userId).toBe("u");
  });

  it("preserves falsy non-identity values", () => {
    const stripped = stripIdentityFields({ detached: false, retries: 0, context: "", cwd: null, userId: "u" });
    expect(stripped).toEqual({ detached: false, retries: 0, context: "", cwd: null });
  });

  it("pins the identity field list so a silent edit fails here", () => {
    expect([...IDENTITY_FIELDS]).toEqual([
      "userId",
      "userName",
      "userEmail",
      "orgId",
      "workspaceId",
      "spacesUserId",
      "senderId",
    ]);
  });
});

describe("spaces surface — invocation gate", () => {
  it("allows an agent with no config", () => {
    expect(authorizeSpacesRun({ actor: { kind: "user", userId: "u-1", orgId: "org-1" }, agent: agent() })).toEqual({
      ok: true,
    });
  });

  it("allows an agent whose privacy mode is everyone", () => {
    const result = authorizeSpacesRun({
      actor: { kind: "user", userId: "u-1", orgId: "org-1" },
      agent: agent({ mode: "everyone" }),
    });
    expect(result.ok).toBe(true);
  });

  it("allows a whitelisted user", () => {
    const result = authorizeSpacesRun({
      actor: { kind: "user", userId: "u-1", orgId: "org-1" },
      agent: agent({ mode: "whitelist", whitelist: ["u-0", "u-1"] }),
    });
    expect(result.ok).toBe(true);
  });

  it("denies a non-whitelisted user with 403 naming the slug", () => {
    const result = authorizeSpacesRun({
      actor: { kind: "user", userId: "u-9", orgId: "org-1" },
      agent: agent({ mode: "whitelist", whitelist: ["u-0", "u-1"] }),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (result.ok) return;
    expect(result.error).toContain("pokemon-dex");
  });

  it("denies everyone when the whitelist is empty, rather than failing open", () => {
    const result = authorizeSpacesRun({
      actor: { kind: "user", userId: "u-1", orgId: "org-1" },
      agent: agent({ mode: "whitelist", whitelist: [] }),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("treats an unrecognised privacy mode as everyone", () => {
    const result = authorizeSpacesRun({
      actor: { kind: "user", userId: "u-1", orgId: "org-1" },
      agent: agent({ mode: "nonsense", whitelist: [] }),
    });
    expect(result.ok).toBe(true);
  });
});

describe("spaces surface — actor resolution", () => {
  it("resolves a user actor from the request", () => {
    expect(resolveSpacesActor(req({}))).toEqual({ ok: true, actor: { kind: "user", userId: "u-1", orgId: "org-1" } });
  });

  it("returns 401 when the requester id is missing", () => {
    state.requesterId = undefined;
    expect(resolveSpacesActor(req({}))).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("returns 401 when the org id is missing", () => {
    state.orgId = undefined;
    expect(resolveSpacesActor(req({}))).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("returns 401 when both are missing", () => {
    state.requesterId = undefined;
    state.orgId = undefined;
    expect(resolveSpacesActor(req({}))).toMatchObject({ ok: false, status: 401 });
  });
});

describe("spaces surface — request extraction precedence", () => {
  it("prefers the verified workspace header over the client-supplied header and cookie", () => {
    expect(
      extractSpacesWorkspaceId(
        req({
          headers: {
            "x-spaces-workspace-id": "ws-verified",
            "x-workspace-id": "ws-header",
            cookie: "xyne_last_workspace=ws-cookie",
          },
        }),
      ),
    ).toBe("ws-verified");
    expect(
      extractSpacesWorkspaceId(req({ headers: { "x-workspace-id": "ws-header", cookie: "xyne_last_workspace=ws-cookie" } })),
    ).toBe("ws-header");
    expect(extractSpacesWorkspaceId(req({ headers: { cookie: "xyne_last_workspace=ws-cookie" } }))).toBe("ws-cookie");
    expect(extractSpacesWorkspaceId(req({}))).toBeUndefined();
  });

  it("walks the user-token precedence from body through to the legacy cookie", () => {
    expect(
      extractSpacesUserToken(req({ body: { userToken: "from-body" }, headers: { authorization: "Bearer from-header" } })),
    ).toBe("from-body");
    expect(extractSpacesUserToken(req({ headers: { authorization: "Bearer from-header" } }))).toBe("from-header");
    expect(
      extractSpacesUserToken(req({ headers: { cookie: `xyne_last_workspace=ws-1; xyne_ws_ws-1_token=${jwt("ws")}` } })),
    ).toBe(jwt("ws"));
    expect(extractSpacesUserToken(req({ headers: { cookie: `google_access_token=${jwt("legacy")}` } }))).toBe(jwt("legacy"));
    expect(extractSpacesUserToken(req({ headers: { cookie: "google_access_token=not-a-jwt" } }))).toBeUndefined();
  });
});

describe("spaces surface — resolveSpacesAuthFromRequest", () => {
  it("prefers the verified workspace header over the client header and cookie", async () => {
    const auth = await resolveSpacesAuthFromRequest(
      req({
        headers: {
          "x-spaces-workspace-id": "ws-verified",
          "x-workspace-id": "ws-header",
          cookie: `xyne_last_workspace=ws-cookie; xyne_ws_ws-verified_token=${jwt("v")}`,
        },
      }),
      "u-1",
    );
    expect(auth).toEqual({ token: jwt("v"), workspaceId: "ws-verified" });
  });

  it("uses the workspace-scoped cookie token only when it looks like a JWT", async () => {
    const good = await resolveSpacesAuthFromRequest(
      req({ headers: { cookie: `xyne_last_workspace=ws-1; xyne_ws_ws-1_token=${jwt("ws")}` } }),
      "u-1",
    );
    expect(good).toMatchObject({ token: jwt("ws"), workspaceId: "ws-1" });

    const bad = await resolveSpacesAuthFromRequest(
      req({ headers: { cookie: "xyne_last_workspace=ws-1; xyne_ws_ws-1_token=opaque" } }),
      "u-1",
    );
    expect(bad).toBeUndefined();
  });

  it("falls back to the legacy google_access_token cookie", async () => {
    const auth = await resolveSpacesAuthFromRequest(
      req({ headers: { cookie: `xyne_last_workspace=ws-1; google_access_token=${jwt("legacy")}` } }),
      "u-1",
    );
    expect(auth).toMatchObject({ token: jwt("legacy"), workspaceId: "ws-1" });
  });

  it("falls back to the Authorization bearer when no cookie carries a token", async () => {
    const auth = await resolveSpacesAuthFromRequest(
      req({ headers: { authorization: "Bearer raw-token", "x-workspace-id": "ws-2" } }),
      "u-1",
    );
    expect(auth).toEqual({ token: "raw-token", workspaceId: "ws-2" });
  });

  it("returns undefined when neither a token nor a session id is present", async () => {
    expect(await resolveSpacesAuthFromRequest(req({ headers: { "x-workspace-id": "ws-2" } }), "u-1")).toBeUndefined();
  });

  it("accepts user_session_id as the session and resolves the workspace from the user row", async () => {
    state.workspaceForUser = "ws-from-row";
    const auth = await resolveSpacesAuthFromRequest(req({ headers: { cookie: "user_session_id=sess-9" } }), "u-1");
    expect(auth).toEqual({ sessionId: "sess-9", workspaceId: "ws-from-row" });
  });
});
