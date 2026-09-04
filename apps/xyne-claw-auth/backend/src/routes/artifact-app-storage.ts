/**
 * Key-value storage for artifact apps.
 *
 * An app is a React project in a bundler-origin iframe with no cookies and no
 * network; it asks the dashboard, which calls this router as the viewer. The
 * design constraint everything below serves: the table is SHARED by every app,
 * so no request may ever touch anything but the indexed key columns.
 *
 *  - **The value is opaque.** Reads and writes address records by
 *    (baseKey, dynamicKey) only. There is no filter on `value` and the schemas
 *    are `.strict()`, so "can't query the blob" holds by construction — an
 *    unknown field is a 400, not a silently ignored (or worse, forwarded) key.
 *
 *  - **Scope is enforced here, not in app code.** App code is model-authored
 *    and runs in the viewer's browser; anything it "hides" client-side is
 *    readable by any viewer with devtools. `owner` is stamped from the session
 *    and reads filter to ("global", caller), so a user-scoped record is private
 *    no matter what the app does. A user row SHADOWS a global row with the same
 *    key on POINT reads only — "default settings, overridden per user" for
 *    free. `list` is deliberately raw: it returns both rows (each carries its
 *    scope) because offset pagination cannot collapse a pair split across two
 *    pages without lying about completeness. Clients that want the collapsed
 *    view filter on scope, or list 'user' and 'global' separately.
 *
 *  - **Global rows are shared-WRITE, not just shared-read — deliberately.**
 *    Any user who can open the app can put/delete scope:"global" records,
 *    last-write-wins; that is what makes shared app state (a common board
 *    config, a team counter) possible without a server component. Per-user
 *    data belongs in scope:"user", which nobody else can touch. If a future
 *    app needs owner-only shared state, gate it here (resolveApp already
 *    fetches ownerUserId; compare it against the requester) — do not trust
 *    app-side checks for it.
 *
 *  - **Every read is bounded.** `limit` is capped, `offset` is capped (a large
 *    OFFSET still walks the index), keys are length-capped, and list order is
 *    dynamicKey only — all of it inside the unique index, so the worst request
 *    is an index range scan.
 *
 * The app ACL is the same predicate the payload read and agent dispatch use:
 * the owner, or anyone in the workspace once published. Storage exists only for
 * SAVED apps — an unsaved chat artifact has no stable id to key records on.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { createLogger } from "../logger.js";

const log = createLogger("artifact-app-storage");
export const artifactAppStorageRouter: Router = Router();

/**
 * Storage-only Bearer bridge, mounted BEFORE requireAuth on this router's
 * path (see http/routes.ts) and nowhere else — requireAuth itself is shared
 * by every route in the service and stays untouched.
 *
 * An SDK client sends only `Authorization: Bearer <workspace JWT>`. Spaces'
 * auth wants that token in a cookie whose NAME embeds the workspaceId
 * (`xyne_ws_<id>_token`), so this synthesizes the cookie header from the
 * token's own workspaceId claim and lets requireAuth's normal cookie path do
 * the rest. The claim is decoded WITHOUT verification — safe, because it is
 * only a routing hint: it selects which cookie slot Spaces verifies, and the
 * signature check still happens there. A tampered claim just misroutes the
 * caller's own request into a slot that fails verification.
 *
 * Strictly additive: it acts only when the request has NO cookie header —
 * which today could never authenticate — and a non-JWT bearer (xyne_cli_*,
 * xyne_svc_*) doesn't decode, so CLI/service tokens fall through untouched.
 */
export function storageBearerAuthBridge(req: Request, _res: Response, next: NextFunction): void {
  if (!req.headers.cookie) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    const token = match?.[1]?.trim();
    const workspaceId = token ? workspaceIdFromJwt(token) : undefined;
    if (token && workspaceId) {
      req.headers.cookie = `xyne_last_workspace=${workspaceId}; xyne_ws_${workspaceId}_token=${token}`;
      if (typeof req.headers["x-workspace-id"] !== "string" || !req.headers["x-workspace-id"].trim()) {
        req.headers["x-workspace-id"] = workspaceId;
      }
    }
  }
  next();
}

/** The workspaceId claim of a Spaces workspace JWT, undefined for anything
 *  that isn't a decodable JWT. Charset-restricted because the value is
 *  embedded into the synthesized Cookie header above. */
function workspaceIdFromJwt(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as {
      workspaceId?: unknown;
    };
    const workspaceId = payload.workspaceId;
    if (typeof workspaceId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(workspaceId)) {
      return workspaceId;
    }
  } catch {
    /* not decodable — not a workspace JWT */
  }
  return undefined;
}

const VISIBILITY_WORKSPACE = "WORKSPACE";

/** The one owner value that is not a user id. A cuid can never collide with it. */
const GLOBAL_OWNER = "global";

