import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { handleWebfetch } = await import("./webfetch.js");

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const PRIVATE = [{ address: "10.0.0.9", family: 4 }];

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

function redirectResponse(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

afterEach(() => {
  lookupMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("handleWebfetch SSRF fence", () => {
  it("refuses loopback / metadata / private-resolving hosts before any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    lookupMock.mockResolvedValue(PRIVATE);

    expect(await handleWebfetch({ url: "http://127.0.0.1:3003/health" })).toMatch(/^Error: .*private, loopback/);
    expect(await handleWebfetch({ url: "http://169.254.169.254/latest/meta-data/" })).toMatch(/^Error: /);
    expect(await handleWebfetch({ url: "http://localhost:8080/" })).toMatch(/^Error: .*internal-only/);
    expect(await handleWebfetch({ url: "https://intranet.example.com/" })).toMatch(/^Error: .*resolves to private/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the validated URL with redirect: manual and converts the page", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const fetchSpy = vi.fn(async () => htmlResponse("<html><body><article><h1>Hi</h1><p>body text here</p></article></body></html>"));
    vi.stubGlobal("fetch", fetchSpy);

    const out = await handleWebfetch({ url: "https://example.com/page" });
    expect(out).toContain("Hi");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("https://example.com/page");
    expect(init.redirect).toBe("manual");
  });

  it("follows a redirect to another public host, re-validating the hop", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse(302, "https://cdn.example.org/final"))
      .mockResolvedValueOnce(htmlResponse("<p>landed</p>"));
    vi.stubGlobal("fetch", fetchSpy);

    const out = await handleWebfetch({ url: "https://example.com/start" });
    expect(out).toContain("landed");
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(["https://example.com/start", "https://cdn.example.org/final"]);
    expect(lookupMock.mock.calls.map((c) => c[0])).toEqual(["example.com", "cdn.example.org"]);
  });

  it("resolves a relative Location against the current hop", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse(301, "/moved"))
      .mockResolvedValueOnce(htmlResponse("<p>moved</p>"));
    vi.stubGlobal("fetch", fetchSpy);

    await handleWebfetch({ url: "https://example.com/old" });
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://example.com/moved");
  });

  it("stops at a redirect into a private / metadata address", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const fetchSpy = vi.fn().mockResolvedValueOnce(redirectResponse(302, "http://169.254.169.254/latest/meta-data/"));
    vi.stubGlobal("fetch", fetchSpy);

    const out = await handleWebfetch({ url: "https://example.com/open-redirect" });
    expect(out).toMatch(/^Error: Webfetch failed: .*169\.254\.169\.254/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    lookupMock.mockResolvedValue(PUBLIC);
    const fetchSpy = vi.fn(async () => redirectResponse(302, "https://example.com/again"));
    vi.stubGlobal("fetch", fetchSpy);

    const out = await handleWebfetch({ url: "https://example.com/loop" });
    expect(out).toMatch(/too many redirects/);
    expect(fetchSpy).toHaveBeenCalledTimes(6); // initial + 5 hops
  });
});
