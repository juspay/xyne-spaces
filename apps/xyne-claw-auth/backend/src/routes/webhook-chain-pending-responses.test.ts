import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webhookSrc = readFileSync(resolve(here, "./webhook.ts"), "utf8");

// Copilot and Verify Responses agents finish through pendingResponses while
// result.text is empty. The pending-response branch used to return before the
// workflow dispatcher, so downstream workflow nodes never started.
describe("pending-response workflow chaining", () => {
  it("dispatches the agent chain before returning from pending-response delivery", () => {
    const branchStart = webhookSrc.indexOf(
      "// ── Copilot mode: post pendingResponses instead of result.text ──",
    );
    const branchReturn = webhookSrc.indexOf(
      "// Don't delete session — copilot sessions persist for multi-turn",
      branchStart,
    );
    const pendingBranch = webhookSrc.slice(branchStart, branchReturn);

    expect(branchStart).toBeGreaterThan(-1);
    expect(branchReturn).toBeGreaterThan(branchStart);
    expect(pendingBranch).toContain("await dispatchAgentChain();");
  });

  it("keeps workflow dispatch on both pending and normal result paths", () => {
    expect(webhookSrc.match(/await dispatchAgentChain\(\);/g)).toHaveLength(2);
  });
});
