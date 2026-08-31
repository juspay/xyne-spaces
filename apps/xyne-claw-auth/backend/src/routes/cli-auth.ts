import { Router, type NextFunction, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { asyncHandler, ok, badRequest, unauthorized, notFound, conflict, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { requireUserAuth } from "../middleware/require-auth.js";
import { generate as generateCliToken } from "../lib/cli-tokens.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { createLogger } from "../logger.js";

const log = createLogger("cli-auth");
const router = Router();

const CLIENT_ID = "xyne-cli";
const DEVICE_TTL_SECONDS = 600;
const POLL_INTERVAL_SECONDS = 3;
const SCOPES = ["agents:read", "runs:read", "runs:write"];
// PAT lifetime in days. Verification (lib/cli-tokens.ts) already enforces
// expiresAt; this bounds a leaked token's usefulness. 0 = non-expiring
// (previous behavior — reserve for vetted service users, not the default).
const configuredTokenTtlDays = Number(process.env["CLI_TOKEN_TTL_DAYS"] ?? 90);
// A malformed env value must fail SAFE (default 90d), not fail open to
// non-expiring: NaN > 0 is false, which would silently mint indefinite PATs.
const TOKEN_TTL_DAYS = Number.isFinite(configuredTokenTtlDays) && configuredTokenTtlDays >= 0
  ? configuredTokenTtlDays
  : 90;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type PendingDeviceAuth =
  | {
      deviceCode: string;
      userCode: string;
      clientId: string;
      status: "pending";
      createdAt: string;
      expiresAt: string;
      interval: number;
    }
  | {
      deviceCode: string;
      userCode: string;
      clientId: string;
      status: "approved";
      createdAt: string;
      expiresAt: string;
      interval: number;
      userId: string;
      orgId: string;
      email: string;
    };

function deviceKey(deviceCode: string): string {
  return `cli:auth:device:${deviceCode}`;
}

function userCodeKey(userCode: string): string {
  return `cli:auth:user:${userCode}`;
}

function pollKey(deviceCode: string): string {
  return `cli:auth:poll:${deviceCode}`;
}

function rateKey(bucket: string, req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "") || req.ip || req.socket.remoteAddress || "unknown";
  return `cli:auth:rate:${bucket}:${ip}`;
}

async function rateLimit(req: Request, res: Response, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = redisService.getConnection();
  const key = rateKey(bucket, req);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  if (count <= limit) return true;

  res.status(429).json({ error: "rate_limited" });
  return false;
}

function parseClientId(req: Request): string | undefined {
  const body = req.body as { clientId?: unknown } | undefined;
  return typeof body?.clientId === "string" ? body.clientId.trim() : undefined;
}

function parseDeviceCode(req: Request): string | undefined {
  const body = req.body as { deviceCode?: unknown } | undefined;
  return typeof body?.deviceCode === "string" ? body.deviceCode.trim() : undefined;
}

function parseUserCode(req: Request): string | undefined {
  const body = req.body as { userCode?: unknown } | undefined;
  return typeof body?.userCode === "string" ? normalizeUserCode(body.userCode) : undefined;
}

function normalizeUserCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{1,4})$/, "$1-$2");
}

function randomUserCode(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += USER_CODE_ALPHABET[randomBytes(1)[0]! % USER_CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function publicVerifyUrl(userCode: string): string {
  return `${CONFIG.spacesAppUrl.replace(/\/+$/, "")}/claw/v3/cli-login?code=${encodeURIComponent(userCode)}`;
}

async function writePending(record: PendingDeviceAuth): Promise<void> {
  const redis = redisService.getConnection();
  const ttl = Math.max(1, Math.ceil((new Date(record.expiresAt).getTime() - Date.now()) / 1000));
  await redis
    .multi()
    .set(deviceKey(record.deviceCode), JSON.stringify(record), "EX", ttl)
    .set(userCodeKey(record.userCode), record.deviceCode, "EX", ttl)
    .exec();
}

async function loadPendingByDevice(deviceCode: string): Promise<PendingDeviceAuth | null> {
  const raw = await redisService.getConnection().get(deviceKey(deviceCode));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingDeviceAuth;
  } catch {
    return null;
  }
}

async function loadPendingForDelivery(deviceCode: string): Promise<PendingDeviceAuth | null> {
  const raw = await redisService.getConnection().getdel(deviceKey(deviceCode));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingDeviceAuth;
  } catch {
    return null;
  }
}

