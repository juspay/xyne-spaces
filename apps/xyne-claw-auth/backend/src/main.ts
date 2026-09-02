import { createLogger } from "./logger.js";
const log = createLogger("main");

// Identify this process in structured logs (overridden by deployment env).
process.env.SERVICE_NAME ||= "xyne-claw-auth";

import express, { type Request, type Response } from "express";
import { CONFIG } from "./config.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorMiddleware } from "./lib/http.js";
import { serversRouter } from "./routes/servers.js";
import { connectionsRouter } from "./routes/connections.js";
import { mcpRouter } from "./routes/mcp.js";
import { awakeningRouter } from "./routes/awakening.js";
import { ensureTickScheduler, closeAwakeningQueues } from "./queue/awakening-queue.js";
import { initAwakeningTickWorker, closeAwakeningTickWorker } from "./queue/awakening-tick-worker.js";
import { initAwakeningWindowWorker, closeAwakeningWindowWorker } from "./queue/awakening-window-worker.js";
import { initAwakeningReflexWorker, closeAwakeningReflexWorker } from "./queue/awakening-reflex-worker.js";
import { runRouter } from "./routes/run.js";
import { runStreamRouter, runStreamInternalRouter } from "./routes/run-stream.js";
import { usersRouter } from "./routes/users.js";
import { gatewaysRouter } from "./routes/gateways.js";
import { webhookRouter } from "./routes/webhook.js";
import { flowActionRouter } from "./routes/flow-action.js";
import { twinDraftInternalRouter } from "./routes/twin-draft.js";
import { attachmentsInternalRouter } from "./routes/attachments.js";
import { appCallbackRouter } from "./routes/app-callback.js";
import { agentsRouter } from "./routes/agents.js";
import { chainWorkflowsRouter } from "./routes/chain-workflows.js";
import { spacesRouter } from "./routes/spaces.js";
import { toolsRouter } from "./routes/tools.js";
import { researchAgentRouter } from "./routes/research-agent.js";
import { skillsRouter } from "./routes/skills.js";
import { knowledgeBaseRouter } from "./routes/knowledge-base.js";
import subagentsRouter from "./routes/subagents.js";
import sandboxRouter from "./routes/sandbox.js";
import { adminRouter } from "./routes/admin.js";
import { adminDigitalTwinRouter } from "./routes/admin-digital-twin.js";
import { organizationsRouter } from "./routes/organizations.js";
// TEMPORARY — delete after backfill of agents.signingSecret is complete.
import { adminBackfillSigningSecretsRouter } from "./routes/admin-backfill-signing-secrets.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { agentChatRouter, agentChatInternalRouter } from "./routes/agent-chat.js";
import { artifactAppsRouter } from "./routes/artifact-apps.js";
import { artifactAppAgentsRouter } from "./routes/artifact-app-agents.js";
import { designSharesRouter, publicDesignSharesRouter } from "./routes/design-shares.js";
import { sessionsArchiveRouter } from "./routes/sessions-archive.js";
import { experimentsInternalRouter } from "./routes/experiments-internal.js";
import { errorPipelineIngestRouter, errorPipelineInternalRouter } from "./routes/error-pipeline.js";
import { ERROR_PIPELINE } from "./config.js";
import { runner as errorPipelineRunner } from "./error-pipeline/runner/runner.js";
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
import { oauthTokenRouter } from "./routes/oauth-token.js";
import { rapidApiLinkedInRouter } from "./routes/rapidapi-linkedin.js";
import { scheduledJobsRouter } from "./routes/scheduled-jobs.js";
import { dailyBriefRouter } from "./routes/daily-brief.js";
import { pendingQuestionsRouter } from "./routes/pending-questions.js";
import { ttsRouter } from "./routes/tts.js";
import { settingsRouter } from "./routes/settings.js";
import { beginLocalHarnessDrain, localHarnessBridgeRouter, localHarnessRouter } from "./routes/local-harness.js";
import { initLocalHarnessExpirySweep } from "./services/localHarnessExpiry.js";
import { runsRouter } from "./routes/runs.js";
import { metricsRouter } from "./routes/metrics.js";
import { memoryRouter } from "./routes/memory.js";
import { digitalTwinRouter } from "./routes/digital-twin.js";
import { controlCenterRouter } from "./routes/control-center.js";
import { evalsRouter } from "./routes/evals/index.js";
import { searchEvalsRouter } from "./routes/search-evals/index.js";
import { entityExtractionRouter } from "./routes/entity-extraction.js";
import { cliAuthRouter } from "./routes/cli-auth.js";
import { slackRouter } from "./surfaces/slack/routes/index.js";
import { mcpGatewayRouter } from "./mcpgateway/index.js";
import { initScheduledJobsWorker, closeWorker } from "./queue/scheduled-jobs-worker.js";
import { closeQueue } from "./queue/scheduled-jobs-queue.js";
import { initDailyBriefWorker, closeDailyBriefWorker } from "./queue/daily-brief-worker.js";
import { closeDailyBriefQueue } from "./queue/daily-brief-queue.js";
import { initDailyBriefCron } from "./services/dailyBriefCron.js";
import { initRunRecoveryWorker, closeRunRecoveryWorker } from "./queue/run-recovery-worker.js";
import { initProviderRetryWorker, closeProviderRetryWorker } from "./queue/provider-retry-worker.js";
import { initExperimentSupervisor, closeExperimentSupervisor } from "./queue/experiment-supervisor.js";
import { initDigitalTwinBackfillWorker } from "./queue/digital-twin-backfill-worker.js";
import { initAgentBackfillWorker, closeAgentBackfillWorker } from "./queue/agent-backfill-worker.js";
import { closeAgentBackfillQueue } from "./queue/agent-backfill-queue.js";
import { initEvalImportWorker, closeEvalImportWorker } from "./queue/eval-import-worker.js";
import { initEvalGenerationWorker, closeEvalGenerationWorker } from "./queue/eval-generation-worker.js";
import { initSearchEvalRunWorker, closeSearchEvalRunWorker } from "./queue/search-eval-run-worker.js";
import { initEntityExtractionWorker, closeEntityExtractionWorker } from "./queue/entity-extraction-worker.js";
import { closeEntityExtractionQueue } from "./queue/entity-extraction-queue.js";
import { initEvalJudgeWorker, closeEvalJudgeWorker } from "./queue/eval-judge-worker.js";
import { initFailureCuratorWorker, closeFailureCuratorWorker } from "./services/failure-curator-worker.js";
import { initOrphanFinalizerWorker, closeOrphanFinalizerWorker } from "./services/orphan-finalizer-worker.js";
import { closeBackfillQueue } from "./queue/digital-twin-backfill-queue.js";
import { bootstrapCustomTools } from "./bootstrap-tools.js";
import { initMemoryCron } from "./services/memoryCronService.js";
import { initSlackConfigTokenCron } from "./surfaces/slack/config-token-cron.js";
import { initDigitalTwinDaily } from "./services/digitalTwinDaily.js";
import {
  startBitbucketStatsBackgroundRefresh,
  stopBitbucketStatsBackgroundRefresh,
} from "./services/bitbucket-stats.js";
import { initializeOpenTelemetry, shutdownOpenTelemetry } from "./otel/telemetry.js";
import { registerDailyBriefGauges } from "./otel/daily-brief-metrics.js";

