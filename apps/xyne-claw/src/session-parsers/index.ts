import { parseClaudeSession } from "../claude-session-parse.js";
import { redactSecrets } from "./common.js";
import { detectCodex, parseCodexSession } from "./codex.js";
import { detectOpenCode, parseOpenCodeSession } from "./opencode.js";
import type { ParsedSession, SessionSource } from "./types.js";

const VALID_SOURCES: readonly SessionSource[] = ["claude", "opencode", "codex"];

function isValidSource(s: string): s is SessionSource {
  return (VALID_SOURCES as readonly string[]).includes(s);
}

function detectFormat(raw: string): SessionSource {
  // Order matters for cost: detectOpenCode bails on the first char unless the
  // payload is a single JSON object; detectCodex caps its line scan. Claude
  // is the fallback (its parser handles both claude.ai JSON and CLI JSONL).
  if (detectOpenCode(raw)) return "opencode";
  if (detectCodex(raw)) return "codex";
  return "claude";
}

function parseWith(source: SessionSource, raw: string, filename?: string): ParsedSession {
  switch (source) {
    case "opencode":
      return parseOpenCodeSession(raw);
    case "codex":
      return parseCodexSession(raw);
    case "claude":
    default: {
      const parsed = parseClaudeSession(raw, filename ?? "");
      return { ...parsed, source: "claude" };
    }
  }
}

/**
 * Parse a raw session export into a source-agnostic transcript.
 *
 * An explicit valid `source` is tried first, but NOT blindly trusted: all
 * upload buttons accept the same file extensions, so users routinely pick the
 * wrong button. If the hinted parser finds zero turns, we fall back to
 * heuristic detection and re-parse — silently losing the upload after the UI
 * already showed a success toast is the one unacceptable outcome.
 *
 * All output text fields pass through redactSecrets here — the single funnel
 * for every source — because distilled content flows into shared agent
 * memory.
 */
export function parseSession(
  raw: string,
  options?: { source?: string | undefined; filename?: string | undefined },
): ParsedSession {
  const requested = options?.source?.trim().toLowerCase() ?? "";
  const hinted: SessionSource | null = isValidSource(requested) ? requested : null;

  let parsed = hinted ? parseWith(hinted, raw, options?.filename) : null;
  if (!parsed || parsed.turnCount === 0) {
    const detected = detectFormat(raw);
    if (detected !== hinted) {
      const fallback = parseWith(detected, raw, options?.filename);
      // Keep whichever attempt produced turns; prefer the fallback when both
      // are empty so `source` reflects the detected format.
      if (!parsed || fallback.turnCount > 0 || parsed.turnCount === 0) parsed = fallback;
    }
  }
  if (!parsed) parsed = parseWith(detectFormat(raw), raw, options?.filename);

  return {
    ...parsed,
    task: redactSecrets(parsed.task),
    result: redactSecrets(parsed.result),
    transcript: redactSecrets(parsed.transcript),
  };
}

export type { ParsedSession, SessionSource } from "./types.js";
