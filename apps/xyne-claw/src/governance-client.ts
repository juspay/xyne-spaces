/**
 * claw has no database: every governance record goes to claw-auth's
 * /internal/governance/events. Side-effect decisions are posted before the call
 * with a short timeout; findings and read decisions are batched once a second.
 */
import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("governance");

export type GovernanceEvent = Record<string, unknown> & { eventType: string };
export type GovernanceFinding = Record<string, unknown> & { foundIn: string };

const FLUSH_MS = 1_000;
const MAX_BATCH = 200;
const QUEUE_CAP = 10_000;

let events: GovernanceEvent[] = [];
let findings: GovernanceFinding[] = [];
let timer: NodeJS.Timeout | null = null;
let dropped = 0;
let failed = 0;
let warnedNoKey = false;

const endpoint = (): string => `${SERVER.authServiceUrl}/claw/api/v1/internal/governance/events`;

async function post(body: { events?: GovernanceEvent[]; findings?: GovernanceFinding[] }, timeoutMs: number): Promise<boolean> {
  if (!SERVER.s2sKey) {
    if (!warnedNoKey) log.warn("[governance] XYNE_CLAW_S2S_KEY is empty; governance records are not sent");
    warnedNoKey = true;
    return false;
  }
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`governance events ${res.status}`);
  return true;
}

export function queueGovernance(event?: GovernanceEvent, finding?: GovernanceFinding): void {
  if (events.length + findings.length >= QUEUE_CAP) {
    if (events.length > 0) events.shift();
    else findings.shift();
    dropped++;
  }
  if (event) events.push(event);
  if (finding) findings.push(finding);
  if (events.length + findings.length >= MAX_BATCH) void flushGovernance();
  else if (!timer) timer = setTimeout(() => void flushGovernance(), FLUSH_MS).unref();
}

export async function flushGovernance(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (events.length === 0 && findings.length === 0) return;
  const batch = { events: events.splice(0, MAX_BATCH), findings: findings.splice(0, MAX_BATCH) };
  try {
    await post(batch, 5_000);
  } catch (err) {
    dropped += batch.events.length + batch.findings.length;
    log.warn(`[governance] batch of ${batch.events.length + batch.findings.length} not recorded: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (events.length + findings.length > 0 && !timer) timer = setTimeout(() => void flushGovernance(), FLUSH_MS).unref();
}

/** Posts one side-effect event before the call runs. False means the audit is unavailable. */
export async function recordGovernanceNow(event: GovernanceEvent, timeoutMs = 250): Promise<boolean> {
  try {
    return await post({ events: [{ ...event, sync: true }] }, timeoutMs);
  } catch (err) {
    failed++;
    log.warn(`[governance] side-effect event not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export const governanceClientStats = (): { queued: number; dropped: number; failed: number } => ({ queued: events.length + findings.length, dropped, failed });
