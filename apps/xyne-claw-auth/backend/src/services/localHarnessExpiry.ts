import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { relayResult } from "../lib/local-harness.js";
import { localHarnessRepository } from "../repositories/localHarnessRepository.js";

const log = createLogger("local-harness-expiry");

const SWEEP_INTERVAL_MS = 30_000;

export function initLocalHarnessExpirySweep(): void {
  if (!CONFIG.localHarnessEnabled) return;

  const timer = setInterval(() => {
    void (async () => {
      const expired = await localHarnessRepository.expireStaleRuns().catch((err) => {
        log.warn("[local-harness] expiry sweep failed:", err instanceof Error ? err.message : err);
        return [];
      });
      for (const run of expired) {
        log.warn(`[local-harness] run expired id=${run.id} device=${run.deviceId ?? "(unclaimed)"} agent=${run.agentSlug}`);
        await relayResult(run, {
          status: "failed",
          text: "",
          error: "The local harness stopped responding — the desktop app may be offline.",
        });
      }
    })();
  }, SWEEP_INTERVAL_MS);

  timer.unref();
  log.info("[local-harness] expiry sweep started");
}
