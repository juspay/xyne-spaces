import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runSrc = readFileSync(resolve(here, "../src/routes/run.ts"), "utf8");

// Regression pin: a TERMINAL transient failure (fallback chain fully exhausted,
// isTransientProviderError true — stall / 5xx / network) must route into
// claw-auth's capacity-retry flow (scheduleProviderRetry auto-retries when the
// provider recovers) instead of dead-ending on a "work stopped" notice.
//
// The runtime signals this by tagging the callback emptyReason=provider_capacity
// (which claw-auth's isCapacityFailure recognises). For interactive runs it also
// emits an EMPTY result so it lands in claw-auth's empty-result retry hook and
// the retry CARD replaces the notice; structured jobs keep their failed terminal.
//
// Before this, only the empty-completion capacity case was tagged, so stalls —
// the dominant failure under provider saturation — never auto-retried.

describe("terminal transient failure → capacity auto-retry", () => {
  // The transient terminal branch: from `else if (isTransientProviderError(err))`
  // up to the next `} else {`.
  const branch = runSrc.slice(
    runSrc.indexOf("} else if (isTransientProviderError(err)) {"),
    runSrc.indexOf("} else {", runSrc.indexOf("} else if (isTransientProviderError(err)) {")),
  );

  it("finds exactly one transient terminal branch", () => {
    expect(branch.length).toBeGreaterThan(0);
    expect(runSrc.indexOf("} else if (isTransientProviderError(err)) {")).toBeGreaterThan(0);
  });

  it("tags the callback emptyReason=provider_capacity so claw-auth auto-retries", () => {
    expect(branch).toContain('emptyReason: "provider_capacity" as const');
  });

  it("sends an EMPTY result for interactive runs (retry card replaces the notice)", () => {
    // Interactive (!requiresStructuredDelivery) must be empty so it lands in the
    // empty-result retry hook; structured keeps the failed `terminal`.
    expect(branch).toContain('requiresStructuredDelivery\n          ? terminal\n          : { status: "completed" as const, result: "" }');
  });

  it("carries a human-readable detail (the stall duration / error) for the fallback notice", () => {
    expect(branch).toContain("const transientDetail = err instanceof ProviderStallError");
    expect(branch).toContain("model stopped responding for");
    expect(branch).toContain("emptyReasonDetail: transientDetail");
  });
});
