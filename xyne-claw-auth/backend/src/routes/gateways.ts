import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

import { createLogger } from "../logger.js";
const log = createLogger("gateways");

const router = Router();

// ── Gateway CRUD ─────────────────────────────────────────────────────

router.get("/", async (_req: Request, res: Response) => {
  try {
    const gateways = await prisma.gateway.findMany({
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: gateways });
  } catch (err) {
    log.error("[gateways] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { type, name, config } = req.body as {
      type?: string;
      name?: string;
      config?: Record<string, unknown>;
    };

    if (!type || typeof type !== "string" || type.trim().length === 0) {
      res.status(400).json({ success: false, error: "type is required" });
      return;
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    const gateway = await prisma.gateway.create({
      data: {
        type: type.trim(),
        name: name.trim(),
        config: (config ?? {}) as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({ success: true, data: gateway });
  } catch (err) {
    log.error("[gateways] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

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

router.get("/:id/identities", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const identities = await prisma.gatewayIdentity.findMany({
      where: { gatewayId: req.params.id },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: identities });
  } catch (err) {
    log.error("[gateways] list identities error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:id/identities", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const gatewayId = req.params.id;
    const { externalUserId, userId } = req.body as {
      externalUserId?: string;
      userId?: string;
    };

    if (!externalUserId || typeof externalUserId !== "string" || externalUserId.trim().length === 0) {
      res.status(400).json({ success: false, error: "externalUserId is required" });
      return;
    }

    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }

    // Verify gateway exists
    const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
    if (!gateway) {
      res.status(404).json({ success: false, error: "Gateway not found" });
      return;
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId.trim() } });
    if (!user) {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    const identity = await prisma.gatewayIdentity.upsert({
      where: { gatewayId_externalUserId: { gatewayId, externalUserId: externalUserId.trim() } },
      create: {
        gatewayId,
        externalUserId: externalUserId.trim(),
        userId: userId.trim(),
      },
      update: {
        userId: userId.trim(),
      },
      include: { user: true, gateway: true },
    });

    res.status(201).json({ success: true, data: identity });
  } catch (err) {
    log.error("[gateways] link identity error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

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
