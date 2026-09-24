import express, { Router, type NextFunction, type Request, type Response } from "express";
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
  clampLocalHarnessWorkspaceDiff,
} from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { getOrgId, getRequesterId, isOrgAdmin } from "../middleware/agent-acl.js";
import { authenticatedProviders, isDeviceOnline, localHarnessRepository } from "../repositories/localHarnessRepository.js";
import { localHarnessSessionRepository } from "../repositories/localHarnessSessionRepository.js";
import {
  callToolForRun,
  clearDeliveredFiles,
  clearLocalHarnessInterrupt,
  isLocalHarnessInterruptRequested,
  TURN_HANDOFF_SUMMARY_FALLBACK,
  readDeliveredFiles,
  stashDeliveredFiles,
  listToolsForRun,
  localHarnessProviderLabel,
  recoverFailedLocalRun,
  relayProgress,
  relayResult,
  type StreamAttachment,
} from "../lib/local-harness.js";
import { nextSurfaceCall, resolveSurfaceCall } from "../lib/surface-calls.js";
import { ingestDeliveredArtifact } from "../lib/conversation-artifact-signals.js";
import { WORKSPACE_DIFF_FILENAME, WORKSPACE_DIFF_MIME, workspaceDiffRefId } from "../lib/workspace-diff.js";

const log = createLogger("local-harness-routes");

// --- Prod-readiness guards for the long-poll bridge ---
// Per-device cap on concurrent /runs/next long-polls. Each poll pins a
// connection + a DB-polling loop for up to localHarnessPollTimeoutMs; without
// a cap a single device (or a leaked token) could exhaust the connection pool.
const MAX_CONCURRENT_POLLS_PER_DEVICE = 2;
const DEVICE_TOUCH_INTERVAL_MS = 30_000;
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
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() >= DEVICE_TOUCH_INTERVAL_MS) {
    void localHarnessRepository.touchDevice(device.id).catch(() => {});
  }
  req.localHarnessDevice = device;
  next();
}

bridgeRouter.use(bridgeLimiter);
bridgeRouter.use("/runs/next", pollLimiter);
bridgeRouter.use(requireDevice);

bridgeRouter.get("/ping", (_req: Request, res: Response) => {
  res.json({ success: true });
});

