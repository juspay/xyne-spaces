/**
 * EnterpriseRAG-Bench (Onyx) — answerer + paper judges, owned end-to-end by
 * the /eval-onyx/* routes (new harness: claw-auth orchestrates.
 *
 * LiteLLM key lives on claw, claw-auth POSTs inputs over S2S, and gets a
 * structured verdict back. Five roles, all on LITELLM.model (the primary
 * model) for answer/judgement fidelity:
 *
 *   - answerer      — the benchmark system under test. Receives a question
 *                     plus the Vespa top-K retrieved documents (full content)
 *                     and must produce a grounded answer with EX-[nn] source
 *                     markers. The harness owns the retrieved document_ids
 *                     (paper Appendix A.2 answers-file format); the markers
 *                     only annotate usage inside the answer.
 *   - correctness   — paper §5.1: BINARY judge, lenient on style/detail,
 *                     strict on factual conflicts / quantity mismatches. Sees
 *                     only (gold answer, candidate) — never the answer_facts,
 *                     per the paper's independence requirement.
 *   - facts judge   — paper §5.1 completeness: each atomic answer_fact
 *                     validated against the answer INDEPENDENTLY, so one wrong
 *                     fact can't drag others down. Per-fact supported + fraction.
 *   - relevance     — paper §5.3 gold-set correction: classifies one candidate
 *                     doc as required | valid | invalid. claw-auth calls this
 *                     3× per doc and majority-votes (gold-biased tie-break).
 *   - regenerate    — paper §5.3: when the corrected required-set differs from
 *                     the original gold set, regenerate the gold answer +
 *                     answer facts from the updated documents, preserving the
 *                     original anti-hallucination facts verbatim.
 *
 * Every call goes through withLlmSlot so the 500-question run shares the proxy
 * key politely with live agents (see llm-gate.ts). Fails closed on error:
 * answerer → "" (treated as judge_unavailable); judges → correct=0 /
 * supported=false / label="invalid"; regenerate → empty goldAnswer (caller
 * must treat that as "discard the correction", never fabricate gold truth).
 */
import { LITELLM } from "./config.js";
import { withLlmSlot, pauseLlmGate, retryAfterMs } from "./llm-gate.js";

import { createLogger } from "./logger.js";
const log = createLogger("eval-onyx");

const CALL_TIMEOUT_MS = Number(process.env["EVAL_ONYX_TIMEOUT_MS"] ?? process.env["EVAL_BENCH_TIMEOUT_MS"] ?? 300_000);
const CALL_RETRIES = 3;
const CALL_BACKOFFS_MS = [1000, 3000];
// Hard caps so a pathological input can't blow the model's context window. Top-K
// is 10 (paper default Recall@10) and documents can be long (Fireflies
// transcripts), so per-doc content is truncated but kept large enough to answer
// from (paper uses full docs).
const MAX_DOCS = 10;
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
        log.warn(`[eval-onyx] LiteLLM ${res.status} (model=${opts.model}, attempt=${attempt}/${CALL_RETRIES}, retryable=${retryable}): ${text.slice(0, 200)}`);
        if (!retryable || last) return null;
      } else {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
        };
        const msg = data.choices?.[0]?.message;
        if (opts.tool) {
          const raw = msg?.tool_calls?.[0]?.function?.arguments;
          if (!raw) {
            log.warn(`[eval-onyx] no tool_call in response (attempt=${attempt}/${CALL_RETRIES})`);
            if (last) return null;
          } else {
            try {
              return { toolArgs: JSON.parse(raw) as Record<string, unknown> };
            } catch {
              log.warn(`[eval-onyx] bad tool_call JSON (attempt=${attempt}/${CALL_RETRIES})`);
              if (last) return null;
            }
          }
        } else {
          const content = typeof msg?.content === "string" ? msg.content : "";
          if (attempt > 1) log.info(`[eval-onyx] succeeded on attempt ${attempt} (model=${opts.model})`);
          return { content };
        }
      }
    } catch (err) {
      log.warn(`[eval-onyx] call failed (attempt=${attempt}/${CALL_RETRIES}): ${err instanceof Error ? err.message : String(err)}`);
      if (last) return null;
    }
    await new Promise((r) => setTimeout(r, CALL_BACKOFFS_MS[attempt - 1] ?? 3000));
  }
  return null;
}

export interface OnyxEvalDoc {
  /** Canonical benchmark dsid, when the doc belongs to the corpus (audit only). */
  benchmarkDocId?: string | null;
  title?: string;
  content: string;
}

function formatDocs(docs: OnyxEvalDoc[], label: string): string {
  return docs
    .slice(0, MAX_DOCS)
    .map((d, i) => {
      const text = String(d.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_CHARS_PER_DOC);
      return `${label}-[${String(i + 1).padStart(2, "0")}] ${(d.title ?? "").slice(0, 256)}\n${text}`;
    })
    .join("\n\n");
}

