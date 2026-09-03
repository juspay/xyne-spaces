import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env["LITELLM_URL"] = "http://litellm.local";
process.env["LITELLM_API_KEY"] = "sk-interactive";
process.env["LITELLM_AUTOMATION_API_KEY"] = "sk-automation";

const { probeProvider, _clearProbeCache } = await import("../src/provider-probe.js");

function res(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

beforeEach(() => {
  _clearProbeCache();
  global.fetch = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("probeProvider penny drop", () => {
  it("reports available on a 200 and pings the exact model with max_tokens 1", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(200));
    const out = await probeProvider({ provider: "litellm", model: "private-large" });
    expect(out.state).toBe("available");
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as { body: string }).body);
    expect(body.model).toBe("private-large");
    expect(body.max_tokens).toBe(1);
  });

  it("reports capacity (keep polling) on a 429", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(429, "rate_limit_exceeded"));
    expect((await probeProvider({ provider: "litellm", model: "m" })).state).toBe("capacity");
  });

  it("reports capacity on a 5xx / overloaded", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(503, "service unavailable"));
    expect((await probeProvider({ provider: "litellm", model: "m" })).state).toBe("capacity");
  });

  it("reports permanent (stop polling) on a 403 — waiting won't fix a disallowed key/model", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(403, "model not allowed for this key"));
    expect((await probeProvider({ provider: "litellm", model: "m" })).state).toBe("permanent");
  });

  it("treats a probe network failure/timeout as capacity, not a hard stop", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("The operation timed out"));
    expect((await probeProvider({ provider: "litellm", model: "m" })).state).toBe("capacity");
  });

  it("uses the automation key when the failed run was an automation", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(200));
    await probeProvider({ provider: "litellm", model: "m", automation: true });
    const auth = (vi.mocked(global.fetch).mock.calls[0]![1] as { headers: Record<string, string> }).headers.Authorization;
    expect(auth).toBe("Bearer sk-automation");
  });

  it("probes a BYO provider with its passed config, not the platform key", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(200));
    await probeProvider({
      provider: "claude",
      model: "claude-opus-4-8",
      providerConfig: { apiKey: "sk-byo", model: "claude-opus-4-8", baseUrl: "https://byo.local/v1" },
    });
    const call = vi.mocked(global.fetch).mock.calls[0]!;
    expect(call[0]).toBe("https://byo.local/v1/chat/completions");
    expect((call[1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer sk-byo");
  });

  it("cannot probe a BYO provider with no config (claw-auth must supply it)", async () => {
    const out = await probeProvider({ provider: "claude", model: "x" });
    expect(out.state).toBe("permanent");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shares one request across concurrent probes of the same target (cache)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res(429, "rate limited"));
    await probeProvider({ provider: "litellm", model: "m" });
    await probeProvider({ provider: "litellm", model: "m" });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });
});
