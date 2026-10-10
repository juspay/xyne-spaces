import { Router, type Request, type Response } from "express";
import { getRequesterId } from "../middleware/agent-acl.js";
import { nextPagePanelCall, resolvePagePanelCall, servePagePanelStream } from "../lib/page-panel-calls.js";

const router = Router();

router.get("/page-calls/next", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Not signed in" });
    return;
  }
  const raw = typeof req.query["runIds"] === "string" ? req.query["runIds"] : "";
  const runIds = raw.split(",").map((id) => id.trim()).filter(Boolean);
  const panelOpen = req.query["panel"] !== "0";
  const call = runIds.length > 0 ? await nextPagePanelCall(userId, runIds, panelOpen) : null;
  res.json({ success: true, data: { call } });
});

// Under the presence TTL, so the run reads as open for as long as the stream is.
const STREAM_HEARTBEAT_MS = 3_000;

router.get("/page-calls/stream", async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Not signed in" });
    return;
  }
  const raw = typeof req.query["runIds"] === "string" ? req.query["runIds"] : "";
  const runIds = raw.split(",").map((id) => id.trim()).filter(Boolean);
  if (runIds.length === 0) {
    res.status(400).json({ success: false, error: "runIds is required" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (istio/nginx)
  });
  let stop: (() => void) | null = null;
  let closed = false;
  res.on("close", () => {
    closed = true;
    stop?.();
  });
  const started = await servePagePanelStream({
    userId,
    runIds,
    panelOpen: req.query["panel"] !== "0",
    write: (chunk) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    },
    heartbeatMs: STREAM_HEARTBEAT_MS,
  });
  if (closed) started();
  else stop = started;
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