async function requireApproveAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireUserAuth(req, res, next);
}

function requireCliTokensEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!CONFIG.cliTokensEnabled) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

router.post("/auth/start", requireCliTokensEnabled, async (req: Request, res: Response) => {
  try {
    if (!(await rateLimit(req, res, "start", 12, 60))) return;
    if (parseClientId(req) !== CLIENT_ID) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    const deviceCode = randomBytes(32).toString("base64url");
    const userCode = randomUserCode();
    const now = Date.now();
    const record: PendingDeviceAuth = {
      deviceCode,
      userCode,
      clientId: CLIENT_ID,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DEVICE_TTL_SECONDS * 1000).toISOString(),
      interval: POLL_INTERVAL_SECONDS,
    };

    await writePending(record);
    res.json({
      deviceCode,
      userCode,
      verifyUrl: publicVerifyUrl(userCode),
      expiresIn: DEVICE_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    });
  } catch (err) {
    log.error("[cli-auth] start failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/auth/token", requireCliTokensEnabled, async (req: Request, res: Response) => {
  try {
    if (!(await rateLimit(req, res, "token", 60, 60))) return;
    if (parseClientId(req) !== CLIENT_ID) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    const deviceCode = parseDeviceCode(req);
    if (!deviceCode) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const pending = await loadPendingByDevice(deviceCode);
    if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) {
      res.status(400).json({ error: "expired_token" });
      return;
    }

    if (pending.status === "pending") {
      const redis = redisService.getConnection();
      const firstPoll = await redis.set(pollKey(deviceCode), "1", "EX", pending.interval, "NX");
      if (!firstPoll) {
        res.json({ error: "slow_down" });
        return;
      }
      res.json({ error: "authorization_pending" });
      return;
    }

    const approved = await loadPendingForDelivery(deviceCode);
    if (!approved || approved.status !== "approved") {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    const surface = await prisma.surface.findUnique({
      where: { key: "cli" },
      select: { id: true },
    });
    if (!surface) {
      res.status(500).json({ error: "server_error" });
      return;
    }

    const token = generateCliToken();
    await prisma.surfaceAccessToken.create({
      data: {
        userId: approved.userId,
        orgId: approved.orgId,
        surfaceId: surface.id,
        client: CLIENT_ID,
        name: "Xyne CLI",
        tokenHash: token.hashed,
        prefix: token.prefix,
        scopes: SCOPES,
        ...(TOKEN_TTL_DAYS > 0 ? { expiresAt: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000) } : {}),
      },
    });

    await redisService.getConnection().del(userCodeKey(approved.userCode), pollKey(deviceCode));
    res.json({ token: token.raw, userId: approved.userId, email: approved.email });
  } catch (err) {
    log.error("[cli-auth] token failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/auth/approve", requireCliTokensEnabled, requireApproveAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!(await rateLimit(req, res, "approve", 20, 60))) return;

  const userCode = parseUserCode(req);
  if (!userCode) {
    throw badRequest("userCode is required");
  }

  const redis = redisService.getConnection();
  const deviceCode = await redis.getdel(userCodeKey(userCode));
  if (!deviceCode) {
    throw notFound("Code not found or expired");
  }

  const pending = await loadPendingByDevice(deviceCode);
  if (!pending || pending.status !== "pending" || new Date(pending.expiresAt).getTime() <= Date.now()) {
    throw badRequest("Code already used or expired");
  }

  const userId = getRequesterId(req);
  if (!userId) {
    throw unauthorized("User session required");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, email: true },
  });
  if (!user?.orgId) {
    throw badRequest("User organization is required");
  }

  const approved: PendingDeviceAuth = {
    ...pending,
    status: "approved",
    userId,
    orgId: user.orgId,
    email: user.email,
  };
  await writePending(approved);
  ok(res);
}));

router.get("/tokens", requireApproveAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    throw unauthorized("User session required");
  }

  const tokens = await prisma.surfaceAccessToken.findMany({
    where: { userId, surface: { key: "cli" }, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, prefix: true, name: true, client: true, lastUsedAt: true, createdAt: true, expiresAt: true },
  });
  ok(res, tokens);
}));

router.delete("/tokens/:id", requireApproveAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    throw unauthorized("User session required");
  }

  const id = (req.params as { id: string }).id;
  await prisma.surfaceAccessToken.updateMany({
    where: { id, userId, surface: { key: "cli" }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  ok(res);
}));

export { router as cliAuthRouter };
