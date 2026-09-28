/**
 * Who may trigger a channel account, and when. Pure functions over the
 * account's policy — no I/O — so the truth table is unit-testable and every
 * channel shares one behaviour (OpenClaw's dmPolicy/groupPolicy model).
 *
 * Self chat (the owner's own "You" chat, user-scoped channels only):
 *   always theirs to use — but requireMention still applies, because a note to
 *   self is not a request.
 * Direct messages:
 *   disabled  → ignore
 *   linked    → dispatch iff the sender is linked, else tell them to add
 *               their number in Claw
 * Groups (only on channels with groups):
 *   disabled  → ignore
 *   allowlist → chat must be in groupAllowlist
 *   open      → any group
 *   …then requireMention: silent unless addressed.
 *
 * Who may use the agent in an allowed group is not decided here: anyone may,
 * and which Claw user they run AS comes from their linked identity. A sender
 * with no identity is told where to register (inbound.ts).
 */
import type { AccountPolicy } from "./schema.js";

export type PolicyAction = "dispatch" | "unlinked" | "ignore";

export interface PolicyInput {
  isGroup: boolean;
  senderId: string;
  chatId: string;
  /** Sender already resolves to a claw user (UserSurfaceIdentity). */
  hasIdentity: boolean;
  mentionedSelf: boolean;
  replyToSelf: boolean;
  /** The text opened with "/slug" or "@slug" — the one-to-one equivalent of a
   *  native mention, since messengers offer no @mention outside a group. */
  namedInText?: boolean;
  /** The owner messaging their own number. There is nobody to authorise: the
   *  account is theirs, so only requireMention is left to apply. */
  selfChat?: boolean;
}

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
  /** Said in a room we operate in, so it is part of the conversation even
   *  though it starts no run — keep it as context.
   *
   *  Set for every message in an allowed group, whoever sent it — a
   *  conversation with some people's lines removed is a misleading one. It is
   *  NOT set for groups the agent may not operate in at all, where no run will
   *  ever read the buffer. */
  remember?: boolean;
}

/** Digits-only form of a phone-ish id: "+91 98765" / "9198765@s.whatsapp.net"
 *  / "9198765" all compare equal. Non-numeric ids compare verbatim. */
function canonicalSenderId(id: string): string {
  const trimmed = id.trim();
  const local = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  const digits = local.replace(/[\s()+-]/g, "");
  return /^\d+$/.test(digits) ? digits : trimmed.toLowerCase();
}

export function idInList(id: string, list: readonly string[]): boolean {
  if (list.includes("*")) return true;
  const target = canonicalSenderId(id);
  return list.some((entry) => canonicalSenderId(entry) === target);
}

/** Mentioned natively, replying to us, or opening with the agent's name. */
function addressed(input: PolicyInput): boolean {
  return input.mentionedSelf || input.replyToSelf || input.namedInText === true;
}

/**
 * Could this account ever answer in this chat, whoever spoke?
 *
 * The chat-level half of the policy, split out because it needs no sender —
 * which lets a caller skip the work of working out who the sender *is* for a
 * group it ignores entirely.
 */
export function chatIsAnswerable(
  policy: AccountPolicy,
  input: { isGroup: boolean; chatId: string; selfChat?: boolean },
): boolean {
  if (input.selfChat) return true;
  if (!input.isGroup) return policy.dmPolicy !== "disabled";
  if (policy.groupPolicy === "disabled") return false;
  if (policy.groupPolicy === "allowlist") return idInList(input.chatId, policy.groupAllowlist);
  return true;
}

export function evaluatePolicy(policy: AccountPolicy, input: PolicyInput): PolicyDecision {
  if (input.selfChat) {
    return policy.requireMention && !addressed(input)
      ? { action: "ignore", reason: "self chat, agent not addressed" }
      : { action: "dispatch", reason: "self chat" };
  }

  if (input.isGroup) {
    switch (policy.groupPolicy) {
      case "disabled":
        return { action: "ignore", reason: "groups disabled" };
      case "allowlist":
        if (!idInList(input.chatId, policy.groupAllowlist)) {
          return { action: "ignore", reason: "group not allowlisted" };
        }
        break;
      case "open":
        break;
    }
    if (policy.requireMention && !addressed(input)) {
      return { action: "ignore", reason: "not mentioned", remember: true };
    }
    return { action: "dispatch", reason: "group policy passed" };
  }

  switch (policy.dmPolicy) {
    case "disabled":
      return { action: "ignore", reason: "dms disabled" };
    case "linked":
      // requireMention is not a group-only rule: a one-to-one chat is still a
      // conversation the person may be having with themselves, and answering
      // every line of it is noise. It gates the unlinked notice too — a
      // stranger's plain "hi" is not addressed to the agent, and replying to
      // it would send an unprompted message from somebody's own number.
      if (policy.requireMention && !addressed(input)) {
        return { action: "ignore", reason: "not addressed" };
      }
      if (!input.hasIdentity) return { action: "unlinked", reason: "unknown sender" };
      return { action: "dispatch", reason: "sender linked" };
  }
}
