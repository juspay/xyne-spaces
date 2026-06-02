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
import { chainWorkflowsRouter } from "./routes/chain-workflows.js";
import { spacesRouter } from "./routes/spaces.js";
import { toolsRouter } from "./routes/tools.js";
import { skillsRouter } from "./routes/skills.js";
import subagentsRouter from "./routes/subagents.js";
import { adminRouter } from "./routes/admin.js";
// TEMPORARY — delete after backfill of agents.signingSecret is complete.
import { adminBackfillSigningSecretsRouter } from "./routes/admin-backfill-signing-secrets.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { agentChatRouter, agentChatInternalRouter } from "./routes/agent-chat.js";
import { sessionsArchiveRouter } from "./routes/sessions-archive.js";
import { googleOAuthRouter, googleCallbackRouter } from "./routes/google-oauth.js";
import { microsoftOAuthRouter, microsoftCallbackRouter } from "./routes/microsoft-oauth.js";
import { calendlyOAuthRouter, calendlyCallbackRouter } from "./routes/calendly-oauth.js";
import { jotformOAuthRouter, jotformCallbackRouter } from "./routes/jotform-oauth.js";
import { docusignOAuthRouter, docusignCallbackRouter } from "./routes/docusign-oauth.js";
import { egnyteOAuthRouter, egnyteCallbackRouter } from "./routes/egnyte-oauth.js";
import { miroOAuthRouter, miroCallbackRouter } from "./routes/miro-oauth.js";
import { webflowOAuthRouter, webflowCallbackRouter } from "./routes/webflow-oauth.js";
import { wixOAuthRouter, wixCallbackRouter } from "./routes/wix-oauth.js";
import { attioOAuthRouter, attioCallbackRouter } from "./routes/attio-oauth.js";
import { mailerliteOAuthRouter, mailerliteCallbackRouter } from "./routes/mailerlite-oauth.js";
import { honeycombOAuthRouter, honeycombCallbackRouter } from "./routes/honeycomb-oauth.js";
import { customerioOAuthRouter, customerioCallbackRouter } from "./routes/customerio-oauth.js";
import { rapidApiLinkedInRouter } from "./routes/rapidapi-linkedin.js";
import { scheduledJobsRouter } from "./routes/scheduled-jobs.js";
import { pendingQuestionsRouter } from "./routes/pending-questions.js";
import { settingsRouter } from "./routes/settings.js";
import { runsRouter } from "./routes/runs.js";
import { memoryRouter } from "./routes/memory.js";
import { digitalTwinRouter } from "./routes/digital-twin.js";
import { controlCenterRouter } from "./routes/control-center.js";
import { initScheduledJobsWorker, closeWorker } from "./queue/scheduled-jobs-worker.js";
import { closeQueue } from "./queue/scheduled-jobs-queue.js";
import { initRunRecoveryWorker, closeRunRecoveryWorker } from "./queue/run-recovery-worker.js";
import { initDigitalTwinBackfillWorker } from "./queue/digital-twin-backfill-worker.js";
import { closeBackfillQueue } from "./queue/digital-twin-backfill-queue.js";
import { bootstrapCustomTools } from "./bootstrap-tools.js";
import { initMemoryCron } from "./services/memoryCronService.js";
import { initDigitalTwinDaily } from "./services/digitalTwinDaily.js";
import {
  startBitbucketStatsBackgroundRefresh,
  stopBitbucketStatsBackgroundRefresh,
} from "./services/bitbucket-stats.js";

import { requireAuth, requireS2S } from "./middleware/require-auth.js";
import { redisService } from "./redis.js";

