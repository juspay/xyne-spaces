import { describe, expect, it } from "vitest";
import { formatStatusPanel, type StatusSnapshot } from "./status-panel.js";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

function base(run: StatusSnapshot["run"]): StatusSnapshot {
  return { agentSlug: "doctor", now: NOW, run };
}

describe("formatStatusPanel", () => {
  it("lists recent tool activity for a running run", () => {
    const out = formatStatusPanel({
      ...base({
        sessionId: "sess-abcdef123456789",
        status: "running",
        startedAt: new Date(NOW.getTime() - 8 * 60_000),
        provider: "claude",
        model: "opus-5",
        currentToolLabel: "Searching the repo",
        toolInvocations: [
          { toolName: "grep", status: "completed", durationMs: 2500, startedAt: iso(60_000) },
          { toolName: "read_file", status: "completed", isError: true, durationMs: 400, startedAt: iso(120_000) },
          { toolName: "bash", status: "running", durationMs: 0, startedAt: iso(10_000) },
          { toolName: "ancient", status: "completed", durationMs: 100, startedAt: iso(60 * 60_000) },
        ],
      }),
      ownership: { holder: "pod-7:uuid-1", ttlMs: 90_000 },
      queue: { state: "active", attempts: 1, delayMs: 0 },
    });

    expect(out).toContain("**running**");
    expect(out).toContain("started 8m ago");
    expect(out).toContain("claude / opus-5");
    expect(out).toContain("Now: Searching the repo");
    expect(out).toContain("**Last 5 min** — 3 tool calls:");
    expect(out).toContain("✓ grep 2.5s");
    expect(out).toContain("✕ read_file");
    expect(out).toContain("⏳ bash");
    expect(out).not.toContain("ancient");
    expect(out).toContain("Ownership: `pod-7:uuid-1` · heartbeat fresh (90s ttl)");
    expect(out).toContain("Queue job: state `active` · attempt 1");
    expect(out).toContain("Verdict: **working**");
  });

  it("flags a running run with no recent activity as stuck", () => {
    const out = formatStatusPanel({
      ...base({
        sessionId: "sess-stuck",
        status: "running",
        startedAt: new Date(NOW.getTime() - 30 * 60_000),
        provider: "codex",
        model: null,
        currentToolLabel: null,
        toolInvocations: [{ toolName: "web_search", status: "completed", durationMs: 1000, startedAt: iso(20 * 60_000) }],
      }),
      ownership: null,
    });

    expect(out).toContain("No tool activity in the last 5 minutes");
    expect(out).toContain("`web_search`");
    expect(out).toContain("19m ago");
    expect(out).toContain("Ownership: no ownership record (HTTP mode or no live executor)");
    expect(out).toContain("Verdict: likely **stuck**");
  });

  it("reports a terminal run with its outcome and error", () => {
    const out = formatStatusPanel(
      base({
        sessionId: "sess-done",
        status: "failed",
        startedAt: new Date(NOW.getTime() - 12 * 60_000),
        completedAt: new Date(NOW.getTime() - 3 * 60_000),
        provider: "spaces",
        model: "private-large",
        currentToolLabel: "should not show",
        error: "provider timed out",
        toolInvocations: [],
      }),
    );

    expect(out).toContain("**failed**");
    expect(out).toContain("finished 3m ago");
    expect(out).toContain("Error: provider timed out");
    expect(out).not.toContain("Now:");
    expect(out).not.toContain("Verdict:");
    expect(out).toContain("No tool calls were recorded for this run.");
  });

  it("explains when no run was found", () => {
    const out = formatStatusPanel(base(null));
    expect(out).toContain("No run has been dispatched in this thread recently.");
    expect(out).toContain("@doctor");
  });
});
