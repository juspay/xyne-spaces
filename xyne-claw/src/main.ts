// Identify this process in structured logs (overridden by deployment env).
process.env.SERVICE_NAME ||= "xyne-claw";

import express from "express";
import { SERVER } from "./config.js";
import { initStore } from "./store.js";
import { runRouter } from "./routes/run.js";
import { curatorRouter } from "./routes/curator.js";
import { userMemoryRouter } from "./routes/user-memory.js";
import { failureCuratorRouter } from "./routes/failure-curator.js";
import { goalJudgeRouter } from "./routes/goal-judge.js";
import { debugRouter } from "./routes/debug.js";
import { evalJudgeRouter } from "./routes/eval-judge.js";
import { evalExtractRouter } from "./routes/eval-extract.js";
import { startSessionCleanup, flushAllActiveSessions } from "./session-store.js";
import { createLogger } from "./logger.js";
const log = createLogger("main");

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

app.use(runRouter);
app.use(curatorRouter);
app.use(userMemoryRouter);
app.use(failureCuratorRouter);
app.use(goalJudgeRouter);
app.use(debugRouter);
app.use(evalJudgeRouter);
app.use(evalExtractRouter);

const server = app.listen(SERVER.port, () => {
  log.info(`[xyne-claw] Server listening on port ${SERVER.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`[xyne-claw] ${signal}. Shutting down.`);
  // Hard backstop: exit even if flush / connection drain hangs. Sits inside the
  // pod's terminationGracePeriodSeconds (keep that ≥ 20s in the manifest).
  setTimeout(() => process.exit(1), 15_000).unref();
  // HA: flush any in-flight sessions to GCS so a deploy/eviction doesn't lose
  // the active run's work. Bounded so we still exit within the grace period.
  await flushAllActiveSessions(8_000).catch(() => {});
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

process.on("uncaughtException", (err: Error) => {
  log.error("[xyne-claw] Uncaught exception — draining connections:", err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("[xyne-claw] Unhandled rejection:", reason);
});

export { app };
