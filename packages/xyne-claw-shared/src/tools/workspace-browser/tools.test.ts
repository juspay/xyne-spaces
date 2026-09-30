import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sandboxCalls = vi.hoisted(() => [] as Array<{ slug: string; params: Record<string, unknown> }>);

vi.mock("../sandbox-pw/tools.js", () => ({
  SANDBOX_PW_TOOLS: ["sandbox-pw-evaluate", "sandbox-pw-snapshot", "sandbox-pw-click"].map((slug) => ({
    slug,
    execute: async (params: Record<string, unknown>) => {
      sandboxCalls.push({ slug, params });
      return `sandbox:${slug}`;
    },
  })),
}));

vi.mock("../claw-auth-url.js", () => ({ clawAuthUrl: () => "http://claw-auth" }));

import { pageClick, pageRead } from "./tools.js";

const serverRun = { sessionId: "s1", meta: { userId: "u1" }, s2sKey: "k" } as never;

function answer(data: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({ success: true, data }), { status: 200 }));
}

describe("browser panel tools on a server run", () => {
  beforeEach(() => {
    sandboxCalls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the user's desktop panel when it answers", async () => {
    const fetchMock = answer({ ok: true, content: "Title: Example" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await pageRead.execute({}, serverRun)).toBe("Title: Example");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ userId: "u1", sessionId: "s1", toolName: "page-read" });
    expect(sandboxCalls).toHaveLength(0);
  });

  it("falls back to the sandbox browser when the desktop panel is unavailable", async () => {
    vi.stubGlobal("fetch", answer({ ok: false, content: "not from the Xyne AI screen", unavailable: true }));
    expect(await pageClick.execute({ ref: "e3" }, serverRun)).toBe("sandbox:sandbox-pw-click");
  });

  it("falls back to the sandbox browser when claw-auth cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    expect(await pageRead.execute({}, serverRun)).toBe("sandbox:sandbox-pw-evaluate");
  });

  it("does not try the desktop without a session", async () => {
    const fetchMock = answer({ ok: true, content: "x" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await pageRead.execute({}, { meta: { userId: "u1" } } as never)).toBe("sandbox:sandbox-pw-evaluate");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
