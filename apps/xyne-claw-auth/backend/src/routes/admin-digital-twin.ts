import { Prisma } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { requireClawAdmin, getRequesterId } from "../middleware/agent-acl.js";
import { findUserByAnyId } from "../lib/users-jit.js";
import { createLogger } from "../logger.js";
import {
  AdminDigitalTwinControlError,
  adminDisableDigitalTwin,
  adminEnableDigitalTwin,
  adminStartDigitalTwinBackfill,
  summarizeAdminBackfill,
  type AdminBackfillWindowInput,
} from "../services/adminDigitalTwinControl.js";

const log = createLogger("admin-digital-twin");
const router = Router();

// Defense in depth: main.ts also mounts this router behind verified session
// auth and the access-token barrier. Keeping the role guard here ensures the
// router remains admin-only if it is ever mounted elsewhere or tested directly.
router.use(requireClawAdmin);

function parseLimit(raw: unknown): number {
  const value = Number(raw ?? 25);
  return [10, 25, 50, 100].includes(value) ? value : 25;
}

function sendControlError(res: Response, error: unknown): void {
  if (error instanceof AdminDigitalTwinControlError) {
    res.status(error.status).json({ success: false, error: error.message, code: error.code });
    return;
  }
  log.error("Admin Digital Twin control failed", {
    error: errMsg(error),
  });
  res.status(500).json({ success: false, error: "Internal server error" });
}

function parseBackfill(raw: unknown, required: boolean): AdminBackfillWindowInput | null | undefined {
  if (raw == null) {
    if (required) throw new AdminDigitalTwinControlError("backfill is required", 400, "INVALID_BACKFILL_WINDOW");
    return raw as null | undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AdminDigitalTwinControlError("backfill must be an object or null", 400, "INVALID_BACKFILL_WINDOW");
  }
  const value = raw as Record<string, unknown>;
  if (typeof value["from"] !== "string" || (value["to"] != null && typeof value["to"] !== "string")) {
    throw new AdminDigitalTwinControlError("backfill requires string from/to dates", 400, "INVALID_BACKFILL_WINDOW");
  }
  return { from: value["from"], ...(typeof value["to"] === "string" ? { to: value["to"] } : {}) };
}

router.get("/users", async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query["limit"]);
    const offset = Math.min(1_000_000, Math.max(0, Math.floor(Number(req.query["offset"] ?? 0) || 0)));
    const search = String(req.query["search"] ?? "").trim().slice(0, 200);
    const status = String(req.query["status"] ?? "all");
    const orgId = String(req.query["orgId"] ?? "").trim();
    const sort = String(req.query["sort"] ?? "name_asc");
    if (!["all", "enabled", "disabled"].includes(status)) {
      res.status(400).json({ success: false, error: "status must be all, enabled, or disabled" });
      return;
    }

    const baseWhere: Prisma.UserWhereInput = {
      ...(orgId ? { orgId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { id: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const where: Prisma.UserWhereInput = {
      ...baseWhere,
      ...(status === "enabled"
        ? { digitalTwinEnabled: true }
        : status === "disabled"
          ? { digitalTwinEnabled: false }
          : {}),
    };
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      sort === "name_desc"
        ? [{ name: "desc" }, { id: "asc" }]
        : sort === "email_asc"
          ? [{ email: "asc" }, { id: "asc" }]
          : sort === "recently_enabled"
            ? [{ digitalTwinEnabledAt: { sort: "desc", nulls: "last" } }, { name: "asc" }]
            : [{ name: "asc" }, { id: "asc" }];

    const [rows, total, enabled, disabled, organizations] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          orgId: true,
          digitalTwinEnabled: true,
          digitalTwinEnabledAt: true,
          digitalTwinBackfillState: true,
          org: { select: { name: true } },
        },
      }),
      prisma.user.count({ where }),
      prisma.user.count({ where: { ...baseWhere, digitalTwinEnabled: true } }),
      prisma.user.count({ where: { ...baseWhere, digitalTwinEnabled: false } }),
      prisma.organization.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          orgId: row.orgId,
          orgName: row.org.name,
          enabled: row.digitalTwinEnabled,
          enabledAt: row.digitalTwinEnabledAt,
          backfill: summarizeAdminBackfill(row.digitalTwinBackfillState),
        })),
        total,
        limit,
        offset,
        summary: { enabled, disabled, total: enabled + disabled },
        organizations,
      },
    });
  } catch (error) {
    sendControlError(res, error);
  }
});

router.post("/users/:userId/enable", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    // The URL parameter may be a canonical Claw id OR a Spaces alias —
    // normalize when resolvable; the service layer rejects unknown ids.
    const userId = (await findUserByAnyId(req.params.userId))?.id ?? req.params.userId;
    const backfill = parseBackfill((req.body as { backfill?: unknown } | undefined)?.backfill, false);
    const result = await adminEnableDigitalTwin({
      userId,
      ...(backfill !== undefined ? { backfill } : {}),
    });
    log.info("CLAW_ADMIN enabled Digital Twin for user", {
      actorUserId: getRequesterId(req),
      targetUserId: userId,
      backfillStarted: result.backfillJobIds.length > 0,
    });
    res.json({ success: true, data: { enabled: true, ...result } });
  } catch (error) {
    sendControlError(res, error);
  }
});

router.post("/users/:userId/disable", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const userId = (await findUserByAnyId(req.params.userId))?.id ?? req.params.userId;
    const result = await adminDisableDigitalTwin(userId);
    log.info("CLAW_ADMIN disabled Digital Twin for user", {
      actorUserId: getRequesterId(req),
      targetUserId: userId,
      cancelledJobs: result.cancelledJobs,
    });
    res.json({ success: true, data: { disabled: true, ...result } });
  } catch (error) {
    sendControlError(res, error);
  }
});

router.post("/users/:userId/backfill", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const userId = (await findUserByAnyId(req.params.userId))?.id ?? req.params.userId;
    const backfill = parseBackfill((req.body as { backfill?: unknown } | undefined)?.backfill, true)!;
    const result = await adminStartDigitalTwinBackfill({ userId, backfill });
    log.info("CLAW_ADMIN started Digital Twin backfill for user", {
      actorUserId: getRequesterId(req),
      targetUserId: userId,
      from: backfill.from,
      to: backfill.to,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    sendControlError(res, error);
  }
});

export { router as adminDigitalTwinRouter };
