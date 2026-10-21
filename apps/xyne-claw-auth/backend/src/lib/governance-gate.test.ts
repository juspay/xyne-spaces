import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.fn(async (e: Record<string, unknown>) => ({ id: "ev1", ...e }));
const queue = vi.fn();
const findRun = vi.fn(async () => ({ id: "run-1", orgId: "org-1", userId: "u1", agentSlug: "helper", conversationId: "conv-1" }));
vi.mock("./governance-audit.js", () => ({ recordGovernanceEvent: record, queueGovernanceEvent: queue }));
vi.mock("./audit.js", () => ({ orgIdForUser: vi.fn(async (id: string) => (id === "u1" ? "org-1" : undefined)) }));
vi.mock("../db.js", () => ({ prisma: { agentRun: { findUnique: findRun } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const { gateCall, runContextForSession } = await import("./governance-gate.js");
const { resetComponentModes } = await import("xyne-claw-shared/governance");

const base = { site: "mcp_call" as const, userId: "u1", agentSlug: "helper", sessionId: "sess-1", serverType: "slack", tool: "send_message", params: { text: "hi" }, writeTool: true };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env["GOVERNANCE_MODE"];
  delete process.env["GOVERNANCE_COMPONENT_MODES"];
  resetComponentModes();
});

describe("gateCall", () => {
  it("treats a call without C1 state as elevated with private data, records it before the call and never enforces in shadow", async () => {
    const gate = await gateCall(base);
    expect(gate).toMatchObject({ decision: "ask", reasonCode: "GOV-PRIVATE-DATA-SEND", enforce: false, mode: "shadow", effect: "send", destinationKind: "untrusted_mcp", recorded: true });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", eventType: "tool_call", runId: "run-1", conversationId: "conv-1", toolName: "send_message", mcpServerId: "slack", decision: "ask", riskLevelAtCall: "elevated", carriedPrivateData: true, subjectKind: "mcp_call" }));
    expect(queue).not.toHaveBeenCalled();
  });

  it("uses C1's state when it travels with the call and queues reads", async () => {
    const gate = await gateCall({ ...base, writeTool: false, tool: "list_channels", params: {}, c1: { decisionId: "d1", decision: "allow", risk: "none", privateData: false, pendingVerdicts: 0, toolCallId: "c7" } });
    expect(gate).toMatchObject({ decision: "allow", reasonCode: "GOV-ALLOW-READ", effect: "read" });
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "c7", subjectId: "d1", riskLevelAtCall: "none", carriedPrivateData: false }));
    expect(record).not.toHaveBeenCalled();
  });

  it("blocks a secret in the arguments and, in enforce mode, a side effect the audit cannot record", async () => {
    const secret = await gateCall({ ...base, params: { text: `token ${"AKIA"}ABCDEFGHIJKLMNOP` }, c1: { risk: "none", privateData: false } });
    expect(secret).toMatchObject({ decision: "block", reasonCode: "GOV-SECRET-IN-ARGS", enforce: false });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ argumentsRedacted: "[redacted: secret in arguments]" }));
    process.env["GOVERNANCE_COMPONENT_MODES"] = "C2=enforce";
    resetComponentModes();
    record.mockRejectedValueOnce(new Error("db down"));
    expect(await gateCall(base)).toMatchObject({ decision: "block", reasonCode: "GOV-AUDIT-UNAVAILABLE", enforce: true });
  });

  it("is off when the component says so and allows when its own inputs fail", async () => {
    process.env["GOVERNANCE_COMPONENT_MODES"] = "C2=off";
    resetComponentModes();
    expect(await gateCall(base)).toMatchObject({ decision: "allow", mode: "off", recorded: false });
    resetComponentModes();
    delete process.env["GOVERNANCE_COMPONENT_MODES"];
    resetComponentModes();
    findRun.mockRejectedValueOnce(new Error("db down"));
    expect(await gateCall({ ...base, sessionId: "sess-2" })).toMatchObject({ decision: "allow", reasonCode: "GOV-ALLOW", recorded: false });
  });

  it("caches the run behind a session id", async () => {
    expect(await runContextForSession("sess-9")).toMatchObject({ runId: "run-1", orgId: "org-1" });
    await runContextForSession("sess-9");
    expect(findRun).toHaveBeenCalledTimes(1);
    expect(await runContextForSession(undefined)).toEqual({});
  });
});

describe("route coverage", () => {
  // Every place a tool runs must pass the gate; a new executor that forgets it fails this test.
  it.each([
    ["routes/mcp.ts", "gateCall(", 4],
    ["routes/flow-action.ts", "gateCall(", 1],
    ["lib/approved-write.ts", "gateCall(", 1],
    ["lib/write-actions.ts", "gateCall(", 1],
    ["routes/app-callback.ts", "gateCall(", 1],
    ["mcp/runner.ts", "killSwitchForTool(", 1],
  ])("%s calls %s at least %d time(s)", (file, needle, times) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source.split(needle).length - 1).toBeGreaterThanOrEqual(times);
  });
});
