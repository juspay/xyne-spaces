import { type Express, type NextFunction, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { requestLogger } from "../middleware/requestLogger.js";
import { errorMiddleware } from "../lib/http.js";
import { serversRouter } from "../routes/servers.js";
import { connectionsRouter } from "../routes/connections.js";
import { mcpRouter } from "../routes/mcp.js";
import { sdlcRuntimeCredentialsRouter } from "../routes/sdlc-runtime-credentials.js";
import { awakeningRouter } from "../routes/awakening.js";
import { runRouter } from "../routes/run.js";
import { runStreamRouter, runStreamInternalRouter } from "../routes/run-stream.js";
import { usersRouter } from "../routes/users.js";
import { spacesSyncRouter } from "../routes/spaces-sync.js";
import { gatewaysRouter } from "../routes/gateways.js";
import { webhookRouter } from "../routes/webhook.js";
import { agentFlowActionRouter, flowActionRouter } from "../routes/flow-action.js";
import { twinDraftInternalRouter } from "../routes/twin-draft-internal.js";
import { attachmentsInternalRouter } from "../routes/attachments.js";
import { appConnectorsInternalRouter } from "../routes/app-connectors-internal.js";
import { agentsInternalRouter } from "../routes/agents-internal.js";
import { agentsRouter } from "../routes/agents.js";
import { chainWorkflowsRouter } from "../routes/chain-workflows.js";
import { spacesRouter } from "../routes/spaces.js";
import { toolsRouter } from "../routes/tools.js";
import { researchAgentRouter } from "../routes/research-agent.js";
import { skillsRouter } from "../routes/skills.js";
import { gatewayRegistryUiRouter } from "../routes/gateway-registry-ui.js";
import { knowledgeBaseRouter } from "../routes/knowledge-base.js";
import subagentsRouter from "../routes/subagents.js";
import sandboxRouter from "../routes/sandbox.js";
import sandboxAccessRouter from "../routes/sandbox-access.js";
import { adminRouter } from "../routes/admin.js";
import { extension } from "./extension.js";
import { adminDigitalTwinRouter } from "../routes/admin-digital-twin.js";
import { adminSandboxReposRouter } from "../routes/admin-sandbox-repos.js";
import { sandboxReposInternalRouter } from "../routes/sandbox-repos-internal.js";
import { sandboxProfilesInternalRouter } from "../routes/sandbox-profiles-internal.js";
import { organizationsRouter } from "../routes/organizations.js";
// TEMPORARY — delete after backfill of agents.signingSecret is complete.
// TEMPORARY — delete this import + its mount + the file once XYNE-66817's
// backfill has run everywhere and `agent.config.designSystem` is dropped.
import { adminBackfillDesignSystemsRouter } from "../routes/admin-backfill-design-systems.js";
import { dashboardRouter } from "../routes/dashboard.js";
import { messagingRouter } from "../surfaces/messaging/routes/index.js";
import { agentChatRouter, agentChatInternalRouter } from "../routes/agent-chat.js";
import { agentWarmRouter, agentWarmInternalRouter } from "../routes/agent-warm.js";
import { artifactAppsRouter } from "../routes/artifact-apps.js";
import { designSystemsRouter } from "../routes/design-systems.js";
import { artifactAppAgentsRouter } from "../routes/artifact-app-agents.js";
import { artifactAppStorageRouter, storageBearerAuthBridge } from "../routes/artifact-app-storage.js";
import { designSharesRouter, publicDesignSharesRouter } from "../routes/design-shares.js";
import { conversationArtifactsRouter } from "../routes/conversation-artifacts.js";
import { sessionsArchiveRouter } from "../routes/sessions-archive.js";
import { surfaceInternalRouter } from "../routes/surface-internal.js";
import { pagePanelRouter } from "../routes/page-panel.js";
import { experimentsInternalRouter } from "../routes/experiments-internal.js";
import { errorPipelineIngestRouter, errorPipelineInternalRouter } from "../routes/error-pipeline.js";
import { connectorsInternalRouter } from "../routes/connectors-internal.js";
import { providersInternalRouter } from "../routes/providers-internal.js";
import { agentCreateCheckRouter } from "../routes/agent-create-check.js";
import { googleOAuthRouter, googleCallbackRouter } from "../routes/google-oauth.js";
import { microsoftOAuthRouter, microsoftCallbackRouter } from "../routes/microsoft-oauth.js";
import { calendlyOAuthRouter, calendlyCallbackRouter } from "../routes/calendly-oauth.js";
import { jotformOAuthRouter, jotformCallbackRouter } from "../routes/jotform-oauth.js";
import { docusignOAuthRouter, docusignCallbackRouter } from "../routes/docusign-oauth.js";
import { egnyteOAuthRouter, egnyteCallbackRouter } from "../routes/egnyte-oauth.js";
import { miroOAuthRouter, miroCallbackRouter } from "../routes/miro-oauth.js";
import { webflowOAuthRouter, webflowCallbackRouter } from "../routes/webflow-oauth.js";
import { clickupOAuthRouter, clickupCallbackRouter } from "../routes/clickup-oauth.js";
import { wixOAuthRouter, wixCallbackRouter } from "../routes/wix-oauth.js";
import { attioOAuthRouter, attioCallbackRouter } from "../routes/attio-oauth.js";
import { mailerliteOAuthRouter, mailerliteCallbackRouter } from "../routes/mailerlite-oauth.js";
import { honeycombOAuthRouter, honeycombCallbackRouter } from "../routes/honeycomb-oauth.js";
import { customerioOAuthRouter, customerioCallbackRouter } from "../routes/customerio-oauth.js";
import { notionRemoteOAuthRouter, notionRemoteCallbackRouter } from "../routes/notion-remote-oauth.js";
import { sentryRemoteOAuthRouter, sentryRemoteCallbackRouter } from "../routes/sentry-remote-oauth.js";
import { mixpanelRemoteOAuthRouter, mixpanelRemoteCallbackRouter } from "../routes/mixpanel-remote-oauth.js";
import { firefliesRemoteOAuthRouter, firefliesRemoteCallbackRouter } from "../routes/fireflies-remote-oauth.js";
import { atlassianRemoteOAuthRouter, atlassianRemoteCallbackRouter } from "../routes/atlassian-remote-oauth.js";
import { oauthTokenRouter } from "../routes/oauth-token.js";
import { rapidApiLinkedInRouter } from "../routes/rapidapi-linkedin.js";
import { scheduledJobsRouter } from "../routes/scheduled-jobs.js";
import { dailyBriefRouter } from "../routes/daily-brief.js";
import { proactiveInboxRouter, gmailPushRouter } from "../routes/proactive-inbox.js";
import { pendingQuestionsRouter } from "../routes/pending-questions.js";
import { ttsRouter } from "../routes/tts.js";
import { settingsRouter } from "../routes/settings.js";
import { localHarnessBridgeRouter, localHarnessRouter } from "../routes/local-harness.js";
import { runsRouter } from "../routes/runs.js";
import { metricsRouter } from "../routes/metrics.js";
import { metricsToolsRouter } from "../routes/metrics-tools.js";
import { memoryRouter } from "../routes/memory.js";
import { agentIndexRouter } from "../routes/agent-index.js";
import { toolIndexRouter } from "../routes/tool-index.js";
import { digitalTwinRouter } from "../routes/digital-twin.js";
import { controlCenterRouter } from "../routes/control-center.js";
import { evalsRouter } from "../routes/evals/index.js";
import { searchEvalsRouter } from "../routes/search-evals/index.js";
import { entityExtractionRouter } from "../routes/entity-extraction.js";
import { cliAuthRouter } from "../routes/cli-auth.js";
import { slackRouter } from "../surfaces/slack/routes/index.js";
import { mcpGatewayRouter } from "../mcpgateway/index.js";
import { requireAuth, requireNoAccessToken, allowReadAccessToken, allowScopedAccessToken, requireUserAuth, optionalAuth } from "../middleware/require-auth.js";
import { requireClawAdmin, requireSearchEvalAccess } from "../middleware/agent-acl.js";
import { apiLimiter, sampleClientIp, isUnlimitedSpacesCall } from "../middleware/rate-limiters.js";
import { requireAnyService, requireRuntime, requireSpacesService } from "../lib/service-assertion.js";

const SIGNED_INGRESS_PREFIXES = ["/webhook"] as const;

const BASE = "/claw/api/v1";

function mountRequestContext(app: Express): void {
  // Per-request structured log context (requestId) + request start/end.
  app.use(requestLogger);
  // No caller may name a user by header: identity comes only from a verified
  // Spaces session, a CLI token, a Spaces delegation token or a run token (each
  // auth middleware sets x-user-id from that). Strip any inbound x-user-id here,
  // before any route runs, so a forged header can't reach a handler even if a
  // route forgets to re-derive identity.
  app.use((req, _res, next) => {
    delete req.headers["x-user-id"];
    // `x-org-id` / `x-user-role` are always server-derived (attachOrgContext).
    delete req.headers["x-org-id"];
    delete req.headers["x-user-role"];
    next();
  });

  app.get("/claw/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "xyne-claw-auth", uptime: process.uptime() });
  });

  app.use(BASE, (req: Request, res: Response, next: NextFunction) => {
    if (SIGNED_INGRESS_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      next();
      return;
    }
    sampleClientIp(req);
    if (isUnlimitedSpacesCall(req)) {
      next();
      return;
    }
    apiLimiter(req, res, next);
  });
}

