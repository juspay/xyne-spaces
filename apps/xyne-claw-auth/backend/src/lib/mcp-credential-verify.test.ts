import { describe, it, expect, vi, beforeEach } from "vitest";

const checkHealth = vi.fn();
const evictSession = vi.fn();
const resolveConnectorDefinition = vi.fn();

vi.mock("../health.js", () => ({ checkHealth: (...args: unknown[]) => checkHealth(...args) }));
vi.mock("../mcp/runner.js", () => ({ evictSession: (...args: unknown[]) => evictSession(...args) }));
vi.mock("../mcp/connector-definitions.js", () => ({
  resolveConnectorDefinition: (...args: unknown[]) => resolveConnectorDefinition(...args),
}));

const { verifyMcpCredentials, verificationSkippedFor } = await import("./mcp-credential-verify.js");

const asana = {
  sessionKey: "user_1",
  serverType: "asana",
  serverName: "Asana",
  credentials: { token: "secret" },
};

beforeEach(() => {
  checkHealth.mockReset();
  evictSession.mockReset().mockResolvedValue(undefined);
  resolveConnectorDefinition
    .mockReset()
    .mockResolvedValue({ type: "asana", credentialFields: [{ name: "token" }] });
});

describe("verifyMcpCredentials", () => {
  it("accepts credentials the connector answers with", async () => {
    checkHealth.mockResolvedValue({ healthy: true, message: "Connected (12 tools available)", latencyMs: 900 });
    const result = await verifyMcpCredentials(asana);
    expect(result).toEqual({ ok: true, skipped: false, message: "Connected (12 tools available)" });
  });

  it("rejects credentials the connector refuses, quoting it", async () => {
    checkHealth.mockResolvedValue({ healthy: false, message: "Not Authorized: invalid token", latencyMs: 400 });
    const result = await verifyMcpCredentials(asana);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rejected");
    expect(result.message).toBe("Asana rejected these details: Not Authorized: invalid token");
  });

  it("treats a transport failure as unreachable, so a good token is not thrown away", async () => {
    checkHealth.mockResolvedValue({ healthy: false, message: "connect ETIMEDOUT 10.0.0.1:443", latencyMs: 20_000 });
    const result = await verifyMcpCredentials(asana);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unreachable");
  });

  it("gives up on a connector that never answers, and kills the child", async () => {
    checkHealth.mockImplementation(() => new Promise(() => undefined));
    const result = await verifyMcpCredentials({ ...asana, timeoutMs: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unreachable");
    expect(result.message).toContain("didn't respond");
    expect(evictSession).toHaveBeenCalledWith("user_1", "asana");
  });

  it("does not spawn anything for OAuth-issued connectors", async () => {
    const result = await verifyMcpCredentials({ ...asana, serverType: "google", serverName: "Google" });
    expect(result).toEqual({ ok: true, skipped: true, message: "Connected." });
    expect(checkHealth).not.toHaveBeenCalled();
    expect(verificationSkippedFor("google")).toBe(true);
    expect(verificationSkippedFor("asana")).toBe(false);
  });

  it("refuses a connector it has no definition for", async () => {
    resolveConnectorDefinition.mockResolvedValue(undefined);
    const result = await verifyMcpCredentials(asana);
    expect(result.ok).toBe(false);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it("surfaces a thrown health check as a failure rather than a 500", async () => {
    checkHealth.mockRejectedValue(new Error("spawn npx ENOENT"));
    const result = await verifyMcpCredentials(asana);
    expect(result.ok).toBe(false);
  });

  it("has nothing to verify for a connector that takes no required credential", async () => {
    resolveConnectorDefinition.mockResolvedValue({
      type: "reddit",
      credentialFields: [{ name: "userAgent", optional: true }],
    });
    const result = await verifyMcpCredentials({ ...asana, serverType: "reddit", serverName: "Reddit" });
    expect(result).toEqual({ ok: true, skipped: true, message: "Connected." });
    expect(checkHealth).not.toHaveBeenCalled();
  });
});
