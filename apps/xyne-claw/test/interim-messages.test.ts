import { afterEach, describe, expect, it, vi } from "vitest";
import { pushInterimMessage } from "../src/agent.js";
import { OPTIMIZATIONS } from "../src/optimizations.js";

afterEach(() => vi.unstubAllGlobals());

describe("pushInterimMessage", () => {
  it("posts the turn's text to the progress endpoint as an interim message", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    pushInterimMessage("http://auth/progress", "sess-1", "2 of your 3 PRs have failing CI");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://auth/progress");
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ sessionId: "sess-1", kind: "interim", text: "2 of your 3 PRs have failing CI" });
  });

  it("caps very long text and skips runs without an HTTP progress endpoint", () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    pushInterimMessage("http://auth/progress", "sess-1", "x".repeat(5_000));
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body).text).toHaveLength(1_500);
    pushInterimMessage(undefined as never, "sess-1", "hi");
    pushInterimMessage({ invocation: vi.fn() } as never, "sess-1", "hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is off unless a run asks for it", () => {
    expect(OPTIMIZATIONS.interim_messages.defaultOn).toBe(false);
  });
});
