/**
 * Source-agnostic output shape for session parsers.
 *
 * All parsers (Claude, OpenCode, Codex) normalize to this shape so the curator
 * and memory ingestion pipeline can stay format-oblivious.
 */

export type SessionSource = "claude" | "opencode" | "codex";

export interface ParsedSession {
  /** The user's opening request / task summary. */
  task: string;
  /** The final assistant turn — used as the curator's result. */
  result: string;
  /** Names of tools referenced anywhere in the session. */
  toolsUsed: string[];
  /** Ordered, human-readable transcript for review and distillation. */
  transcript: string;
  /** Number of parsed turns (0 means nothing usable was found). */
  turnCount: number;
  /** Number of distinct conversations bundled in the export (usually 1). */
  conversationCount: number;
  /** Discovered format label, e.g. "jsonl" | "opencode-json" | "codex-jsonl". */
  format: string;
  /** Detected or explicit source. */
  source: SessionSource;
}
