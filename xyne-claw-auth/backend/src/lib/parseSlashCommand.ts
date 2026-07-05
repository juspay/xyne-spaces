/**
 * Tiny parser for `/goal` slash commands the user can type into a Spaces
 * thread to control an autonomous loop.
 *
 * Recognised forms:
 *   /goal <condition…>        → start (or replace) the active goal
 *   /goal status              → show active-goal status
 *   /goal clear  |  /stop     → cancel the active goal
 *
 * Anything else returns `null` so the caller falls through to normal agent
 * processing. Parser is intentionally generous about leading whitespace but
 * does NOT auto-trim mid-command tokens — `/goal  show  status` is the same
 * as `/goal status`.
 */

export type SlashCommand =
  | { kind: "goalStart"; condition: string }
  | { kind: "goalStatus" }
  | { kind: "goalClear" }
  // `/clear` — wipe this thread's agent session (forget prior context).
  | { kind: "clear" }
  // `/compact [instructions]` — compact (summarize) the thread's context and
  // continue. Optional instructions steer what the summary should preserve.
  | { kind: "compact"; instructions: string }
  // `/help` — list the available slash commands.
  | { kind: "help" };

// Strip a sequence of leading `@<token>` mentions so /goal works even when
// the message addresses an agent first (e.g. `@Xyne Doctor /goal count to 10`).
// Display names may contain spaces ("Xyne Doctor"), but the next token after a
// space must itself be a name token (no `/`, no punct) to keep being consumed —
// otherwise we stop, so `@Doctor please /goal X` does NOT strip `please` and
// the parser falls through (no false-positive goal start).
const LEADING_MENTIONS = /^(?:@[\w.\-]+(?:\s+[\w.\-]+)*\s*)+/;

export function parseSlashCommand(input: string | undefined | null): SlashCommand | null {
  if (!input) return null;
  const trimmed = input.trim().replace(LEADING_MENTIONS, "");
  if (trimmed.length === 0 || trimmed[0] !== "/") return null;

  const lower = trimmed.toLowerCase();

  if (lower === "/help") {
    return { kind: "help" };
  }
  // `/clear` — exact match only (so "/clearfoo" or "/clear the air" fall
  // through to a normal message). `/goal clear` stays goal-specific below.
  if (lower === "/clear") {
    return { kind: "clear" };
  }
  // `/compact` or `/compact <instructions>`.
  if (lower === "/compact") {
    return { kind: "compact", instructions: "" };
  }
  if (lower.startsWith("/compact ")) {
    return { kind: "compact", instructions: trimmed.slice("/compact ".length).trim().slice(0, 2_000) };
  }

  if (lower === "/stop" || lower === "/goal clear") {
    return { kind: "goalClear" };
  }
  if (lower === "/goal status" || lower === "/goal show status") {
    return { kind: "goalStatus" };
  }
  if (lower.startsWith("/goal ")) {
    const condition = trimmed.slice("/goal ".length).trim();
    if (condition.length === 0) return null;
    // Defensive: cap absurdly long conditions; the DB column has no length
    // limit but the boss prompt has finite attention.
    return { kind: "goalStart", condition: condition.slice(0, 2_000) };
  }
  return null;
}
