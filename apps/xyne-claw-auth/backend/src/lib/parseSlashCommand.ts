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

import { RESERVED_COMMAND_SLUGS } from "./commandRegistry.js";

export type ProviderOverride = { provider: string; model?: string };

export type SlashCommand =
  | { kind: "goalStart"; condition: string; providerOverride?: ProviderOverride; maxTurns?: number; maxWallClockMs?: number }
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
  // `/queue clear` — drop the messages waiting behind the active run (does NOT
  // stop the current run — that's `/stop`). Short-circuits.
  | { kind: "queueClear" }
  // `/help` — list the available slash commands.
  | { kind: "help" }
  // `/fast` / `/fast off` — thread-scoped fast-mode toggle. Start-anchored only.
  | { kind: "fastMode"; enabled: boolean }
  | { kind: "fastModeUsage" }
  // `/command` registry — define/list/show/delete org-scoped custom commands.
  | { kind: "commandList" }
  | { kind: "commandShow"; slug: string }
  | { kind: "commandDelete"; slug: string }
  | {
      kind: "commandDefine";
      slug: string;
      template: string;
      description?: string;
      providerOverride?: ProviderOverride;
      maxTurns?: number;
      maxWallClockMs?: number;
    };

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
// Hard ceiling for a user-supplied `/goal maxTurns=N`. When the option is
// absent the repo default (GOAL_MAX_TURNS_DEFAULT env, default 5) still
// applies. Anything above this cap is clamped down — a user-configured loop
// must never be able to schedule unbounded, cost-bearing agent turns.
const GOAL_MAX_TURNS_CAP = 20;
// Hard ceiling for a user-supplied `/goal maxTime=…` wall-clock budget: 6h.
// Absent → no time cap (only maxTurns applies). Like maxTurns, this bounds a
// user-configured loop so it can never run unbounded, cost-bearing turns.
const GOAL_MAX_WALL_CLOCK_MS_CAP = 6 * 60 * 60 * 1000;

/**
 * Parse a compact duration like `30m`, `2h`, `45s`, `500ms`, or a bare
 * integer (interpreted as MINUTES) into milliseconds. Returns undefined for
 * anything non-positive or malformed so the caller can preserve it as goal
 * text rather than silently coercing junk.
 */
export function parseDurationMs(raw: string): number | undefined {
  const m = /^(\d+)(ms|s|m|h)?$/iu.exec(raw.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1] ?? "", 10);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  const unit = (m[2] ?? "m").toLowerCase();
  const mult = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "h" ? 3_600_000 : 60_000;
  return n * mult;
}

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
  // `/compact` or `/compact <instructions>`.
  if (lower === "/compact") {
    return { kind: "compact", instructions: "" };
  }
  if (lower.startsWith("/compact ")) {
    return { kind: "compact", instructions: trimmed.slice("/compact ".length).trim().slice(0, 2_000) };
  }

  if (lower === "/command" || lower === "/commands" || lower === "/command list") {
    return { kind: "commandList" };
  }
  if (lower.startsWith("/command ")) {
    return parseCommandMgmt(trimmed.slice("/command ".length));
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
      ...(parsed.maxTurns != null ? { maxTurns: parsed.maxTurns } : {}),
      ...(parsed.maxWallClockMs != null ? { maxWallClockMs: parsed.maxWallClockMs } : {}),
    };
  }
  return null;
}

/** Extract the same provider/model tokens as `/experiment` while leaving the
 * remaining text as the goal's exit condition. A model-only override uses the
 * Spaces provider, matching `/experiment`'s default. */
function parseGoalStart(raw: string): { condition: string; providerOverride?: ProviderOverride; maxTurns?: number; maxWallClockMs?: number } {
  let provider: string | undefined;
  let model: string | undefined;
  let maxTurns: number | undefined;
  let maxWallClockMs: number | undefined;
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
    if (key === "maxturns" || key === "max_turns" || key === "turns") {
      const n = Number.parseInt(match?.[2] ?? "", 10);
      // Positive integers only; clamp to the hard cap. Junk (maxturns=abc)
      // is preserved as goal text rather than silently coerced — mirrors
      // the provider/model handling above.
      if (Number.isInteger(n) && n > 0) maxTurns = Math.min(n, GOAL_MAX_TURNS_CAP);
      else conditionParts.push(part);
      continue;
    }
    if (key === "maxtime" || key === "max_time" || key === "maxwallclock" || key === "timeout" || key === "deadline") {
      const ms = parseDurationMs(match?.[2] ?? "");
      // Valid positive duration only; clamp to the hard cap. Junk is kept as
      // goal text rather than silently coerced — mirrors maxTurns handling.
      if (ms != null) maxWallClockMs = Math.min(ms, GOAL_MAX_WALL_CLOCK_MS_CAP);
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
    ...(maxTurns != null ? { maxTurns } : {}),
    ...(maxWallClockMs != null ? { maxWallClockMs } : {}),
  };
}

