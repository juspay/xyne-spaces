import type { JevAnswer, JevQuestion } from "./jev.js";

const SYSTEM_PROMPT = [
  "You are a strict evaluator. You are given a STATE and a set of QUESTIONS about it.",
  "Answer every question using only the STATE. Do not explain.",
  'Reply with one JSON object: {"answers": {"<question id>": <answer>}}.',
  'A "noul" question is yes/no: answer {"noul": p} where p is the probability from 0 to 1 that the answer is yes.',
  'A "choice" question lists options: answer {"choice": "<option key>"} using exactly one listed key.',
  'A "score" question: answer {"score": s} where s is from 0 to 1.',
].join("\n");

export function llmJudgeConfig(): { url: string; key: string; model: string; timeoutMs: number } {
  const base = (process.env["LITELLM_URL"] ?? "").replace(/\/$/, "");
  return {
    url: process.env["JUDGE_LLM_URL"]?.trim() || (base ? `${base}/v1/chat/completions` : ""),
    key:
      process.env["JUDGE_LLM_API_KEY"]?.trim() ||
      process.env["LITELLM_AUTOMATION_API_KEY"]?.trim() ||
      process.env["LITELLM_API_KEY"]?.trim() ||
      "",
    model:
      process.env["JUDGE_LLM_MODEL"]?.trim() ||
      process.env["LITELLM_FAST_MODEL"]?.trim() ||
      process.env["LITELLM_MODEL"]?.trim() ||
      "",
    timeoutMs: Math.max(1000, Number(process.env["JUDGE_LLM_TIMEOUT_MS"]) || 30_000),
  };
}

function renderQuestions(questions: Record<string, JevQuestion>): string {
  return Object.entries(questions)
    .map(([id, q]) => {
      if (q.type === "choice") {
        const options = Object.entries(q.criteria)
          .map(([key, meaning]) => `    ${key}: ${meaning}`)
          .join("\n");
        return `- id: ${id}\n  type: choice\n  question: ${q.instructions}\n  options:\n${options}`;
      }
      if (q.type === "score" && q.criteria?.length) {
        return `- id: ${id}\n  type: score\n  question: ${q.instructions}\n  criteria: ${q.criteria.join("; ")}`;
      }
      return `- id: ${id}\n  type: ${q.type}\n  question: ${q.instructions}`;
    })
    .join("\n");
}

function clamp01(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

export function parseLlmJudgeReply(
  raw: string,
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("judge-llm reply had no JSON object");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { answers?: Record<string, unknown> };
  const source = parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {};
  const out: Record<string, JevAnswer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const entry = source[id];
    const fields = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    if (q.type === "noul") {
      const v = clamp01(typeof entry === "number" || typeof entry === "boolean" ? Number(entry) : fields["noul"]);
      if (v !== undefined) out[id] = { type: "noul", noul: v };
      continue;
    }
    if (q.type === "choice") {
      const pick = typeof entry === "string" ? entry : fields["choice"];
      if (typeof pick === "string" && pick in q.criteria) out[id] = { type: "choice", choice: pick };
      continue;
    }
    const v = clamp01(typeof entry === "number" ? entry : fields["score"]);
    if (v !== undefined) out[id] = { type: "score", score: v };
  }
  return out;
}

export async function llmJudgePost(
  state: string,
  questions: Record<string, JevQuestion>,
  signal: AbortSignal,
): Promise<Record<string, JevAnswer>> {
  const cfg = llmJudgeConfig();
  const res = await fetch(cfg.url, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `STATE:\n${state}\n\nQUESTIONS:\n${renderQuestions(questions)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`judge-llm ${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseLlmJudgeReply(body.choices?.[0]?.message?.content ?? "", questions);
}