const MAX_VALUE_BYTES = 64 * 1024;
const MAX_LIST_LIMIT = 100;
const MAX_OFFSET = 10_000;
const MAX_BATCH_KEYS = 50;
/** Soft cap per app, checked only when a `put` would create a new record —
 *  an app at the cap can still update and delete its way back under it. */
const MAX_RECORDS_PER_APP = 20_000;

/** Writes a viewer may make per hour across every app. A runaway-loop guard,
 *  not a permission — mirrors artifact-app-agents' run quota. */
const WRITES_PER_HOUR = 2_000;
const RATE_WINDOW_SECONDS = 3600;

const baseKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "baseKey must be 1-64 chars of letters, digits, . _ -");
const dynamicKey = z.string().min(1).max(256);
const scopeRead = z.enum(["user", "global", "any"]).default("any");
const scopeWrite = z.enum(["user", "global"]).default("user");

/**
 * The fetch contract. `.strict()` throughout: these schemas ARE the query
 * language, and anything they do not name does not reach Prisma.
 */
const querySchema = z
  .object({
    appId: z.string().min(1),
    baseKey,
    op: z.enum(["get", "list"]),
    /** get: one key, or a batch. Exactly one of the two. */
    key: dynamicKey.optional(),
    keys: z.array(dynamicKey).min(1).max(MAX_BATCH_KEYS).optional(),
    /** list: dynamicKey prefix filter. */
    prefix: z.string().max(256).optional(),
    scope: scopeRead,
    order: z.enum(["asc", "desc"]).default("asc"),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
    offset: z.number().int().min(0).max(MAX_OFFSET).default(0),
  })
  .strict();

const putSchema = z
  .object({
    appId: z.string().min(1),
    baseKey,
    key: dynamicKey,
    /** Opaque JSON. Size-capped below — zod cannot see serialized size. */
    value: z.unknown(),
    scope: scopeWrite,
  })
  .strict();

const deleteSchema = z
  .object({
    appId: z.string().min(1),
    baseKey,
    key: dynamicKey,
    scope: scopeWrite,
  })
  .strict();

function badRequest(res: Response, parsed: z.ZodSafeParseError<unknown>): void {
  res.status(400).json({ success: false, error: "ValidationError", details: parsed.error.flatten() });
}

/**
 * Same read rule as `GET /artifact-apps/:id/payload` and artifact-app-agents:
 * the owner, or anyone in the workspace once published.
 */
async function resolveApp(
  appId: string,
  requesterId: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; status: number; error: string }> {
  const app = await prisma.artifactApp.findUnique({
    where: { id: appId },
    select: { workspaceId: true, ownerUserId: true, visibility: true, isArchived: true },
  });
  if (!app || app.isArchived) return { ok: false, status: 404, error: "App not found" };

  if (app.ownerUserId !== requesterId) {
    const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-app-storage");
    const sameWorkspace = workspaceId !== null && workspaceId === app.workspaceId;
    if (!sameWorkspace || app.visibility !== VISIBILITY_WORKSPACE) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }
  return { ok: true, workspaceId: app.workspaceId };
}

/** Owners a read may touch. Never anything but the caller's row and the shared one. */
function readOwners(scope: "user" | "global" | "any", requesterId: string): string[] {
  if (scope === "user") return [requesterId];
  if (scope === "global") return [GLOBAL_OWNER];
  return [GLOBAL_OWNER, requesterId];
}

