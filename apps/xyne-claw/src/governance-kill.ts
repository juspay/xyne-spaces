/**
 * This pod's copy of the kill switches. claw has no database, so it asks claw-auth for the epoch
 * every 2 s and for the full snapshot only when that integer changed, and it also hears every
 * set or clear on Redis within milliseconds. Whenever the snapshot changes, every live run this
 * pod owns that a stop switch matches is aborted (or, in shadow mode, logged as would-abort).
 */
import { componentMode, matchKillSwitches, type KillSnapshot } from "xyne-claw-shared/governance";
import { SERVER } from "./config.js";
import { queueGovernance } from "./governance-client.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { registerKillMessageHandler, startRunControlSubscriber } from "./run-control.js";

const log = createLogger("governance-kill");
const POLL_MS = 2_000;
const FETCH_MS = 1_500;

export interface KillableRun {
  sessionId: string;
  userId: string;
  agentSlug?: string | undefined;
  orgId?: string | undefined;
  abort: (reason: string) => void;
}

let snapshot: KillSnapshot = { epoch: 0, takenAtMs: 0, switches: [] };
let lister: (() => KillableRun[]) | null = null;
let timer: NodeJS.Timeout | null = null;
const acted = new Set<string>();

export const currentKillSnapshot = (): KillSnapshot => snapshot;

/** run.ts registers the runs this pod owns; governance-kill never imports run.ts. */
export function registerKillableRuns(fn: (() => KillableRun[]) | null): void {
  lister = fn;
}

/** Test seam. */
export function setKillSnapshotForTests(s: KillSnapshot): void {
  snapshot = s;
  acted.clear();
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/internal/governance/kill/${path}`, { headers: { "x-s2s-key": SERVER.s2sKey }, signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok) throw new Error(`kill ${path} ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  return body.data;
}

/** Aborts every live run a stop switch matches; shadow mode only says it would. Once per run and epoch. */
export function applyKillSnapshot(runs: readonly KillableRun[] = lister?.() ?? []): number {
  const mode = componentMode("kill");
  if (mode === "off") return 0;
  let hits = 0;
  for (const run of runs) {
    const top = matchKillSwitches(snapshot, { run: run.sessionId, user: run.userId, ...(run.agentSlug ? { agent: run.agentSlug } : {}), ...(run.orgId ? { org: run.orgId } : {}) }, Date.now())[0];
    if (top?.mode !== "stop") continue;
    const key = `${run.sessionId}:${snapshot.epoch}`;
    if (acted.has(key)) continue;
    acted.add(key);
    hits++;
    const reason = `GOV-KILL-STOP (${top.scopeKind}=${top.scopeId}): ${top.reason ?? "kill switch"}`;
    queueGovernance({ eventType: "kill_switch_enforced", sessionId: run.sessionId, userId: run.userId, actorKind: "system", subjectKind: `kill:${top.scopeKind}`, subjectId: top.scopeId, decision: "block", reasonCode: "GOV-KILL-STOP", reasonText: mode === "enforce" ? `run aborted: ${reason}` : `shadow: would abort the run: ${reason}` });
    metric.count("governance_kill_enforced", { mode, scope: top.scopeKind });
    if (mode === "enforce") {
      log.warn(`[governance-kill] aborting session=${run.sessionId} agent=${run.agentSlug ?? "?"}: ${reason}`);
      run.abort(reason);
    } else {
      log.warn(`[governance-kill] shadow: would abort session=${run.sessionId} agent=${run.agentSlug ?? "?"}: ${reason}`);
    }
  }
  if (acted.size > 5_000) acted.clear();
  return hits;
}

export async function refreshKillSnapshot(force = false): Promise<KillSnapshot> {
  if (componentMode("kill") === "off") return snapshot;
  try {
    if (!force) {
      const epoch = Number((await fetchJson("epoch") as { epoch?: unknown })?.epoch ?? NaN);
      if (Number.isFinite(epoch) && epoch === snapshot.epoch && snapshot.takenAtMs > 0) {
        snapshot = { ...snapshot, takenAtMs: Date.now() };
        return snapshot;
      }
    }
    const next = (await fetchJson("snapshot")) as Partial<KillSnapshot> | undefined;
    snapshot = { epoch: Number(next?.epoch ?? 0), takenAtMs: Date.now(), switches: Array.isArray(next?.switches) ? next.switches : [] };
    log.info(`[governance-kill] snapshot epoch=${snapshot.epoch} switches=${snapshot.switches.length}`);
    applyKillSnapshot();
  } catch (err) {
    // The old snapshot keeps serving; decide() refuses side effects once it is 10 s old.
    log.warn(`[governance-kill] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return snapshot;
}

export function startKillSwitchSync(): void {
  if (componentMode("kill") === "off" || timer) return;
  registerKillMessageHandler(() => void refreshKillSnapshot(true));
  startRunControlSubscriber();
  void refreshKillSnapshot(true);
  const tick = (): void => {
    timer = setTimeout(async () => {
      await refreshKillSnapshot(false);
      tick();
    }, POLL_MS + Math.floor(Math.random() * 500));
    timer.unref();
  };
  tick();
}

export function stopKillSwitchSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
