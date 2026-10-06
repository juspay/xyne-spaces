/**
 * Digital Twin soul synthesizer (Memory v2, Phase 4).
 *
 * Compiles a single persona file (soul.md, people.md, …) from the user's
 * ALREADY-APPROVED facts. Runs on claw (LITELLM_API_KEY lives here), called
 * S2S by claw-auth via POST /internal/user-memory/synthesize-file.
 *
 * Unlike the curator (which extracts discrete facts), this is a holistic
 * generation pass: it turns a bag of approved facts into one coherent, always-
 * loaded document the twin reads as its persona. Uses ONLY the provided facts —
 * never invents — and respects a hard char cap so the file can't blow context.
 */

import type { SynthesizeFileRequest, SynthesizeFileResult, SynthesizeFileTrace } from "xyne-claw-shared";
import { postChatCompletion, tokenUsage, type ChatCompletionResponse } from "./litellm-chat.js";
import { createLogger } from "./logger.js";

const log = createLogger("twin-soul-synthesizer");

const LITELLM_API_KEY = process.env["LITELLM_API_KEY"] ?? "";
const SYNTH_MODEL = process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";
const SYNTH_TIMEOUT_MS = Number(process.env["TWIN_SYNTH_TIMEOUT_MS"] ?? 120_000);
/** Match the claw-auth fetch ceiling. The character budget below remains the
 * primary context safeguard; this count cap only bounds pathological sets of
 * tiny facts. */
const MAX_FACTS = 500;
/** A count cap alone is not a context-window safeguard because individual facts
 *  have no fixed size. Keep the fact portion at 200k chars (roughly 40-50k
 *  English tokens), leaving substantial room in the configured 200k-token
 *  models for the system prompt, a hand-edited file, and model output.
 *  Operators can lower this for a smaller synthesis model. */
const MAX_FACT_INPUT_CHARS = Math.max(
  4_000,
  Math.min(200_000, Number(process.env["TWIN_SYNTH_MAX_FACT_INPUT_CHARS"] ?? 200_000) || 200_000),
);

function selectFactsForPrompt(input: string[]): { facts: string[]; available: number; chars: number } {
  const normalized = (input ?? []).map((f) => (f ?? "").trim()).filter(Boolean);
  const facts: string[] = [];
  let chars = 0;

  for (const fact of normalized) {
    if (facts.length >= MAX_FACTS) break;
    // Include the markdown bullet prefix + separating newline in the budget.
    const cost = fact.length + 3;
    if (chars + cost > MAX_FACT_INPUT_CHARS) continue;
    facts.push(fact);
    chars += cost;
  }

  return { facts, available: normalized.length, chars };
}

export async function synthesizeMemoryFile(req: SynthesizeFileRequest): Promise<SynthesizeFileResult> {
  const startedAt = Date.now();
  const selected = selectFactsForPrompt(req.facts ?? []);
  const facts = selected.facts;
  if (facts.length === 0) return { content: null, error: "no-facts" };

  // Sanity ceiling on the S2S input, deliberately ABOVE claw-auth's MAX_FILE_CHARS
  // (20k) so the authoritative cap stays there and this guard never silently
  // trims a legitimate request at the boundary.
  const maxChars = Math.max(200, Math.min(40_000, req.maxChars || 20_000));

  const system = [
    "You compile ONE persona file for a user's Digital Twin — an AI that replies to chats AS the user.",
    "The file must capture the user faithfully so the twin sounds exactly like them, with zero extra tool calls.",
    "",
    "Rules:",
    "- Use ONLY the approved facts provided. Never invent, never generalise beyond them.",
    "- Keep concrete specifics: names, tools, projects, and SHORT quoted examples of the user's own phrasing — these are what make the twin sound real.",
    "- Write clean, skimmable markdown. Lead with the highest-signal, most-used patterns.",
    "- Address the twin in the second person where natural (\"You write short, lowercase acks…\").",
    `- HARD LIMIT: ${maxChars} characters. Be concise; drop the weakest facts if over.`,
    "- Output ONLY the file's markdown content — no preamble, no code fences, no \"here is\".",
  ].join("\n");

  const userLines = [
    `File: ${req.fileName} — ${req.description}`,
    "",
    "Approved facts about the user:",
    ...facts.map((f) => `- ${f}`),
  ];
  if (req.preserveEdits && req.currentContent?.trim()) {
    userLines.push(
      "",
      "The user HAND-EDITED the current file. Preserve their wording and structure; only fold in genuinely new facts from the list above. Current content:",
      req.currentContent.slice(0, maxChars),
    );
  }
  userLines.push("", `Write ${req.fileName} now.`);
  const userPrompt = userLines.join("\n");
  const factsDropped = selected.available - facts.length;
  const baseTrace: SynthesizeFileTrace = {
    model: SYNTH_MODEL,
    durationMs: 0,
    systemPrompt: system,
    userPrompt,
    rawOutput: "",
    promptChars: system.length + userPrompt.length,
    factsAvailable: selected.available,
    factsUsed: facts.length,
    factsDropped,
    // Retained for trace compatibility. Facts are no longer clipped
    // individually; the aggregate prompt budget remains the context guard.
    factsClipped: 0,
    factInputChars: selected.chars,
    factInputBudgetChars: MAX_FACT_INPUT_CHARS,
    contextLimited: factsDropped > 0,
  };
  const traced = (extra: Partial<SynthesizeFileTrace> = {}): SynthesizeFileTrace => ({
    ...baseTrace,
    durationMs: Date.now() - startedAt,
    ...extra,
  });

  if (!LITELLM_API_KEY) return { content: null, error: "no-api-key", trace: traced() };

  try {
    const res = await postChatCompletion(
      LITELLM_API_KEY,
      {
        model: SYNTH_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        // The file is character-capped below; this token cap prevents a
        // disobedient model from consuming the rest of its context on output.
        // The ceiling tracks the maxChars ceiling above (~3 chars/token) so a
        // full-length file always fits in the output budget.
        max_tokens: Math.max(256, Math.min(16_384, Math.ceil(maxChars / 3))),
      },
      { timeoutMs: SYNTH_TIMEOUT_MS, label: `twin-soul-synth:${req.fileName}` },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[twin-soul-synth] LiteLLM ${res.status} file=${req.fileName}: ${body.slice(0, 200)}`);
      return { content: null, error: `llm-http-${res.status}`, trace: traced({ rawOutput: body.slice(0, 20_000) }) };
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const rawOutput = data.choices?.[0]?.message?.content ?? "";
    let content = rawOutput.trim();
    const trace = traced({
      rawOutput,
      ...(data.choices?.[0]?.finish_reason
        ? { finishReason: data.choices[0].finish_reason }
        : {}),
      ...(data.usage ? { usage: tokenUsage(data.usage) } : {}),
    });
    // Strip accidental code fences.
    content = content.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (!content) return { content: null, error: "empty", trace };
    return { content: content.slice(0, maxChars), trace };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn(`[twin-soul-synth] failed file=${req.fileName}: ${error}`);
    return { content: null, error, trace: traced() };
  }
}
