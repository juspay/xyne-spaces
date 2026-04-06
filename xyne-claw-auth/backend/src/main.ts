import express, { type Request, type Response } from "express";
import { CONFIG } from "./config.js";
import { serversRouter } from "./routes/servers.js";
import { connectionsRouter } from "./routes/connections.js";
import { mcpRouter } from "./routes/mcp.js";
import { runRouter } from "./routes/run.js";
import { usersRouter } from "./routes/users.js";
import { gatewaysRouter } from "./routes/gateways.js";
import { webhookRouter } from "./routes/webhook.js";
import { appCallbackRouter } from "./routes/app-callback.js";
import { agentsRouter } from "./routes/agents.js";
import { toolsRouter } from "./routes/tools.js";
import { scheduledJobsRouter } from "./routes/scheduled-jobs.js";
import { pendingQuestionsRouter } from "./routes/pending-questions.js";
import { initScheduledJobsWorker, closeWorker } from "./queue/scheduled-jobs-worker.js";
import { closeQueue } from "./queue/scheduled-jobs-queue.js";
import { restoreScheduledJobs } from "./queue/restore-jobs.js";
import { redisService } from "./redis.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/claw/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "xyne-claw-auth", uptime: process.uptime() });
});

const BASE = "/claw/api/v1";

app.use(`${BASE}/servers`, serversRouter);
app.use(`${BASE}/users`, usersRouter);
app.use(`${BASE}/users`, connectionsRouter);
app.use(`${BASE}/users`, mcpRouter);
app.use(`${BASE}/gateways`, gatewaysRouter);
app.use(`${BASE}/agents`, agentsRouter);
app.use(`${BASE}/tools`, toolsRouter);
app.use(BASE, runRouter);
app.use(`${BASE}/webhook`, webhookRouter);
app.use(`${BASE}/app`, appCallbackRouter);
app.use(`${BASE}/scheduled-jobs`, scheduledJobsRouter);
app.use(`${BASE}/pending-questions`, pendingQuestionsRouter);

const server = app.listen(CONFIG.port, () => {
  console.log(`[xyne-claw-auth] Server listening on port ${CONFIG.port}`);
  initScheduledJobsWorker();
  restoreScheduledJobs().catch((err) => {
    console.error("[xyne-claw-auth] Failed to restore scheduled jobs:", err);
  });
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[xyne-claw-auth] ${signal}. Shutting down.`);
  await closeWorker().catch(() => {});
  await closeQueue().catch(() => {});
  await redisService.disconnect().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err: Error) => {
  console.error("[xyne-claw-auth] Uncaught exception — draining connections:", err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[xyne-claw-auth] Unhandled rejection:", reason);
});

export { app };