function mountCoreApi(app: Express): void {
  // Public bearer-link viewer. The secret arrives in x-design-share-token, not
  // the URL, so request/access logs never capture it. Every route verifies the
  // token hash and serves HTML under a CSP sandbox.
  // optionalAuth resolves the Spaces session cookie when one is present and
  // stamps x-user-id/x-org-id, but never rejects: `design` shares stay anonymous
  // while `review_room` shares additionally require org membership in-router.
  app.use(`${BASE}/public/design-shares`, optionalAuth, publicDesignSharesRouter);

  // MCP connector CRUD. requireUserAuth verifies a real Spaces session cookie and
  // sets x-user-id from it — so a client-supplied x-user-id header is ignored and
  // can't be forged. Was previously fully unauthenticated: anyone could POST a
  // stdio connector whose launch command the gateway then spawned (RCE).
  app.use(`${BASE}/servers`, requireUserAuth, serversRouter);
  app.use(`${BASE}/surface`, requireUserAuth, pagePanelRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, usersRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, connectionsRouter);
  // NOT behind requireAuth (so requireNoAccessToken never runs here): every
  // sub-path self-authenticates inside the router with a runtime service assertion +
  // requireSessionToken (routes/mcp.ts) — the run's HMAC session token is the
  // credential, not a user identity. Do NOT add requireAuth here expecting the
  // access-token barrier to apply; add the guard inside the router instead.
  app.use(`${BASE}/sessions`, mcpRouter);
  app.use(`${BASE}/sessions`, sdlcRuntimeCredentialsRouter);
  app.use(`${BASE}/gateways`, requireAuth, requireNoAccessToken, requireClawAdmin, gatewaysRouter);
  // allowReadAccessToken (NOT the hard barrier): device-flow CLI tokens are
  // minted with agents:read (routes/cli-auth.ts) so the CLI can list agents.
  // Reads (GET/HEAD) pass with that scope; token writes are still rejected.
  app.use(`${BASE}/agents`, requireAuth, allowScopedAccessToken({ read: "agents:read", write: "agents:write" }), agentsRouter);
  // NOT behind requireAuth (so requireNoAccessToken never runs here): the device
  // -flow endpoints must be reachable pre-authentication, and each route carries
  // its own guard (requireCliTokensEnabled / requireApproveAuth — routes/cli-auth.ts).
  // This is also where CLI tokens are MINTED, so it must never require one.
  app.use(`${BASE}/cli`, cliAuthRouter);
  // Public Slack ingress; authenticates itself with the per-install HMAC secret.
  app.use(`${BASE}/surfaces/slack`, slackRouter);
  // Messaging channels (WhatsApp, Telegram, …): admin API is user-authed inside
  // the router; the per-account webhook ingress self-authenticates per plugin.
  app.use(`${BASE}/surfaces/:channel`, messagingRouter);
  // Off: Spaces thread mentions only (2026-11-12).
  // app.use(`${BASE}/chain-workflows`, requireAuth, requireNoAccessToken, chainWorkflowsRouter);
  app.use(`${BASE}/spaces`, requireAuth, requireNoAccessToken, spacesRouter);
  app.use(`${BASE}/tools`, requireAuth, requireNoAccessToken, toolsRouter);
  app.use(`${BASE}/skills`, requireAuth, allowScopedAccessToken({ write: "skills:write" }), skillsRouter);
  // Session-authed UI surface over the MCP Gateway registry (the gateway's own
  // registration key stays server-side; see routes/gateway-registry-ui.ts). Distinct
  // from the `${BASE}/gateway` router below, which external services call.
  app.use(`${BASE}/gateway-registry`, requireAuth, requireNoAccessToken, gatewayRegistryUiRouter);
  app.use(`${BASE}/knowledge-base`, requireAuth, requireNoAccessToken, knowledgeBaseRouter);
  app.use(`${BASE}/subagents`, requireAuth, allowScopedAccessToken({ write: "subagents:write" }), subagentsRouter);
  app.use(`${BASE}/sandbox-access`, requireUserAuth, sandboxAccessRouter); // sandbox-router → may this Spaces session open /claw-preview|code|term/<sandboxId>?
  app.use(`${BASE}/sandbox`, requireAuth, requireNoAccessToken, sandboxRouter);
  app.use(`${BASE}/organizations`, requireAuth, requireNoAccessToken, organizationsRouter);
  app.use(`${BASE}/admin/digital-twin`, requireAuth, requireNoAccessToken, requireClawAdmin, adminDigitalTwinRouter);
  app.use(`${BASE}/admin/sandbox-repos`, requireAuth, requireNoAccessToken, requireClawAdmin, adminSandboxReposRouter);
  app.use(`${BASE}/admin`, requireAuth, requireNoAccessToken, adminRouter);
  extension?.mount(app, { base: BASE, requireAuth, requireNoAccessToken });
  app.use(`${BASE}/admin`, requireAuth, requireNoAccessToken, adminBackfillDesignSystemsRouter);
  app.use(`${BASE}/dashboard`, requireAuth, requireNoAccessToken, dashboardRouter);
  app.use(`${BASE}/agent-chat`, requireAuth, requireNoAccessToken, agentChatRouter);
  app.use(`${BASE}/agent-warm`, requireAuth, requireNoAccessToken, agentWarmRouter);
  app.use(`${BASE}/artifact-apps`, requireAuth, artifactAppsRouter);
  app.use(`${BASE}/design-systems`, requireAuth, requireNoAccessToken, designSystemsRouter);
  app.use(`${BASE}/artifact-app-agents`, requireAuth, artifactAppAgentsRouter);
  // storageBearerAuthBridge runs first: bare-Bearer SDK calls get the token's
  // own workspaceId claim turned into the cookie form requireAuth expects.
  // Scoped to this path only — requireAuth itself is untouched.
  app.use(`${BASE}/artifact-app-storage`, storageBearerAuthBridge, requireAuth, artifactAppStorageRouter);
  app.use(`${BASE}/design-shares`, requireAuth, requireNoAccessToken, designSharesRouter);
  app.use(`${BASE}/conversation-artifacts`, requireAuth, requireNoAccessToken, conversationArtifactsRouter);
  app.use(`${BASE}/daily-brief`, requireAuth, requireNoAccessToken, dailyBriefRouter);
  app.use(`${BASE}/proactive-inbox`, requireAuth, requireNoAccessToken, proactiveInboxRouter);
  app.use(`${BASE}/public/gmail-push`, gmailPushRouter);
  app.use(`${BASE}/internal/agent-chat`, requireRuntime, agentChatInternalRouter); // progress/callback from xyne-claw
  app.use(`${BASE}/internal/agent-warm`, requireRuntime, agentWarmInternalRouter);
  app.use(`${BASE}/internal/twin-draft`, requireSpacesService, twinDraftInternalRouter);  // Spaces → approve/decline an in-thread Twin reply draft (Spaces service assertion)
  app.use(`${BASE}/internal/attachments`, requireAnyService, attachmentsInternalRouter); // Spaces → extract document text via claw's converters (Spaces service assertion)
  app.use(`${BASE}/internal/agents`, requireSpacesService, agentsInternalRouter); // Spaces → is this app a Claw agent? decides AGENT vs APP at install (Spaces service assertion)
  app.use(`${BASE}/internal/app-connectors`, requireSpacesService, appConnectorsInternalRouter); // Spaces → sdk.connectors: run the viewer's own MCP connection for an artifact app (Spaces service assertion)
  app.use(`${BASE}/internal/surface`, requireRuntime, surfaceInternalRouter);       // app-control calls from xyne-claw → the user's desktop window
  app.use(`${BASE}/internal/sessions`, requireRuntime, sessionsArchiveRouter);     // archive/restore session JSONLs to GCS — runtime only (transcripts)
  // Spaces → org/workspace/user provisioning. The Spaces provisioning worker
  // authenticates with a Spaces service assertion and drives the
  // org/workspace/user upserts — see services/clawSpacesSyncClient.ts in Spaces.
  app.use(`${BASE}/internal/spaces-sync`, requireSpacesService, spacesSyncRouter);
  // Off: Spaces thread mentions only (2026-11-12).
  // app.use(`${BASE}/internal/experiments`, requireRuntime, experimentsInternalRouter);
  app.use(`${BASE}/error-pipeline`, errorPipelineIngestRouter); // Grafana webhook ingest (JWT-authed inside)
  app.use(`${BASE}/internal/error-pipeline`, requireRuntime, errorPipelineInternalRouter); // run-result callback from xyne-claw (runtime only)
  app.use(`${BASE}/internal/tts`, requireAnyService, ttsRouter);
  app.use(`${BASE}/internal/sandbox-repos`, requireRuntime, sandboxReposInternalRouter);
  app.use(`${BASE}/internal/sandbox-profiles`, requireSpacesService, sandboxProfilesInternalRouter); // Spaces → sandbox profile editor
  app.use(`${BASE}/internal/connectors`, requireRuntime, connectorsInternalRouter); // connector availability lookup for xyne-claw (runtime only)
  app.use(`${BASE}/internal/providers`, requireRuntime, providersInternalRouter); // AI provider availability lookup for xyne-claw (runtime only)
  app.use(`${BASE}/internal/agent-create`, requireRuntime, agentCreateCheckRouter);
}

