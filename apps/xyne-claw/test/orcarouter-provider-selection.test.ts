import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runSrc = readFileSync(resolve(here, "../src/routes/run.ts"), "utf8");

// The provider gates in run.ts are inline expressions, so they are pinned here
// the way transient-terminal-autoretry.test.ts pins its branch: by asserting on
// the source. An `orcarouter` credential must be recognised as BYO everywhere a
// `litellm` credential is, otherwise the run dispatches with no providerConfig
// and silently lands on the platform LiteLLM proxy.

describe("run.ts provider whitelists include orcarouter", () => {
  it("uses a BYO providerConfig for orcarouter (same gate as litellm)", () => {
    expect(runSrc).toContain(
      'provider === "copilot" || provider === "claude" || provider === "codex" || provider === "litellm" || provider === "orcarouter"',
    );
  });

  it("defaults the tool provider base URL to the OrcaRouter inference origin", () => {
    expect(runSrc).toContain('provider === "orcarouter"');
    expect(runSrc).toContain("ORCAROUTER.baseUrl");
  });

  it("lets subagents follow an orcarouter parent", () => {
    const occurrences = runSrc.split('["copilot", "claude", "codex", "orcarouter"]').length - 1;
    // Both gates: the parent's subagents and a delegated A2A callee's.
    expect(occurrences).toBe(2);
  });

  it("does not leave a bare copilot/claude/codex list behind (the gate subagent-tools.ts also enforces)", () => {
    expect(runSrc).not.toContain('(["copilot", "claude", "codex"] as readonly string[])');
  });

  // run.ts only NAMES the parent provider; the subagent actually inherits the
  // credential through subagent-tools.ts, which keeps its own whitelist. The two
  // must agree or the run.ts edit is inert.
  it("subagent-tools.ts lets an orcarouter parent hand its credential down", () => {
    const subagentSrc = readFileSync(resolve(here, "../src/subagent-tools.ts"), "utf8");
    expect(subagentSrc).toContain(
      'chosen === "copilot" || chosen === "claude" || chosen === "codex" || chosen === "orcarouter"',
    );
  });
});
