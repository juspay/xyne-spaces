import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { finalize } = vi.hoisted(() => ({ finalize: vi.fn(async () => undefined) }));

vi.mock("../db.js", () => ({ prisma: { agentRun: { findUnique: vi.fn(async () => null) } } }));
vi.mock("../repositories/index.js", () => ({
  agentRunRepository: { finalize, findBySessionId: vi.fn(async () => null) },
}));
vi.mock("../queue/run-recovery-worker.js", () => ({ handleRunCompletion: vi.fn(async () => undefined) }));
vi.mock("./claw-fetch.js", () => ({ fetchClawRunWithRetry: vi.fn() }));
vi.mock("./consume-claw-stream.js", () => ({ consumeAlreadyOpenStream: vi.fn() }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

import { CONFIG } from "../config.js";
import { postBrokenSseTerminalCallback } from "./run-bridge.js";

function headersOf(call: unknown[]): Record<string, string> {
  const init = call[1] as RequestInit;
  return (init.headers ?? {}) as Record<string, string>;
}

describe("run-bridge callback delivery — S2S key policy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    finalize.mockClear();
    fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches x-s2s-key when the callback target is a configured internal origin", async () => {
    await postBrokenSseTerminalCallback({
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      sessionId: "s1",
      sessionToken: "run-hmac",
      logPrefix: "test",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = headersOf(fetchMock.mock.calls[0]!);
    expect(headers["x-s2s-key"]).toBe(CONFIG.xyneClawS2sKey || undefined);
    expect(headers["x-session-token"]).toBe("run-hmac");
  });

  it("never hands the fleet S2S key to a caller-supplied external callbackUrl", async () => {
    await postBrokenSseTerminalCallback({
      callbackUrl: "https://attacker.example.com/collect",
      sessionId: "s2",
      sessionToken: "run-hmac",
      logPrefix: "test",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = headersOf(fetchMock.mock.calls[0]!);
    expect(headers["x-s2s-key"]).toBeUndefined();
    // The per-run HMAC token stays: it is bound to this session and is the
    // credential the receiver is meant to check.
    expect(headers["x-session-token"]).toBe("run-hmac");
  });

  it("refuses a callbackUrl aimed at a private address instead of dialling it", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3:6379/",
      "http://127.0.0.1:6379/",
    ]) {
      fetchMock.mockClear();
      finalize.mockClear();
      await postBrokenSseTerminalCallback({
        callbackUrl: url,
        sessionId: "s3",
        sessionToken: "run-hmac",
        logPrefix: "test",
      });
      expect(fetchMock, url).not.toHaveBeenCalled();
      // Delivery failed, so the run is finalized directly rather than left running.
      expect(finalize, url).toHaveBeenCalled();
    }
  });
});