// ── /command registry parsing ──────────────────────────────────────────────
// `/command list` · `/command show <slug>` · `/command delete <slug>` ·
// `/command define <slug> [key=val …] <template…>`. Slug validity + reserved
// checks are enforced downstream (validateCommandSlug) so the webhook can post a
// helpful error; here we only extract structure.
function parseCommandMgmt(rest: string): SlashCommand | null {
  const trimmed = rest.trim();
  const firstTok = /^(\S+)/.exec(trimmed);
  const sub = (firstTok?.[1] ?? "").toLowerCase();
  const afterSub = trimmed.slice(firstTok?.[1]?.length ?? 0).trim();

  if (sub === "" || sub === "list" || sub === "ls") return { kind: "commandList" };
  if (sub === "show" || sub === "get") {
    const slug = (/^(\S+)/.exec(afterSub)?.[1] ?? "").toLowerCase();
    return slug ? { kind: "commandShow", slug } : null;
  }
  if (sub === "delete" || sub === "remove" || sub === "rm") {
    const slug = (/^(\S+)/.exec(afterSub)?.[1] ?? "").toLowerCase();
    return slug ? { kind: "commandDelete", slug } : null;
  }
  if (sub === "define" || sub === "set" || sub === "add" || sub === "create") {
    return parseCommandDefine(afterSub);
  }
  return null;
}

// `/command define <slug> [key=val …] <template…>`. Leading key=value tokens
// (provider/model/maxTurns/maxTime/desc) are consumed as options; the first
// non-option token begins the template, which keeps its original spacing from
// there. Budgets are clamped to the same hard caps /goal uses, so a custom
// command can never exceed the /goal ceilings.
function parseCommandDefine(afterSub: string): SlashCommand | null {
  let s = afterSub.trim();
  const slugMatch = /^(\S+)\s*/.exec(s);
  if (!slugMatch) return null;
  const slug = (slugMatch[1] ?? "").toLowerCase();
  s = s.slice(slugMatch[0].length);

  let provider: string | undefined;
  let model: string | undefined;
  let maxTurns: number | undefined;
  let maxWallClockMs: number | undefined;
  let description: string | undefined;

  for (;;) {
    const m = /^(\S+?)=(\S*)\s*/.exec(s);
    if (!m) break;
    const key = (m[1] ?? "").toLowerCase();
    const val = m[2] ?? "";
    if (key === "provider") {
      if (!GOAL_OVERRIDABLE_PROVIDERS.has(val.toLowerCase())) break;
      provider = val.toLowerCase();
    } else if (key === "model") {
      if (!val) break;
      model = val;
    } else if (key === "maxturns" || key === "max_turns" || key === "turns") {
      const n = Number.parseInt(val, 10);
      if (!(Number.isInteger(n) && n > 0)) break;
      maxTurns = Math.min(n, GOAL_MAX_TURNS_CAP);
    } else if (
      key === "maxtime" || key === "max_time" || key === "maxwallclock" ||
      key === "timeout" || key === "deadline"
    ) {
      const ms = parseDurationMs(val);
      if (ms == null) break;
      maxWallClockMs = Math.min(ms, GOAL_MAX_WALL_CLOCK_MS_CAP);
    } else if (key === "desc" || key === "description") {
      description = val;
    } else {
      break;
    }
    s = s.slice(m[0].length);
  }

  const template = s.trim().slice(0, 2_000);
  if (!slug || !template) return null;

  const resolvedProvider = provider ?? (model ? "spaces" : undefined);
  return {
    kind: "commandDefine",
    slug,
    template,
    ...(description ? { description } : {}),
    ...(resolvedProvider
      ? { providerOverride: { provider: resolvedProvider, ...(model ? { model } : {}) } }
      : {}),
    ...(maxTurns != null ? { maxTurns } : {}),
    ...(maxWallClockMs != null ? { maxWallClockMs } : {}),
  };
}

/**
 * Extract a custom-command invocation `/<slug> <input>` from a raw message.
 * Returns null unless the WHOLE message (after leading @mentions) is a single
 * `/<slug>` token optionally followed by args, and the slug is not a built-in.
 * The caller resolves <slug> against the org's registry; a miss falls through
 * to normal processing. Start-anchored + reserved-slug filtered, so prose that
 * merely contains a slash is never hijacked.
 */
export function extractCustomCommandInvocation(
  input: string | undefined | null,
): { slug: string; input: string } | null {
  if (!input) return null;
  const trimmed = input.trim().replace(LEADING_MENTIONS, "");
  if (trimmed[0] !== "/") return null;
  const m = /^\/([a-z][a-z0-9_-]{1,31})(?:\s+([\s\S]*))?$/iu.exec(trimmed);
  if (!m) return null;
  const slug = (m[1] ?? "").toLowerCase();
  if (RESERVED_COMMAND_SLUGS.has(slug)) return null;
  return { slug, input: (m[2] ?? "").trim() };
}
