import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import { createHash } from "node:crypto";
import type { LocalHarnessDevice } from "@prisma/client";
import type {
  LocalHarnessDeviceStatus,
  LocalHarnessInstallation,
  LocalHarnessPollResult,
  LocalHarnessRunEnvelope,
} from "xyne-claw-shared";
import {
  isLocalHarnessDeviceRegistration,
  isLocalHarnessInstallationSync,
  isLocalHarnessProgressEvent,
  isLocalHarnessProvider,
  isLocalHarnessRunResult,
  isLocalHarnessToolCallRequest,
} from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { getOrgId, getRequesterId, isOrgAdmin } from "../middleware/agent-acl.js";
import { authenticatedProviders, isDeviceOnline, localHarnessRepository } from "../repositories/localHarnessRepository.js";
import {
  callToolForRun,
  listToolsForRun,
  localHarnessProviderLabel,
  recoverFailedLocalRun,
  relayProgress,
  relayResult,
} from "../lib/local-harness.js";

const log = createLogger("local-harness-routes");

// --- Prod-readiness guards for the long-poll bridge ---
// Per-device cap on concurrent /runs/next long-polls. Each poll pins a
// connection + a DB-polling loop for up to localHarnessPollTimeoutMs; without
// a cap a single device (or a leaked token) could exhaust the connection pool.
const MAX_CONCURRENT_POLLS_PER_DEVICE = 2;
const activePolls = new Map<string, number>();

const RATE_WINDOW_MS = 5 * 60 * 1000;

const deviceKey = (req: Request): string => {
  const header = req.headers.authorization;
  return header
    ? createHash("sha256").update(header).digest("hex").slice(0, 32)
    : ipKeyGenerator(req.ip ?? "unknown");
};

const tooManyRequests = { success: false, error: "Too many requests. Please slow down." };

const pollLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_WINDOW_MS,
  limit: 120,
  keyGenerator: deviceKey,
  message: tooManyRequests,
  standardHeaders: true,
  legacyHeaders: false,
});

const bridgeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_WINDOW_MS,
  limit: 900,
  keyGenerator: deviceKey,
  message: tooManyRequests,
  standardHeaders: true,
  legacyHeaders: false,
});

const userLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: RATE_WINDOW_MS,
  limit: 120,
  keyGenerator: (req) => getRequesterId(req) ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: tooManyRequests,
  standardHeaders: true,
  legacyHeaders: false,
});

// Graceful drain: on SIGTERM we stop parking new long-poll loops so in-flight
// connections return `idle` quickly and the pod can exit without dropping a
// claimed run. Wired from main.ts's shutdown handler.
let draining = false;
export function beginLocalHarnessDrain(): void {
  draining = true;
  log.info(`[local-harness][metric] drain_started active_poll_devices=${activePolls.size}`);
}

function requireFeature(_req: Request, res: Response, next: NextFunction): void {
  if (!CONFIG.localHarnessEnabled) {
    res.status(404).json({ success: false, error: "Local harness is not enabled" });
    return;
  }
  next();
}

const router = Router();
router.use(requireFeature);
router.use(userLimiter);

function toDeviceStatus(device: LocalHarnessDevice): LocalHarnessDeviceStatus {
  return {
    deviceId: device.id,
    deviceName: device.deviceName,
    platform: device.platform,
    installations: (Array.isArray(device.installations) ? device.installations : []) as unknown as LocalHarnessInstallation[],
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    online: isDeviceOnline(device),
    createdAt: device.createdAt.toISOString(),
  };
}

router.post("/devices", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  if (!isLocalHarnessDeviceRegistration(req.body)) {
    res.status(400).json({ success: false, error: "Invalid device registration payload" });
    return;
  }

  try {
    const { device, token } = await localHarnessRepository.registerDevice({
      userId,
      orgId,
      deviceName: req.body.deviceName.trim(),
      platform: req.body.platform.trim(),
      installations: req.body.installations as unknown as never,
    });
    log.info(
      `[local-harness] device registered id=${device.id} user=${userId} installs=[${req.body.installations
        .map((i) => `${i.provider}${i.authenticated ? "" : ":unauth"}`)
        .join(",")}]`,
    );
    res.json({ success: true, data: { deviceId: device.id, deviceToken: token } });
  } catch (err) {
    log.error("[local-harness] device registration failed:", err);
    res.status(500).json({ success: false, error: "Failed to register device" });
  }
});

router.get("/devices", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const devices = await localHarnessRepository.listDevices(userId).catch(() => [] as LocalHarnessDevice[]);
  res.json({ success: true, data: devices.map(toDeviceStatus) });
});

router.delete("/devices/:deviceId", async (req: Request<{ deviceId: string }>, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const revoked = await localHarnessRepository.revokeDevice(userId, req.params.deviceId).catch(() => false);
  if (!revoked) {
    res.status(404).json({ success: false, error: "Device not found" });
    return;
  }
  log.info(`[local-harness] device revoked id=${req.params.deviceId} user=${userId}`);
  res.json({ success: true });
});

