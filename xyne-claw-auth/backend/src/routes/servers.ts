import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { isValidServerType } from "../validation.js";
import { getAdapters } from "../mcp/runner.js";
import type { CredentialField } from "../mcp/types.js";

const router = Router();

router.get("/credential-fields", (_req: Request, res: Response) => {
  const adapters = getAdapters();
  const data: Record<string, readonly CredentialField[]> = {};
  for (const [type, adapter] of Object.entries(adapters)) {
    data[type] = adapter.credentialFields;
  }
  res.json({ success: true, data });
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const servers = await prisma.mcpServer.findMany({
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: servers });
  } catch (err) {
    console.error("[servers] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, type, url, description } = req.body as {
      name?: string;
      type?: string;
      url?: string;
      description?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    if (!type || typeof type !== "string" || !isValidServerType(type)) {
      res.status(400).json({ success: false, error: "type must be one of: kibana, grafana, bitbucket, xyne-spaces" });
      return;
    }

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      res.status(400).json({ success: false, error: "url is required" });
      return;
    }

    const data: { name: string; type: string; url: string; description?: string } = {
      name: name.trim(),
      type,
      url: url.trim(),
    };
    if (description && typeof description === "string" && description.trim().length > 0) {
      data.description = description.trim();
    }

    const server = await prisma.mcpServer.create({ data });
    res.status(201).json({ success: true, data: server });
  } catch (err) {
    console.error("[servers] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    await prisma.mcpServer.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    console.error("[servers] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as serversRouter };
