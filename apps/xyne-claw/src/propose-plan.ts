/**
 * propose-plan — the terminal tool for PLAN MODE (agent.config.planMode).
 *
 * When an agent runs in plan mode it gets a READ-ONLY tool palette plus this
 * one tool. It investigates (search / read only), then calls propose-plan with
 * the full ordered todo list and a `trivial` judgment, which:
 *   1. captures the plan into a closure ref (read back by run.ts), and
 *   2. HARD-STOPS the turn via abortRun (like respond-to-user) — the agent must
 *      NOT execute anything until the user approves.
 *
 * run.ts recovers ref.value in its catch block (the abort lands there) and puts
 * it on the /webhook/result callback as `pendingPlan`. claw-auth then posts the
 * plan card: a `proposed` card with an Approve button when !trivial, or an
 * `executing` card that auto-continues into Turn 2 (auto mode) when trivial.
 *
 * Mirrors the twin-deliver ref/idempotency pattern; injected ONLY when
 * mode==='plan', never in auto mode (so auto-mode behavior is unchanged).
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger.js";

const log = createLogger("propose-plan");

export const PROPOSE_PLAN_TOOL_NAME = "propose-plan";
const MAX_TODOS = 30;
const MAX_TITLE = 120;
const MAX_DESC = 1000;
const MAX_DOCUMENT = 20000;

/** The plan the agent proposes — read back by run.ts and shipped as `pendingPlan`. */
export interface ProposedPlan {
  title: string;
  desc?: string;
  /** Ordered todos. Stable ids the user selects among; titles are user-facing. */
  todos: { id: string; title: string }[];
  /**
   * The DETAILED plan, in GitHub-flavored markdown. Separate from the short todo
   * titles: the card briefs the plan (title + todos), the expanded view renders
   * this full document. Always present (synthesized from the todos if the model
   * omits it) so the expanded view is never empty.
   */
  document: string;
  /** True ⇒ skip the approval gate: post an executing card + auto-continue. */
  trivial: boolean;
}

/**
 * Strip a leading ordinal label from a todo title so the UI's crisp titles never
 * carry "Step 1 -", "Stage2:", "Phase 3.", "Plan1)", "Task 4 —", or a bare "1." —
 * the card numbers/orders todos itself. Both patterns REQUIRE a digit, so a real
 * title that merely starts with the word "Plan"/"Task" (e.g. "Plan the rollout")
 * is left untouched. Falls back to the original if stripping would empty it.
 */
export function stripOrdinalPrefix(title: string): string {
  const base = title.trim();
  let t = base
    // "Step 1:", "Stage2 -", "Phase 3.", "Plan1)", "Task 4 —", "Part 5]", "Item6"
    .replace(/^(?:step|stage|phase|plan|task|todo|part|item)\s*#?\s*\d+\s*[-:.)\]–—]*\s*/i, "")
    // bare "1.", "2)", "3 -" (must have a trailing separator so "3 files" is safe)
    .replace(/^\d+\s*[-:.)\]–—]+\s*/, "");
  t = t.trim();
  return t.length > 0 ? t : base;
}

/** Build a minimal markdown document from the plan when the model omits one. */
function synthesizePlanDocument(
  title: string,
  desc: string,
  todos: { id: string; title: string }[],
): string {
  const lines = [`# ${title}`];
  if (desc) lines.push("", desc);
  lines.push("", "## Steps", "");
  todos.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
  return lines.join("\n");
}

/** Shared ref the tool writes the accepted plan into (mirrors TwinDeliverRef). */
export interface ProposePlanRef {
  value?: ProposedPlan;
  /** How many duplicate calls arrived after the first accepted plan. */
  duplicates?: number;
  /** How many times the tool rejected a call — telemetry / fail-open backstop. */
  rejections?: number;
}

