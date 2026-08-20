#!/usr/bin/env node
/**
 * TEMPORARY — delete with routes/backfill-temp.ts once prod is backfilled.
 *
 * Drives the toolStats backfill from an operator machine, one bounded step at a
 * time. The server does a fixed amount of work per request and reports how much
 * is left; this loop decides how fast to ask again.
 *
 * That split is deliberate. A single long request would die on an ingress
 * timeout partway through and leave no way to know where it stopped, and a
 * server-side loop would take pacing out of the operator's hands while sharing
 * a database with the live agent write path.
 *
 * Safe to interrupt at any point: the server selects only rows that still need
 * a summary, so re-running resumes rather than redoing.
 *
 * Usage:
 *   XYNE_CLAW_S2S_KEY=... CLAW_BASE_URL=https://claw.example.com \
 *     node scripts/backfill-tool-stats.mjs [--status] [--max-rows 500]
 *       [--batch-size 200] [--pause-ms 100] [--sleep-ms 1000] [--since-days 90]
 *       [--limit-steps 10000]
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const has = (name) => args.includes(`--${name}`);

const BASE = (process.env.CLAW_BASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.XYNE_CLAW_S2S_KEY ?? "";
if (!BASE || !KEY) {
  console.error("Set CLAW_BASE_URL and XYNE_CLAW_S2S_KEY.");
  process.exit(2);
}

const cfg = {
  maxRows: flag("max-rows", 500),
  batchSize: flag("batch-size", 200),
  pauseMs: flag("pause-ms", 100),
  sleepMs: flag("sleep-ms", 1000),
  sinceDays: flag("since-days", undefined),
  limitSteps: flag("limit-steps", 10_000),
};

const url = (p) => `${BASE}/claw/api/v1/internal/backfill${p}`;
const headers = { "content-type": "application/json", "x-s2s-key": KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

async function call(path, init) {
  const res = await fetch(url(path), { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

let stopping = false;
process.on("SIGINT", () => {
  // Finish the request in flight rather than tearing the connection down —
  // the batch it is running has already done its writes.
  console.log("\nStopping after the current step. Re-run to resume.");
  stopping = true;
});

const started = Date.now();
const status = await call("/status");
console.log(
  `Candidates: ${status.total.toLocaleString()} runs with tool invocations · ` +
    `${status.done.toLocaleString()} done · ${status.remaining.toLocaleString()} remaining (${pct(status.coverage)} covered)`,
);

if (has("--status") || status.remaining === 0) {
  console.log(status.remaining === 0 ? "Nothing to do." : "Status only; no changes made.");
  process.exit(0);
}

console.log(
  `Stepping ${cfg.maxRows} rows/request (batches of ${cfg.batchSize}, ${cfg.pauseMs}ms between), ` +
    `${cfg.sleepMs}ms between requests. Ctrl-C is safe.\n`,
);

let steps = 0;
let processed = 0;
let remaining = status.remaining;

while (remaining > 0 && !stopping && steps < cfg.limitSteps) {
  steps += 1;
  const body = {
    maxRows: cfg.maxRows,
    batchSize: cfg.batchSize,
    pauseMs: cfg.pauseMs,
    ...(Number.isFinite(cfg.sinceDays) ? { sinceDays: cfg.sinceDays } : {}),
  };

  let step;
  try {
    step = await call("/run", { method: "POST", body: JSON.stringify(body) });
  } catch (err) {
    // A transient 502/504 mid-backfill is expected on a busy cluster. The work
    // already committed is durable, so back off and retry rather than exit.
    console.warn(`  step ${steps}: ${err.message} — retrying in 10s`);
    await sleep(10_000);
    continue;
  }

  processed += step.scanned;
  remaining = step.remaining;

  const elapsed = (Date.now() - started) / 1000;
  const rate = processed / Math.max(elapsed, 1);
  const eta = rate > 0 ? Math.round(remaining / rate) : 0;
  console.log(
    `  step ${String(steps).padStart(4)} · scanned ${String(step.scanned).padStart(4)} · ` +
      `summarised ${String(step.summarised).padStart(4)} · empty ${String(step.emptied).padStart(3)} · ` +
      `remaining ${String(remaining).padStart(7)} · ${pct(step.coverage)} · ` +
      `${rate.toFixed(0)} rows/s · eta ${Math.floor(eta / 60)}m${eta % 60}s`,
  );

  // A step that scans nothing while rows remain means the selection found no
  // more candidates — stop rather than spin.
  if (step.scanned === 0) {
    console.log("  No further candidates returned; stopping.");
    break;
  }
  if (remaining > 0) await sleep(cfg.sleepMs);
}

const final = await call("/status");
const mins = ((Date.now() - started) / 60_000).toFixed(1);
console.log(
  `\nDone in ${mins}m · ${final.done.toLocaleString()}/${final.total.toLocaleString()} summarised (${pct(final.coverage)})` +
    (final.remaining > 0 ? ` · ${final.remaining.toLocaleString()} still remaining — re-run to continue.` : ""),
);
