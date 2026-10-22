import { experimentRepository } from "../repositories/index.js";
import { errMsg } from "../lib/errors.js";
import { superviseExperiment } from "../loop-graph/specs/experiment.js";
import { createLogger } from "../logger.js";

const log = createLogger("experiment-supervisor");

const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function tickOnce(): Promise<void> {
  const runs = await experimentRepository.listActive();
  const now = Date.now();
  for (const run of runs) {
    try {
      await superviseExperiment(run, now);
    } catch (err) {
      log.warn(`[experiment] supervisor tick failed id=${run.id}: ${errMsg(err)}`);
    }
  }
}

export function initExperimentSupervisor(): void {
  if (timer) return;
  timer = setInterval(() => { void tickOnce(); }, INTERVAL_MS);
  void tickOnce();
  log.info("[experiment] supervisor started");
}

export function closeExperimentSupervisor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