function mountOAuthProviders(app: Express): void {
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
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, clickupOAuthRouter);
  app.use(BASE, clickupCallbackRouter);
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
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, notionRemoteOAuthRouter);
  app.use(BASE, notionRemoteCallbackRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, sentryRemoteOAuthRouter);
  app.use(BASE, sentryRemoteCallbackRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, mixpanelRemoteOAuthRouter);
  app.use(BASE, mixpanelRemoteCallbackRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, firefliesRemoteOAuthRouter);
  app.use(BASE, firefliesRemoteCallbackRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, atlassianRemoteOAuthRouter);
  app.use(BASE, atlassianRemoteCallbackRouter);
  app.use(`${BASE}/users`, requireAuth, requireNoAccessToken, rapidApiLinkedInRouter);
}

function mountRunAndWebhooks(app: Express): void {
  // DELIBERATE requireNoAccessToken exception: /run is the ONE route that
  // understands CLI/service-token scopes and enforces them itself (agent
  // allowlist + elevated-delivery scope — see routes/run.ts, `accessToken` in
  // res.locals). Every other requireAuth mount carries the barrier. Do not "fix"
  // this asymmetry by adding the barrier — it would break every service token.
  app.use(`${BASE}/internal`, requireAnyService, runRouter);
  // IMPORTANT: more-specific runStreamRouter MUST be mounted BEFORE the broader
  // runRouter at BASE. runRouter has `POST /run/:sessionId/cancel`, which would
  // otherwise match `POST /claw/api/v1/run/stream/cancel` with sessionId="stream"
  // and shadow the dedicated cancel handler in run-stream.ts. Mounting the
  // longer prefix first lets Express dispatch the right router.
  app.use(`${BASE}/run/stream`, runStreamRouter);
  app.use(`${BASE}/internal/run-stream`, requireRuntime, runStreamInternalRouter);
  app.use(BASE, runRouter);
  // Awakening: the result callback self-protects with requireRuntime and the
  // status route carries its own admin gate, so no mount-level auth here.
  // Off: Spaces thread mentions only (2026-11-12).
  // app.use(BASE, awakeningRouter);
  // No mount-level auth on /webhook by design: it mixes auth schemes per route.
  // /result and /progress are runtime callbacks (service assertion + run token);
  // /pr-event comes from Spaces; POST /agent/:principalId is hit directly by
  // Spaces and self-protects with its signed event token. Any new route added to
  // webhookRouter MUST carry its own auth middleware explicitly.
  app.use(`${BASE}/webhook`, webhookRouter);
  // Flow UI action webhook. Reached only through claw-auth's own signed proxy hop;
  // requireRuntime keeps it unreachable by external/browser callers, and the
  // route re-verifies the forwarded Spaces signature (see flow-action.ts) so the
  // body-supplied userId is bound to a payload Spaces signed.
  // Clicks on cards a Claw agent posted: Spaces calls this directly with a
  // signed, single-use event token (flow-action.ts verifyAgentFlowClick).
  // Must stay above the service-gated /flow mount.
  app.use(`${BASE}/flow/agent`, agentFlowActionRouter);
  app.use(`${BASE}/flow`, requireRuntime, flowActionRouter);
  // Off: Spaces thread mentions only (2026-11-12).
  // app.use(`${BASE}/scheduled-jobs`, requireAuth, requireNoAccessToken, scheduledJobsRouter);
  // Runtime only: the ask-question tool stores questions here (service assertion);
  // flow-action consumes them through the module's atomic Redis helper.
  app.use(`${BASE}/pending-questions`, requireRuntime, pendingQuestionsRouter);
}

