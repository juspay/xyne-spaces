import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { decideBatch, validateQuestions, type DecideItem } from "../xor-decide.js";
import { isImageDataUrl, xorEnabled } from "../xor.js";

const MAX_TEXT = 12_000;
const MAX_IMAGE_CHARS = 11_000_000;

const router = Router();

router.post("/xor-decide/try", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as { questions?: unknown; item?: { text?: unknown; image?: unknown }; context?: unknown };
  const q = validateQuestions(body.questions);
  if ("error" in q) {
    res.status(400).json({ success: false, error: q.error });
    return;
  }
  const text = typeof body.item?.text === "string" ? body.item.text.trim().slice(0, MAX_TEXT) : "";
  const image = typeof body.item?.image === "string" ? body.item.image : "";
  if (image && (!isImageDataUrl(image) || image.length > MAX_IMAGE_CHARS)) {
    res.status(400).json({ success: false, error: "image must be a base64 png/jpeg/webp data URL under 8 MB" });
    return;
  }
  if (!text && !image) {
    res.status(400).json({ success: false, error: "paste some text or add a screenshot to try" });
    return;
  }
  if (!xorEnabled()) {
    res.status(503).json({ success: false, error: "xor is not configured on this deployment" });
    return;
  }
  const item: DecideItem = { id: "sample", ...(text ? { text } : {}), ...(image ? { image } : {}) };
  const started = Date.now();
  const result = await decideBatch({
    items: [item],
    questions: q.questions,
    ...(typeof body.context === "string" && body.context.trim() ? { context: body.context.slice(0, 4_000) } : {}),
    purpose: "xor-decide-try",
  });
  res.json({
    success: true,
    answers: result.items[0]?.answers ?? {},
    unavailable: result.unavailable > 0,
    ms: Date.now() - started,
  });
});

export { router as xorDecideTryRouter };
