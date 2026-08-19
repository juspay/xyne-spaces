/**
 * EnterpriseRAG-Bench answerer + fact/relevance judges.
 *
 * One-shot LLM helpers mirroring the existing goal/eval judges: the LiteLLM key
 * lives on claw, claw-auth/backend POSTs inputs over S2S, and gets a structured
 * verdict back. Three roles, all on LITELLM.model (the primary model) for
 * answer/judgement fidelity:
 *
 *   - answerer      — the benchmark system under test. Receives a question plus
 *                     the Vespa top-K retrieved documents (full content) and
 *                     must produce a grounded answer. Returns the plain answer
 *                     text; the benchmark harness owns the retrieved
 *                     document_ids (we do NOT trust the model to report them).
 *   - facts judge   — completeness. Validates each atomic answer_fact against
 *                     the answer INDEPENDENTLY, so one wrong fact can't drag
 *                     others down. Adds `supported` per fact + `completeness`
 *                     fraction (paper §5.1 Completeness).
 *   - relevance     — gold-set correction. Classifies a candidate doc as
 *                     required | valid | invalid. Called 3× per doc by the
 *                     backend and majority-voted (paper §5.3).
 *
 * Every call goes through withLlmSlot so the 500-question run shares the proxy
 * key politely with live agents (see llm-gate.ts). Fails closed on error:
 * answerer → "" (the backend treats an empty answer as judge_unavailable);
 * judges → supported=false / classification="invalid" with a judge_unavailable
 * marker the caller can detect.
 */
import { LITELLM } from "./config.js";
import { withLlmSlot, pauseLlmGate, retryAfterMs } from "./llm-gate.js";

import { createLogger } from "./logger.js";
const log = createLogger("eval-bench");

// Generous timeouts: the answerer ingests up to 10 full documents and a judge
// ingests the answer + facts, so slow LiteLLM-under-load is normal. Bounded so
// a hung call aborts and retries rather than blocking a 500-question batch.
const CALL_TIMEOUT_MS = Number(process.env["EVAL_BENCH_TIMEOUT_MS"] ?? 180_000);
const CALL_RETRIES = 3;
const CALL_BACKOFFS_MS = [1000, 3000];
// Hard caps so a pathological input can't blow the model's context window. Top-K
// is 10 and documents can be long (Fireflies transcripts), so per-doc content is
// truncated but kept large enough to answer from (paper uses full docs).
const MAX_DOCS = 20; // matches backend topK=20; content per doc is capped separately
const MAX_CONTENT_CHARS_PER_DOC = 30_000;
const MAX_FACTS = 64;
const MAX_FACT_CHARS = 2_000;

// ─── Shared LiteLLM helpers ──────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Fire a chat completion through the shared concurrency gate with retry. Returns
 * the parsed tool-call arguments when `tool` is supplied (forced tool-call), or
 * the plain message content otherwise. Returns null on any failure so callers
 * can fail closed.
 */
async function callLiteLLM(opts: {
  model: string;
  system: string;
  user: string;
  tool?: { name: string; parameters: Record<string, unknown> };
  maxTokens?: number;
}): Promise<{ toolArgs?: Record<string, unknown>; content?: string } | null> {
  if (!LITELLM.apiKey) return null;
  const url = `${LITELLM.url}/v1/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${LITELLM.apiKey}`,
  };
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };
  if (opts.tool) {
    body["tools"] = [{ type: "function", function: { name: opts.tool.name, description: opts.tool.name, parameters: opts.tool.parameters } }];
    body["tool_choice"] = { type: "function", function: { name: opts.tool.name } };
  }

  for (let attempt = 1; attempt <= CALL_RETRIES; attempt++) {
    const last = attempt === CALL_RETRIES;
    try {
      const doFetch = () =>
        fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
      const res = await withLlmSlot(doFetch);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        if (res.status === 429) pauseLlmGate(retryAfterMs(res.headers.get("retry-after")) ?? 5_000);
        log.warn(`[eval-bench] LiteLLM ${res.status} (model=${opts.model}, attempt=${attempt}/${CALL_RETRIES}, retryable=${retryable}): ${text.slice(0, 200)}`);
        if (!retryable || last) return null;
      } else {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
        };
        const msg = data.choices?.[0]?.message;
        if (opts.tool) {
          const raw = msg?.tool_calls?.[0]?.function?.arguments;
          if (!raw) {
            log.warn(`[eval-bench] no tool_call in response (attempt=${attempt}/${CALL_RETRIES})`);
            if (last) return null;
          } else {
            try {
              return { toolArgs: JSON.parse(raw) as Record<string, unknown> };
            } catch {
              log.warn(`[eval-bench] bad tool_call JSON (attempt=${attempt}/${CALL_RETRIES})`);
              if (last) return null;
            }
          }
        } else {
          const content = typeof msg?.content === "string" ? msg.content : "";
          if (attempt > 1) log.info(`[eval-bench] succeeded on attempt ${attempt} (model=${opts.model})`);
          return { content };
        }
      }
    } catch (err) {
      log.warn(`[eval-bench] call failed (attempt=${attempt}/${CALL_RETRIES}): ${err instanceof Error ? err.message : String(err)}`);
      if (last) return null;
    }
    await new Promise((r) => setTimeout(r, CALL_BACKOFFS_MS[attempt - 1] ?? 3000));
  }
  return null;
}

