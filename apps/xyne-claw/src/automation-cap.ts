import { isReadOnlyJob } from "xyne-claw-shared";

const DEFER_BASE_MS = 5_000;
const DEFER_JITTER_MS = 5_000;

function readLimit(): number {
  const parsed = Math.floor(Number(process.env["RUN_QUEUE_AUTOMATION_CONCURRENCY"]));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const limit = readLimit();
let active = 0;

export function automationConcurrencyLimit(): number {
  return limit;
}

export function activeAutomationRuns(): number {
  return active;
}

export function isAutomationPayload(payload: { eventType?: string; conversationId?: string }): boolean {
  return isReadOnlyJob(payload.eventType, payload.conversationId);
}

export function tryAcquireAutomationSlot(): boolean {
  if (limit > 0 && active >= limit) return false;
  active++;
  return true;
}

export function releaseAutomationSlot(): void {
  if (active > 0) active--;
}

export function automationDeferMs(): number {
  return DEFER_BASE_MS + Math.floor(Math.random() * DEFER_JITTER_MS);
}
