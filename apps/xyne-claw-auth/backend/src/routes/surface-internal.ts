import { Router, type Request, type Response } from "express";
import { callSurfaceTool, isSurfaceTool } from "../lib/surface-calls.js";

const router = Router();

router.post("/call", async (req: Request, res: Response) => {
  const body = req.body as {
    userId?: unknown;
    sessionId?: unknown;
    toolName?: unknown;
    params?: unknown;
  } | null;

  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const toolName = typeof body?.toolName === "string" ? body.toolName.trim() : "";
  if (!userId || !toolName) {
    res.status(400).json({ success: false, error: "userId and toolName are required" });
    return;
  }
  if (!isSurfaceTool(toolName)) {
    res.status(400).json({ success: false, error: "Unknown app tool" });
    return;
  }

  const params =
    body?.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};

  const result = await callSurfaceTool({
    userId,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : null,
    toolName,
    args: params,
  });

  res.json({ success: true, data: result });
});

export { router as surfaceInternalRouter };
