import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reachable: false, reachableCalls: [] as Array<[unknown, unknown]> }));

vi.mock("../../lib/surface-calls.js", () => ({
  panelReachable: vi.fn(async (userId: unknown, sessionId: unknown) => {
    state.reachableCalls.push([userId, sessionId]);
    return state.reachable;
  }),
}));
vi.mock("../../mcpgateway/services/http-client.js", () => ({ assertSafeOutboundUrl: vi.fn(async () => undefined) }));

import { handleWebfetch } from "./webfetch.js";

type Step = { status: number; location?: string; body?: string; statusText?: string };

function stubFetch(steps: Step[]): string[] {
  const seen: string[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      seen.push(url);
      const step = steps[Math.min(i++, steps.length - 1)] as Step;
      const headers = new Headers({ "content-type": "text/html" });
      if (step.location) headers.set("location", step.location);
      return new Response(step.body ?? "", { status: step.status, statusText: step.statusText ?? "", headers });
    }),
  );
  return seen;
}

const run = { userId: "u1", sessionId: "run-1" };

describe("webfetch sign-in walls", () => {
  beforeEach(() => {
    state.reachable = false;
    state.reachableCalls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([401, 403])("reports a %d as AUTH_REQUIRED and tells the agent to use the panel when it is reachable", async (status) => {
    state.reachable = true;
    stubFetch([{ status, statusText: "Unauthorized" }]);
    const out = await handleWebfetch({ url: "https://intranet.example.com/doc" }, run);
    expect(out).toMatch(/^AUTH_REQUIRED: https:\/\/intranet\.example\.com\/doc needs the user's sign-in\. Open it with open-url/);
    expect(out).toContain("wait-for-sign-in");
    expect(state.reachableCalls).toEqual([["u1", "run-1"]]);
  });

  it("tells the agent it cannot reach the user's browser when the panel is not reachable", async () => {
    stubFetch([{ status: 401 }]);
    const out = await handleWebfetch({ url: "https://intranet.example.com/doc" }, run);
    expect(out).toMatch(/^AUTH_REQUIRED: .* cannot reach their browser/);
    expect(out).not.toContain("open-url");
    expect(out).toContain("Claw → Connectors");
  });

  it("stops at a redirect to a sign-in page instead of fetching the login page", async () => {
    state.reachable = true;
    const seen = stubFetch([
      { status: 302, location: "https://accounts.google.com/v3/signin/identifier?continue=x" },
      { status: 200, body: "<html>login</html>" },
    ]);
    const out = await handleWebfetch({ url: "https://docs.example.com/private" }, run);
    expect(out).toMatch(/^AUTH_REQUIRED: https:\/\/docs\.example\.com\/private /);
    expect(seen).toEqual(["https://docs.example.com/private"]);
  });

  it("asks for an unreachable message when the caller passes no run", async () => {
    stubFetch([{ status: 403 }]);
    const out = await handleWebfetch({ url: "https://intranet.example.com/doc" });
    expect(state.reachableCalls).toEqual([[undefined, undefined]]);
    expect(out).toContain("cannot reach their browser");
  });

  it.each([
    [404, "Not Found"],
    [500, "Internal Server Error"],
  ])("leaves a %d as a plain fetch error", async (status, statusText) => {
    stubFetch([{ status, statusText }]);
    const out = await handleWebfetch({ url: "https://example.com/missing" }, run);
    expect(out).toBe(`Error: Fetch failed: ${status} ${statusText}`);
    expect(state.reachableCalls).toHaveLength(0);
  });

  it("follows an ordinary redirect as before", async () => {
    const seen = stubFetch([
      { status: 301, location: "https://example.com/new" },
      { status: 200, body: "<html><body><article><h1>Hello</h1><p>World of text here.</p></article></body></html>" },
    ]);
    const out = await handleWebfetch({ url: "https://example.com/old" }, run);
    expect(seen).toEqual(["https://example.com/old", "https://example.com/new"]);
    expect(out).not.toContain("AUTH_REQUIRED");
    expect(out).toContain("Hello");
  });
});
