export type ProactiveMode = "off" | "shadow" | "live";

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function proactiveMode(): ProactiveMode {
  const raw = (process.env["PROACTIVE_INBOX_MODE"] ?? "off").trim().toLowerCase();
  return raw === "shadow" || raw === "live" ? raw : "off";
}

export const PROACTIVE = {
  get gmailTopic(): string {
    return process.env["GMAIL_PUSH_TOPIC"]?.trim() ?? "";
  },
  get pushToken(): string {
    return process.env["GMAIL_PUSH_TOKEN"]?.trim() ?? "";
  },
  ingestDebounceMs: envNumber("PROACTIVE_INGEST_DEBOUNCE_MS", 60_000),
  ingestConcurrency: envNumber("PROACTIVE_INGEST_CONCURRENCY", 4),
  maxMessagesPerIngest: envNumber("PROACTIVE_MAX_MESSAGES_PER_INGEST", 100),
  maxExtractsPerIngest: envNumber("PROACTIVE_MAX_EXTRACTS_PER_INGEST", 10),
  tickMs: envNumber("PROACTIVE_TICK_MS", 5 * 60_000),
  sweepBatch: envNumber("PROACTIVE_SWEEP_BATCH", 100),
  staleSyncMs: envNumber("PROACTIVE_STALE_SYNC_MS", 6 * 60 * 60_000),
  watchRenewAheadMs: envNumber("PROACTIVE_WATCH_RENEW_AHEAD_MS", 24 * 60 * 60_000),
  hitImportance: envNumber("PROACTIVE_HIT_IMPORTANCE", 0.5),
  hitNeedsReply: envNumber("PROACTIVE_HIT_NEEDS_REPLY", 0.6),
  hitDeadline: envNumber("PROACTIVE_HIT_DEADLINE", 0.6),
  laterDelayMs: envNumber("PROACTIVE_LATER_DELAY_MS", 4 * 60 * 60_000),
  maxNudgesPerLoop: envNumber("PROACTIVE_MAX_NUDGES_PER_LOOP", 2),
  maxLaterPerLoop: envNumber("PROACTIVE_MAX_LATER_PER_LOOP", 3),
  cloudWindowMs: envNumber("PROACTIVE_CLOUD_WINDOW_MS", 23 * 60 * 60_000),
};