// Per-user default harness — "use this harness for all my agents". Written by
// onboarding and by the Local harness card in Claw Settings; read by
// resolveLocalHarnessTarget for every agent the user has no override on.
router.get("/preferences", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const defaultProvider = await localHarnessRepository.getUserDefaultProvider(userId).catch(() => null);
  res.json({ success: true, data: { defaultProvider } });
});

router.put("/preferences", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const defaultProvider = (req.body as { defaultProvider?: unknown } | null)?.defaultProvider ?? null;
  if (defaultProvider !== null && !isLocalHarnessProvider(defaultProvider)) {
    res.status(400).json({ success: false, error: "defaultProvider must be a local harness provider or null" });
    return;
  }
  try {
    await localHarnessRepository.setUserDefaultProvider(userId, defaultProvider);
  } catch (err) {
    log.error("[local-harness] failed to save default provider:", err);
    res.status(500).json({ success: false, error: "Failed to save your default harness" });
    return;
  }
  log.info(`[local-harness] user default harness user=${userId} provider=${defaultProvider ?? "(none)"}`);
  res.json({ success: true, data: { defaultProvider } });
});

router.get("/workspace-settings", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const mode = (await localHarnessRepository.getOrgHarnessMode(orgId).catch(() => null))
    ?? (CONFIG.localHarnessDefaultAll ? "all" : "selected");
  res.json({ success: true, data: { mode } });
});

router.put("/workspace-settings", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  if (!(await isOrgAdmin(userId, orgId).catch(() => false))) {
    res.status(403).json({ success: false, error: "Only a workspace admin can change local-harness settings" });
    return;
  }
  const mode = (req.body as { mode?: unknown } | null)?.mode;
  if (mode !== "all" && mode !== "selected") {
    res.status(400).json({ success: false, error: "mode must be 'all' or 'selected'" });
    return;
  }
  await localHarnessRepository.setOrgHarnessMode(orgId, mode);
  log.info(`[local-harness] workspace mode set org=${orgId} mode=${mode} by=${userId}`);
  res.json({ success: true, data: { mode } });
});

const bridgeRouter = Router();
bridgeRouter.use(requireFeature);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      localHarnessDevice?: LocalHarnessDevice;
    }
  }
}

async function requireDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ success: false, error: "Device token required" });
    return;
  }
  const device = await localHarnessRepository.findDeviceByToken(header.slice(7).trim()).catch(() => null);
  if (!device) {
    res.status(401).json({ success: false, error: "Invalid or revoked device token" });
    return;
  }
  req.localHarnessDevice = device;
  next();
}

bridgeRouter.use(bridgeLimiter);
bridgeRouter.use("/runs/next", pollLimiter);
bridgeRouter.use(requireDevice);

// Per-harness connect/disconnect from the desktop app. Device-token authed on
// purpose: re-POSTing /devices would rotate the pairing token and 401 the
// long-poll this same app has in flight.
bridgeRouter.put("/installations", async (req: Request, res: Response) => {
  const device = req.localHarnessDevice!;
  if (!isLocalHarnessInstallationSync(req.body)) {
    res.status(400).json({ success: false, error: "Invalid installations payload" });
    return;
  }
  try {
    await localHarnessRepository.updateInstallations(device.id, req.body.installations as unknown as never);
  } catch (err) {
    log.error(`[local-harness] installation sync failed device=${device.id}:`, err);
    res.status(500).json({ success: false, error: "Failed to update installations" });
    return;
  }
  log.info(
    `[local-harness] installations synced device=${device.id} enabled=[${req.body.installations
      .filter((i) => i.authenticated && i.enabled !== false)
      .map((i) => i.provider)
      .join(",")}]`,
  );
  res.json({ success: true });
});