const app = express();
// Capture the raw request body so verify-spaces-signature middleware can
// HMAC-check inbound webhook bodies. express.json() consumes the stream
// otherwise; the verify callback gets the buffer before parsing.
app.use(express.json({
  limit: "50mb",
  verify: (req, _res, buf) => {
    if (buf && buf.length > 0) {
      (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  },
}));

app.get("/claw/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "xyne-claw-auth", uptime: process.uptime() });
});

const BASE = "/claw/api/v1";

app.use(`${BASE}/servers`, serversRouter);
app.use(`${BASE}/users`, requireAuth, usersRouter);
app.use(`${BASE}/users`, requireAuth, connectionsRouter);
app.use(`${BASE}/sessions`, mcpRouter);
app.use(`${BASE}/gateways`, requireAuth, gatewaysRouter);
app.use(`${BASE}/agents`, requireAuth, agentsRouter);
app.use(`${BASE}/chain-workflows`, requireAuth, chainWorkflowsRouter);
app.use(`${BASE}/spaces`, requireAuth, spacesRouter);
app.use(`${BASE}/tools`, requireAuth, toolsRouter);
app.use(`${BASE}/skills`, requireAuth, skillsRouter);
app.use(`${BASE}/subagents`, requireAuth, subagentsRouter);
app.use(`${BASE}/admin`, requireAuth, adminRouter);
// TEMPORARY — delete this mount + the import above + the file after backfill.
app.use(`${BASE}/admin`, requireAuth, adminBackfillSigningSecretsRouter);
app.use(`${BASE}/dashboard`, requireAuth, dashboardRouter);
app.use(`${BASE}/agent-chat`, requireAuth, agentChatRouter);
app.use(`${BASE}/internal/agent-chat`, requireS2S, agentChatInternalRouter); // progress/callback from xyne-claw
app.use(`${BASE}/internal/sessions`, requireS2S, sessionsArchiveRouter);     // archive/restore session JSONLs to GCS
app.use(`${BASE}/users`, requireAuth, googleOAuthRouter);
app.use(BASE, googleCallbackRouter);
app.use(`${BASE}/users`, requireAuth, microsoftOAuthRouter);
app.use(BASE, microsoftCallbackRouter);
app.use(`${BASE}/users`, requireAuth, calendlyOAuthRouter);
app.use(BASE, calendlyCallbackRouter);
app.use(`${BASE}/users`, requireAuth, jotformOAuthRouter);
app.use(BASE, jotformCallbackRouter);
app.use(`${BASE}/users`, requireAuth, docusignOAuthRouter);
app.use(BASE, docusignCallbackRouter);
app.use(`${BASE}/users`, requireAuth, egnyteOAuthRouter);
app.use(BASE, egnyteCallbackRouter);
// requireAuth on every `/users/...` OAuth initiation router so an
// unauthenticated request can't enumerate userIds and either start an
// OAuth flow on someone else's behalf or hit the `/:userId/oauth/*/token`
// endpoint to exfiltrate a stored access token. Matches the docusign /
// egnyte / calendly / jotform pattern above. The corresponding `/callback`
// routers stay unauthenticated because the OAuth provider hits them
// directly with no session cookie — they self-protect by verifying the
// `state` parameter against the in-flight session.
app.use(`${BASE}/users`, requireAuth, miroOAuthRouter);
app.use(BASE, miroCallbackRouter);
app.use(`${BASE}/users`, requireAuth, webflowOAuthRouter);
app.use(BASE, webflowCallbackRouter);
app.use(`${BASE}/users`, requireAuth, wixOAuthRouter);
app.use(BASE, wixCallbackRouter);
app.use(`${BASE}/users`, requireAuth, attioOAuthRouter);
app.use(BASE, attioCallbackRouter);
app.use(`${BASE}/users`, requireAuth, mailerliteOAuthRouter);
app.use(BASE, mailerliteCallbackRouter);
app.use(`${BASE}/users`, requireAuth, honeycombOAuthRouter);
app.use(BASE, honeycombCallbackRouter);
app.use(`${BASE}/users`, requireAuth, customerioOAuthRouter);
app.use(BASE, customerioCallbackRouter);
app.use(`${BASE}/users`, requireAuth, rapidApiLinkedInRouter);
app.use(BASE, runRouter);
app.use(`${BASE}/run/stream`, runStreamRouter);
app.use(`${BASE}/internal/run-stream`, requireS2S, runStreamInternalRouter);
app.use(`${BASE}/webhook`, webhookRouter);
app.use(`${BASE}/app`, appCallbackRouter);
app.use(`${BASE}/scheduled-jobs`, requireAuth, scheduledJobsRouter);
app.use(`${BASE}/pending-questions`, pendingQuestionsRouter);
app.use(`${BASE}/settings`, requireAuth, settingsRouter);
app.use(`${BASE}/runs`, requireAuth, runsRouter);
app.use(`${BASE}/memory`, memoryRouter);
app.use(`${BASE}/digital-twin`, digitalTwinRouter);
app.use(`${BASE}/control-center`, requireAuth, controlCenterRouter);

const server = app.listen(CONFIG.port, () => {
  console.log(`[xyne-claw-auth] Server listening on port ${CONFIG.port}`);
  // npx cache scrub: prior deploys left half-installed package trees in
  // ~/.npm/_npx (e.g. node-fetch present, data-uri-to-buffer missing),
  // which made every stdio MCP spawn (github, etc.) die with
  // ERR_MODULE_NOT_FOUND → "Connection closed". Wipe on boot so the
  // next npx -y re-downloads a complete tree.
  void (async () => {
    try {
      const { rm } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      const path = `${homedir()}/.npm/_npx`;
      await rm(path, { recursive: true, force: true });
      console.log(`[boot] scrubbed npx cache at ${path}`);
    } catch (err) {
      console.warn(`[boot] npx cache scrub failed:`, err);
    }
  })();
  initScheduledJobsWorker();
  initRunRecoveryWorker();
  initDigitalTwinBackfillWorker();
  initMemoryCron();
  initDigitalTwinDaily();
  // Upsert custom tools from the shared registry so newly added tools (e.g.
  // google-sheets-create, google-forms-create) show up in the agent UI on
  // restart without needing a manual POST /tools/sync call.
  void bootstrapCustomTools();
  // Jobs persist in Redis. A full Redis wipe loses schedulers; there is no
  // auto-reconcile from Postgres. If that ever happens, restore by iterating
  // active ScheduledJob rows and calling enqueueCronJob / enqueueDelayedJob.
  // Warm the Bitbucket-author stats cache (PR/commit counts for xyne-doctor)
  // so the admin dashboard's stat cards never serve a cold fetch.
  startBitbucketStatsBackgroundRefresh();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[xyne-claw-auth] ${signal}. Shutting down.`);
  stopBitbucketStatsBackgroundRefresh();
  await closeWorker().catch(() => {});
  await closeRunRecoveryWorker().catch(() => {});
  await closeQueue().catch(() => {});
  await closeBackfillQueue().catch(() => {});
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
