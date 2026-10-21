import { afterEach, describe, expect, it, vi } from "vitest";

const navigated = vi.hoisted(() => [] as string[]);

vi.mock("../sandbox-pw/tools.js", () => ({
  SANDBOX_PW_TOOLS: [
    {
      slug: "sandbox-pw-navigate",
      execute: async (params: Record<string, unknown>) => {
        navigated.push(String(params["url"]));
        return "snapshot";
      },
    },
  ],
}));

vi.mock("../claw-auth-url.js", () => ({ clawAuthUrl: () => "http://claw-auth" }));

import { openUrl } from "./tools.js";

const serverRun = { sessionId: "s1", meta: { userId: "u1" } } as never;

function answer(data: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({ success: true, data }), { status: 200 }));
}

describe("open-url on a server run", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    navigated.length = 0;
  });

  it("opens the page in the user's Xyne AI browser panel when it is watching", async () => {
    vi.stubGlobal("fetch", answer({ ok: true, content: "Opened https://docs.google.com/ in the user's browser panel" }));
    const result = await openUrl.execute({ url: "https://docs.google.com/" }, serverRun);
    expect(result).toContain("browser panel");
    expect(navigated).toHaveLength(0);
  });

  it("falls back to the sandbox browser otherwise", async () => {
    vi.stubGlobal("fetch", answer({ ok: false, content: "not watching", unavailable: true }));
    const result = await openUrl.execute({ url: "https://docs.google.com/" }, serverRun);
    expect(result).toContain("sandbox browser");
    expect(navigated).toEqual(["https://docs.google.com/"]);
  });
});
