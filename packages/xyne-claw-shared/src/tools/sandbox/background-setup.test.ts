import { describe, expect, it, vi } from "vitest";
import {
  buildSetupOrchestratorScript,
  waitForSandboxReady,
  type RepoSetupConfig,
} from "./tools.js";

function makeConfig(): RepoSetupConfig {
  return {
    slug: "xyne-spaces",
    name: "Xyne Spaces",
    description: "test",
    repoUrl: "https://example.com/xyne-spaces.git",
    defaultBranch: "main",
    workDir: "/workspace/xyne-spaces",
    template: "agent-workspace",
    steps: [
      {
        type: "services",
        cmd: "nix run .#services",
        markerPath: "/tmp/services-up",
        healthCheck: { cmd: "probe-ports", successCondition: "all-up", intervalMs: 5_000, timeoutMs: 120_000 },
      },
      { type: "devserver", name: "web", cmd: "npm run dev", cwd: "/workspace/xyne-spaces", markerPath: "/tmp/dev-up" },
      { type: "run", label: "codegen", cmd: "npm run codegen" },
    ],
    ports: { app: 3000 },
  };
}

function scriptedSession(responses: string[]) {
  let i = 0;
  const run = vi.fn(async (_cmd: string) => {
    const stdout: string = responses[Math.min(i, responses.length - 1)] ?? "";
    i += 1;
    return { stdout };
  });
  return { commands: { run } };
}

describe("buildSetupOrchestratorScript", () => {
  const script = buildSetupOrchestratorScript(makeConfig());

  it("writes syncing first and ready last", () => {
    expect(script).toContain(`echo syncing > "$READY_FILE"`);
    expect(script).toContain(`echo ready > "$READY_FILE"`);
    expect(script.indexOf("echo syncing")).toBeLessThan(script.indexOf("echo ready"));
  });

  it("polls the prebake-done marker", () => {
    expect(script).toContain("/tmp/prebake-done");
    expect(script).toContain("PREBAKE_DEADLINE");
  });

  it("guards services/devserver launch on the markerPath", () => {
    expect(script).toContain("[ -f '/tmp/services-up' ]");
    expect(script).toContain("[ -f '/tmp/dev-up' ]");
  });

  it("launches services under setsid so they survive the orchestrator exit", () => {
    expect(script).toContain("setsid bash -c");
    expect(script).toContain("< /dev/null");
    expect(script).not.toContain("nohup bash -c");
  });

  it("has a failed: write path", () => {
    expect(script).toContain(`printf 'failed:%s\\n' "$1" > "$READY_FILE"`);
    expect(script).toContain("fail ");
  });

  it("runs a run-step synchronously and fails on non-zero exit", () => {
    expect(script).toContain("npm run codegen");
    expect(script).toContain(`fail "codegen:`);
  });
});

describe("waitForSandboxReady", () => {
  it("resolves when the status file reads ready", async () => {
    const session = scriptedSession(["syncing", "ready"]);
    await expect(waitForSandboxReady(session, 10_000)).resolves.toEqual({ ready: true });
  });

  it("throws with the reason when the status file reads failed:<reason>", async () => {
    const session = scriptedSession(["failed:boom"]);
    await expect(waitForSandboxReady(session, 10_000)).rejects.toThrow(/boom/);
  });

  it("throws a timeout error when it only ever reads syncing", async () => {
    const session = scriptedSession(["syncing"]);
    await expect(waitForSandboxReady(session, 50)).rejects.toThrow(/not ready/);
  });
});
