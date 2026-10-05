import { hostname } from "node:os";
import { createLogger } from "../logger.js";

const log = createLogger("event-loop");

const CHECK_MS = 1_000;
const WARN_MS = 5_000;

/**
 * This service exports no event-loop metrics, and a pod frozen for 30s loses
 * its WhatsApp leases and job locks without saying why. Log each freeze with
 * the pod and heap size, so it can be matched to what the pod was doing.
 */
export function startEventLoopMonitor(): void {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const blockedMs = now - last - CHECK_MS;
    last = now;
    if (blockedMs < WARN_MS) return;
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    log.warn(`[event-loop] blocked for ${blockedMs}ms host=${hostname()} heapUsedMb=${heapMb}`);
  }, CHECK_MS).unref();
}
