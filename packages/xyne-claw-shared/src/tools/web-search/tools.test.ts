import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webSearchTool } from "./tools.js";

type FetchArgs = [string, RequestInit];

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const ctx = { config: { PARALLEL_API_KEY: "test-key" } } as unknown as Parameters<typeof webSearchTool.execute>[1];

describe("webSearchTool (Parallel)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts search_queries, objective and settings to /v1/search with x-api-key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        search_id: "s1",
        results: [{ url: "https://a.test", title: "A", publish_date: "2026-09-01", excerpts: ["one", "two"] }],
      }),
    );

    const out = await webSearchTool.execute(
      { query: " react 19 features ", queries: ["react 19 release notes", "react 19 features"], objective: "What changed in React 19?" },
      ctx,
    );

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("https://api.parallel.ai/v1/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body));
    expect(body.search_queries).toEqual(["react 19 features", "react 19 release notes"]);
    expect(body.objective).toBe("What changed in React 19?");
    expect(body.advanced_settings.max_results).toBe(10);
    expect(out).toContain("Found 1 search results");
    expect(out).toContain("URL: https://a.test (2026-09-01)");
    expect(out).toContain("one\n…\ntwo");
  });

  it("omits objective when not given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { results: [] }));
    const out = await webSearchTool.execute({ query: "x" }, ctx);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as FetchArgs)[1].body));
    expect(body).not.toHaveProperty("objective");
    expect(out).toBe("No search results found for the query.");
  });

  it("retries a 429 honouring Retry-After, then succeeds", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: "slow down" }, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(200, { results: [{ url: "https://b.test", title: "B" }] }));

    const pending = webSearchTool.execute({ query: "x" }, ctx);
    await vi.advanceTimersByTimeAsync(1_000);
    const out = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toContain("URL: https://b.test");
  });

  it("gives up after the retry budget on persistent 429", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse(429, { error: "slow down" }, { "retry-after": "0" }));

    const pending = webSearchTool.execute({ query: "x" }, ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out).toContain("rate limit exceeded after retries");
  });

  it("does not retry a 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "bad key" }));
    const out = await webSearchTool.execute({ query: "x" }, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toContain("PARALLEL_API_KEY");
  });

  it("errors without a key and never calls the API", async () => {
    const saved = process.env["PARALLEL_API_KEY"];
    delete process.env["PARALLEL_API_KEY"];
    const out = await webSearchTool.execute({ query: "x" }, { config: {} } as unknown as typeof ctx);
    if (saved !== undefined) process.env["PARALLEL_API_KEY"] = saved;
    expect(out).toContain("PARALLEL_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty query", async () => {
    const out = await webSearchTool.execute({ query: "   " }, ctx);
    expect(out).toBe("Error: query is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