import { requireAuth, requireNoAccessToken, allowReadAccessToken, requireS2S, requireStrictS2S, requireInternalS2S, requireUserAuth, s2sKeyMatches } from "./middleware/require-auth.js";
import { requireClawAdmin, requireSearchEvalAccess } from "./middleware/agent-acl.js";
import { redisService } from "./redis.js";
import { connectDb } from "./db.js";

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
// Slack slash commands POST application/x-www-form-urlencoded; the signature
// is computed over the raw form body, so capture it the same way.
app.use(express.urlencoded({
  extended: false,
  limit: "1mb",
  verify: (req, _res, buf) => {
    if (buf && buf.length > 0) {
      (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  },
}));

// Per-request structured log context (requestId) + request start/end.
app.use(requestLogger);
// Identity-header firewall (defense-in-depth). A browser/client request must
// never assert its own identity: only an internal caller holding a valid S2S
// key may pin `x-user-id`. For everyone else we strip inbound `x-user-id` here,
// before any route or auth middleware runs, so a forged header can't reach a
// handler even if some route forgets to re-derive identity. The auth middlewares
// (requireAuth/requireUserAuth) set `x-user-id` from the verified Spaces session
// downstream. NOTE: the public ingress should ALSO strip x-user-id/x-s2s-key on
// inbound external traffic — this is the in-process backstop, not a replacement.
// x-s2s-key is intentionally NOT stripped: internal callers need it and it is
// already validated in constant time (see require-auth.ts).
app.use((req, _res, next) => {
  if (!s2sKeyMatches(req.headers["x-s2s-key"])) {
    delete req.headers["x-user-id"];
  }
  // Phase-2: `x-org-id` / `x-user-role` are ALWAYS server-derived (set by
  // attachOrgContext from the verified session) and are never a legitimate
  // inbound header — not even over S2S (verified: xyne-claw sends neither).
  // Strip them unconditionally here so org context is fail-closed uniformly,
  // including on requireStrictS2S / unauthenticated mounts. The per-auth-
  // middleware strips remain as defense-in-depth.
  delete req.headers["x-org-id"];
  delete req.headers["x-user-role"];
  next();
});

app.get("/claw/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "xyne-claw-auth", uptime: process.uptime() });
});

const BASE = "/claw/api/v1";

// Public bearer-link viewer. The secret arrives in x-design-share-token, not
// the URL, so request/access logs never capture it. Every route verifies the
// token hash and serves HTML under a CSP sandbox.
app.use(`${BASE}/public/design-shares`, publicDesignSharesRouter);

// MCP connector CRUD. requireUserAuth verifies a real Spaces session cookie and
// sets x-user-id from it — so a client-supplied x-user-id header is ignored and
// can't be forged. Was previously fully unauthenticated: anyone could POST a
// stdio connector whose launch command the gateway then spawned (RCE).
app.use(`${BASE}/servers`, requireUserAuth, serversRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, usersRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, connectionsRouter);
// NOT behind requireAuth (so requireNoAccessToken never runs here): every
// sub-path self-authenticates inside the router with requireStrictS2S +
// requireSessionToken (routes/mcp.ts) — the run's HMAC session token is the
// credential, not a user identity. Do NOT add requireAuth here expecting the
// access-token barrier to apply; add the guard inside the router instead.
app.use(`${BASE}/sessions`, mcpRouter);
app.use(`${BASE}/gateways`, requireAuth, requireNoAccessToken, requireClawAdmin, gatewaysRouter);
// allowReadAccessToken (NOT the hard barrier): device-flow CLI tokens are
// minted with agents:read (routes/cli-auth.ts) so the CLI can list agents.
// Reads (GET/HEAD) pass with that scope; token writes are still rejected.
app.use(`${BASE}/agents`, requireAuth, allowReadAccessToken("agents:read"), agentsRouter);
// NOT behind requireAuth (so requireNoAccessToken never runs here): the device
// -flow endpoints must be reachable pre-authentication, and each route carries
// its own guard (requireCliTokensEnabled / requireApproveAuth — routes/cli-auth.ts).
// This is also where CLI tokens are MINTED, so it must never require one.
app.use(`${BASE}/cli`, cliAuthRouter);
// Public Slack ingress; authenticates itself with the per-install HMAC secret.
app.use(`${BASE}/surfaces/slack`, slackRouter);
app.use(`${BASE}/chain-workflows`, requireAuth, requireNoAccessToken, chainWorkflowsRouter);
app.use(`${BASE}/spaces`, requireAuth, requireNoAccessToken, spacesRouter);
app.use(`${BASE}/tools`, requireAuth, requireNoAccessToken, toolsRouter);
app.use(`${BASE}/skills`, requireAuth, requireNoAccessToken, skillsRouter);
app.use(`${BASE}/knowledge-base`, requireAuth, requireNoAccessToken, knowledgeBaseRouter);
app.use(`${BASE}/subagents`, requireAuth, requireNoAccessToken, subagentsRouter);
app.use(`${BASE}/sandbox`, requireAuth, requireNoAccessToken, sandboxRouter);
app.use(`${BASE}/organizations`, requireAuth, requireNoAccessToken, organizationsRouter);
app.use(`${BASE}/admin/digital-twin`, requireAuth, requireNoAccessToken, requireClawAdmin, adminDigitalTwinRouter);
app.use(`${BASE}/admin`, requireAuth, requireNoAccessToken, adminRouter);
// TEMPORARY — delete this mount + the import above + the file after backfill.
app.use(`${BASE}/admin`, requireAuth, requireNoAccessToken, adminBackfillSigningSecretsRouter);
app.use(`${BASE}/dashboard`, requireAuth, requireNoAccessToken, dashboardRouter);
app.use(`${BASE}/agent-chat`, requireAuth, requireNoAccessToken, agentChatRouter);
app.use(`${BASE}/artifact-apps`, requireAuth, artifactAppsRouter);
app.use(`${BASE}/artifact-app-agents`, requireAuth, artifactAppAgentsRouter);
app.use(`${BASE}/design-shares`, requireAuth, requireNoAccessToken, designSharesRouter);
app.use(`${BASE}/daily-brief`, requireAuth, requireNoAccessToken, dailyBriefRouter);
app.use(`${BASE}/internal/agent-chat`, requireStrictS2S, agentChatInternalRouter); // progress/callback from xyne-claw
app.use(`${BASE}/internal/twin-draft`, requireInternalS2S, twinDraftInternalRouter);  // Spaces → approve/decline an in-thread Twin reply draft (INTERNAL_S2S_KEY)
app.use(`${BASE}/internal/attachments`, requireInternalS2S, attachmentsInternalRouter); // Spaces → extract document text via claw's converters (INTERNAL_S2S_KEY)
app.use(`${BASE}/internal/sessions`, requireStrictS2S, sessionsArchiveRouter);     // archive/restore session JSONLs to GCS — S2S only (transcripts)
app.use(`${BASE}/internal/experiments`, requireStrictS2S, experimentsInternalRouter);
app.use(`${BASE}/error-pipeline`, errorPipelineIngestRouter); // Grafana webhook ingest (JWT-authed inside)
app.use(`${BASE}/internal/error-pipeline`, requireStrictS2S, errorPipelineInternalRouter); // run-result callback from xyne-claw (S2S only)
app.use(`${BASE}/internal/tts`, requireStrictS2S, ttsRouter);
// Generic live OAuth-token read for every connector — GET /users/:userId/oauth/:provider/token.
// Mounted before the per-provider routers (which now only serve authorize/callback)
// so it owns the `/token` path. Same requireAuth guard; the handler additionally
// requires the run's HMAC session token. See routes/oauth-token.ts.
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, oauthTokenRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, googleOAuthRouter);
app.use(BASE, googleCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, microsoftOAuthRouter);
app.use(BASE, microsoftCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, calendlyOAuthRouter);
app.use(BASE, calendlyCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, jotformOAuthRouter);
app.use(BASE, jotformCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, docusignOAuthRouter);
app.use(BASE, docusignCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, egnyteOAuthRouter);
app.use(BASE, egnyteCallbackRouter);
// requireAuth on every `/users/...` OAuth initiation router so an
// unauthenticated request can't enumerate userIds and either start an
// OAuth flow on someone else's behalf or hit the `/:userId/oauth/*/token`
// endpoint to exfiltrate a stored access token. Matches the docusign /
// egnyte / calendly / jotform pattern above. The corresponding `/callback`
// routers stay unauthenticated because the OAuth provider hits them
// directly with no session cookie — they self-protect by verifying the
// `state` parameter against the in-flight session.
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, miroOAuthRouter);
app.use(BASE, miroCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, webflowOAuthRouter);
app.use(BASE, webflowCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, wixOAuthRouter);
app.use(BASE, wixCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, attioOAuthRouter);
app.use(BASE, attioCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, mailerliteOAuthRouter);
app.use(BASE, mailerliteCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, honeycombOAuthRouter);
app.use(BASE, honeycombCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, customerioOAuthRouter);
app.use(BASE, customerioCallbackRouter);
app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, rapidApiLinkedInRouter);
// DELIBERATE requireNoAccessToken exception: /run is the ONE route that
// understands CLI/service-token scopes and enforces them itself (agent
// allowlist + elevated-delivery scope — see routes/run.ts, `accessToken` in
// res.locals). Every other requireAuth mount carries the barrier. Do not "fix"
// this asymmetry by adding the barrier — it would break every service token.
app.use(`${BASE}/internal`, requireStrictS2S, runRouter);
// IMPORTANT: more-specific runStreamRouter MUST be mounted BEFORE the broader
// runRouter at BASE. runRouter has `POST /run/:sessionId/cancel`, which would
// otherwise match `POST /claw/api/v1/run/stream/cancel` with sessionId="stream"
// and shadow the dedicated cancel handler in run-stream.ts. Mounting the
// longer prefix first lets Express dispatch the right router.
app.use(`${BASE}/run/stream`, runStreamRouter);
app.use(`${BASE}/internal/run-stream`, requireStrictS2S, runStreamInternalRouter);
app.use(BASE, runRouter);
// Awakening: the result callback self-protects with requireStrictS2S and the
// status route carries its own admin gate, so no mount-level auth here.
app.use(BASE, awakeningRouter);
// No mount-level auth on /webhook by design: it mixes auth schemes per route.
// POST / , /result and /progress are S2S callbacks; POST /:agentSlug is hit
// directly by Spaces and self-protects via verifySpacesSignature (per-agent
// HMAC over the raw body). Any new route added to webhookRouter MUST carry
// its own auth middleware explicitly.
app.use(`${BASE}/webhook`, webhookRouter);
// Flow UI action webhook. Reached only via the signature-verified webhook
// /:agentSlug proxy. requireStrictS2S keeps it unreachable by external/browser
// callers, and the route itself re-verifies the forwarded Spaces signature
// (see flow-action.ts) so the body-supplied userId is bound to a payload
// Spaces signed — an S2S key alone is no longer enough to forge identity.
app.use(`${BASE}/flow`, requireStrictS2S, flowActionRouter);
app.use(`${BASE}/scheduled-jobs`, requireAuth, requireNoAccessToken, scheduledJobsRouter);
// Strict S2S: the ask-question tool stores questions here with the S2S key;
// flow-action consumes them through the module's atomic Redis helper.
app.use(`${BASE}/pending-questions`, requireStrictS2S, pendingQuestionsRouter);
app.use(`${BASE}/settings`, requireAuth, requireNoAccessToken, settingsRouter);
// Local harness: device management is user-authed; the bridge router is
// device-token authed inside (requireDevice) and rate-limited per device.
app.use(`${BASE}/local-harness`, requireUserAuth, localHarnessRouter);
app.use(`${BASE}/local-harness-bridge`, localHarnessBridgeRouter);
// allowReadAccessToken (NOT the hard barrier): CLI tokens carry runs:read so
// the CLI can list/search/fetch its own runs (GET /runs/light, /runs/search,
// /runs/:id). Reads pass with the scope; token writes are still rejected.
app.use(`${BASE}/runs`, requireAuth, allowReadAccessToken("runs:read"), runsRouter);
app.use(`${BASE}/metrics`, requireAuth, requireNoAccessToken, metricsRouter);
// Mount-level baseline auth (defense-in-depth): every memory route also has
// stricter per-route middleware (requireUserAuth / requireClawAdmin), but a
// future route that forgets it must still fail closed at the mount. requireAuth
// (not requireUserAuth) because /recall-hits is an S2S callback from xyne-claw.
// The per-request memoization in require-auth.ts makes the second layer free.
app.use(`${BASE}/memory`, requireAuth, requireNoAccessToken, memoryRouter);
app.use(`${BASE}/digital-twin`, requireUserAuth, digitalTwinRouter);
app.use(`${BASE}/control-center`, requireAuth, requireNoAccessToken, controlCenterRouter);
app.use(`${BASE}/research-agent`, requireAuth, requireNoAccessToken, researchAgentRouter);
app.use(`${BASE}/evals`, requireAuth, requireNoAccessToken, requireClawAdmin, evalsRouter);
app.use(`${BASE}/search-evals`, requireAuth, requireNoAccessToken, requireSearchEvalAccess, searchEvalsRouter);
// A run reads a whole channel with no per-user ACL guard — operator action only.
app.use(`${BASE}/entity-extraction`, requireAuth, requireNoAccessToken, requireClawAdmin, entityExtractionRouter);

