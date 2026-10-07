import { describe, expect, it, vi } from "vitest";
import { runReuseSteps, stepOutputTail, type SetupStep } from "./tools.js";

function fakeSession(exitCodes: Record<string, number | null> = {}) {
  const ran: string[] = [];
  return {
    ran,
    session: {
      commands: {
        runDetached: vi.fn(async (cmd: string) => {
          ran.push(cmd);
          return cmd;
        }),
        pollJob: vi.fn(async (jobId: string) => ({
          done: true,
          exitCode: Object.keys(exitCodes).find((k) => jobId.includes(k)) ? exitCodes[Object.keys(exitCodes).find((k) => jobId.includes(k))!]! : 0,
          stderr: "boom",
          stdout: jobId.includes("dep-sync")
            ? "dependency-sync: FAILED — build will not work until these are fixed:\n  chitragupt: yarn install --immutable FAILED after 4s -> cd /workspace/chitragupt && yarn install --immutable (log: /tmp/depsync-chitragupt.log)"
            : "",
        })),
      },
    },
  };
}

const steps: SetupStep[] = [
  { type: "install", packages: ["apps/web"] },
  { type: "services", cmd: "start-services" },
  { type: "devserver", name: "web", cmd: "yarn dev", cwd: "/workspace/web" },
  { type: "run", label: "prebuild codegen", cmd: "yarn codegen" },
  { type: "run", label: "sync node_modules", cmd: "dep-sync", runOnReuse: true },
  { type: "run", label: "explicitly off", cmd: "never", runOnReuse: false },
];

describe("runReuseSteps", () => {
  it("runs only run-steps flagged runOnReuse, in the workDir by default", async () => {
    const { session, ran } = fakeSession();
    const log: string[] = [];
    await runReuseSteps(session, steps, "/workspace/upi-fe", log, 1);
    expect(ran).toEqual(["cd /workspace/upi-fe && dep-sync"]);
    expect(log.slice(0, 2)).toEqual(["Running on reuse: sync node_modules...", "sync node_modules done."]);
  });

  it("honours a step cwd", async () => {
    const { session, ran } = fakeSession();
    await runReuseSteps(session, [{ type: "run", label: "x", cmd: "c", cwd: "/w/sub", runOnReuse: true }], "/w", [], 1);
    expect(ran).toEqual(["cd /w/sub && c"]);
  });

  it("does nothing when no step opts in", async () => {
    const { session, ran } = fakeSession();
    const log: string[] = [];
    await runReuseSteps(session, steps.filter((s) => !(s.type === "run" && s.runOnReuse)), "/w", log, 1);
    expect(ran).toEqual([]);
    expect(log).toEqual([]);
  });

  it("surfaces the step's output, so an in-band FAILED line naming the repo and command reaches the log", async () => {
    const { session } = fakeSession();
    const log: string[] = [];
    await runReuseSteps(session, steps, "/w", log, 1);
    expect(log[2]).toContain("chitragupt: yarn install --immutable FAILED");
    expect(log[2]).toContain("cd /workspace/chitragupt && yarn install --immutable");
  });

  it("logs a failure as a warning instead of throwing, so reuse still returns", async () => {
    const { session } = fakeSession({ "dep-sync": 1 });
    const log: string[] = [];
    await expect(runReuseSteps(session, steps, "/w", log, 1)).resolves.toBeUndefined();
    expect(log[1]).toContain("sync node_modules: WARN failed on reuse (exit 1)");
  });
});

describe("stepOutputTail", () => {
  it("keeps the last 20 lines, trimmed", () => {
    const out = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n\n";
    const tail = stepOutputTail(out)!;
    expect(tail.split("\n")).toHaveLength(20);
    expect(tail.startsWith("line 11")).toBe(true);
    expect(tail.endsWith("line 30")).toBe(true);
  });

  it("returns null for empty output", () => {
    expect(stepOutputTail("")).toBeNull();
    expect(stepOutputTail("  \n ")).toBeNull();
    expect(stepOutputTail(undefined)).toBeNull();
  });

  it("redacts secrets in the output", () => {
    expect(stepOutputTail("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });
});
