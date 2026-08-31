// Identify this process in structured logs (overridden by deployment env).
process.env.SERVICE_NAME ||= "xyne-claw";

import express from "express";
import { SERVER } from "./config.js";
import { initStore } from "./store.js";
import { runRouter, getActiveRunCount, getActiveSessionIds, cancelActiveRunsForDrain, describeActiveRuns, requestActiveRunHandoffs } from "./routes/run.js";
import { curatorRouter } from "./routes/curator.js";
import { userMemoryRouter } from "./routes/user-memory.js";
import { failureCuratorRouter } from "./routes/failure-curator.js";
import { goalJudgeRouter } from "./routes/goal-judge.js";
import { debugRouter } from "./routes/debug.js";
import { evalJudgeRouter } from "./routes/eval-judge.js";
import { evalExtractRouter } from "./routes/eval-extract.js";
import { entityLlmRouter } from "./routes/entity-llm.js";
import { attachmentsRouter } from "./routes/attachments.js";
import { litellmModelsRouter } from "./routes/litellm-models.js";
import { startSessionCleanup, flushAllActiveSessions } from "./session-store.js";
import { beginDraining, isDraining } from "./drain.js";
import { createLogger } from "./logger.js";
const log = createLogger("main");

const DRAIN_TIMEOUT_MS = Number(process.env["DRAIN_TIMEOUT"] ?? 900) * 1_000;
const FATAL_FLUSH_TIMEOUT_MS = Number(process.env["FATAL_FLUSH_TIMEOUT_MS"] ?? 30_000);
// Default ON (owner decision 2026-07-15, enabled during a low-traffic window):
// on drain, checkpoint active runs at a turn boundary and hand off to the new
// pod via the recovery machinery instead of waiting them out for 15 min.
// Set XYNE_DRAIN_HANDOFF=0 to fall back to legacy drain-in-place (the
// kill-switch if handoff misbehaves — see drain-handoff-plan.md Slice C for
// what to watch: handoff_ok≈handoff_resume_ok, no double answers, no runs
// stuck in "running"). Handoff only applies to callback-backed runs; others
// still drain in place, and DRAIN_TIMEOUT stays 900s as the safety net until
// handoff is proven, so a failed handoff degrades to the old behavior.
const DRAIN_HANDOFF_ENABLED = process.env["XYNE_DRAIN_HANDOFF"] !== "0";
const HANDOFF_TURN_CAP_MS = Number(process.env["XYNE_HANDOFF_TURN_CAP_MS"] ?? 120_000);

// Fail closed at boot. Every route is gated by the S2S key; serving without it
// would leave the whole API unauthenticated. Refuse to start unless the key is
// configured — there is no insecure escape hatch.
if (!SERVER.s2sKey) {
  log.error("[startup] FATAL: XYNE_CLAW_S2S_KEY is not set. Refusing to boot an unauthenticated service. Set the key.");
  process.exit(1);
}


initStore();
startSessionCleanup();

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "xyne-claw", uptime: process.uptime() });
});

app.get("/healthz/ready", (_req, res) => {
  if (isDraining()) {
    res.status(503).json({ status: "draining", service: "xyne-claw", activeRuns: getActiveRunCount(), activeSessionIds: getActiveSessionIds() });
    return;
  }
  res.json({ status: "ready", service: "xyne-claw", activeRuns: getActiveRunCount(), activeSessionIds: getActiveSessionIds() });
});

app.use(runRouter);
app.use(curatorRouter);
app.use(userMemoryRouter);
app.use(failureCuratorRouter);
app.use(goalJudgeRouter);
app.use(debugRouter);
app.use(evalJudgeRouter);
app.use(evalExtractRouter);
app.use(entityLlmRouter);
app.use(attachmentsRouter);
app.use(litellmModelsRouter);

const server = app.listen(SERVER.port, () => {
  log.info(`[xyne-claw] Server listening on port ${SERVER.port}`);
});

let shuttingDown = false;
async function waitForActiveRuns(maxMs: number): Promise<"idle" | "timeout"> {
  const deadline = Date.now() + maxMs;
  while (getActiveRunCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return getActiveRunCount() === 0 ? "idle" : "timeout";
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  beginDraining();
  log.info(`[xyne-claw] ${signal}. Draining active runs (timeoutMs=${DRAIN_TIMEOUT_MS}).`);
  // Black-box recorder: enumerate every in-flight run NOW, at drain start. If
  // an external kill (node scale-down, force delete, kata teardown) bypasses
  // the drain, this is the only surviving record of exactly which runs died.
  for (const r of describeActiveRuns()) {
    log.warn(`[drain] inflight at ${signal}: session=${r.sessionId} agent=${r.agentSlug} user=${r.userId} ageS=${r.ageS}`);
  }
  if (DRAIN_HANDOFF_ENABLED) {
    const requested = requestActiveRunHandoffs(HANDOFF_TURN_CAP_MS);
    log.warn(`[xyne-claw] drain handoff enabled; requested handoff for ${requested} active run(s) (turnCapMs=${HANDOFF_TURN_CAP_MS}).`);
  }

  const hardExitMs = DRAIN_TIMEOUT_MS + FATAL_FLUSH_TIMEOUT_MS + 60_000;
  setTimeout(() => process.exit(1), hardExitMs).unref();

  const result = await waitForActiveRuns(DRAIN_TIMEOUT_MS);
  if (result === "timeout" && getActiveRunCount() > 0) {
    const cancelled = cancelActiveRunsForDrain("DRAIN_TIMEOUT");
    log.warn(`[xyne-claw] Drain deadline reached; cancelled ${cancelled} active run(s).`);
    await waitForActiveRuns(Math.min(30_000, FATAL_FLUSH_TIMEOUT_MS)).catch(() => "timeout");
  }

  await flushAllActiveSessions(FATAL_FLUSH_TIMEOUT_MS).catch((err) => {
    log.error("[xyne-claw] flushAllActiveSessions during drain failed:", err);
  });
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

async function fatalFlushAndExit(kind: string, reason: unknown): Promise<void> {
  log.error(`[xyne-claw] ${kind} — flushing active sessions before exit:`, reason);
  beginDraining();
  setTimeout(() => process.exit(1), FATAL_FLUSH_TIMEOUT_MS + 5_000).unref();
  await flushAllActiveSessions(FATAL_FLUSH_TIMEOUT_MS).catch((err) => {
    log.error(`[xyne-claw] fatal flush failed after ${kind}:`, err);
  });
  server.close(() => process.exit(1));
}

process.on("uncaughtException", (err: Error) => {
  void fatalFlushAndExit("uncaughtException", err);
});

// Unhandled rejections must NOT kill the pod. A stray promise in SDK code
// (e.g. kata-sdk's sandboxclaim DELETE racing a claim that's already gone →
// 404 HttpError) says nothing about process health — exiting here turned a
// harmless cleanup race into a full pod crash that killed every in-flight
// run (prod, 2026-07-06, ~30-min crash loop). Registering this handler also
// suppresses Node's default crash-on-unhandled-rejection. Log loudly so the
// offending call site gets a .catch added; only uncaughtException (truly
// corrupted state) flushes and exits.
process.on("unhandledRejection", (reason: unknown) => {
  log.error("[xyne-claw] unhandledRejection (non-fatal — add a .catch at the call site):", reason);
});

export { app };
