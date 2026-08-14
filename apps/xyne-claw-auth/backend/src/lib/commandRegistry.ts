/**
 * Custom slash-command registry — pure helpers (no DB, no I/O).
 *
 * A custom command is a *saved, parameterized `/goal`*: an org-scoped template
 * plus optional provider/model and budget ceilings. When a user types
 * `/<slug> <input>`, the webhook renders the stored template into a goal
 * condition and boots the SAME proven worker → judge → audit loop that `/goal`
 * uses. This module owns the pure parts of that mapping so they can be unit
 * tested without a Prisma client:
 *
 *   - RESERVED_COMMAND_SLUGS / validateCommandSlug  — which slugs a user may register.
 *   - renderCommandTemplate                          — {input} substitution.
 *   - renderCommandToGoalStart                       — stored definition → goalStart command.
 *
 * The pure parser (parseSlashCommand.ts) imports RESERVED_COMMAND_SLUGS so a
 * registered slug can never shadow a built-in, and so `/<builtin>` is never
 * mis-resolved as a custom command.
 */

import type { SlashCommand } from "./parseSlashCommand.js";

/** A goalStart command (the only SlashCommand shape a custom command maps to). */
type GoalStartCommand = Extract<SlashCommand, { kind: "goalStart" }>;

/**
 * Built-in verbs a custom command may NOT shadow. Two jobs:
 *   1. validateCommandSlug rejects an attempt to `/command define` one of these.
 *   2. extractCustomCommandInvocation (in parseSlashCommand.ts) skips these so a
 *      built-in like `/stop` is never resolved against the registry.
 * Keep in sync with the verbs handled in parseSlashCommand.ts / webhook.ts.
 */
export const RESERVED_COMMAND_SLUGS: ReadonlySet<string> = new Set([
  "goal",
  "goals",
  "stop",
  "help",
  "clear",
  "compact",
  "queue",
  "queues",
  "fast",
  "upgrade",
  "experiment",
  "experiments",
  "command",
  "commands",
  "status",
]);

/** Slug charset: lowercase, starts with a letter, 2-32 chars, [a-z0-9_-]. */
const SLUG_RE = /^[a-z][a-z0-9_-]{1,31}$/;

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/**
 * Validate a user-supplied command slug. Lowercases first, then enforces the
 * charset and the reserved-word list. Returns a human-readable reason on
 * failure so the webhook can post a helpful error.
 */
export function validateCommandSlug(raw: string): SlugValidation {
  const slug = raw.trim().toLowerCase();
  if (!slug) return { ok: false, reason: "slug is empty" };
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason:
        "slug must be 2-32 chars, start with a letter, and contain only a-z, 0-9, - or _",
    };
  }
  if (RESERVED_COMMAND_SLUGS.has(slug)) {
    return { ok: false, reason: `\`/${slug}\` is a built-in command and can't be redefined` };
  }
  return { ok: true, slug };
}

/** The stored-definition fields renderCommandToGoalStart needs. */
export interface StoredCommandDefinition {
  slug: string;
  template: string;
  provider?: string | null;
  model?: string | null;
  maxTurns?: number | null;
  maxWallClockMs?: number | null;
}

/** Placeholder a template uses to interpolate the user's invocation text. */
const INPUT_PLACEHOLDER_RE = /\{input\}/g;

/**
 * Render a stored template with the user's invocation text. If the template
 * contains `{input}` every occurrence is replaced; otherwise the input (when
 * non-empty) is appended as an extra paragraph so a command with a fixed
 * template still receives the user's arguments.
 */
export function renderCommandTemplate(template: string, input: string): string {
  const trimmedInput = (input ?? "").trim();
  if (template.includes("{input}")) {
    return template.replace(INPUT_PLACEHOLDER_RE, trimmedInput).trim();
  }
  return (trimmedInput ? `${template}\n\n${trimmedInput}` : template).trim();
}

/**
 * Map a stored command definition + invocation text to a `goalStart` command.
 * The webhook feeds this through the exact same path a typed `/goal` takes, so
 * budgets, provider override, persistence, and the audit loop are all reused.
 *
 * Budgets are already clamped to the hard caps at `/command define` time (see
 * parseSlashCommand.ts); nothing here can exceed them because the only write
 * path to a definition is the parser.
 */
export function renderCommandToGoalStart(
  def: StoredCommandDefinition,
  input: string,
): GoalStartCommand {
  const condition = renderCommandTemplate(def.template, input).slice(0, 2_000);
  const providerOverride = def.provider
    ? { provider: def.provider, ...(def.model ? { model: def.model } : {}) }
    : def.model
      ? { provider: "spaces", model: def.model }
      : undefined;
  return {
    kind: "goalStart",
    condition,
    ...(providerOverride ? { providerOverride } : {}),
    ...(def.maxTurns != null ? { maxTurns: def.maxTurns } : {}),
    ...(def.maxWallClockMs != null ? { maxWallClockMs: def.maxWallClockMs } : {}),
  };
}
