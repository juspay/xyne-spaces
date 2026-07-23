/**
 * Digital Twin structured delivery — the ONE channel the Twin uses to respond.
 *
 * The Twin agent (xyne-claw) MUST finish by calling the mandatory `twin_deliver`
 * tool; its arguments become a `TwinDelivery`, which rides back on the run's done
 * payload, gets rendered into the approval DM by claw-auth, and is executed
 * (react-as-user and/or post-as-user) only after the user approves. Free-form
 * assistant text is discarded on the Twin path, so assistant-style narration
 * ("Saved to memory", "Searching…", todo chatter) can never leak into a channel.
 */

/** What the Twin does with a turn. `ignore` = a confident decision to post
 *  NOTHING (no reply, no emoji, no approval DM) — the turn ends silently. It is
 *  distinct from a fail-closed non-delivery: `ignore` is an explicit choice that
 *  still rides back so the caller can tell "chose to stay silent" from "never
 *  delivered". */
export type TwinDeliveryAction = "react" | "reply" | "react_and_reply" | "ignore";

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
}

/**
 * A destination the Twin is allowed to reply in — injected into the run so the
 * model names REAL channels/threads (by id) instead of inventing them. Built by
 * claw-auth from the user's Spaces memberships and passed on the run dispatch.
 */
export interface TwinDestinationCandidate {
  kind: "channel" | "thread" | "user";
  /** Human label shown to the model, e.g. "#engineering", "thread: Q3 launch",
   *  or "Mamtha Venkattaramanujam" for a person the Twin can DM. */
  label: string;
  /** For kind="channel"/"thread": the channel id. Absent for kind="user". */
  channelId?: string;
  channelName?: string;
  /** For kind="thread": the conversation id of the specific thread. */
  conversationId?: string;
  /** For kind="user": the Spaces user id to DM (offered as a `dm:<userId>` token). */
  userId?: string;
}

/** Runtime type guard — validates an unknown value is a well-formed TwinDelivery. */
export function isTwinDelivery(v: unknown): v is TwinDelivery {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (d["action"] !== "react" && d["action"] !== "reply" && d["action"] !== "react_and_reply" && d["action"] !== "ignore") return false;
  // `ignore` carries no emoji/message — it is valid on its own.
  const wantsEmoji = d["action"] === "react" || d["action"] === "react_and_reply";
  const wantsMessage = d["action"] === "reply" || d["action"] === "react_and_reply";
  if (wantsEmoji && (typeof d["emoji"] !== "string" || !d["emoji"].trim())) return false;
  if (wantsMessage && (typeof d["message"] !== "string" || !d["message"].trim())) return false;
  return true;
}
