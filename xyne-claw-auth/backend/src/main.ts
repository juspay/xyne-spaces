import express, { type Request, type Response } from "express";
import { CONFIG } from "./config.js";
import { serversRouter } from "./routes/servers.js";
import { connectionsRouter } from "./routes/connections.js";
import { mcpRouter } from "./routes/mcp.js";
import { runRouter } from "./routes/run.js";
import { runStreamRouter, runStreamInternalRouter } from "./routes/run-stream.js";
import { usersRouter } from "./routes/users.js";
import { gatewaysRouter } from "./routes/gateways.js";
import { webhookRouter } from "./routes/webhook.js";
import { appCallbackRouter } from "./routes/app-callback.js";
import { agentsRouter } from "./routes/agents.js";
import { toolsRouter } from "./routes/tools.js";
import { skillsRouter } from "./routes/skills.js";
import { adminRouter } from "./routes/admin.js";
import { agentChatRouter, agentChatInternalRouter } from "./routes/agent-chat.js";
import { googleOAuthRouter, googleCallbackRouter } from "./routes/google-oauth.js";
import { microsoftOAuthRouter, microsoftCallbackRouter } from "./routes/microsoft-oauth.js";
import { scheduledJobsRouter } from "./routes/scheduled-jobs.js";
import { pendingQuestionsRouter } from "./routes/pending-questions.js";
import { settingsRouter } from "./routes/settings.js";
import { runsRouter } from "./routes/runs.js";
import { initScheduledJobsWorker, closeWorker } from "./queue/scheduled-jobs-worker.js";
import { closeQueue } from "./queue/scheduled-jobs-queue.js";
import { initRunRecoveryWorker, closeRunRecoveryWorker } from "./queue/run-recovery-worker.js";

import { requireAuth, requireS2S } from "./middleware/require-auth.js";
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
app.use(`${BASE}/agents`, requireAuth, agentsRouter);
app.use(`${BASE}/tools`, requireAuth, toolsRouter);
app.use(`${BASE}/skills`, requireAuth, skillsRouter);
app.use(`${BASE}/admin`, requireAuth, adminRouter);
app.use(`${BASE}/agent-chat`, requireAuth, agentChatRouter);
app.use(`${BASE}/internal/agent-chat`, requireS2S, agentChatInternalRouter); // progress/callback from xyne-claw
app.use(`${BASE}/users`, googleOAuthRouter);
app.use(BASE, googleCallbackRouter);
app.use(`${BASE}/users`, microsoftOAuthRouter);
app.use(BASE, microsoftCallbackRouter);
app.use(BASE, runRouter);
app.use(`${BASE}/run/stream`, runStreamRouter);
app.use(`${BASE}/internal/run-stream`, requireS2S, runStreamInternalRouter);
app.use(`${BASE}/webhook`, webhookRouter);
app.use(`${BASE}/app`, appCallbackRouter);
app.use(`${BASE}/scheduled-jobs`, requireAuth, scheduledJobsRouter);
app.use(`${BASE}/pending-questions`, pendingQuestionsRouter);
app.use(`${BASE}/settings`, requireAuth, settingsRouter);
app.use(`${BASE}/runs`, requireAuth, runsRouter);

const server = app.listen(CONFIG.port, () => {
  console.log(`[xyne-claw-auth] Server listening on port ${CONFIG.port}`);
  initScheduledJobsWorker();
  initRunRecoveryWorker();
  // Jobs persist in Redis. A full Redis wipe loses schedulers; there is no
  // auto-reconcile from Postgres. If that ever happens, restore by iterating
  // active ScheduledJob rows and calling enqueueCronJob / enqueueDelayedJob.
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[xyne-claw-auth] ${signal}. Shutting down.`);
  await closeWorker().catch(() => {});
  await closeRunRecoveryWorker().catch(() => {});
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
