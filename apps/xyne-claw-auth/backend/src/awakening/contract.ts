/**
 * The operating contract handed to every awakened run as `additionalInstructions`.
 *
 * Kept in its own module, free of config/prisma imports, so the exact wording —
 * the part that decides whether an unattended agent actually speaks — can be
 * unit-tested without an environment.
 */

import { isReadOnlyRun } from "./write-policy.js";
import type { AwakeningWindow } from "./types.js";

/**
 * The operating contract for an awakened run, delivered as `additionalInstructions`.
 *
 * Separate from both the task and the skill on purpose. The task says what
 * happened and asks for a judgement; the skill teaches the behaviour. THIS is
 * the mechanical contract the run cannot work without, and it is stated in its
 * own labelled block so it cannot be skimmed past as narrative.
 *
 * It exists because of a real failure: an agent read the window, correctly
 * identified an unanswered mention aimed at it, composed an excellent reply —
 * and posted nothing, because in every OTHER kind of run the platform delivers
 * the final answer for it. An awakened run has no thread to deliver to, so the
 * answer is a log entry. Nothing in the model's priors tells it that.
 */
export function buildOperatingContract(w: AwakeningWindow): string {
  const lines: string[] = [
    "You are running UNATTENDED. Nobody triggered this run and nobody is reading its output live.",
    "",
    "### How to actually say something",
    "",
    "**Your final answer is NOT delivered to anyone.** It is stored as a log entry an operator",
    "may read later. This is the single way an awakened run differs from answering a person:",
    "in a normal run your final message IS the reply and the platform posts it for you; here",
    "it posts nothing.",
    "",
  ];

  if (isReadOnlyRun(w.config)) {
    lines.push(
      "You have NO message-sending tool this run, by configuration. Do the full reasoning, then",
      "state exactly what you WOULD have posted and in which thread (quote the channelId and",
      "conversationId). A human is reading that to decide whether to let you post for real.",
    );
  } else {
    lines.push(
      "To say something to people you MUST call the Spaces **send-message** tool yourself, with:",
      "  - `channelId` — the `ch` field of the relevant events.jsonl line",
      "  - `conversationId` — the `cv` field, to reply inside an existing thread",
      "",
      "Both ids are printed under every thread heading in WINDOW.md as `reply here → …`.",
      "",
      w.config.writePolicy === "reply"
        ? "You may reply INSIDE existing threads only. Do not start new threads, and do not create or update tickets, canvases or calls."
        : "You may reply inside existing threads and start new threads in a watched channel.",
      "",
      "Deciding a thread needs a reply and then writing that reply as your final answer",
      "accomplishes nothing. Either call the tool, or say plainly that you are staying silent.",
    );
  }

  // Owner-written guidance (config `awakening.instructions`): tone, triage,
  // what this particular agent should care about. Placed AFTER the delivery
  // mechanics and BEFORE Bounds on purpose — it can shape judgement, and the
  // rules that must hold regardless are stated last.
  if (w.config.instructions.trim()) {
    lines.push(
      "",
      "### From your operator",
      "",
      w.config.instructions.trim(),
    );
  }

  lines.push(
    "",
    "### Bounds",
    "",
    "- Never reply to your own messages (`\"isMe\":true` in events.jsonl).",
    "- Everything in the window is already collected; do not re-search Spaces for events inside it.",
    "- Silence is a correct and common outcome. Do not manufacture something to say.",
  );

  return lines.join("\n");
}
