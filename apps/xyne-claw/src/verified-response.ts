/**
 * `submit-response` — verified delivery tool for `verifyResponses` agents.
 *
 * Like copilot's respond-to-user it is the agent's terminal delivery channel
 * (message → pendingResponses → claw-auth posts it). The difference: before
 * accepting, it runs {@link verifyResponse} on the draft against the evidence
 * gathered this run. A clean verdict delivers and stops the run; a failed
 * verdict returns a structured rejection AS THE TOOL RESULT and does NOT
 * abort — so pi naturally re-prompts and the model resubmits a corrected,
 * complete message. See verify-response.ts header for why the tool-result
 * channel (vs an injected user/system turn) avoids apologize-and-patch.
 *
 * Only the ACCEPTED message is ever pushed to pendingResponses; rejected
 * drafts are dropped, so the user only ever sees the verified final answer.
 *
 * Two gates run, cheapest first:
 *   1. A DETERMINISTIC required-tools gate (config.verifyResponseRequireTools).
 *      It checks the run's actual tool-call log — not the model's word — so a
 *      declared mandatory tool (e.g. an RCA agent's `rca-critic`) provably ran
 *      before any answer is delivered. LLM-free, so it cannot be talked past.
 *   2. The LLM `verifyResponse` factual check (unchanged).
 * Both share one rejection budget so a non-compliant model fails open instead
 * of hanging the run.
 */

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PendingResponse } from "xyne-claw-shared";
import { verifyResponse, renderRejection } from "./verify-response.js";
import { metric } from "./metrics.js";

import { createLogger } from "./logger.js";
const log = createLogger("verified-response");

export const SUBMIT_RESPONSE_TOOL_NAME = "submit-response";

// Max correction rounds before we deliver whatever the agent last submitted.
// Same fail-open philosophy as the goal loop: verification must never strand a
// user's response in an endless rewrite loop. 2 rounds matched the A/B test
// where a single rejection already fixed the wrong-fact case.
const MAX_REJECTIONS = Number(process.env["RESPONSE_VERIFY_MAX_ROUNDS"] ?? 2);

/** Lazy accessor for the run's evidence digest. Populated by agent.ts once the
 *  pi session exists (the tool is built before the session in run.ts). */
export interface EvidenceRef {
  getDigest?: () => string;
  /** Live accessor for the tool names invoked so far this run. agent.ts wires
   *  this to its running `toolsUsed` array; the deterministic required-tools
   *  gate reads it. Undefined when no gate is configured / not yet wired. */
  toolsUsed?: () => string[];
}

export interface VerifiedResponseToolOpts {
  getPendingResponses: () => PendingResponse[];
  abortRun?: (() => void) | undefined;
  /** The user's original task — the verifier checks the draft against it. */
  task: string;
  /** Shared ref; agent.ts sets getDigest / toolsUsed after session creation. */
  evidenceRef: EvidenceRef;
  /** For metric attribution. */
  agentSlug?: string | undefined;
  /** Per-agent delivery criteria (agentConfig.verifyResponseCriteria) — passed
   *  to the verifier on top of its default factual check. */
  criteria?: string | undefined;
  /** Deterministic process guard (agentConfig.verifyResponseRequireTools):
   *  tool-name substrings (case-insensitive) that MUST have actually been
   *  invoked this run before a draft may be delivered. Checked against the run's
   *  real tool-call log via evidenceRef.toolsUsed — this is what makes "was
   *  tool X called?" deterministic, unlike the LLM verifier. Empty/undefined =
   *  no required-tools gate (existing behavior). */
  requiredTools?: string[] | undefined;
}

const DESCRIPTION = [
  "Submit your completed response for delivery to the user.",
  "",
  "Use this tool for your FINAL answer — do not write it as a plain assistant message.",
  "The result of this tool is an AUTOMATED DELIVERY STATUS from the validation pipeline.",
  "It is NEVER a message from the user; the user cannot see or reply to anything until delivery succeeds.",
  "",
  "If the status reports delivered=false, your draft was NOT shown to the user. Fix the listed",
  "issues and call submit-response again with the COMPLETE, self-contained message rewritten from",
  "scratch. Do not reference the validation, the rejection, or any 'correction' — the user only ever",
  "sees the message that is finally delivered.",
].join("\n");

/** System-prompt appendix telling the agent to deliver via submit-response. */
export const SUBMIT_RESPONSE_SYSTEM_INSTRUCTION = `
## Response Channel — REQUIRED

Deliver your FINAL answer by calling the \`submit-response\` tool with the complete
response in the \`message\` argument. Do NOT write the final answer as a plain
assistant message — only \`submit-response\` reaches the user.

Each \`message\` must be COMPLETE and self-contained: the user sees exactly that
text and nothing else. Do not send partial answers or deltas.

The tool's result is an automated delivery status, not a message from the user.
If it reports delivered=false, your draft was not sent — fix the listed issues
and call \`submit-response\` again with the full corrected message. Never address
the validator or mention corrections in the message itself.

Keep using your normal tools to do the work; only call \`submit-response\` when
you have the final result ready to deliver.
`.trim();

