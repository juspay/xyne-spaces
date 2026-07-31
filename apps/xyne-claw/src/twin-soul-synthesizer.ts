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

import { fetchLiteLLMWithRetry } from "./litellm-retry.js";
import { createLogger } from "./logger.js";

const log = createLogger("twin-soul-synthesizer");

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
const LITELLM_API_KEY = process.env["LITELLM_API_KEY"] ?? "";
const SYNTH_MODEL = process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";
const SYNTH_TIMEOUT_MS = Number(process.env["TWIN_SYNTH_TIMEOUT_MS"] ?? 120_000);
/** Cap facts fed in so a heavy user doesn't blow the synth prompt. */
const MAX_FACTS = 200;

export interface SynthesizeFileRequest {
  fileName: string;
  description: string;
  /** Approved fact texts in this file's subsystem(s). */
  facts: string[];
  /** Hard char cap for the produced file. */
  maxChars: number;
  /** Existing file content (folded in / preserved when preserveEdits). */
  currentContent?: string;
  /** True when the current file was hand-edited by the user — preserve it. */
  preserveEdits?: boolean;
}

export interface SynthesizeFileResult {
  content: string | null;
  error?: string;
}

export async function synthesizeMemoryFile(req: SynthesizeFileRequest): Promise<SynthesizeFileResult> {
  if (!LITELLM_API_KEY) return { content: null, error: "no-api-key" };
  const facts = (req.facts ?? []).map((f) => (f ?? "").trim()).filter(Boolean).slice(0, MAX_FACTS);
  if (facts.length === 0) return { content: null, error: "no-facts" };

  const maxChars = Math.max(200, Math.min(20_000, req.maxChars || 10_000));

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

  try {
    const res = await fetchLiteLLMWithRetry(
      `${LITELLM_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${LITELLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: SYNTH_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userLines.join("\n") },
          ],
          temperature: 0.3,
        }),
      },
      { timeoutMs: SYNTH_TIMEOUT_MS, label: `twin-soul-synth:${req.fileName}` },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[twin-soul-synth] LiteLLM ${res.status} file=${req.fileName}: ${body.slice(0, 200)}`);
      return { content: null, error: `llm-http-${res.status}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    let content = (data.choices?.[0]?.message?.content ?? "").trim();
    // Strip accidental code fences.
    content = content.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (!content) return { content: null, error: "empty" };
    return { content: content.slice(0, maxChars) };
  } catch (err) {
    log.warn(`[twin-soul-synth] failed file=${req.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    return { content: null, error: err instanceof Error ? err.message : String(err) };
  }
}
