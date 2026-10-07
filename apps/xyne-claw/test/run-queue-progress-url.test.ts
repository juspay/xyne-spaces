import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => ({ DelayedError: class extends Error {}, Worker: class {} }));
vi.mock("../src/run-execution.js", () => ({ executeRunFromPayload: vi.fn() }));
vi.mock("../src/routes/run.js", () => ({ abortRunForOwnershipLoss: vi.fn(), sendCallback: vi.fn() }));
vi.mock("../src/storage.js", () => ({ gcsDownloadResultMarker: vi.fn() }));
vi.mock("../src/run-ownership.js", () => ({}));
vi.mock("../src/run-control.js", () => ({ startRunControlSubscriber: vi.fn() }));
vi.mock("../src/metrics.js", () => ({ metric: { count: vi.fn(), observe: vi.fn() } }));

async function load() {
  vi.resetModules();
  process.env["XYNE_CLAW_AUTH_URL"] = "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003";
  process.env["XYNE_CLAW_S2S_KEY"] = "s2s-secret";
  return await import("../src/run-queue-worker.js");
}

const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["XYNE_CLAW_AUTH_URL"];
  delete process.env["XYNE_CLAW_S2S_KEY"];
});

describe("postProgressLabel", () => {
  it("posts to the allowlisted claw-auth origin with the S2S key", async () => {
    const { postProgressLabel } = await load();
    await postProgressLabel(
      { sessionId: "s1", progressUrl: "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003/claw/api/v1/webhook/progress" } as never,
      "Working on it...",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-s2s-key"]).toBe("s2s-secret");
  });

  it.each([
    "http://127.0.0.1:15000/quitquitquit",
    "http://169.254.169.254/latest/meta-data/",
    "https://attacker.example/collect",
    "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3004/claw/api/v1/webhook/progress",
  ])("never sends the S2S key to a non-allowlisted progressUrl: %s", async (progressUrl) => {
    const { postProgressLabel } = await load();
    await postProgressLabel({ sessionId: "s1", progressUrl } as never, "Working on it...");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
