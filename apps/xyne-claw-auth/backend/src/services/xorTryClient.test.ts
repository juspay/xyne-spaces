import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ CONFIG: { xyneClawUrl: "http://claw:3002/", xyneClawS2sKey: "s2s" } }));

const { tryChecksViaClaw } = await import("./xorTryClient.js");

const Q = [{ id: "failure", question: "Real failure?", type: "yesno" as const }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tryChecksViaClaw", () => {
  it("posts to claw with the S2S key and returns the answers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, answers: { failure: { value: true, confidence: 0.9, unsure: false } }, unavailable: false, ms: 120 })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await tryChecksViaClaw({ questions: Q, item: { text: "ERROR" } });
    expect(r).toEqual({ ok: true, answers: { failure: { value: true, confidence: 0.9, unsure: false } }, unavailable: false, ms: 120 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://claw:3002/xor-decide/try");
    expect((init.headers as Record<string, string>)["x-s2s-key"]).toBe("s2s");
  });

  it("passes claw's 4xx message through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: "image must be a data URL" }), { status: 400 })));
    expect(await tryChecksViaClaw({ questions: Q, item: { image: "x" } })).toEqual({ ok: false, status: 400, error: "image must be a data URL" });
  });

  it("maps claw being down to 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const r = await tryChecksViaClaw({ questions: Q, item: { text: "x" } });
    expect(r).toMatchObject({ ok: false, status: 502 });
  });
});
