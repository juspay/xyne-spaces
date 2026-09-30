import { Router, type Request, type Response } from "express";
import { getRequesterId } from "../middleware/agent-acl.js";
import { nextPagePanelCall, resolvePagePanelCall } from "../lib/page-panel-calls.js";

const router = Router();

router.get("/page-calls/next", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Not signed in" });
    return;
  }
  const raw = typeof req.query["runIds"] === "string" ? req.query["runIds"] : "";
  const runIds = raw.split(",").map((id) => id.trim()).filter(Boolean);
  const call = runIds.length > 0 ? await nextPagePanelCall(userId, runIds) : null;
  res.json({ success: true, data: { call } });
});

router.post("/page-calls/:callId/result", async (req: Request<{ callId: string }>, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Not signed in" });
    return;
  }
  const accepted = await resolvePagePanelCall(userId, req.params.callId, req.body);
  if (!accepted) {
    res.status(404).json({ success: false, error: "Call not found" });
    return;
  }
  res.json({ success: true });
});

export { router as pagePanelRouter };
