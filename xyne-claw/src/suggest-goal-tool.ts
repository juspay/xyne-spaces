/**
 * suggest-goal tool. Built per-session and injected when the agent's config
 * has `suggestGoal === true`. Lets a worker propose to the user that the
 * remaining work be promoted to a /goal autonomous loop — claw-auth renders
 * a one-click button that fires /goal with the suggested condition.
 *
 * The tool does NOT start the loop itself; it only stashes the suggestion so
 * the run callback can surface it. Goal-start still requires explicit user
 * tap (preserves the "/goal is opt-in" contract).
 *
 * Only ONE suggestion is emitted per run — later calls overwrite earlier
 * ones, since the agent should refine its single best proposal rather than
 * spam buttons.
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { createLogger } from "./logger.js";
const log = createLogger("suggest-goal-tool");

export interface PendingGoalSuggestion {
  condition: string;
  rationale: string;
}

const MAX_CONDITION_CHARS = 2_000;
const MAX_RATIONALE_CHARS = 400;

export function buildSuggestGoalTool(
  setSuggestion: (s: PendingGoalSuggestion) => void,
): ToolDefinition {
  return {
    name: "suggest-goal",
    label: "Suggest /goal Loop",
    description: [
      "Offer the user a one-click button that promotes the remaining work to an autonomous /goal loop.",
      "",
      "## What /goal is",
      "/goal is the platform's autonomous-loop feature. When started, YOU keep getting re-invoked",
      "turn after turn until a separate BOSS JUDGE decides the exit condition is satisfied (or a",
      "turn cap / feasibility check kicks in). Between turns there is NO human reply — the user",
      "only sees your turn outputs as they stream in, plus a final 'goal complete' message.",
      "Practical implications you must keep in mind when proposing one:",
      "  - You won't get to ask follow-up questions; everything you need must be derivable from",
      "    the condition and tools you already have.",
      "  - The judge reads your turn output (and a digest of prior turns) — write each turn's",
      "    summary as if a different reviewer is grading it against the exit condition.",
      "  - Turn cap is typically ~20. Goals that mention an explicit COUNT ('all 777 PRs') are",
      "    auto-terminated if your rate × turns_remaining can't cover the remaining work.",
      "  - First time the judge votes done, an AUDIT pass re-asks you to verify your own claims",
      "    before terminating — so be precise about numbers and lists in your last turn.",
      "",
      "## When to call suggest-goal",
      "Call this ONCE at the end of a planning turn when ALL of these hold:",
      "  1. The plan you just laid out needs ≥3 independent iterations to complete.",
      "  2. You can state a clear, observable EXIT condition (e.g. 'all 17 PRs reviewed and a",
      "     summary posted', 'all failing tests pass and the report is attached').",
      "  3. The work does not require further user input mid-execution.",
      "  4. You can make progress entirely with the tools you already have in this session.",
      "",
      "Do NOT call this for:",
      "  - Single-turn tasks you can finish right now.",
      "  - Open-ended exploration with no clear exit ('make it pretty', 'investigate X').",
      "  - Plans that need the user's approval for individual write actions.",
      "  - Tasks blocked on info only the user has.",
      "",
      "## Writing a good exit condition",
      "The condition is embedded VERBATIM in the loop's per-turn task and is what the boss judge",
      "evaluates against. A bad condition wastes turns and produces wrong terminations.",
      "  - Make it concrete and checkable. 'All 12 failing tests pass' beats 'tests are fixed'.",
      "  - State the artefact if one is required ('… and a summary message is posted in this",
      "    thread', '… and the report PDF is attached').",
      "  - If there's an explicit count, include the number so the judge can do feasibility math.",
      "  - Avoid vague verbs ('improve', 'handle', 'address'). Prefer 'all X are Y' / 'X file exists'.",
      "",
      "Calling this does NOT start the loop. The user sees your rationale + a button and decides",
      "whether to tap it. If they don't, they continue replying manually and you do nothing",
      "special on the next turn.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        condition: {
          type: "string",
          description:
            "The exit condition for the goal — concrete and observable. Will be embedded verbatim in the /goal prompt. Max 2000 chars.",
        },
        rationale: {
          type: "string",
          description:
            "One short sentence shown above the button explaining what the loop would do. Max 400 chars.",
        },
      },
      required: ["condition", "rationale"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const condition = typeof p["condition"] === "string" ? p["condition"].trim() : "";
      const rationale = typeof p["rationale"] === "string" ? p["rationale"].trim() : "";
      if (!condition) {
        return {
          content: [{ type: "text" as const, text: "Error: condition is required." }],
          details: {},
        };
      }
      if (!rationale) {
        return {
          content: [{ type: "text" as const, text: "Error: rationale is required." }],
          details: {},
        };
      }
      setSuggestion({
        condition: condition.slice(0, MAX_CONDITION_CHARS),
        rationale: rationale.slice(0, MAX_RATIONALE_CHARS),
      });
      log.info(
        `[suggest-goal] queued (${condition.length} char condition, ${rationale.length} char rationale)`,
      );
      return {
        content: [
          {
            type: "text" as const,
            text:
              "Suggestion queued. The user will see a one-click button to start a /goal loop with the given exit condition once your turn ends.",
          },
        ],
        details: {},
      };
    },
  };
}
