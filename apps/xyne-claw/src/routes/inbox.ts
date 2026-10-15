import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import {
  decideInterrupt,
  extractOpenLoops,
  inboxJevAvailable,
  triageItems,
  type ExtractInput,
  type ExtractMessage,
  type InboxTriageItem,
} from "../inbox-triage.js";

const router = Router();

const MAX_TRIAGE_ITEMS = 100;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : null;
}

router.post("/inbox/triage", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const raw = (req.body as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ success: false, error: "items is required" });
    return;
  }
  const items: InboxTriageItem[] = [];
  for (const entry of raw.slice(0, MAX_TRIAGE_ITEMS)) {
    const key = str((entry as { key?: unknown })?.key, 200);
    const state = str((entry as { state?: unknown })?.state, 8_000);
    if (key && state) items.push({ key, state });
  }
  if (items.length === 0) {
    res.status(400).json({ success: false, error: "no valid items" });
    return;
  }
  if (!inboxJevAvailable()) {
    res.status(503).json({ success: false, error: "jev_unavailable" });
    return;
  }
  res.json({ success: true, results: await triageItems(items) });
});

router.post("/inbox/interrupt", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const state = str((req.body as { state?: unknown } | undefined)?.state, 8_000);
  if (!state) {
    res.status(400).json({ success: false, error: "state is required" });
    return;
  }
  if (!inboxJevAvailable()) {
    res.status(503).json({ success: false, error: "jev_unavailable" });
    return;
  }
  const result = await decideInterrupt(state);
  if (!result) {
    res.status(503).json({ success: false, error: "jev_unavailable" });
    return;
  }
  res.json({ success: true, ...result });
});

router.post("/inbox/extract", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = str(body["now"], 64);
  const timezone = str(body["timezone"], 64) ?? "UTC";
  const rawMessages = Array.isArray(body["messages"]) ? body["messages"] : [];
  const messages: ExtractMessage[] = [];
  for (const m of rawMessages.slice(-20)) {
    const entry = (m ?? {}) as Record<string, unknown>;
    const text = str(entry["text"], 4_000);
    if (!text) continue;
    messages.push({
      from: str(entry["from"], 200) ?? "unknown",
      at: str(entry["at"], 64) ?? "",
      fromUser: entry["fromUser"] === true,
      text,
    });
  }
  if (!now || messages.length === 0) {
    res.status(400).json({ success: false, error: "now and messages are required" });
    return;
  }
  const input: ExtractInput = { now, timezone, messages };
  const userName = str(body["userName"], 200);
  const userAddress = str(body["userAddress"], 200);
  const subject = str(body["subject"], 300);
  if (userName) input.userName = userName;
  if (userAddress) input.userAddress = userAddress;
  if (subject) input.subject = subject;
  const result = await extractOpenLoops(input);
  if (!result) {
    res.status(503).json({ success: false, error: "extract_unavailable" });
    return;
  }
  res.json({ success: true, ...result });
});

export { router as inboxRouter };