export function buildProposePlanTool(
  ref: ProposePlanRef,
  abortRun?: () => void,
): ToolDefinition {
  return {
    name: PROPOSE_PLAN_TOOL_NAME,
    label: "Propose Plan",
    description: [
      "Propose your plan for this task and STOP. This is your ONLY exit in plan mode —",
      "you have read-only tools, so you CANNOT do the work yet. First investigate just",
      "enough (search / read) to write a concrete plan, then call propose-plan exactly",
      "ONCE with the full, ordered todo list. Calling it ENDS your turn immediately;",
      "do NOT keep working or call other tools after it.",
      "",
      "Each todo is { id, title } — give every todo a short, stable id (e.g. 't1', 't2')",
      "and a CRISP title: an imperative action phrase of at most 6–8 words. Do NOT prefix",
      "titles with 'Step 1', 'Stage 2', 'Phase 3', 'Plan 4', a bare number, or any other",
      "ordinal — the UI orders and numbers them for you. The user sees these as a checklist,",
      "picks which to keep, and approves; only then does execution begin (fresh auto-mode turn).",
      "",
      "ALSO provide `document`: the FULL plan written out in GitHub-flavored MARKDOWN. The",
      "short todos are just the checklist; the document is the detailed brief shown when the",
      "user expands the plan — cover the context, the approach, what each step does and why,",
      "any risks/assumptions, and the expected outcome. Use headings, bullets and short",
      "paragraphs. This is separate from and richer than the todo titles and the `desc`.",
      "",
      "Set `trivial: true` ONLY when the task is so simple that asking for approval would",
      "be noise (a one- or two-step ask with no risky/irreversible action). A trivial plan",
      "skips the approval gate and starts immediately. When in doubt, set trivial: false.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string",
          description: "Short title for the plan (what you're about to do).",
        },
        desc: {
          type: "string",
          description: "Optional one- or two-line description / framing of the plan.",
        },
        todos: {
          type: "array",
          description: "The full, ordered list of steps you will execute once approved.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", description: "Short stable id, e.g. 't1'." },
              title: {
                type: "string",
                description:
                  "Crisp imperative step title, max 6–8 words, NO ordinal prefix ('Step 1', numbers, etc.).",
              },
            },
            required: ["id", "title"],
          },
        },
        document: {
          type: "string",
          description:
            "The DETAILED plan in GitHub-flavored markdown — the full brief shown when the user expands the plan (context, approach, per-step detail, risks, expected outcome). Separate from and richer than the short todo titles.",
        },
        trivial: {
          type: "boolean",
          description:
            "true ⇒ skip approval and start immediately (only for simple, low-risk tasks). Default false.",
        },
      },
      required: ["title", "todos", "document"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const reject = (text: string) => {
        ref.rejections = (ref.rejections ?? 0) + 1;
        return { content: [{ type: "text" as const, text }], details: { error: true } };
      };
      // Idempotency: the plan is proposed EXACTLY ONCE per turn. Repeat calls
      // (some models re-emit) are a no-op that firmly tells the model to stop —
      // the first accepted plan stands.
      if (ref.value !== undefined) {
        ref.duplicates = (ref.duplicates ?? 0) + 1;
        log.info(`[propose-plan] duplicate call #${ref.duplicates} ignored — first plan stands`);
        return {
          content: [
            {
              type: "text" as const,
              text: "You have ALREADY proposed your plan — that first call is final and is queued for the user. Do NOT call propose-plan again. Stop here and produce no further output.",
            },
          ],
          details: { duplicate: true },
        };
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const title = typeof p["title"] === "string" ? p["title"].trim() : "";
      if (!title) return reject("Rejected: `title` is required. Call propose-plan again with a short plan title.");

      const rawTodos = Array.isArray(p["todos"]) ? (p["todos"] as unknown[]) : [];
      const todos = rawTodos
        .map((t, i) => {
          const o = (t ?? {}) as Record<string, unknown>;
          // Crisp titles: strip any ordinal prefix the model added ("Step 1 -",
          // "2)" …) so the UI's own numbering is the only ordering signal.
          return {
            id: String(o["id"] ?? `t${i + 1}`).slice(0, 64),
            title: stripOrdinalPrefix(String(o["title"] ?? "")).slice(0, MAX_TITLE),
          };
        })
        .filter((t) => t.title.length > 0)
        .slice(0, MAX_TODOS);
      if (todos.length === 0) {
        return reject("Rejected: provide at least one todo with a non-empty `title`. Call propose-plan again.");
      }
      // De-dup ids so the client can key rows unambiguously.
      const seen = new Set<string>();
      for (const t of todos) {
        let id = t.id;
        while (seen.has(id)) id = `${id}_`;
        t.id = id;
        seen.add(id);
      }

      const desc = typeof p["desc"] === "string" ? p["desc"].trim().slice(0, MAX_DESC) : "";
      // Detailed markdown brief for the expanded view. Synthesize a minimal one
      // from the todos if the model omitted it, so the expanded view is never blank.
      const rawDocument = typeof p["document"] === "string" ? p["document"].trim().slice(0, MAX_DOCUMENT) : "";
      const document = rawDocument || synthesizePlanDocument(title.slice(0, MAX_TITLE), desc, todos);
      ref.value = {
        title: title.slice(0, MAX_TITLE),
        ...(desc ? { desc } : {}),
        todos,
        document,
        trivial: p["trivial"] === true,
      };
      log.info(
        `[propose-plan] accepted title="${ref.value.title}" todos=${todos.length} docLen=${document.length} trivial=${ref.value.trivial}`,
      );

      // Hard-stop the turn — plan mode is read-only, so there is nothing more to
      // do until the user approves. Wired by run.ts to AbortController.abort().
      try {
        abortRun?.();
      } catch {
        // Never let an abort-wiring bug poison the plan path.
      }

      return {
        content: [
          {
            type: "text" as const,
            text: ref.value.trivial
              ? "STOP — plan proposed (trivial: starting immediately). Do NOT continue or call any more tools."
              : "STOP — plan proposed and sent to the user for approval. Do NOT continue or call any more tools; execution begins only after they approve.",
          },
        ],
        details: { trivial: ref.value.trivial, count: todos.length },
      };
    },
  };
}
