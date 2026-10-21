/**
 * Digital Twin structured delivery — the ONE channel the Twin uses to respond.
 *
 * The Twin agent (xyne-claw) MUST finish by calling the mandatory `twin_deliver`
 * tool; its arguments become a `TwinDelivery`, which rides back on the run's done
 * payload and is rendered by claw-auth as an owner-only in-thread reply draft (the
 * legacy approval DM is used only when the Spaces draft endpoint returns 401/404;
 * any other draft failure stays silent, fail-closed). It is executed (react-as-user
 * and/or post-as-user) only after the owner approves. Free-form assistant text is
 * discarded on the Twin path, so assistant-style narration ("Saved to memory",
 * "Searching…", todo chatter) can never leak into a channel.
 */

/** What the Twin does with a turn. `ignore` = a confident decision to post
 *  NOTHING (no reply, no emoji, no approval DM) — the turn ends silently. It is
 *  distinct from a fail-closed non-delivery: `ignore` is an explicit choice that
 *  still rides back so the caller can tell "chose to stay silent" from "never
 *  delivered". */
export const TWIN_DELIVERY_ACTIONS = ["react", "reply", "react_and_reply", "ignore"] as const;
export type TwinDeliveryAction = (typeof TWIN_DELIVERY_ACTIONS)[number];

export const isTwinDeliveryAction = (v: unknown): v is TwinDeliveryAction => (TWIN_DELIVERY_ACTIONS as readonly unknown[]).includes(v);

/** Which parts an action carries: `emoji` = it reacts, `message` = it posts a reply. `ignore` (or anything else) carries neither. */
export const twinDeliveryParts = (action: unknown) => ({
  emoji: action === "react" || action === "react_and_reply",
  message: action === "reply" || action === "react_and_reply",
});

/**
 * Where a REPLY is posted. (A REACT always targets the triggering message — that
 * is fixed and not the model's choice, so it is not part of this union.)
 *
 * Default is `origin_thread`. Non-default choices are validated against the
 * user's accessible destinations and ultimately gated by post-as-user, which
 * enforces the user's real Spaces membership — so an invalid pick degrades to
 * the origin thread rather than posting somewhere the user can't.
 */
export type TwinReplyDestination =
  | { kind: "origin_thread" }
  | { kind: "origin_channel" }
  /** DM the person who mentioned the user (the sender). Resolved to their userId
   *  downstream from the run's session context. */
  | { kind: "dm_sender" }
  /** DM a SPECIFIC person by their Spaces user id — not restricted to the sender. */
  | { kind: "dm"; userId: string; userName?: string }
  | { kind: "channel"; channelId: string; channelName?: string }
  | { kind: "thread"; conversationId: string; channelId: string; channelName?: string };

export interface TwinDelivery {
  action: TwinDeliveryAction;
  /** Unicode emoji for `react` / `react_and_reply` (e.g. "👍"). */
  emoji?: string;
  /** Reply text in the user's own first-person voice, for `reply` / `react_and_reply`. */
  message?: string;
  /** Reply destination; omitted ⇒ `origin_thread`. Ignored when `action === "react"`. */
  destination?: TwinReplyDestination;
  /** Why the Twin chose a non-default destination (shown in the approval + logged). */
  destinationReason?: string;
  /**
   * PRIVATE rationale for this response — the "Why?" panel content, shown ONLY to
   * the owner and NEVER posted. Unlike `message` (which stays clean and
   * citation-free), this SHOULD ground its factual claims: each fact carries the
   * exact `[clf-<toolCallId>#<n>]` citation token copied verbatim from the tool
   * result, so claw-auth can bake citation metadata and the frontend can render
   * clickable source chips (same pipeline as thread-message citations). Absent
   * when the model provided none. Not applicable to `ignore`.
   */
  reasoning?: string;
  /**
   * Classifier self-check of this delivery (advisory, never blocks). Set by claw
   * after the delivery is accepted; each score is 0..1, higher is better.
   */
  check?: TwinDeliveryCheck;
}

export interface TwinDeliveryCheck {
  /** The reply addresses what was asked (reply actions). */
  answersAsk?: number;
  /** Every claim in the reply is supported by the conversation/context (reply actions). */
  grounded?: number;
  /** Staying silent / only reacting was the right call (ignore/react actions). */
  actionFits?: number;
  /** "right" | "wrong" | "unsure" — the destination (reply actions with a destination). */
  destination?: string;
  /** Lowest of the scores above — one number to sort/flag by. */
  overall: number;
  source: "jev";
  ms: number;
}

/** Runtime type guard — validates an unknown value is a well-formed TwinDelivery. */
export function isTwinDelivery(v: unknown): v is TwinDelivery {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  const action = d["action"];
  if (!isTwinDeliveryAction(action)) return false;
  // `ignore` carries no emoji/message — it is valid on its own.
  const parts = twinDeliveryParts(action);
  if (parts.emoji && (typeof d["emoji"] !== "string" || !d["emoji"].trim())) return false;
  if (parts.message && (typeof d["message"] !== "string" || !d["message"].trim())) return false;
  return true;
}