function mountWorkspace(app: Express): void {
  app.use(`${BASE}/settings`, requireAuth, requireNoAccessToken, settingsRouter);
  // Local harness: device management is user-authed; the bridge router is
  // device-token authed inside (requireDevice) and rate-limited per device.
  app.use(`${BASE}/local-harness`, requireUserAuth, localHarnessRouter);
  app.use(`${BASE}/local-harness-bridge`, localHarnessBridgeRouter);
  // allowReadAccessToken (NOT the hard barrier): CLI tokens carry runs:read so
  // the CLI can list/search/fetch its own runs (GET /runs/light, /runs/search,
  // /runs/:id). Reads pass with the scope; token writes are still rejected.
  app.use(`${BASE}/runs`, requireAuth, allowReadAccessToken("runs:read"), runsRouter);
  // One chain so unhandled requests fall through without re-authenticating.
  app.use(`${BASE}/metrics`, requireAuth, requireNoAccessToken, metricsRouter, metricsToolsRouter);
  // Mount-level baseline auth (defense-in-depth): every memory route also has
  // stricter per-route middleware (requireUserAuth / requireClawAdmin), but a
  // future route that forgets it must still fail closed at the mount. requireAuth
  // (not requireUserAuth) because /recall-hits is a runtime callback from xyne-claw.
  // The per-request memoization in require-auth.ts makes the second layer free.
  app.use(`${BASE}/memory`, requireAuth, requireNoAccessToken, memoryRouter);
  app.use(`${BASE}/agent-index`, requireAuth, requireNoAccessToken, agentIndexRouter);
  app.use(`${BASE}/tool-index`, requireAuth, requireNoAccessToken, toolIndexRouter);
  app.use(`${BASE}/digital-twin`, requireUserAuth, digitalTwinRouter);
  app.use(`${BASE}/control-center`, requireAuth, requireNoAccessToken, controlCenterRouter);
  app.use(`${BASE}/research-agent`, requireAuth, requireNoAccessToken, researchAgentRouter);
  app.use(`${BASE}/evals`, requireAuth, requireNoAccessToken, requireClawAdmin, evalsRouter);
  app.use(`${BASE}/search-evals`, requireAuth, requireNoAccessToken, requireSearchEvalAccess, searchEvalsRouter);
  // A run reads a whole channel with no per-user ACL guard — operator action only.
  app.use(`${BASE}/entity-extraction`, requireAuth, requireNoAccessToken, requireClawAdmin, entityExtractionRouter);
}

function mountGatewayAndErrors(app: Express): void {
  // MCP Gateway routes (for backend service registration)
  // NOT behind requireAuth (so requireNoAccessToken never runs here): gateway
  // routes authenticate per-route with gatewayTenantAuth + gatewayRegistrationAuth
  // (mcpgateway/middleware/gateway-auth.ts) against the registration API key.
  app.use(`${BASE}/gateway`, mcpGatewayRouter);
  app.use(errorMiddleware);
}

export function mountRoutes(app: Express): void {
  mountRequestContext(app);
  mountCoreApi(app);
  mountOAuthProviders(app);
  mountRunAndWebhooks(app);
  mountWorkspace(app);
  mountGatewayAndErrors(app);
}
