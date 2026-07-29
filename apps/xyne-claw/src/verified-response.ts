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
}

export interface VerifiedResponseToolOpts {
  getPendingResponses: () => PendingResponse[];
  abortRun?: (() => void) | undefined;
  /** The user's original task — the verifier checks the draft against it. */
  task: string;
  /** Shared ref; agent.ts sets getDigest after session creation. */
  evidenceRef: EvidenceRef;
  /** For metric attribution. */
  agentSlug?: string | undefined;
  /** Per-agent delivery criteria (agentConfig.verifyResponseCriteria) — passed
   *  to the verifier on top of its default factual check. */
  criteria?: string | undefined;
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

export function buildVerifiedResponseTool(opts: VerifiedResponseToolOpts): ToolDefinition {
  const pendingResponses = opts.getPendingResponses();
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

      // Give-up branch: we've corrected enough times, deliver as-is.
      if (rejections >= MAX_REJECTIONS) {
        metric.count("response_verify_exhausted", { agentSlug: opts.agentSlug ?? "" });
        deliver(message);
        return { content: [{ type: "text" as const, text: STOP_TEXT }], details: {} };
      }

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