// ─── Answerer (2nd agent) ────────────────────────────────────────────────────

export interface EvalDoc {
  benchmarkDocId?: string | null;
  title?: string;
  content: string;
}

const ANSWERER_SYSTEM = `You are a precise enterprise knowledge assistant for the fictional company "Redwood Inference".

You answer the user's question using ONLY the retrieved documents below. Every document is labelled EX-[01], EX-[02], … in the order it was retrieved.

Rules:
- Base the answer strictly on the retrieved documents. Do not use outside knowledge.
- If the documents do not contain the answer, say exactly that the information is not available instead of guessing.
- When documents conflict, prefer the most recent / superseding information and note the discrepancy.
- Answer directly in prose. Do NOT put the EX-[nn] markers inside the prose body.
- After you finish the answer, on the FINAL line output ONLY the markers of the documents you actually relied on, space-separated, e.g.:
  EX-[01] EX-[04] EX-[12]
  List every document that contributed a fact to your answer; none you didn't use.
- Be complete: cover every distinct fact in the documents relevant to the question.`;

/**
 * Generate the benchmark answer for one question from its Vespa top-K docs.
 * Plain-text completion (no tool-call) — the answer is free prose.
 */
export async function answerFromDocs(input: {
  question: string;
  docs: EvalDoc[];
  model?: string | undefined;
}): Promise<{ answer: string; model: string }> {
  const model = (input.model && input.model.trim()) || LITELLM.model; // primary for fidelity
  if (!LITELLM.apiKey || input.docs.length === 0) {
    return { answer: "", model };
  }
  const docs = input.docs.slice(0, MAX_DOCS);
  const docsBlock = docs
    .map((d, i) => {
      const text = String(d.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_CHARS_PER_DOC);
      const title = (d.title ?? "").slice(0, 256);
      return `EX-[${String(i + 1).padStart(2, "0")}] ${title}\n${text}`;
    })
    .join("\n\n");

  const userContent = [
    `Question: ${input.question}`,
    "",
    "--- Retrieved documents (top-K, full content) ---",
    docsBlock,
  ].join("\n");

  const res = await callLiteLLM({ model, system: ANSWERER_SYSTEM, user: userContent, maxTokens: 2_048 });
  return { answer: (res?.content ?? "").trim(), model };
}

// ─── Completeness (per-fact judge) ──────────────────────────────────────────

const FACTS_SYSTEM = `You are a meticulous grader. You are given a candididate ANSWER and a list of atomic FACTS.

For EACH fact, independently decide whether the answer contains or implies it. Judge each fact in isolation — never let one fact's verdict influence another's.

- supported  = true  if a careful reader of the answer would learn that fact's content.
- supported  = false if the answer omits it, contradicts it, or only mentions it vaguely.

Be literal: a fact is supported only when the answer actually conveys it, not merely gestures at it.`;

const FACTS_TOOL = {
  name: "report",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 0, description: "0-based index into the FACTS list" },
            supported: { type: "boolean" },
          },
          required: ["index", "supported"],
        },
      },
    },
    required: ["verdicts"],
  },
};

/**
 * Validate each atomic answer_fact against the answer, independently. Returns a
 * per-fact boolean and the completeness fraction (supported / total). Facts that
 * the model never returned a verdict for are treated as unsupported (fail closed).
 */
export async function gradeAnswerFacts(input: {
  answer: string;
  answerFacts: string[];
  model?: string | undefined;
}): Promise<{ supported: boolean[]; completeness: number; model: string }> {
  const model = (input.model && input.model.trim()) || LITELLM.model;
  const facts = input.answerFacts.slice(0, MAX_FACTS).map((f) => String(f ?? "").slice(0, MAX_FACT_CHARS));
  if (!LITELLM.apiKey || facts.length === 0 || !input.answer.trim()) {
    return { supported: facts.map(() => false), completeness: 0, model };
  }

  const factsList = facts.map((f, i) => `[${i}] ${f}`).join("\n");
  const userContent = [
    "--- ANSWER ---",
    input.answer.slice(0, 12_000),
    "",
    "--- FACTS (index === verdict.index) ---",
    factsList,
  ].join("\n");

  const res = await callLiteLLM({
    model,
    system: FACTS_SYSTEM,
    user: userContent,
    tool: FACTS_TOOL,
    maxTokens: 2_048,
  });
  const verdicts = Array.isArray(res?.toolArgs?.["verdicts"]) ? (res.toolArgs["verdicts"] as Array<Record<string, unknown>>) : [];
  const byIndex = new Map<number, boolean>();
  for (const v of verdicts) {
    const idx = typeof v?.["index"] === "number" ? Math.trunc(v["index"]) : -1;
    if (idx >= 0 && idx < facts.length && typeof v?.["supported"] === "boolean") byIndex.set(idx, v["supported"]);
  }
  const supported = facts.map((_, i) => byIndex.get(i) === true);
  const n = supported.filter(Boolean).length;
  return { supported, completeness: facts.length > 0 ? n / facts.length : 0, model };
}