// MCP Gateway routes (for backend service registration)
// NOT behind requireAuth (so requireNoAccessToken never runs here): gateway
// routes authenticate per-route with gatewayTenantAuth + gatewayRegistrationAuth
// (mcpgateway/middleware/gateway-auth.ts) against the registration API key.
app.use(`${BASE}/gateway`, mcpGatewayRouter);
app.use(errorMiddleware);

initializeOpenTelemetry();
registerDailyBriefGauges();

const server = app.
listen(CONFIG.port, () => {
  log.info(`[xyne-claw-auth] Server listening on port ${CONFIG.port}`);

  void connectDb().catch(err => {
    log.error('[xyne-claw-auth] Database warmup failed:', err);
  });
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
      log.info(`[boot] scrubbed npx cache at ${path}`);
    } catch (err) {
      log.warn(`[boot] npx cache scrub failed:`, err);
    }
  })();

  if (ERROR_PIPELINE.isRunnerPod) {
    log.info("[boot] runner pod — starting pipeline workers, skipping all other background workers/crons");
    errorPipelineRunner.start();
  } else {
    // Normal API pod: the full background fleet, no runner.
    initScheduledJobsWorker();
    initRunRecoveryWorker();
    initProviderRetryWorker();
    initExperimentSupervisor();
    initDigitalTwinBackfillWorker();
    initAgentBackfillWorker();
    initEvalImportWorker();
    initEvalGenerationWorker();
    initEvalJudgeWorker();
    initSearchEvalRunWorker();
    initEntityExtractionWorker();
    initMemoryCron();
    initSlackConfigTokenCron();
    initDigitalTwinDaily();
    // Daily Brief: bounded worker (caps concurrent LLM runs) + leader-locked
    // enqueue cron (fans out opted-in users once/day). See services/dailyBrief*.
    initDailyBriefWorker();
    initDailyBriefCron();
    initFailureCuratorWorker();
    initOrphanFinalizerWorker();
    // Awakened agents: one fleet-wide tick fans out to per-agent window jobs.
    // ensureTickScheduler is idempotent, so every pod calling it converges on
    // a single scheduler — which is also what makes a Redis wipe self-heal on
    // the next boot instead of silently stopping every awakened agent.
    initAwakeningTickWorker();
    initAwakeningWindowWorker();
    initAwakeningReflexWorker();
    void ensureTickScheduler().catch((err) =>
      log.error("[boot] awakening tick scheduler registration failed:", err),
    );
    initLocalHarnessExpirySweep();
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
  }
});