interface RecordRow {
  dynamicKey: string;
  owner: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** The wire shape. `owner` is collapsed to a scope so a user id never leaves. */
function toWire(row: RecordRow): {
  key: string;
  scope: "user" | "global";
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    key: row.dynamicKey,
    scope: row.owner === GLOBAL_OWNER ? "global" : "user",
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** For one dynamicKey, the row the app should see: the user's shadows the global. */
function shadow(rows: RecordRow[]): RecordRow | null {
  return rows.find((r) => r.owner !== GLOBAL_OWNER) ?? rows[0] ?? null;
}

async function overWriteQuota(userId: string): Promise<boolean> {
  try {
    const redis = redisService.getConnection();
    const key = `artifact-app-storage:rate:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
    return count > WRITES_PER_HOUR;
  } catch (err) {
    // Redis down must not take the feature down; the other caps still hold.
    log.warn(`rate limit check failed for ${userId}: ${String(err)}`);
    return false;
  }
}

const recordSelect = { dynamicKey: true, owner: true, value: true, createdAt: true, updatedAt: true } as const;

/** POST /query — the only read. `op` picks point-get or bounded list. */
artifactAppStorageRouter.post("/query", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);
  const q = parsed.data;

  if (q.op === "get" && !q.key && !q.keys) {
    res.status(400).json({ success: false, error: "op \"get\" needs key or keys" });
    return;
  }
  if (q.op === "get" && q.key && q.keys) {
    res.status(400).json({ success: false, error: "Pass key or keys, not both" });
    return;
  }

  const resolved = await resolveApp(q.appId, requesterId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }

  const base = {
    workspaceId: resolved.workspaceId,
    appId: q.appId,
    baseKey: q.baseKey,
    owner: { in: readOwners(q.scope, requesterId) },
  };

  if (q.op === "get") {
    const wanted = q.keys ?? [q.key as string];
    const rows = await prisma.artifactAppRecord.findMany({
      where: { ...base, dynamicKey: { in: wanted } },
      select: recordSelect,
    });
    const byKey = new Map<string, RecordRow[]>();
    for (const row of rows) {
      const bucket = byKey.get(row.dynamicKey) ?? [];
      bucket.push(row);
      byKey.set(row.dynamicKey, bucket);
    }
    if (q.key !== undefined) {
      const row = shadow(byKey.get(q.key) ?? []);
      res.json({ success: true, record: row ? toWire(row) : null });
      return;
    }
    const records = wanted
      .map((k) => shadow(byKey.get(k) ?? []))
      .filter((r): r is RecordRow => r !== null)
      .map(toWire);
    res.json({ success: true, records });
    return;
  }

  // list. limit+1 answers hasMore without a count; ties across owners break on
  // owner so the order is total and offset paging never skips or repeats.
  // No shadow-collapse here (see header): under scope "any" a key with both a
  // user and a global row yields TWO records, distinguished by their scope.
  const rows = await prisma.artifactAppRecord.findMany({
    where: { ...base, ...(q.prefix ? { dynamicKey: { startsWith: q.prefix } } : {}) },
    orderBy: [{ dynamicKey: q.order }, { owner: q.order }],
    skip: q.offset,
    take: q.limit + 1,
    select: recordSelect,
  });
  res.json({
    success: true,
    records: rows.slice(0, q.limit).map(toWire),
    hasMore: rows.length > q.limit,
  });
});

/** POST /put — upsert one record. The unique index is what makes this atomic. */
artifactAppStorageRouter.post("/put", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);
  const body = parsed.data;

  if (body.value === undefined) {
    res.status(400).json({ success: false, error: "value is required" });
    return;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(body.value);
  } catch {
    res.status(400).json({ success: false, error: "value must be JSON-serializable" });
    return;
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_VALUE_BYTES) {
    res.status(413).json({ success: false, error: `value must serialize to at most ${MAX_VALUE_BYTES / 1024}KB of JSON` });
    return;
  }

  const resolved = await resolveApp(body.appId, requesterId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }

  if (await overWriteQuota(requesterId)) {
    res.status(429).json({ success: false, error: "Too many storage writes recently. Try again later." });
    return;
  }

  const owner = body.scope === "global" ? GLOBAL_OWNER : requesterId;
  const uniqueKey = {
    workspaceId: resolved.workspaceId,
    appId: body.appId,
    baseKey: body.baseKey,
    owner,
    dynamicKey: body.key,
  };

  // Soft cap, paid only on a CREATE: an existing key updates in place freely.
  // The count/create race can overshoot by a few rows; that is fine for a guard
  // whose job is stopping unbounded growth, not enforcing an exact number.
  const exists = await prisma.artifactAppRecord.findUnique({
    where: { workspaceId_appId_baseKey_owner_dynamicKey: uniqueKey },
    select: { id: true },
  });
  if (!exists) {
    const total = await prisma.artifactAppRecord.count({
      where: { workspaceId: resolved.workspaceId, appId: body.appId },
    });
    if (total >= MAX_RECORDS_PER_APP) {
      res.status(403).json({ success: false, error: "This app has reached its storage limit. Delete records to add more." });
      return;
    }
  }

  const valueJson = JSON.parse(serialized) as object;
  const row = await prisma.artifactAppRecord.upsert({
    where: { workspaceId_appId_baseKey_owner_dynamicKey: uniqueKey },
    create: { ...uniqueKey, value: valueJson },
    update: { value: valueJson },
    select: recordSelect,
  });
  res.json({ success: true, record: toWire(row) });
});

/** POST /delete — remove one record the caller may write. */
artifactAppStorageRouter.post("/delete", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);
  const body = parsed.data;

  const resolved = await resolveApp(body.appId, requesterId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }

  const owner = body.scope === "global" ? GLOBAL_OWNER : requesterId;
  const { count } = await prisma.artifactAppRecord.deleteMany({
    where: {
      workspaceId: resolved.workspaceId,
      appId: body.appId,
      baseKey: body.baseKey,
      owner,
      dynamicKey: body.key,
    },
  });
  res.json({ success: true, deleted: count > 0 });
});
