/**
 * S2S endpoints exposing the EnterpriseRAG-Bench (Onyx) answerer + judges to
 * claw-auth, under the overarching /eval-onyx path.
 *
 * Same "LLM-on-claw-only" structure as routes/eval-judge.ts: the LiteLLM key
 * lives on claw, claw-auth's onyx-eval worker POSTs judging requests here and
 * scores the (paper-strict) metrics itself. The benchmark ANSWER never comes
 * through this route — it runs through the ask-ai agent (real prod path).
 * Routes:
 *
 *   POST /eval-onyx/correctness     — paper §5.1 binary correctness judge (independent of facts).
 *   POST /eval-onyx/facts           — paper §5.1 completeness judge: per-fact support.
 *   POST /eval-onyx/relevance       — paper §5.3 single relevance vote (harness calls 3×/doc).
 *   POST /eval-onyx/regenerate-gold — paper §5.3 gold answer + facts regeneration on correction.
 *
 * All plain S2S (validateS2SKey) — the LiteLLM key never leaves claw.
 *
 * NOTE: validation is manual (no zod) to keep xyne-claw dependency-free — this
 * mirrors the defensive body-parsing in routes/goal-judge.ts.
 */
import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import {
  gradeAnswerFacts,
  judgeCorrectness,
  judgeRelevanceOnce,
  regenerateGoldFromDocs,
  type OnyxEvalDoc,
} from "../eval-onyx.js";

const router = Router();

/** Defensively coerce an unknown doc entry into OnyxEvalDoc, or null when unusable. */
function parseDoc(v: unknown): OnyxEvalDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["content"] !== "string" || o["content"].trim().length === 0) return null;
  const doc: OnyxEvalDoc = { content: o["content"].slice(0, 200_000) };
  if (typeof o["title"] === "string") doc.title = o["title"].slice(0, 256);
  if (typeof o["benchmarkDocId"] === "string") doc.benchmarkDocId = o["benchmarkDocId"];
  else if (o["benchmarkDocId"] === null) doc.benchmarkDocId = null;
  return doc;
}

function parseDocs(v: unknown): OnyxEvalDoc[] {
  return (Array.isArray(v) ? v : []).map(parseDoc).filter((d): d is OnyxEvalDoc => d !== null).slice(0, 20);
}

function parseStrings(v: unknown, max: number): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, max);
}

const MODEL = (b: Record<string, unknown>): string | undefined =>
  typeof b["model"] === "string" && b["model"].trim() ? b["model"].trim() : undefined;

const requireQuestion = (body: Record<string, unknown> | undefined): string | null => {
  if (!body || typeof body["question"] !== "string" || body["question"].trim().length === 0) return null;
  return body["question"];
};

router.post("/eval-onyx/correctness", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body["expected"] !== "string" || typeof body["generated"] !== "string") {
    res.status(400).json({ success: false, error: "expected and generated must be strings" });
    return;
  }
  const { correct, reasoning, model } = await judgeCorrectness({ expected: body["expected"], generated: body["generated"], model: MODEL(body) });
  res.json({ success: true, correct, reasoning, model });
});

router.post("/eval-onyx/facts", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body["answer"] !== "string") {
    res.status(400).json({ success: false, error: "answer must be a string" });
    return;
  }
  const answerFacts = parseStrings(body["answerFacts"], 64);
  if (answerFacts.length === 0) {
    res.status(400).json({ success: false, error: "answerFacts must be a non-empty string array" });
    return;
  }
  const { supported, completeness, model } = await gradeAnswerFacts({ answer: body["answer"], answerFacts, model: MODEL(body) });
  res.json({ success: true, supported, completeness, model });
});

router.post("/eval-onyx/relevance", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  const question = requireQuestion(body);
  if (!question) {
    res.status(400).json({ success: false, error: "question is required" });
    return;
  }
  const doc = parseDoc(body?.["doc"]);
  if (!doc) {
    res.status(400).json({ success: false, error: "doc must be an object with a non-empty content string" });
    return;
  }
  const { label, note, model } = await judgeRelevanceOnce({ question, doc, model: MODEL(body!) });
  res.json({ success: true, label, note, model });
});

router.post("/eval-onyx/regenerate-gold", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  const question = requireQuestion(body);
  if (!question) {
    res.status(400).json({ success: false, error: "question is required" });
    return;
  }
  const docs = parseDocs(body?.["docs"]);
  if (docs.length === 0) {
    res.status(400).json({ success: false, error: "docs must contain at least one item with a non-empty content string" });
    return;
  }
  const { goldAnswer, answerFacts, model } = await regenerateGoldFromDocs({
    question,
    docs,
    originalFacts: parseStrings(body?.["originalFacts"], 64),
    model: MODEL(body!),
  });
  res.json({ success: true, goldAnswer, answerFacts, model });
});

export { router as evalOnyxRouter };