// ─── Correctness (paper §5.1, binary) ───────────────────────────────────────

const CORRECTNESS_SYSTEM = `You are a strict but fair grader. You are given the GOLD (ground-truth) answer and a CANDIDATE answer.

Decide whether the CANDIDATE is CORRECT.

Leniency you MUST apply:
- Ignore stylistic differences, extra context, and supplementary detail.
- Reward correct meaning even if phrasing or formatting differ.

Disqualify (NOT correct) if ANY holds:
- A factual conflict with the GOLD answer (a wrong number, wrong name, wrong date, wrong entity…).
- A quantity that mismatches the GOLD answer.
- The candidate is empty, refuses, or is largely off-topic.

Be conservative: one clear conflict = NOT correct, even if the rest matches.`;

const CORRECTNESS_TOOL = {
  name: "verdict",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      correct: { type: "boolean" },
      reasoning: { type: "string", description: "≤200 chars, plain English, no markdown." },
    },
    required: ["correct", "reasoning"],
  },
};

/**
 * Paper §5.1 correctness: BINARY correct/incorrect, lenient on style, strict on
 * factual conflicts. Independent: sees only (gold_answer, candidate) — NOT
 * answer_facts. Returns 0/1 so the leaderboard can gate completeness on it.
 * Fails closed to 0 on judge outage so a broken judge never inflates scores.
 */
export async function judgeCorrectness(input: {
  expected: string;
  generated: string;
  model?: string | undefined;
}): Promise<{ correct: 0 | 1; reasoning: string; model: string }> {
  const model = (input.model && input.model.trim()) || LITELLM.model;
  if (!LITELLM.apiKey || !input.generated.trim() || !input.expected.trim()) {
    return { correct: 0, reasoning: "judge_unavailable", model };
  }
  const userContent = [
    "--- GOLD (ground-truth) answer ---",
    input.expected.slice(0, 8_000),
    "",
    "--- CANDIDATE answer ---",
    input.generated.slice(0, 8_000),
  ].join("\n");

  const res = await callLiteLLM({
    model,
    system: CORRECTNESS_SYSTEM,
    user: userContent,
    tool: CORRECTNESS_TOOL,
    maxTokens: 512,
  });
  const correct = res?.toolArgs?.["correct"] === true ? 1 : 0;
  const reasoning = typeof res?.toolArgs?.["reasoning"] === "string" ? (res.toolArgs["reasoning"] as string).slice(0, 240) : "";
  return { correct: correct as 0 | 1, reasoning, model };
}

// ─── Relevance (3-judge gold-set correction) ────────────────────────────────

export type RelevanceLabel = "required" | "valid" | "invalid";

const RELEVANCE_SYSTEM = `You are a retrieval-relevance judge for one QUESTION.

Classify the CANDIDATE document as exactly one of:
- "required" : the document carries information essential to answering the question (a correct, complete answer depends on it).
- "valid"    : relevant and helpful, but not strictly necessary to answer.
- "invalid"  : does not help answer the question.

Judge only helpfulness for answering — not popularity, not length, not how on-topic the title sounds. Answer with the single most accurate label.`;

const RELEVANCE_TOOL = {
  name: "classify",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string", enum: ["required", "valid", "invalid"] },
      note: { type: "string", description: "≤120 chars, plain English, no markdown." },
    },
    required: ["label", "note"],
  },
};

/**
 * One relevance vote for a candidate doc. The backend calls this 3× per doc and
 * majority-votes (gold-biased tie-break). Fails closed to "invalid" so a judge
 * outage never promotes junk into the gold set.
 */
export async function judgeRelevanceOnce(input: {
  question: string;
  doc: EvalDoc;
  model?: string | undefined;
}): Promise<{ label: RelevanceLabel; note: string; model: string }> {
  const model = (input.model && input.model.trim()) || LITELLM.model;
  if (!LITELLM.apiKey) {
    return { label: "invalid", note: "judge_unavailable", model };
  }
  // Empty content is honest "cannot help answer" evidence, not a judge outage —
  // distinct note so the caller's gold-biased tie-break can tell them apart.
  if (!input.doc.content?.trim()) {
    return { label: "invalid", note: "no_content", model };
  }
  const text = String(input.doc.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_CHARS_PER_DOC);
  const userContent = [
    `QUESTION: ${input.question}`,
    "",
    "--- CANDIDATE DOCUMENT ---",
    (input.doc.title ?? "").slice(0, 256),
    text,
  ].join("\n");

  const res = await callLiteLLM({ model, system: RELEVANCE_SYSTEM, user: userContent, tool: RELEVANCE_TOOL, maxTokens: 256 });
  const label = (res?.toolArgs?.["label"] as string | undefined) ?? "invalid";
  const note = typeof res?.toolArgs?.["note"] === "string" ? (res.toolArgs["note"] as string).slice(0, 160) : "";
  return { label: (["required", "valid", "invalid"].includes(label) ? label : "invalid") as RelevanceLabel, note, model };
}
