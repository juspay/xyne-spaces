import { parseClaudeSession } from "../claude-session-parse.js";
import { detectCodex, parseCodexSession } from "./codex.js";
import { detectOpenCode, parseOpenCodeSession } from "./opencode.js";
import type { ParsedSession, SessionSource } from "./types.js";

const VALID_SOURCES: readonly SessionSource[] = ["claude", "opencode", "codex"];

function isValidSource(s: string): s is SessionSource {
  return (VALID_SOURCES as readonly string[]).includes(s);
}

function detectFormat(raw: string, filename?: string): SessionSource {
  if (detectOpenCode(raw)) return "opencode";
  if (detectCodex(raw)) return "codex";
  return "claude";
}

/**
 * Parse a raw session export into a source-agnostic transcript.
 *
 * @param raw       Raw file contents (JSON, JSONL, or ZIP bytes handled by caller).
 * @param options   Optional explicit `source` and original `filename`.
 *                  If `source` is provided and valid it is trusted; otherwise
 *                  the payload is sniffed.
 */
export function parseSession(
  raw: string,
  options?: { source?: string | undefined; filename?: string | undefined },
): ParsedSession {
  const requested = options?.source?.trim().toLowerCase() ?? "";
  const source: SessionSource = isValidSource(requested)
    ? requested
    : detectFormat(raw, options?.filename);

  switch (source) {
    case "opencode":
      return parseOpenCodeSession(raw, options?.filename);
    case "codex":
      return parseCodexSession(raw, options?.filename);
    case "claude":
    default: {
      const parsed = parseClaudeSession(raw, options?.filename ?? "");
      return { ...parsed, source: "claude" };
    }
  }
}

export type { ParsedSession, SessionSource } from "./types.js";
