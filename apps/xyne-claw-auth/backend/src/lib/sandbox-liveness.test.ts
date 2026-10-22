import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ marked: [] as string[][] }));

vi.mock("../config.js", () => ({ CONFIG: { xyneClawUrl: "http://claw.test", xyneClawS2sKey: "s2s-key" } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }));
vi.mock("./conversation-artifacts.js", () => ({
  SANDBOX_ARTIFACT_KINDS: ["PREVIEW", "DIFF"],
  SANDBOX_ID_RE: /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/,
  markSandboxArtifactsStale: vi.fn(async (ids: string[]) => {
    state.marked.push(ids);
    return ids.length;
  }),
}));

const { refreshSandboxLiveness, resetSandboxLivenessCache, LIVENESS_RECHECK_MS } = await import("./sandbox-liveness.js");

const row = (refId: string, kind = "PREVIEW", status = "ACTIVE", refService = "CLAW") => ({ kind, refService, refId, status });

function mockClaw(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const ok = (liveness: Record<string, string>) => new Response(JSON.stringify({ success: true, liveness }));

describe("refreshSandboxLiveness (XYNE-66339)", () => {
  beforeEach(() => {
    resetSandboxLivenessCache();
    state.marked = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends only ACTIVE Claw preview/diff sandboxes, once each, with the S2S key", async () => {
    const fetchMock = mockClaw(ok({}));
    await refreshSandboxLiveness([
      row("sbx-1"),
      row("sbx-1", "DIFF"),
      row("sbx-2", "PREVIEW", "STALE"),
      row("canvas-1", "CANVAS", "ACTIVE", "SPACES"),
      row("local:conv_1", "DIFF"),
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://claw.test/internal/sandboxes/liveness");
    expect(JSON.parse(String(init.body))).toEqual({ sandboxIds: ["sbx-1"] });
    expect((init.headers as Record<string, string>)["x-s2s-key"]).toBe("s2s-key");
  });

  it("marks only the sandboxes reported ended", async () => {
    mockClaw(ok({ "sbx-1": "ended", "sbx-2": "alive", "sbx-3": "unknown" }));
    await refreshSandboxLiveness([row("sbx-1"), row("sbx-2"), row("sbx-3")]);
    expect(state.marked).toEqual([["sbx-1"]]);
  });

  it("asks about a sandbox again only after the recheck window", async () => {
    const fetchMock = mockClaw(ok({}));
    await refreshSandboxLiveness([row("sbx-1")], 1_000);
    await refreshSandboxLiveness([row("sbx-1")], 1_000 + LIVENESS_RECHECK_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await refreshSandboxLiveness([row("sbx-1")], 1_000 + LIVENESS_RECHECK_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks nothing and does not throw when xyne-claw is down or errors", async () => {
    mockClaw(new Error("ECONNREFUSED"));
    await expect(refreshSandboxLiveness([row("sbx-1")])).resolves.toBeUndefined();
    resetSandboxLivenessCache();
    mockClaw(new Response("{}", { status: 503 }));
    await expect(refreshSandboxLiveness([row("sbx-1")])).resolves.toBeUndefined();
    expect(state.marked).toEqual([]);
  });
});