async function shutdown(signal: string): Promise<void> {
  log.info(`[xyne-claw-auth] ${signal}. Shutting down.`);
  if (ERROR_PIPELINE.isRunnerPod) {
    errorPipelineRunner.stop();
  } else {
    // API pod: drain the background fleet (none of it ran on the runner pod).
    // Stop parking new local-harness long-polls first so in-flight bridge
    // connections return idle and the pod can exit without dropping a run.
    beginLocalHarnessDrain();
    stopBitbucketStatsBackgroundRefresh();
    await closeWorker().catch(() => {});
    await closeRunRecoveryWorker().catch(() => {});
    await closeProviderRetryWorker().catch(() => {});
    closeExperimentSupervisor();
    await closeEvalImportWorker().catch(() => {});
    await closeEvalGenerationWorker().catch(() => {});
    await closeEvalJudgeWorker().catch(() => {});
    await closeSearchEvalRunWorker().catch(() => {});
    await closeEntityExtractionWorker().catch(() => {});
    await closeEntityExtractionQueue().catch(() => {});
    closeFailureCuratorWorker();
    closeOrphanFinalizerWorker();
    await closeAwakeningTickWorker().catch(() => {});
    await closeAwakeningWindowWorker().catch(() => {});
    await closeAwakeningReflexWorker().catch(() => {});
    await closeAwakeningQueues().catch(() => {});
    await closeQueue().catch(() => {});
    await closeDailyBriefWorker().catch(() => {});
    await closeDailyBriefQueue().catch(() => {});
    await closeBackfillQueue().catch(() => {});
    await closeAgentBackfillWorker().catch(() => {});
    await closeAgentBackfillQueue().catch(() => {});
  }
  await redisService.disconnect().catch(() => {});
  await shutdownOpenTelemetry().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err: Error) => {
  log.error("[xyne-claw-auth] Uncaught exception — draining connections:", err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("[xyne-claw-auth] Unhandled rejection:", reason);
});

export { app };
