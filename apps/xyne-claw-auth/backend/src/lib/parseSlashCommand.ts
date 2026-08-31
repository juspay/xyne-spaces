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

export type ProviderOverride = { provider: string; model?: string };

export type SlashCommand =
  | { kind: "goalStart"; condition: string; providerOverride?: ProviderOverride }
  | { kind: "goalStatus" }
  | { kind: "goalClear" }
  // `/clear` — wipe this thread's agent session (forget prior context).
  | { kind: "clear" }
  // `/compact [instructions]` — compact (summarize) the thread's context and
  // continue. Optional instructions steer what the summary should preserve.
  | { kind: "compact"; instructions: string }
  // `/queue` — show the messages currently waiting behind the active run for
  // this conversation (the mid-run message queue). Read-only; short-circuits.
  | { kind: "queueShow" }
  // `/queue <message>` — append a message behind the active run without
  // interrupting it. Short-circuits after enqueueing.
  | { kind: "queueAdd"; message: string }
  // `/queue clear` — drop the messages waiting behind the active run (does NOT
  // stop the current run — that's `/stop`). Short-circuits.
  | { kind: "queueClear" }
  // `/help` — list the available slash commands.
  | { kind: "help" }
  // `/fast` / `/fast off` — thread-scoped fast-mode toggle. Start-anchored only.
  | { kind: "fastMode"; enabled: boolean }
  | { kind: "fastModeUsage" };

// Strip a sequence of leading `@<token>` mentions so /goal works even when
// the message addresses an agent first (e.g. `@Xyne Doctor /goal count to 10`).
// Display names may contain spaces ("Xyne Doctor"), but the next token after a
// space must itself be a name token (no `/`, no punct) to keep being consumed —
// otherwise we stop, so `@Doctor please /goal X` does NOT strip `please` and
// the parser falls through (no false-positive goal start).
const LEADING_MENTIONS = /^(?:@[\w.\-]+(?:\s+[\w.\-]+)*\s*)+/;

// Commands recognized ANYWHERE in the message (not just at the start) — for
// the "PR Rules Miner /stop" case, where the agent's display-name prefix
// isn't an `@`-mention and so isn't stripped. DELIBERATELY restricted to the
// arg-less control commands AND to tokens that END the message: arg-taking
// commands (/goal, /compact, /queue …) use startsWith parsing, so a
// mid-sentence mention like "can you check the /goal endpoint behavior"
// would hijack a normal question into a goal-loop start. A trailing bare
// /stop//help//clear cannot be prose.
const TRAILING_COMMAND_TOKEN = /(?:^|\s)(\/(?:stop|help|clear))\s*$/i;
const GOAL_OVERRIDABLE_PROVIDERS = new Set(["spaces", "litellm", "claude", "codex", "copilot"]);

export function parseSlashCommand(input: string | undefined | null): SlashCommand | null {
  if (!input) return null;
  const trimmed = input.trim().replace(LEADING_MENTIONS, "");

  // Primary: message begins with the command (all commands, args allowed).
  if (trimmed[0] === "/") {
    const direct = parseFromSlash(trimmed);
    if (direct) return direct;
  }

  // Fallback: an arg-less control command as the FINAL token after other text
  // (un-`@`'d agent-name prefix). Bounded by whitespace + end-of-message so
  // prose that merely mentions a command mid-sentence is never hijacked.
  const match = TRAILING_COMMAND_TOKEN.exec(trimmed);
  const commandToken = match?.[1];
  if (commandToken) {
    return parseFromSlash(commandToken.toLowerCase());
  }
  return null;
}

// Parse a string that is expected to START with a slash command.
function parseFromSlash(trimmed: string): SlashCommand | null {
  if (trimmed.length === 0 || trimmed[0] !== "/") return null;

  const lower = trimmed.toLowerCase();

  if (lower === "/help") {
    return { kind: "help" };
  }
  if (lower === "/fast" || lower === "/fast on") {
    return { kind: "fastMode", enabled: true };
  }
  if (lower === "/fast off") {
    return { kind: "fastMode", enabled: false };
  }
  if (lower.startsWith("/fast ")) {
    const rest = trimmed.slice("/fast ".length).trim();
    // Obvious on/off typos get the usage hint; anything else is
    // "/fast <task>" — enable fast mode AND run the task in one message
    // (mirrors `/upgrade [task]`). Handled by the webhook's FAST_RE block,
    // so fall through as a normal message here.
    if (/^o(n+|f+)$/i.test(rest)) {
      return { kind: "fastModeUsage" };
    }
    return null;
  }
  // `/clear` — exact match only (so "/clearfoo" or "/clear the air" fall
  // through to a normal message). `/goal clear` stays goal-specific below.
  if (lower === "/clear") {
    return { kind: "clear" };
  }
  // `/queue clear` — drop the waiting messages (check before bare `/queue`).
  if (lower === "/queue clear") {
    return { kind: "queueClear" };
  }
  // `/queue` — exact match only; show the mid-run message queue for this thread.
  if (lower === "/queue") {
    return { kind: "queueShow" };
  }
  // `/queue <message>` — explicit opt-out from same-user interrupt-with-reply.
  // It appends the message behind the active run and does not touch that run.
  if (lower.startsWith("/queue ")) {
    const message = trimmed.slice("/queue ".length).trim();
    if (message.length === 0) return { kind: "queueShow" };
    return { kind: "queueAdd", message: message.slice(0, 20_000) };
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
    const parsed = parseGoalStart(trimmed.slice("/goal ".length));
    const condition = parsed.condition;
    if (condition.length === 0) return null;
    // Defensive: cap absurdly long conditions; the DB column has no length
    // limit but the boss prompt has finite attention.
    return {
      kind: "goalStart",
      condition: condition.slice(0, 2_000),
      ...(parsed.providerOverride ? { providerOverride: parsed.providerOverride } : {}),
    };
  }
  return null;
}

/** Extract the same provider/model tokens as `/experiment` while leaving the
 * remaining text as the goal's exit condition. A model-only override uses the
 * Spaces provider, matching `/experiment`'s default. */
function parseGoalStart(raw: string): { condition: string; providerOverride?: ProviderOverride } {
  let provider: string | undefined;
  let model: string | undefined;
  const conditionParts: string[] = [];
  for (const part of raw.trim().split(/\s+/)) {
    const match = /^([^=]+)=(.*)$/u.exec(part);
    const key = match?.[1]?.toLowerCase();
    if (key === "provider") {
      const candidate = (match?.[2] ?? "").toLowerCase();
      if (GOAL_OVERRIDABLE_PROVIDERS.has(candidate)) provider = candidate;
      else conditionParts.push(part); // Preserve invalid input as part of the goal, never silently select a provider.
      continue;
    }
    if (key === "model") {
      const candidate = match?.[2] ?? "";
      if (candidate) model = candidate;
      else conditionParts.push(part);
      continue;
    }
    conditionParts.push(part);
  }
  const condition = conditionParts.join(" ").replace(/^focus=/i, "").trim();
  const resolvedProvider = provider ?? (model ? "spaces" : undefined);
  return {
    condition,
    ...(resolvedProvider ? { providerOverride: { provider: resolvedProvider, ...(model ? { model } : {}) } } : {}),
  };
}
