import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTokenRouteError, appTokenPath, isAppToken, spacesFetch, spacesFetchBuffer, spacesFetchText } from "./xyne-spaces-client.js";

const jwt = (claims: Record<string, unknown>) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
const APP = jwt({ appId: "app-1", userId: "bot-1" });
const USER = jwt({ sub: "user-1", workspaceId: "ws-1" });
const base = { baseUrl: "http://spaces" };

type Call = { url: string; headers: Record<string, string> };
function stubFetch(status = 200, body: unknown = { ok: true }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("app tokens", () => {
  it("tells an app token from a user token", () => {
    expect(isAppToken(APP)).toBe(true);
    expect(isAppToken(USER)).toBe(false);
  });

  it("go as a Bearer token, never as the user session cookie", async () => {
    const calls = stubFetch();
    await spacesFetch("/api/query/claw", { method: "POST", body: "{}" }, { ...base, token: APP, workspaceId: "ws-1" });
    expect(calls[0]!.url).toBe("http://spaces/api/query/claw");
    expect(calls[0]!.headers["Authorization"]).toBe(`Bearer ${APP}`);
    expect(calls[0]!.headers["Cookie"]).toBeUndefined();
  });

  it("use the app route where Spaces has one", () => {
    expect(appTokenPath("/api/attachments/att-1/download")).toBe("/api/apps/files/download/att-1");
    expect(appTokenPath("/api/email/conv-1/reply")).toBe("/api/apps/email/conv-1/reply");
    expect(appTokenPath("/api/tickets/XYNE-1")).toBe("/api/tickets/claw/XYNE-1");
    expect(appTokenPath("/api/tickets/claw")).toBe("/api/tickets/claw");
    expect(appTokenPath("/api/memory/claw/search")).toBe("/api/memory/claw/search");
    expect(appTokenPath("/api/apps/chat/postMessage")).toBe("/api/apps/chat/postMessage");
  });

  it("are refused, before any request, on routes that read only a user's session", async () => {
    const calls = stubFetch();
    for (const path of ["/api/automations", "/api/collections/accessible?x=1", "/api/sdlc/claw/links", "/api/auth/me", "/api/query"]) {
      await expect(spacesFetch(path, undefined, { ...base, token: APP })).rejects.toBeInstanceOf(AppTokenRouteError);
    }
    await expect(spacesFetchText("/api/automations/claw/agents", { ...base, token: APP })).rejects.toThrow(/accepts only a user's session/);
    expect(calls).toHaveLength(0);
  });

  it("download attachments from the app route", async () => {
    const calls = stubFetch();
    await spacesFetchBuffer("/api/attachments/att-1/download", { ...base, token: APP });
    expect(calls[0]!.url).toBe("http://spaces/api/apps/files/download/att-1");
    expect(calls[0]!.headers["Authorization"]).toBe(`Bearer ${APP}`);
  });

  it("do not fall back from a /claw route to its user-only twin", async () => {
    const calls = stubFetch(404, { error: "nope" });
    await expect(spacesFetch("/api/query/claw", undefined, { ...base, token: APP })).rejects.toThrow(/404/);
    expect(calls.map((c) => c.url)).toEqual(["http://spaces/api/query/claw"]);
  });
});

describe("user tokens", () => {
  it("go in the workspace session cookie, on any route", async () => {
    const calls = stubFetch();
    await spacesFetch("/api/automations", undefined, { ...base, token: USER, sessionId: "s-1", workspaceId: "ws-1" });
    expect(calls[0]!.url).toBe("http://spaces/api/automations");
    expect(calls[0]!.headers["Authorization"]).toBeUndefined();
    expect(calls[0]!.headers["Cookie"]).toContain(`xyne_ws_ws-1_token=${USER}`);
  });
});
