/**
 * Experiment context must survive a recovery round-trip.
 *
 * xyne-claw injects the experiment-ledger / experiment-review / end-experiment
 * tools ONLY when `experiment` is present on the /run body (routes/run.ts:
 * normalizeExperimentContext → buildExperimentTools). The field used to be
 * declared nowhere on RecoveryDispatchPayload, so TypeScript silently dropped
 * it when the dispatch payload was stored — every recovery re-dispatch (watchdog
 * timeout, drain handoff, lock defer) then reached claw WITHOUT it, and the
 * agent lost the ability to write to its own ledger mid-experiment
 * ("Tool experiment-review not found"). An 8h epoch is precisely the run that
 * gets recovered, so the first restart silently disarmed the experiment.
 *
 * These tests pin the two hops that carry it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");

describe("experiment context survives recovery", () => {
  it("RecoveryDispatchPayload declares `experiment` (excess-property drop guard)", () => {
    const src = read("./run-recovery-worker.ts");
    const iface = src.slice(
      src.indexOf("interface RecoveryDispatchPayload"),
      src.indexOf("export interface RecoverySessionContext"),
    );
    expect(iface).toContain("experiment?:");
    // The three fields claw needs to rebuild the context.
    expect(iface).toContain("deadlineAt");
    expect(iface).toContain("epoch");
    expect(iface).toContain("mode?:");
  });

  it("re-dispatch spreads the whole stored payload (so `experiment` rides along)", () => {
    const src = read("./run-recovery-worker.ts");
    // Both re-dispatch sites must spread, not hand-rebuild — a field-by-field
    // rebuild is what silently dropped the context on the queue path.
    const spreads = src.match(/\.\.\.state\.dispatchPayload/g) ?? [];
    expect(spreads.length).toBeGreaterThanOrEqual(2);
  });

  it("the lock-contention queue hop forwards `experiment` in both directions", () => {
    // enqueue side: recovery → QueuedMessage
    expect(read("./run-recovery-worker.ts")).toContain("experiment: dispatchPayload.experiment");
    // drain side: QueuedMessage → /internal/run
    expect(read("../routes/webhook.ts")).toContain("experiment: msg.experiment");
    // and the carrier type must declare it
    expect(read("../lib/message-queue.ts")).toContain("experiment?:");
  });
});
