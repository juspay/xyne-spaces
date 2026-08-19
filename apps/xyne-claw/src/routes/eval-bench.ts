/**
 * S2S endpoints for the EnterpriseRAG-Bench harness.
 *
 * Same "LLM-on-claw-only" pattern as the existing goal/eval judges: the LiteLLM
 * key lives on claw, so the onyx backend POSTs answer-generation and judging
 * requests here rather than spawning its own model client. Three routes:
 *
 *   POST /eval-answer    — 2nd agent (answerer): question + retrieved docs → answer text.
 *   POST /eval-facts     — completeness judge: answer + answer_facts → per-fact support.
 *   POST /eval-relevance — one gold-set-correction vote (backend calls 3× + majority).
 *
 * All plain S2S (validateS2SKey) — the LiteLLM key never leaves claw.
 *
 * NOTE: validation is manual (no zod) to keep xyne-claw dependency-free — this
 * mirrors the defensive body-parsing in routes/goal-judge.ts.
 */
import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { answerFromDocs, gradeAnswerFacts, judgeCorrectness, judgeRelevanceOnce, type EvalDoc } from "../eval-bench.js";

const router = Router();

/** Defensively coerce an unknown doc entry into EvalDoc, or null when unusable. */
function parseDoc(v: unknown): EvalDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["content"] !== "string" || o["content"].trim().length === 0) return null;
  const doc: EvalDoc = { content: o["content"].slice(0, 200_000) };
  if (typeof o["title"] === "string") doc.title = o["title"].slice(0, 256);
  if (typeof o["benchmarkDocId"] === "string") doc.benchmarkDocId = o["benchmarkDocId"];
  else if (o["benchmarkDocId"] === null) doc.benchmarkDocId = null;
  return doc;
}

const MODEL = (b: Record<string, unknown>): string | undefined =>
  typeof b["model"] === "string" && b["model"].trim() ? b["model"].trim() : undefined;

router.post("/eval-answer", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body["question"] !== "string" || body["question"].trim().length === 0) {
    res.status(400).json({ success: false, error: "question is required" });
    return;
  }
  const rawDocs = Array.isArray(body["docs"]) ? body["docs"] : [];
  const docs = rawDocs.map(parseDoc).filter((d): d is EvalDoc => d !== null).slice(0, 20);
  if (docs.length === 0) {
    res.status(400).json({ success: false, error: "docs must contain at least one item with a non-empty content string" });
    return;
  }
  const { answer, model } = await answerFromDocs({ question: body["question"], docs, model: MODEL(body) });
  res.json({ success: true, answer, model });
});

router.post("/eval-facts", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body["answer"] !== "string") {
    res.status(400).json({ success: false, error: "answer must be a string" });
    return;
  }
  const rawFacts = Array.isArray(body["answerFacts"]) ? body["answerFacts"] : [];
  const answerFacts = rawFacts.filter((f): f is string => typeof f === "string" && f.trim().length > 0).slice(0, 64);
  if (answerFacts.length === 0) {
    res.status(400).json({ success: false, error: "answerFacts must be a non-empty string array" });
    return;
  }
  const { supported, completeness, model } = await gradeAnswerFacts({ answer: body["answer"], answerFacts, model: MODEL(body) });
  res.json({ success: true, supported, completeness, model });
});

router.post("/eval-correctness", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body["expected"] !== "string" || typeof body["generated"] !== "string") {
    res.status(400).json({ success: false, error: "expected and generated must be strings" });
    return;
  }
  const { correct, reasoning, model } = await judgeCorrectness({ expected: body["expected"], generated: body["generated"], model: MODEL(body) });
  res.json({ success: true, correct, reasoning, model });
});

router.post("/eval-relevance", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body["question"] !== "string" || body["question"].trim().length === 0) {
    res.status(400).json({ success: false, error: "question is required" });
    return;
  }
  const doc = parseDoc(body["doc"]);
  if (!doc) {
    res.status(400).json({ success: false, error: "doc must be an object with a non-empty content string" });
    return;
  }
  const { label, note, model } = await judgeRelevanceOnce({ question: body["question"], doc, model: MODEL(body) });
  res.json({ success: true, label, note, model });
});

export { router as evalBenchRouter };
