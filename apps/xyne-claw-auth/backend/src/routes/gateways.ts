import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { asyncHandler, ok, badRequest, notFound } from "../lib/http.js";
import { prisma } from "../db.js";
import { findUserByAnyId } from "../lib/users-jit.js";

import { createLogger } from "../logger.js";
const log = createLogger("gateways");

const router = Router();

// ── Gateway CRUD ─────────────────────────────────────────────────────

router.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const gateways = await prisma.gateway.findMany({
    orderBy: { name: "asc" },
  });
  ok(res, gateways);
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { type, name, config } = req.body as {
    type?: string;
    name?: string;
    config?: Record<string, unknown>;
  };

  if (!type || typeof type !== "string" || type.trim().length === 0) {
    throw badRequest("type is required");
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw badRequest("name is required");
  }

  const gateway = await prisma.gateway.create({
    data: {
      type: type.trim(),
      name: name.trim(),
      config: (config ?? {}) as Prisma.InputJsonValue,
    },
  });

  res.status(201).json({ success: true, data: gateway });
}));

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await prisma.gateway.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Gateway not found" });
      return;
    }
    log.error("[gateways] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Identity linking ─────────────────────────────────────────────────

router.get("/:id/identities", asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const identities = await prisma.gatewayIdentity.findMany({
    where: { gatewayId: id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  ok(res, identities);
}));

router.post("/:id/identities", asyncHandler(async (req, res) => {
  const { id: gatewayId } = req.params as { id: string };
  const { externalUserId, userId } = req.body as {
    externalUserId?: string;
    userId?: string;
  };

  if (!externalUserId || typeof externalUserId !== "string" || externalUserId.trim().length === 0) {
    throw badRequest("externalUserId is required");
  }

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    throw badRequest("userId is required");
  }

  // Verify gateway exists
  const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!gateway) {
    throw notFound("Gateway not found");
  }

  // The body userId may be a canonical Claw id OR a Spaces alias —
  // normalize before linking the gateway identity row.
  const user = await findUserByAnyId(userId.trim());
  if (!user) {
    throw notFound("User not found");
  }

  const identity = await prisma.gatewayIdentity.upsert({
    where: { gatewayId_externalUserId: { gatewayId, externalUserId: externalUserId.trim() } },
    create: {
      gatewayId,
      externalUserId: externalUserId.trim(),
      userId: user.id,
    },
    update: {
      userId: userId.trim(),
    },
    include: { user: true, gateway: true },
  });

  res.status(201).json({ success: true, data: identity });
}));

router.delete("/:id/identities/:identityId", async (req: Request<{ id: string; identityId: string }>, res: Response) => {
  try {
    await prisma.gatewayIdentity.delete({ where: { id: req.params.identityId } });
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Identity not found" });
      return;
    }
    log.error("[gateways] delete identity error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as gatewaysRouter };