bridgeRouter.get(
  "/runs/:runId/attachments/:attachmentId",
  async (req: Request<{ runId: string; attachmentId: string }>, res: Response) => {
    const device = req.localHarnessDevice!;
    const run = await localHarnessRepository.findOwnedRun(req.params.runId, device).catch(() => null);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    const envelope = run.envelope as unknown as {
      attachments?: Array<{ id: string }>;
    } | null;
    const listed = envelope?.attachments?.some((a) => a.id === req.params.attachmentId);
    if (!listed) {
      res.status(404).json({ success: false, error: "Attachment not part of this run" });
      return;
    }

    const { chatAttachmentRepository } = await import("../repositories/chatAttachmentRepository.js");
    const att = await chatAttachmentRepository.findById(req.params.attachmentId).catch(() => null);
    if (!att || att.uploaderUserId !== run.userId) {
      res.status(404).json({ success: false, error: "Attachment not found" });
      return;
    }

    const gcsService = await storage();
    res.setHeader("Content-Type", att.mimeType);
    if (att.size) res.setHeader("Content-Length", String(att.size));
    const stream = gcsService.createReadStream(att.url);
    stream.on("error", (err) => {
      log.error(`[local-harness] attachment stream failed run=${run.id}:`, err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  },
);

bridgeRouter.get("/runs/:runId/status", async (req: Request<{ runId: string }>, res: Response) => {
  const device = req.localHarnessDevice!;
  const run = await localHarnessRepository.findOwnedRun(req.params.runId, device).catch(() => null);
  if (!run) {
    res.status(404).json({ success: false, error: "Run not found" });
    return;
  }
  const interruptRequested = await isLocalHarnessInterruptRequested(run.id).catch(() => false);
  res.json({
    success: true,
    data: { status: run.status, cancelled: run.status === "cancelled", interruptRequested },
  });
});

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

const HARNESS_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const HARNESS_SESSION_MAX_BYTES = 32 * 1024 * 1024;

function harnessSessionPath(userId: string, conversationId: string, provider: string): string {
  return `local-harness-sessions/${userId}/${conversationId}/${provider}.jsonl`;
}

async function storage(): Promise<typeof import("../services/storageService.js")["gcsService"]> {
  const mod = await import("../services/storageService.js");
  return mod.gcsService;
}

function runConversationId(run: { envelope: unknown }): string | null {
  const envelope = run.envelope as unknown as { conversationId?: string } | null;
  const id = envelope?.conversationId;
  return typeof id === "string" && id ? id : null;
}

bridgeRouter.get("/runs/:runId/session", async (req: Request<{ runId: string }>, res: Response) => {
  const run = await ownedRun(req, res);
  if (!run) return;
  const conversationId = runConversationId(run);
  const row = conversationId
    ? await localHarnessSessionRepository.find(conversationId, run.provider).catch(() => null)
    : null;
  const gcsService = await storage();
  if (!row?.storagePath || !(await gcsService.exists(row.storagePath).catch(() => false))) {
    res.status(404).json({ success: false, error: "No archived session" });
    return;
  }
  res.setHeader("content-type", "application/octet-stream");
  res.setHeader("x-harness-session-id", row.cliSessionId);
  const stream = gcsService.createReadStream(row.storagePath);
  stream.on("error", (err: unknown) => {
    log.warn(`[local-harness] session download failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) res.status(502).json({ success: false, error: "Failed to read the archived session" });
    else res.end();
  });
  stream.pipe(res);
});

bridgeRouter.put(
  "/runs/:runId/session",
  express.raw({ type: () => true, limit: "32mb" }),
  async (req: Request<{ runId: string }>, res: Response) => {
    const run = await ownedRun(req, res);
    if (!run) return;
    const sessionId = typeof req.query["sessionId"] === "string" ? req.query["sessionId"] : "";
    if (!HARNESS_SESSION_ID_PATTERN.test(sessionId)) {
      res.status(400).json({ success: false, error: "Invalid sessionId" });
      return;
    }
    const body = req.body;
    if (typeof body === "string" || Array.isArray(body)) {
      res.status(400).json({ success: false, error: "Session body must be raw binary data" });
      return;
    }
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > HARNESS_SESSION_MAX_BYTES) {
      res.status(400).json({ success: false, error: "Session body must be a non-empty payload of at most 32MB" });
      return;
    }
    const conversationId = runConversationId(run);
    if (!conversationId) {
      res.status(400).json({ success: false, error: "Run has no conversation" });
      return;
    }
    const storagePath = harnessSessionPath(run.userId, conversationId, run.provider);
    try {
      await (await storage()).uploadFile(body, storagePath, "application/x-ndjson");
      await localHarnessSessionRepository.upsertArchive({
        userId: run.userId,
        conversationId,
        provider: run.provider,
        cliSessionId: sessionId,
        storagePath,
        sizeBytes: body.length,
      });
    } catch (err) {
      log.error(`[local-harness] session upload failed run=${run.id}:`, err);
      res.status(502).json({ success: false, error: "Failed to store the session" });
      return;
    }
    log.info(`[local-harness] session archived run=${run.id} provider=${run.provider} bytes=${body.length}`);
    res.json({ success: true, data: { sizeBytes: body.length } });
  },
);

const DELIVER_MAX_FILES = 20;
const DELIVER_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

function sanitizeDeliveredName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 200);
  return cleaned || "file";
}

bridgeRouter.post("/runs/:runId/deliver", express.json({ limit: "40mb" }), async (req: Request<{ runId: string }>, res: Response) => {
  const run = await ownedRun(req, res);
  if (!run) return;
  const files = (req.body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: "files must be a non-empty array" });
    return;
  }
  if (files.length > DELIVER_MAX_FILES) {
    res.status(400).json({ success: false, error: `At most ${DELIVER_MAX_FILES} files may be delivered at once` });
    return;
  }
  const normalized: Array<{ fileName: string; mimeType: string; data: string }> = [];
  let totalBytes = 0;
  for (const entry of files) {
    if (!entry || typeof entry !== "object") {
      res.status(400).json({ success: false, error: "Each file must be an object" });
      return;
    }
    const file = entry as Record<string, unknown>;
    const fileName = typeof file["fileName"] === "string" ? file["fileName"] : "";
    const mimeType = typeof file["mimeType"] === "string" && file["mimeType"].trim() ? file["mimeType"].trim() : "application/octet-stream";
    const data = typeof file["data"] === "string" ? file["data"] : "";
    if (!fileName.trim() || !data) {
      res.status(400).json({ success: false, error: "Each file needs a fileName and base64 data" });
      return;
    }
    totalBytes += Buffer.byteLength(data, "base64");
    if (totalBytes > DELIVER_MAX_TOTAL_BYTES) {
      res.status(400).json({ success: false, error: "Delivered files exceed the 25MB limit" });
      return;
    }
    normalized.push({ fileName: sanitizeDeliveredName(fileName), mimeType: mimeType.slice(0, 200), data });
  }

  try {
    const count = await stashDeliveredFiles(run.id, normalized);
    log.info(`[local-harness] delivered files stashed run=${run.id} added=${normalized.length} total=${count} bytes=${totalBytes}`);
    res.json({ success: true, data: { count } });
  } catch (err) {
    log.error(`[local-harness] deliver stash failed run=${run.id}:`, err);
    res.status(502).json({ success: false, error: "Failed to stash delivered files" });
  }
});

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
    const interruptRequested = await isLocalHarnessInterruptRequested(run.id).catch(() => false);
    res.json({ success: true, data: { ...result, interruptRequested } });
  } catch (err) {
    log.error(`[local-harness] tool call failed run=${run.id} tool=${serverType}/${toolName}:`, err);
    res.status(502).json({ success: false, error: "Tool execution failed" });
  }
});

bridgeRouter.get("/surface-calls/next", async (req: Request, res: Response) => {
  const device = req.localHarnessDevice!;
  const call = await nextSurfaceCall(device.id).catch(() => null);
  res.json({ success: true, data: { call } });
});

bridgeRouter.post("/surface-calls/:callId/result", async (req: Request<{ callId: string }>, res: Response) => {
  const device = req.localHarnessDevice!;
  const body = req.body as { ok?: unknown; content?: unknown; image?: unknown } | null;
  const image = body?.image as { data?: unknown; mimeType?: unknown } | null | undefined;
  const validImage =
    image && typeof image.data === "string" && typeof image.mimeType === "string" &&
    /^image\/(png|jpeg|webp)$/.test(image.mimeType) && image.data.length <= 8 * 1024 * 1024
      ? { data: image.data, mimeType: image.mimeType }
      : undefined;

  const accepted = await resolveSurfaceCall(device.id, req.params.callId, {
    ok: body?.ok === true,
    content: typeof body?.content === "string" ? body.content : "",
    ...(validImage ? { image: validImage } : {}),
  }).catch(() => false);

  res.json({ success: true, data: { accepted } });
});

bridgeRouter.post("/devices/focus", async (req: Request, res: Response) => {
  const device = req.localHarnessDevice!;
  const body = req.body as { focused?: unknown; route?: unknown } | null;
  await localHarnessRepository
    .setDeviceFocus(device.id, body?.focused === true, typeof body?.route === "string" ? body.route.slice(0, 300) : null)
    .catch(() => undefined);
  res.json({ success: true });
});

bridgeRouter.post("/runs/:runId/progress", async (req: Request<{ runId: string }>, res: Response) => {
  const device = req.localHarnessDevice!;
  const owned = await localHarnessRepository.findOwnedRun(req.params.runId, device).catch(() => null);
  if (owned && owned.status === "cancelled") {
    res.json({ success: true, data: { cancelled: true, interruptRequested: false } });
    return;
  }
  const run = await ownedRun(req, res);
  if (!run) return;
  const interruptRequested = await isLocalHarnessInterruptRequested(run.id).catch(() => false);
  res.json({ success: true, data: { cancelled: false, interruptRequested } });

  const event = req.body;
  if (!isLocalHarnessProgressEvent(event)) return;
  await localHarnessRepository.markRunning(run.id).catch(() => {});

  switch (event.kind) {
    case "text":
      await relayProgress(run, { textDelta: event.delta });
      break;
    case "reasoning":
      await relayProgress(run, { reasoningDelta: event.delta });
      break;
    case "tool":
      await relayProgress(run, {
        toolInvocation: {
          toolName: event.toolName,
          toolCallId: event.toolCallId ?? `local-${run.id}-${Date.now()}`,
          args: event.args ?? {},
          status: event.status ?? "completed",
          durationMs: event.durationMs ?? 0,
          ...(event.result ? { result: event.result } : {}),
        },
      });
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
  const result = req.body.interrupted && !req.body.text.trim()
    ? { ...req.body, text: TURN_HANDOFF_SUMMARY_FALLBACK }
    : req.body;
  res.json({ success: true });
  await clearLocalHarnessInterrupt(run.id).catch(() => {});

  if (result.harnessSessionId) {
    await localHarnessRepository.setCliSessionId(run.id, result.harnessSessionId).catch(() => {});
    const conversationId = runConversationId(run);
    if (conversationId) {
      await localHarnessSessionRepository
        .upsertSessionId({
          userId: run.userId,
          conversationId,
          provider: run.provider,
          cliSessionId: result.harnessSessionId,
        })
        .catch(() => undefined);
    }
  }

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

  const pendingAction = run.pendingAction && typeof run.pendingAction === "object" && !Array.isArray(run.pendingAction)
    ? (run.pendingAction as Record<string, unknown>)
    : null;

  const won = pendingAction && result.status === "done"
    ? await localHarnessRepository.markAwaitingApproval(run.id).catch(() => false)
    : await localHarnessRepository.finishRun(run.id, result.status, result.error).catch(() => false);
  if (!won) {
    log.warn(`[local-harness] result ignored id=${run.id} — run already finished (expired or cancelled)`);
    return;
  }
  if (pendingAction && result.status !== "done") {
    await localHarnessRepository.clearPendingAction(run.id).catch(() => {});
  }
  log.info(
    `[local-harness] run finished id=${run.id} status=${result.status} provider=${run.provider} ` +
      `requestedModel=${run.model ?? "(cli default)"} effectiveModel=${result.effectiveModel ?? "(not reported)"} ` +
      `chars=${result.text.length}${result.error ? ` error=${result.error}` : ""}`,
  );
  const delivered = await readDeliveredFiles(run.id).catch(() => []);

  const diff = result.workspaceDiff ? clampLocalHarnessWorkspaceDiff(result.workspaceDiff) : null;
  const attachments: StreamAttachment[] = [...delivered];
  if (diff && diff.changedFiles > 0 && diff.patch.trim()) {
    attachments.push({
      fileName: WORKSPACE_DIFF_FILENAME,
      mimeType: WORKSPACE_DIFF_MIME,
      data: Buffer.from(diff.patch, "utf8").toString("base64"),
      metadata: { workspaceDiff: { branch: diff.branch, changedFiles: diff.changedFiles, stat: diff.stat } },
    });
    const conversationId = runConversationId(run);
    if (conversationId) {
      await ingestDeliveredArtifact(
        { conversationId, runId: run.sessionId, userId: run.userId, orgId: run.orgId },
        {
          kind: "DIFF",
          refId: workspaceDiffRefId(conversationId),
          title: `Changes on ${diff.branch} (${diff.changedFiles} ${diff.changedFiles === 1 ? "file" : "files"})`,
        },
      ).catch((err: unknown) => {
        log.warn(`[local-harness] workspace diff artifact ingest failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  await relayResult(run, {
    ...result,
    ...(pendingAction && result.status === "done" ? { pendingActions: [pendingAction] } : {}),
    ...(attachments.length ? { attachments } : {}),
  });
  if (delivered.length) await clearDeliveredFiles(run.id);
});

export { router as localHarnessRouter, bridgeRouter as localHarnessBridgeRouter };
