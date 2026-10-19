import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const findUnique = vi.fn();
const isClawAdmin = vi.fn();

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../db.js", () => ({ prisma: { agentRun: { findMany }, agent: { findUnique } } }));
vi.mock("../../middleware/agent-acl.js", () => ({ isClawAdmin }));

const { accumulateInvocations, buildAgentDiagnostics, classify, handleGetAgentDiagnostics } = await import("./agent-diagnostics.js");
type Run = import("./agent-diagnostics.js").DiagRun;

const t0 = new Date("2026-10-14T10:00:00.000Z");
const run = (over: Partial<Run>): Run => ({
  sessionId: "s", status: "completed", provider: "claude", model: "opus", triggerSource: "spaces", startedAt: t0,
  completedAt: new Date(t0.getTime() + 60_000), totalMs: 60_000, llmTotalMs: 20_000, toolMs: 30_000, llmTurns: 5,
  llmRetries: 0, lastRetryReason: null, error: null, tokensIn: 10_000, tokensOut: 500, tokensCacheRead: 30_000,
  rating: null, ratingComment: null, toolsUsed: ["a"], parentSessionId: null, ...over,
});

describe("classify", () => {
  it.each([
    ["session_locked", "session-lock"],
    ["Tool Juspay_Alerts__alert_data({\"ts\": \"x\"})</arg_value> not found", "tool-call-format"],
    ["Tool todo-write not found", "unknown-tool"],
    ["Validation failed for tool \"x\": - workspace: must have required properties workspace", "bad-arguments"],
    ["Invalid content_query regex: Invalid regular expression: /(?s).*/", "bad-arguments"],
    ["No connection found for user and server type: xyne-spaces", "missing-connection"],
    ["Permission Denied: `juspay` forbids access via a personal access token (classic)", "credentials"],
    ["Bitbucket call failed (status=403): Permission denied: getting diff", "permissions"],
    ["File 'src/A.hs' not found in JBIZ/repo on branch 'main'", "wrong-path"],
    ["ENOENT: no such file or directory, access '/app/x'", "wrong-path"],
    ["MCP error -32001: TimeoutError: The operation was aborted due to timeout", "timeout"],
    ["429 Rate limit exceeded for api_key: x. Limit type: max_parallel_requests", "rate-limit"],
    ["Circuit breaker is OPEN for service 'lightbox_logviewer'", "upstream-down"],
    ["Failed to search code: Request failed with status code 500", "upstream-error"],
    ["get_victoria_logs No result", "empty-result"],
    ["Maximum call stack size exceeded", "tool-crash"],
    ["Verification passed: artifact type x is the PRDs type", "output-recorded-as-error"],
    ["Run cancelled by user", "user-cancel"],
    ["something nobody has seen", "other"],
  ])("%s → %s", (text, category) => {
    expect(classify(text).category).toBe(category);
  });
});

describe("buildAgentDiagnostics", () => {
  it("groups run errors with causes and example sessions, and reports effort and telemetry gaps", () => {
    const tools = new Map();
    accumulateInvocations(tools, [
      { toolName: "Bitbucket__get_file_content", durationMs: 4000, isError: true, result: "File 'a.hs' not found in X/y on branch 'main'" },
      { toolName: "Bitbucket__get_file_content", durationMs: 3000, isError: false, result: "ok" },
      { toolName: "Bitbucket__get_file_content", durationMs: 2000, isError: true, result: { text: "Permission denied: getting file" } },
      { toolName: "webfetch", durationMs: 100 },
      { name: "legacy", durationMs: 5 },
      null,
    ]);
    const d = buildAgentDiagnostics({
      agentSlug: "doctor",
      days: 7,
      now: new Date(t0.getTime() + 5 * 3_600_000),
      sampledRuns: 2,
      tools,
      runs: [
        run({ sessionId: "a" }),
        run({ sessionId: "b", totalMs: null, llmTotalMs: null, toolMs: null, completedAt: new Date(t0.getTime() + 600_000), tokensIn: 900_000 }),
        run({ sessionId: "c", status: "failed", error: "session_locked", completedAt: null }),
        run({ sessionId: "d", status: "failed", error: "session_locked", completedAt: null }),
        run({ sessionId: "e", status: "running", completedAt: null }),
        run({ sessionId: "f", status: "cancelled", error: "interrupted (orphaned run)", completedAt: null }),
        run({ sessionId: "g", rating: "down", ratingComment: "wrong repo", llmRetries: 2, lastRetryReason: "429 Rate limit exceeded" }),
      ],
    }) as Record<string, any>;
    expect(d.runs).toMatchObject({ total: 6, completed: 3, failed: 2, stuckRunning: 1 });
    expect(d.latency.missingTimingPct).toBe(33.3);
    expect(d.latency.maxS).toBe(600);
    expect(d.effort.tokensInP95).toBeGreaterThan(800_000);
    expect(d.effort.llmRetries).toBe(2);
    expect(d.runErrors[0]).toMatchObject({ message: "session_locked", count: 2, category: "session-lock", exampleSessions: ["c", "d"] });
    const bb = d.tools.failing[0];
    expect(bb).toMatchObject({ tool: "Bitbucket__get_file_content", calls: 3, errors: 2, errorPct: 66.7 });
    expect(bb.errorKinds.map((k: { category: string }) => k.category).sort()).toEqual(["permissions", "wrong-path"]);
    expect(d.causeTotals[0]).toEqual({ category: "session-lock", count: 2 });
    expect(d.ratings.comments).toEqual([{ rating: "down", comment: "wrong repo", sessionId: "g" }]);
    expect(d.heaviestContextSessions[0].sessionId).toBe("b");
    expect(d.slowestSessions[0].sessionId).toBe("b");
  });
});

describe("handleGetAgentDiagnostics", () => {
  beforeEach(() => {
    findMany.mockReset();
    findUnique.mockReset();
    isClawAdmin.mockReset();
  });

  it("is admin-only, needs a slug and an existing agent", async () => {
    isClawAdmin.mockResolvedValue(false);
    expect(JSON.parse(await handleGetAgentDiagnostics({ agentSlug: "x" }, "org", "u")).error).toMatch(/claw admins/);
    isClawAdmin.mockResolvedValue(true);
    expect(JSON.parse(await handleGetAgentDiagnostics({}, "org", "u")).error).toMatch(/agentSlug/);
    findUnique.mockResolvedValue(null);
    expect(JSON.parse(await handleGetAgentDiagnostics({ agentSlug: "x" }, "org", "u")).error).toMatch(/No agent/);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes to org+agent, clamps the window and pages the tool sample", async () => {
    isClawAdmin.mockResolvedValue(true);
    findUnique.mockResolvedValue({ slug: "doctor" });
    findMany
      .mockResolvedValueOnce([run({ sessionId: "a" })])
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, toolInvocations: [{ toolName: "webfetch", durationMs: 10 }] })));
    const out = JSON.parse(await handleGetAgentDiagnostics({ agentSlug: "doctor", days: 99, sampleRuns: 3 }, "org", "admin"));
    expect(out.windowDays).toBe(30);
    expect(out.tools.sampledRuns).toBe(10);
    expect(out.tools.mostUsed[0]).toEqual({ tool: "webfetch", calls: 10, errorPct: 0 });
    for (const [arg] of findMany.mock.calls) expect(arg.where).toMatchObject({ orgId: "org", agentSlug: "doctor" });
    expect(findMany.mock.calls[1]![0].take).toBe(10);
  });
});