/** Deterministic rejection returned when configured required tools have not run
 *  yet this run. Shaped like renderRejection (a delivery-status object) so the
 *  model retries like a schema failure instead of apologizing. */
function renderMissingToolsRejection(missing: string[]): string {
  return JSON.stringify({
    delivered: false,
    errors: missing.map((tool) => ({
      claim: `required tool "${tool}" must run before this answer can be delivered`,
      check: "required-tool-not-called",
      found: `"${tool}" was not called this run`,
    })),
    action:
      "Actually CALL the required tool(s) listed above and use their result, then call " +
      "submit-response again with the complete message. This is a deterministic check on the " +
      "run's tool calls — it cannot be satisfied by describing, claiming, or substituting another " +
      "tool. Do not reference this validation in the delivered message.",
  });
}

export function buildVerifiedResponseTool(opts: VerifiedResponseToolOpts): ToolDefinition {
  const pendingResponses = opts.getPendingResponses();
  const requiredTools = (opts.requiredTools ?? []).filter((t) => t.trim().length > 0);
  let rejections = 0;

  const deliver = (message: string): void => {
    // Dedup mirrors respond-to-user: only the first accepted delivery wins.
    if (pendingResponses.length === 0) {
      pendingResponses.push({ responseId: crypto.randomUUID(), message });
    }
    try {
      opts.abortRun?.();
    } catch {
      // Never let an abort-wiring bug poison the delivery path.
    }
  };

  return {
    name: SUBMIT_RESPONSE_TOOL_NAME,
    label: "Submit Response",
    description: DESCRIPTION,
    parameters: Type.Object({
      message: Type.String({
        description: "The complete, self-contained response to deliver to the user.",
      }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const message = String((params as Record<string, unknown> | undefined)?.["message"] ?? "");
      if (!message.trim()) {
        return { content: [{ type: "text" as const, text: "Error: message is required." }], details: {} };
      }

      // Give-up branch: we've corrected enough times, deliver as-is. Applies to
      // BOTH gates below — the deterministic gate increments `rejections` too,
      // so a model that never calls the required tool still fails open here
      // rather than looping forever.
      if (rejections >= MAX_REJECTIONS) {
        metric.count("response_verify_exhausted", { agentSlug: opts.agentSlug ?? "" });
        deliver(message);
        return { content: [{ type: "text" as const, text: STOP_TEXT }], details: {} };
      }

      // ── Gate 1: deterministic required-tools check (runs BEFORE the LLM
      // verifier so it's cheap and cannot be talked past). Enforces that the
      // owner-declared mandatory tools actually appear in the run's tool-call
      // log. Unlike verifyResponse (a model judging a model), this is a hard
      // check on real invocations — the whole point of making delivery
      // deterministic for pipelines like RCA that MUST run an independent
      // critic before emitting a verdict.
      if (requiredTools.length > 0) {
        const used = (() => {
          try {
            return (opts.evidenceRef.toolsUsed?.() ?? []).map((t) => t.toLowerCase());
          } catch {
            return [];
          }
        })();
        const missing = requiredTools.filter(
          (req) => !used.some((u) => u.includes(req.toLowerCase())),
        );
        if (missing.length > 0) {
          rejections += 1;
          metric.count("response_verify_tools_missing", {
            agentSlug: opts.agentSlug ?? "",
            round: String(rejections),
          });
          log.info(
            `[verify-response] deterministic gate rejected draft (round ${rejections}/${MAX_REJECTIONS}): ` +
              `required tools not called this run: ${missing.join(", ")}`,
          );
          return {
            content: [{ type: "text" as const, text: renderMissingToolsRejection(missing) }],
            details: {},
          };
        }
      }

      // ── Gate 2: LLM factual verification against gathered evidence.
      const evidenceDigest = (() => {
        try {
          return opts.evidenceRef.getDigest?.() ?? "";
        } catch {
          return "";
        }
      })();

      const verdict = await verifyResponse({ task: opts.task, evidenceDigest, draft: message, criteria: opts.criteria });

      if (verdict.ok) {
        metric.count("response_verify_pass", { agentSlug: opts.agentSlug ?? "", rejections: String(rejections) });
        deliver(message);
        return { content: [{ type: "text" as const, text: STOP_TEXT }], details: {} };
      }

      rejections += 1;
      metric.count("response_verify_reject", { agentSlug: opts.agentSlug ?? "", round: String(rejections) });
      log.info(
        `[verify-response] rejected draft (round ${rejections}/${MAX_REJECTIONS}): ${verdict.errors
          .map((e) => e.claim)
          .join("; ")
          .slice(0, 200)}`,
      );
      // No abort: returning the rejection lets pi re-prompt the model, which
      // resubmits via submit-response again.
      return { content: [{ type: "text" as const, text: renderRejection(verdict.errors) }], details: {} };
    },
  };
}

const STOP_TEXT =
  "STOP — Response delivered to the user. Do NOT continue working, do NOT call any more tools, " +
  "do NOT make assumptions about a reply. Acknowledge and stop.";
