import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { failOverToServerRun, localHarnessProviderLabel, relayResult } from "../lib/local-harness.js";
import { localHarnessRepository } from "../repositories/localHarnessRepository.js";

const log = createLogger("local-harness-expiry");

const SWEEP_INTERVAL_MS = 15_000;

const CLAIM_TIMEOUT_MS = 30_000;

export function initLocalHarnessExpirySweep(): void {
  if (!CONFIG.localHarnessEnabled) return;

  const timer = setInterval(() => {
    void (async () => {
      const abandoned = await localHarnessRepository
        .findAbandonedRuns({ claimTimeoutMs: CLAIM_TIMEOUT_MS })
        .catch((err) => {
          log.warn("[local-harness] abandoned-run sweep failed:", err instanceof Error ? err.message : err);
          return [];
        });

      for (const { run, reason } of abandoned) {
        if (!(await localHarnessRepository.beginFallback(run.id).catch(() => false))) continue;

        log.warn(
          `[local-harness] run abandoned id=${run.id} device=${run.deviceId ?? "(unclaimed)"} ` +
            `agent=${run.agentSlug} provider=${run.provider} reason="${reason}"`,
        );

        if (await failOverToServerRun(run, reason)) continue;

        await relayResult(
          run,
          { status: "failed", text: "", error: `${localHarnessProviderLabel(run.provider)}: ${reason}` },
          { localHarnessUnreachable: true },
        );
      }
    })();
  }, SWEEP_INTERVAL_MS);

  timer.unref();
  log.info("[local-harness] abandoned-run sweep started");
}
