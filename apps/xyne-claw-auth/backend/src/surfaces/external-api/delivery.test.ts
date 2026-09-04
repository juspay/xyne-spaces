import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  CONFIG: {
    selfUrl: "https://auth.example.com",
    internalUrl: "http://auth.internal:3003",
    xyneClawUrl: "http://claw.internal:3002",
    encryptionKey: Buffer.alloc(32, 9),
  },
}));

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../../logger.js", () => ({ createLogger: () => logger }));

import {
  isAllowedExternalCallbackUrl,
  isInternalCallbackOrigin,
  sendExternalResultCallback,
  sendStoredExternalResultCallback,
} from "./delivery.js";
import { encryptSurfaceSecret } from "../../lib/surface-resolver.js";

describe("isInternalCallbackOrigin", () => {
  const config = {
    selfUrl: "https://auth.example.com/base",
    internalUrl: "http://auth.internal:3003",
    xyneClawUrl: "http://claw.internal:3002",
    nodeEnv: "production",
  };

  it("matches configured auth and claw origins regardless of path", () => {
    expect(isInternalCallbackOrigin("https://auth.example.com/claw/result", config)).toBe(true);
    expect(isInternalCallbackOrigin("http://auth.internal:3003/callback", config)).toBe(true);
    expect(isInternalCallbackOrigin("http://claw.internal:3002/result", config)).toBe(true);
  });

  it("does not trust lookalike or external origins", () => {
    expect(isInternalCallbackOrigin("https://auth.example.com.evil.test/result", config)).toBe(false);
    expect(isInternalCallbackOrigin("https://integrator.example/result", config)).toBe(false);
    expect(isInternalCallbackOrigin("not a URL", config)).toBe(false);
  });

  it("trusts localhost only in development", () => {
    expect(isInternalCallbackOrigin("http://localhost:9999/result", config)).toBe(false);
    expect(isInternalCallbackOrigin("http://127.0.0.1:9999/result", { ...config, nodeEnv: "development" })).toBe(true);
    expect(isInternalCallbackOrigin("http://[::1]:9999/result", { ...config, nodeEnv: "development" })).toBe(true);
  });

  it("trusts any in-cluster host, covering Spaces backend service-name drift", () => {
    // The prod regression: the automation callback origin was
    // xyne-backend.svc.cluster.local while SPACES_INTERNAL_URL pointed at
    // xyne-backend-02 — a configured origin alone would miss it. Cluster
    // hosts are never external integrators, so both resolve internal.
    expect(isInternalCallbackOrigin("http://xyne-backend.xyne-apps.svc.cluster.local:3001/api/internal/automations/claw-callback/x/y", config)).toBe(true);
    expect(isInternalCallbackOrigin("http://xyne-backend-02.xyne-apps.svc.cluster.local:3001/api/internal/automations/claw-callback/x/y", config)).toBe(true);
    expect(isInternalCallbackOrigin("http://10.4.2.9:3001/callback", config)).toBe(true);
  });

  it("still refuses a public integrator host even in production", () => {
    // The .svc.cluster.local suffix is required — a lookalike public host
    // that merely CONTAINS the substring must not slip through.
    expect(isInternalCallbackOrigin("https://svc.cluster.local.evil.test/result", config)).toBe(false);
    expect(isInternalCallbackOrigin("https://integrator.example/result", config)).toBe(false);
  });

  it("matches the configured Spaces backend origins", () => {
    const withSpaces = { ...config, spacesInternalUrl: "http://xyne-backend-02.xyne-apps.svc.cluster.local:3001", spacesBackendUrl: "https://spaces.example.net" };
    expect(isInternalCallbackOrigin("https://spaces.example.net/api/agent/result", withSpaces)).toBe(true);
  });
});

describe("external result delivery", () => {
  beforeEach(() => {
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("signs the exact raw body with the caller secret and never sends an internal key", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendExternalResultCallback(
      { url: "https://qa.example.com/callback", secret: "caller-secret" },
      { sessionId: "session-1", status: "completed", result: "done" },
    )).resolves.toBe("delivered");

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("manual");
    const rawBody = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(JSON.parse(rawBody)).toEqual({ sessionId: "session-1", status: "completed", result: "done" });
    expect(headers["x-s2s-key"]).toBe("caller-secret");
    expect(headers["x-s2s-key"]).not.toBe("internal-claw-auth-key");
    expect(headers["x-claw-signature"]).toBe(
      `sha256=${createHmac("sha256", "caller-secret").update(rawBody).digest("hex")}`,
    );
  });

  it("decrypts the stored secret in the result-endpoint adapter before forwarding", async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendStoredExternalResultCallback(
      {
        url: "https://qa.example.com/callback",
        encryptedSecret: encryptSurfaceSecret("stored-caller-secret"),
      },
      { sessionId: "session-stored", status: "failed", result: "", error: "agent failed" },
    )).resolves.toBe("delivered");

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-s2s-key"]).toBe("stored-caller-secret");
    expect(JSON.stringify(init)).not.toContain("internal-claw-auth-key");
  });

  it("retries a 500 once and then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const delivery = sendExternalResultCallback(
      { url: "https://qa.example.com/callback" },
      { sessionId: "session-2", status: "completed", result: "done" },
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(delivery).resolves.toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses metadata and link-local callback targets without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(isAllowedExternalCallbackUrl("https://metadata.google.internal/computeMetadata/v1")).toBe(false);
    expect(isAllowedExternalCallbackUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedExternalCallbackUrl("file:///tmp/result")).toBe(false);
    await expect(sendExternalResultCallback(
      { url: "http://169.254.169.254/latest/meta-data" },
      { sessionId: "session-3", status: "failed", result: "", error: "failed" },
    )).resolves.toBe("refused");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