// ─── Judges (these take DOCS AS INPUT; nothing here GENERATES an answer —
//    the bench answer goes through the ask-ai agent, never through claw) ────

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

// ─── Completeness (paper §5.1, per-fact judge) ──────────────────────────────

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

// ─── Relevance (paper §5.3, one vote of the 3-judge panel) ──────────────────

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
 * One relevance vote for a candidate doc. claw-auth calls this 3× per doc and
 * majority-votes (gold-biased tie-break). Fails closed to "invalid" so a judge
 * outage never promotes junk into the gold set.
 */
export async function judgeRelevanceOnce(input: {
  question: string;
  doc: OnyxEvalDoc;
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
  const userContent = [
    `QUESTION: ${input.question}`,
    "",
    "--- CANDIDATE DOCUMENT ---",
    formatDocs([input.doc], "DOC"),
  ].join("\n");

  const res = await callLiteLLM({ model, system: RELEVANCE_SYSTEM, user: userContent, tool: RELEVANCE_TOOL, maxTokens: 256 });
  const label = (res?.toolArgs?.["label"] as string | undefined) ?? "invalid";
  const note = typeof res?.toolArgs?.["note"] === "string" ? (res.toolArgs["note"] as string).slice(0, 160) : "";
  return { label: (["required", "valid", "invalid"].includes(label) ? label : "invalid") as RelevanceLabel, note, model };
}

// ─── Gold regeneration (paper §5.3 — correction follow-up) ──────────────────

const REGENERATE_SYSTEM = `You regenerate the GOLD benchmark answer and its atomic answer-facts list for an evaluation question after the gold document set was corrected by independent relevance judges.

You are given: the QUESTION, the corrected REQUIRED documents (the new gold set), and the ORIGINAL answer-facts list.

Rules:
- Write the gold answer strictly from the required documents. Do not use outside knowledge.
- Produce answer facts: small, atomic, individually verifiable claims that together cover the gold answer (these drive completeness scoring).
- Preserve anti-hallucination facts: original facts phrased as NEGATIVE constraints (e.g. "The answer must not claim X", "must not say Y") must be carried over VERBATIM into the new facts list whenever they still apply. Do not weaken or reword them.
- Drop original facts the regenerated answer does not support.
- If the required documents do not contain the answer, the gold answer must say exactly that the information is not available, and the facts list should assert that the correct response acknowledges the absence.`;

const REGENERATE_TOOL = {
  name: "regenerate_gold",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      goldAnswer: { type: "string", description: "The corrected gold answer, in plain prose." },
      answerFacts: {
        type: "array",
        items: { type: "string" },
        description: "Atomic, individually verifiable claims covering the gold answer; preserved anti-hallucination facts included verbatim.",
      },
    },
    required: ["goldAnswer", "answerFacts"],
  },
};

/**
 * Paper §5.3: when the corrected required-set differs from the original gold
 * set, regenerate the gold answer + answer facts from the updated documents,
 * PRESERVING the original anti-hallucination facts. Fails closed to the
 * original facts with an empty goldAnswer so a judge outage never fabricates
 * gold truth — the caller must treat empty goldAnswer as "discard the correction".
 */
export async function regenerateGoldFromDocs(input: {
  question: string;
  docs: OnyxEvalDoc[];
  originalFacts: string[];
  model?: string | undefined;
}): Promise<{ goldAnswer: string; answerFacts: string[]; model: string }> {
  const model = (input.model && input.model.trim()) || LITELLM.model;
  const originalFacts = input.originalFacts
    .slice(0, MAX_FACTS)
    .map((f) => String(f ?? "").slice(0, MAX_FACT_CHARS));
  if (!LITELLM.apiKey || input.docs.length === 0) {
    return { goldAnswer: "", answerFacts: originalFacts, model };
  }

  const userContent = [
    `QUESTION: ${input.question}`,
    "",
    "--- CORRECTED REQUIRED DOCUMENTS (new gold set) ---",
    formatDocs(input.docs, "REQUIRED"),
    "",
    "--- ORIGINAL ANSWER FACTS ---",
    originalFacts.map((f, i) => `[${i}] ${f}`).join("\n"),
  ].join("\n");

  const res = await callLiteLLM({ model, system: REGENERATE_SYSTEM, user: userContent, tool: REGENERATE_TOOL, maxTokens: 4_096 });
  const goldAnswer = typeof res?.toolArgs?.["goldAnswer"] === "string" ? (res.toolArgs["goldAnswer"] as string).trim() : "";
  const rawFacts = Array.isArray(res?.toolArgs?.["answerFacts"]) ? (res.toolArgs["answerFacts"] as unknown[]) : [];
  const answerFacts = rawFacts
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .slice(0, MAX_FACTS)
    .map((f) => f.slice(0, MAX_FACT_CHARS));
  if (!goldAnswer || answerFacts.length === 0) {
    return { goldAnswer: "", answerFacts: originalFacts, model };
  }
  return { goldAnswer, answerFacts, model };
}