bridgeRouter.get("/runs/next", async (req: Request, res: Response) => {
  const device = req.localHarnessDevice!;
  await localHarnessRepository.touchDevice(device.id).catch(() => {});

  // Draining for shutdown: don't park a new loop, answer idle immediately so
  // the client re-polls the next (healthy) pod.
  if (draining) {
    res.json({ success: true, data: { status: "idle" } as LocalHarnessPollResult });
    return;
  }

  const inflight = activePolls.get(device.id) ?? 0;
  if (inflight >= MAX_CONCURRENT_POLLS_PER_DEVICE) {
    log.warn(`[local-harness][metric] poll_rejected device=${device.id} inflight=${inflight}`);
    res.status(429).json({ success: false, error: "Too many concurrent poll connections" });
    return;
  }
  activePolls.set(device.id, inflight + 1);
  try {

  const providers = authenticatedProviders(device);

  const deadline = Date.now() + CONFIG.localHarnessPollTimeoutMs;
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  while (!aborted && !draining && Date.now() < deadline) {
    const run = await localHarnessRepository.claimNextRun(device, providers).catch(() => null);
    if (run) {
      if (aborted) {
        await localHarnessRepository.releaseRun(run.id).catch(() => {});
        log.info(`[local-harness] run released id=${run.id} — device disconnected mid-claim`);
        return;
      }
      const envelope = run.envelope as unknown as LocalHarnessRunEnvelope;
      log.info(`[local-harness][metric] run_claimed id=${run.id} device=${device.id} agent=${run.agentSlug}`);
      const payload: LocalHarnessPollResult = { status: "run", run: { ...envelope, runId: run.id } };
      res.json({ success: true, data: payload });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

    if (aborted) return;
    const idle: LocalHarnessPollResult = { status: "idle" };
    res.json({ success: true, data: idle });
  } finally {
    const remaining = (activePolls.get(device.id) ?? 1) - 1;
    if (remaining <= 0) activePolls.delete(device.id);
    else activePolls.set(device.id, remaining);
  }
});

async function ownedRun(req: Request<{ runId: string }>, res: Response) {
  const device = req.localHarnessDevice!;
  const run = await localHarnessRepository.findOwnedRun(req.params.runId, device).catch(() => null);
  if (!run) {
    res.status(404).json({ success: false, error: "Run not found" });
    return null;
  }
  if (run.status !== "queued" && run.status !== "claimed" && run.status !== "running") {
    res.status(409).json({ success: false, error: "Run already finished" });
    return null;
  }
  return run;
}

bridgeRouter.get("/runs/:runId/tools", async (req: Request<{ runId: string }>, res: Response) => {
  const run = await ownedRun(req, res);
  if (!run) return;
  try {
    const tools = await listToolsForRun(run);
    res.json({ success: true, data: { runId: run.id, tools } });
  } catch (err) {
    log.error(`[local-harness] tool listing failed run=${run.id}:`, err);
    res.status(502).json({ success: false, error: "Failed to list tools" });
  }
});

bridgeRouter.post("/runs/:runId/tools/call", async (req: Request<{ runId: string }>, res: Response) => {
  const run = await ownedRun(req, res);
  if (!run) return;
  if (!isLocalHarnessToolCallRequest(req.body)) {
    res.status(400).json({ success: false, error: "Invalid tool call payload" });
    return;
  }
  const { serverType, toolName, params } = req.body;
  try {
    const result = await callToolForRun(run, { serverType, toolName, params: params ?? {} });
    res.json({ success: true, data: result });
  } catch (err) {
    log.error(`[local-harness] tool call failed run=${run.id} tool=${serverType}/${toolName}:`, err);
    res.status(502).json({ success: false, error: "Tool execution failed" });
  }
});

bridgeRouter.post("/runs/:runId/progress", async (req: Request<{ runId: string }>, res: Response) => {
  const run = await ownedRun(req, res);
  if (!run) return;
  res.json({ success: true });

  const event = req.body;
  if (!isLocalHarnessProgressEvent(event)) return;
  await localHarnessRepository.markRunning(run.id).catch(() => {});

  switch (event.kind) {
    case "text":
      await relayProgress(run, { textDelta: event.delta });
      break;
    case "tool":
      await relayProgress(run, { toolLabel: event.toolName });
      break;
    case "status":
      await relayProgress(run, { toolLabel: event.label });
      break;
  }
});

bridgeRouter.post("/runs/:runId/result", async (req: Request<{ runId: string }>, res: Response) => {
  const run = await ownedRun(req, res);
  if (!run) return;
  if (!isLocalHarnessRunResult(req.body)) {
    res.status(400).json({ success: false, error: "Invalid run result payload" });
    return;
  }
  const result = req.body;
  res.json({ success: true });

  if (result.status === "failed") {
    const harness = localHarnessProviderLabel(run.provider);
    const detail = result.error?.trim() ? `${harness} failed: ${result.error.trim()}` : `${harness} failed`;
    if (await recoverFailedLocalRun(run, detail)) {
      log.info(`[local-harness] run ${run.id} failed locally — handed to the server fallback (${detail})`);
      return;
    }
    log.error(`[local-harness] run ${run.id} failed locally AND the server fallback failed — surfacing to the user`);
    await relayResult(run, { ...result, error: detail }, { localHarnessUnreachable: true });
    return;
  }

  const won = await localHarnessRepository.finishRun(run.id, result.status, result.error).catch(() => false);
  if (!won) {
    log.warn(`[local-harness] result ignored id=${run.id} — run already finished (expired or cancelled)`);
    return;
  }
  log.info(
    `[local-harness] run finished id=${run.id} status=${result.status} provider=${run.provider} ` +
      `requestedModel=${run.model ?? "(cli default)"} effectiveModel=${result.effectiveModel ?? "(not reported)"} ` +
      `chars=${result.text.length}${result.error ? ` error=${result.error}` : ""}`,
  );
  await relayResult(run, result);
});

export { router as localHarnessRouter, bridgeRouter as localHarnessBridgeRouter };
