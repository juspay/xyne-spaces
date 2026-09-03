/**
 * Shared helpers for all session parsers.
 */

import type { ParsedSession, SessionSource } from "./types.js";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function safeJson(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return "";
  }
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

export function extractTopLevelString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

export function joinNonEmpty(parts: (string | undefined | null)[], sep = "\n"): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(sep);
}

/**
 * Uniform turn model shared by the OpenCode and Codex parsers.
 *
 * `tool` turns render as `### TOOL` transcript sections — matching the Claude
 * parser's convention — so the curator sees the same role structure for every
 * source, and tool output can never masquerade as assistant prose (it used to
 * become `result`, so distilled memories captured raw command dumps as the
 * "final answer").
 */
export interface NormalizedTurn {
  role: "user" | "assistant" | "tool";
  text: string;
}

/** Per-turn transcript cap. */
export const MAX_TURN_CHARS = 8_000;
/** Tool-output cap — matches the Claude parser's tool_result clip. */
export const TOOL_OUTPUT_CLIP = 2_000;
/** Tool-input/args cap. */
export const TOOL_INPUT_CLIP = 800;

/**
 * Redact obvious credential material from donated-session text.
 *
 * Session tool outputs routinely contain `.env` dumps, curl responses with
 * bearer tokens, and API keys; distilled content flows into SHARED agent
 * memory (recallable by every user of the agent, and retained long-term), so
 * this is a floor, not a substitute for the uploader scrubbing their file.
 * Patterns are deliberately conservative — well-known key prefixes and
 * key=value assignments for credential-named fields only.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, // OpenAI/LiteLLM/Stripe-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PATs
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  // key=value / key: value assignments for credential-named fields
  /\b((?:api[_-]?key|apikey|(?:access[_-]|auth[_-]|refresh[_-])?token|(?:client[_-])?secret|password|passwd|private[_-]?key))(["']?\s*[:=]\s*["']?)[^\s"'&,;]{8,}/gi,
  /\b(bearer)\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0]!, "[REDACTED]");
  out = out.replace(SECRET_PATTERNS[1]!, "[REDACTED]");
  out = out.replace(SECRET_PATTERNS[2]!, "[REDACTED]");
  out = out.replace(SECRET_PATTERNS[3]!, "[REDACTED]");
  out = out.replace(SECRET_PATTERNS[4]!, "[REDACTED]");
  out = out.replace(SECRET_PATTERNS[5]!, "[REDACTED]");
  out = out.replace(SECRET_PATTERNS[6]!, "$1$2[REDACTED]");
  out = out.replace(SECRET_PATTERNS[7]!, "$1 [REDACTED]");
  return out;
}

/**
 * Assemble the shared ParsedSession shape from normalized turns.
 *
 * One implementation for task/result selection, transcript rendering, and
 * counts, so per-source parsers only produce `NormalizedTurn[]` and can never
 * drift on the contract the curator prompt keys on:
 *  - task    = first USER turn (fallback: caller-provided title)
 *  - result  = last ASSISTANT turn (never a tool turn)
 *  - empty parse → turnCount 0 AND conversationCount 0
 */
export function finalizeSession(opts: {
  turns: NormalizedTurn[];
  tools: Iterable<string>;
  format: string;
  source: SessionSource;
  taskFallback?: string;
}): ParsedSession {
  const { turns, format, source } = opts;
  if (turns.length === 0) {
    return {
      task: "",
      result: "",
      toolsUsed: [],
      transcript: "",
      turnCount: 0,
      conversationCount: 0,
      format,
      source,
    };
  }

  const firstUser = turns.find((t) => t.role === "user");
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

  const task = firstUser
    ? clip(firstUser.text, 4_000)
    : opts.taskFallback?.trim() || "(no user turn found in session)";
  const result = lastAssistant ? clip(lastAssistant.text, 4_000) : "(no assistant turn found in session)";

  const transcript = turns
    .map((t) => `### ${t.role.toUpperCase()}\n${clip(t.text, MAX_TURN_CHARS)}`)
    .join("\n\n");

  return {
    task,
    result,
    toolsUsed: [...new Set(opts.tools)],
    transcript,
    turnCount: turns.length,
    conversationCount: 1,
    format,
    source,
  };
}
