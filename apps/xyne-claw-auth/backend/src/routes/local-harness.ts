import { Router, type NextFunction, type Request, type Response } from "express";
import type { LocalHarnessDevice } from "@prisma/client";
import type {
  LocalHarnessDeviceStatus,
  LocalHarnessInstallation,
  LocalHarnessPollResult,
  LocalHarnessRunEnvelope,
} from "xyne-claw-shared";
import {
  isLocalHarnessDeviceRegistration,
  isLocalHarnessProgressEvent,
  isLocalHarnessRunResult,
  isLocalHarnessToolCallRequest,
} from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { getOrgId, getRequesterId, isOrgAdmin } from "../middleware/agent-acl.js";
import { isDeviceOnline, localHarnessRepository } from "../repositories/localHarnessRepository.js";
import { callToolForRun, listToolsForRun, relayProgress, relayResult } from "../lib/local-harness.js";

const log = createLogger("local-harness-routes");

// --- Prod-readiness guards for the long-poll bridge ---
// Per-device cap on concurrent /runs/next long-polls. Each poll pins a
// connection + a DB-polling loop for up to localHarnessPollTimeoutMs; without
// a cap a single device (or a leaked token) could exhaust the connection pool.
const MAX_CONCURRENT_POLLS_PER_DEVICE = 2;
const activePolls = new Map<string, number>();

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

bridgeRouter.use(requireDevice);

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

  const providers = (Array.isArray(device.installations) ? device.installations : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return record["authenticated"] === true && typeof record["provider"] === "string" ? record["provider"] : null;
    })
    .filter((p): p is string => p !== null);

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
  if (run.status === "done" || run.status === "failed" || run.status === "cancelled") {
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
