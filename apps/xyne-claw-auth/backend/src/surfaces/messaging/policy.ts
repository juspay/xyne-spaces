/**
 * Who may trigger a channel account, and when. Pure functions over the
 * account's policy — no I/O — so the truth table is unit-testable and every
 * channel shares one behaviour (OpenClaw's dmPolicy/groupPolicy model).
 *
 * Direct messages:
 *   disabled  → ignore
 *   linked    → dispatch iff the sender is linked, else tell them to add
 *               their number in Claw
 * Groups (only on channels with groups):
 *   disabled  → ignore
 *   allowlist → chat must be in groupAllowlist; if groupAllowFrom is set the
 *               sender must be in it too
 *   open      → any group (groupAllowFrom still applies if set)
 *   …then requireMention: silent unless @mentioned or replied-to.
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
}

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
  /** Said in a room we operate in, so it is part of the conversation even
   *  though it starts no run — keep it as context.
   *
   *  Set for every message in an allowed group, including from senders
   *  `groupAllowFrom` bars: that list decides who may TRIGGER the agent, not
   *  whose words it may read, and a conversation with those people's lines
   *  removed is a misleading one. It is NOT set for groups the agent may not
   *  operate in at all, where no run will ever read the buffer. */
  remember?: boolean;
}

/** Digits-only form of a phone-ish id: "+91 98765" / "9198765@s.whatsapp.net"
 *  / "9198765" all compare equal. Non-numeric ids compare verbatim. */
export function canonicalSenderId(id: string): string {
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

export function evaluatePolicy(policy: AccountPolicy, input: PolicyInput): PolicyDecision {
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
    if (policy.groupAllowFrom.length > 0 && !idInList(input.senderId, policy.groupAllowFrom)) {
      return { action: "ignore", reason: "sender not in groupAllowFrom", remember: true };
    }
    if (policy.requireMention && !input.mentionedSelf && !input.replyToSelf) {
      return { action: "ignore", reason: "not mentioned", remember: true };
    }
    return { action: "dispatch", reason: "group policy passed" };
  }

  switch (policy.dmPolicy) {
    case "disabled":
      return { action: "ignore", reason: "dms disabled" };
    case "linked":
      return input.hasIdentity
        ? { action: "dispatch", reason: "sender linked" }
        : { action: "unlinked", reason: "unknown sender" };
  }
}
