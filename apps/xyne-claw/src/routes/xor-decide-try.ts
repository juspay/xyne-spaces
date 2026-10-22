import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { decideBatch, validateQuestions, type DecideItem } from "../xor-decide.js";
import { isImageDataUrl, xorEnabled } from "../xor.js";
import { CURRENT_MODEL, findRegressions, formatEvalReport, MAX_EVAL_MODELS, MAX_EVAL_SAMPLES, runChecksEval, type EvalSample, type Expected } from "../xor-eval.js";

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

const MODEL_RE = /^[a-zA-Z0-9._:/-]{1,100}$/;

function parseSamples(raw: unknown): EvalSample[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "samples must be a non-empty array";
  if (raw.length > MAX_EVAL_SAMPLES) return `at most ${MAX_EVAL_SAMPLES} samples`;
  const out: EvalSample[] = [];
  for (const [i, r] of (raw as Array<Record<string, unknown>>).entries()) {
    const text = typeof r?.["text"] === "string" ? r["text"].trim().slice(0, MAX_TEXT) : typeof r?.["input"] === "string" ? r["input"].trim().slice(0, MAX_TEXT) : "";
    const image = typeof r?.["image"] === "string" ? r["image"] : "";
    if (image && (!isImageDataUrl(image) || image.length > MAX_IMAGE_CHARS)) return `samples[${i}].image must be a base64 image data URL under 8 MB`;
    if (!text && !image) return `samples[${i}] needs text or an image`;
    const expected = r?.["expected"];
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) return `samples[${i}].expected must be an object`;
    out.push({ id: typeof r["id"] === "string" ? r["id"].slice(0, 80) : `sample-${i + 1}`, ...(text ? { text } : {}), ...(image ? { image } : {}), expected: expected as Record<string, Expected> });
  }
  return out;
}

router.post("/xor-decide/eval", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as { checks?: unknown; samples?: unknown; models?: unknown; compare?: unknown; variants?: unknown; context?: unknown };
  const q = validateQuestions(body.checks);
  if ("error" in q) {
    res.status(400).json({ success: false, error: `checks: ${q.error}` });
    return;
  }
  const samples = parseSamples(body.samples);
  if (typeof samples === "string") {
    res.status(400).json({ success: false, error: samples });
    return;
  }
  const compare = Array.isArray(body.compare) ? body.compare : [];
  const models = Array.isArray(body.models) && body.models.length > 0 ? body.models : [...new Set([CURRENT_MODEL, ...compare])];
  if (models.length > MAX_EVAL_MODELS || !models.every((m) => typeof m === "string" && MODEL_RE.test(m))) {
    res.status(400).json({ success: false, error: `models must be 1–${MAX_EVAL_MODELS} model ids` });
    return;
  }
  const variants =
    body.variants && typeof body.variants === "object" && !Array.isArray(body.variants)
      ? Object.fromEntries(Object.entries(body.variants as Record<string, unknown>).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === "string")]))
      : undefined;
  if (!xorEnabled()) {
    res.status(503).json({ success: false, error: "xor is not configured on this deployment" });
    return;
  }
  const report = await runChecksEval({
    checks: q.questions,
    samples,
    models: models as string[],
    ...(variants ? { variants } : {}),
    ...(typeof body.context === "string" && body.context.trim() ? { context: body.context.slice(0, 4_000) } : {}),
  });
  const [base, ...rest] = report.models;
  const regressions = base ? rest.map((m) => ({ model: m.model, regressions: findRegressions(base, m) })) : [];
  res.json({ success: true, report, regressions, markdown: formatEvalReport(report) });
});

export { router as xorDecideTryRouter };
