import express from "express";
import { SERVER } from "./config.js";
import { initStore } from "./store.js";
import { runRouter } from "./routes/run.js";
import { curatorRouter } from "./routes/curator.js";
import { userMemoryRouter } from "./routes/user-memory.js";
import { goalJudgeRouter } from "./routes/goal-judge.js";
import { startSessionCleanup, flushAllActiveSessions } from "./session-store.js";
import { pruneStaleWorktrees, prewarmConfiguredRepos } from "./workspace.js";

initStore();
startSessionCleanup();
pruneStaleWorktrees().catch((err) => console.warn("[workspace] Prune failed:", err));
// Kick off pre-clones in background — first user request shouldn't pay the cold-clone cost.
prewarmConfiguredRepos().catch((err) => console.warn("[workspace] Prewarm failed:", err));

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "xyne-claw", uptime: process.uptime() });
});

app.use(runRouter);
app.use(curatorRouter);
app.use(userMemoryRouter);
app.use(goalJudgeRouter);

const server = app.listen(SERVER.port, () => {
  console.log(`[xyne-claw] Server listening on port ${SERVER.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[xyne-claw] ${signal}. Shutting down.`);
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
  console.error("[xyne-claw] Uncaught exception — draining connections:", err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[xyne-claw] Unhandled rejection:", reason);
});

export { app };
