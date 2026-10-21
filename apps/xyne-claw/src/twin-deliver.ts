/**
 * twin_deliver — the MANDATORY, twin-only delivery tool for the Digital Twin's
 * mention/approval flow.
 *
 * Why it exists: the Twin used to hand back its raw last-assistant text, so
 * process narration ("Saved to memory", "Searching…", "Need to update todos")
 * and tool-usage footers leaked into the user's channel. Making a STRUCTURED
 * tool the only delivery channel fixes that at the root — free-form assistant
 * text is discarded on this path; only what the model passes here is delivered,
 * and only after the user approves.
 *
 * The tool captures WHAT (react with an emoji and/or reply) and WHERE (the reply
 * destination — default the origin thread, or another place the user can post).
 * A REACT always targets the triggering message, so it is not a destination
 * choice. Destination ids come from explicit fields the Twin looks up with its
 * own Spaces tools; no candidate list is injected.
 *
 * Twin-only: registered solely for the digital-twin agent AND hard-gated on
 * isDigitalTwinAgent at call time.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isDigitalTwinAgent, isTwinDeliveryAction, twinDeliveryParts, TWIN_DELIVERY_ACTIONS } from "xyne-claw-shared";
import type { TwinDelivery, TwinReplyDestination } from "xyne-claw-shared";
import { createLogger } from "./logger.js";
import { parseArgMarkup, parseJsonObject } from "./leaked-tool-call.js";

const log = createLogger("twin-deliver");

export const TWIN_DELIVER_TOOL_NAME = "twin_deliver";
const MAX_MESSAGE = 4000;
const MAX_EMOJI = 32;
const MAX_REASON = 300;
// The private "Why?" reasoning can be longer than the reply — it holds several
// grounded claims, each trailing a `[clf-…#n]` citation token.
const MAX_REASONING = 6000;

/** Shared ref the tool writes the accepted delivery into (mirrors StructuredOutputRef). */
export interface TwinDeliverRef {
  value?: TwinDelivery;
  /** How many times the tool rejected a call — telemetry / fail-open backstop. */
  rejections?: number;
  /** How many duplicate calls arrived after the first accepted delivery. */
  duplicates?: number;
}

// Reply destinations are SEMANTIC kinds. The Twin already has the Spaces tools
// (Vespa search + psql) to look up channel ids, thread/conversation ids, and
// user ids itself — so it discovers the real id and passes it in an explicit
// field (destination_channel_id / destination_conversation_id / dm_user_id)
// rather than us pre-injecting a candidate enum. No candidate list needed.
const DEST_KINDS = ["origin_thread", "origin_channel", "dm_sender", "dm", "channel", "thread"] as const;

const DEST_DESCRIBE = [
  "- origin_thread — reply in the same thread you were mentioned in (DEFAULT; no ids needed).",
  "- origin_channel — post a NEW top-level message in that same channel.",
  "- dm_sender — DM the person who @mentioned you (default DM target — no id needed).",
  "- dm — DM a SPECIFIC person (anyone): also set `dm_user_id` to their Spaces user id.",
  "- channel — reply in a DIFFERENT channel: also set `destination_channel_id`.",
  "- thread — reply in a DIFFERENT existing thread: also set `destination_channel_id` AND `destination_conversation_id`.",
  "Use your Spaces tools (search / lookup) to FIND the channel id, conversation id, or user id first — never guess an id.",
].join("\n");

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const toolResult = (text: string, details: Record<string, unknown>, terminate = false) => ({
  content: [{ type: "text" as const, text }],
  details,
  // Delivery is the twin's last act. pi ends the loop after this batch
  // (when every result in it terminates); the agent.ts stop hook covers
  // mixed batches. Without this the model kept calling tools — up to 117
  // duplicate twin_deliver calls in one prod run.
  ...(terminate ? { terminate: true as const } : {}),
});

function parseDestination(p: Record<string, unknown>): TwinReplyDestination | { error: string } {
  const token = typeof p["destination"] === "string" ? p["destination"] : undefined;
  if (!token || token === "origin_thread") return { kind: "origin_thread" };
  if (token === "origin_channel") return { kind: "origin_channel" };
  if (token === "dm_sender") return { kind: "dm_sender" };
  const uid = trimmed(p["dm_user_id"]);
  const ch = trimmed(p["destination_channel_id"]);
  const conv = trimmed(p["destination_conversation_id"]);
  if (token === "dm") {
    return uid
      ? { kind: "dm", userId: uid }
      : { error: `destination "dm" also needs \`dm_user_id\` (the person's Spaces user id — look it up with your Spaces tools) — or use "dm_sender" to DM whoever mentioned you` };
  }
  if (token === "channel") {
    return ch
      ? { kind: "channel", channelId: ch }
      : { error: `destination "channel" also needs \`destination_channel_id\` — find the channel id with your Spaces tools, or use origin_thread/origin_channel` };
  }
  if (token === "thread") {
    return ch && conv
      ? { kind: "thread", channelId: ch, conversationId: conv }
      : { error: `destination "thread" needs BOTH \`destination_channel_id\` and \`destination_conversation_id\` — find them with your Spaces tools, or use origin_thread` };
  }
  return { error: `unknown destination "${token}" — use origin_thread, origin_channel, dm_sender, dm, channel, or thread` };
}

/** Validate raw twin_deliver args into a TwinDelivery — the one parser for the
 *  tool call AND the leaked-call recovery. `lenient` (recovery) silently drops
 *  an invalid destination (and its reason) instead of rejecting the call. */
function parseDelivery(p: Record<string, unknown>, lenient = false): { delivery: TwinDelivery } | { error: string } {
  const action = p["action"];
  if (!isTwinDeliveryAction(action)) return { error: 'Rejected: `action` must be one of "react", "reply", "react_and_reply", "ignore". Call twin_deliver again.' };
  // `ignore` = a confident decision to post nothing. No emoji/message/destination.
  if (action === "ignore") return { delivery: { action: "ignore" } };
  const parts = twinDeliveryParts(action);
  const emoji = trimmed(p["emoji"]);
  const message = trimmed(p["message"]);
  if (parts.emoji && !emoji) return { error: "Rejected: `emoji` is required for this action — provide a single emoji." };
  if (parts.message && !message) return { error: "Rejected: `message` is required for this action — write the reply in the user's own voice." };

  const delivery: TwinDelivery = { action };
  if (parts.emoji) delivery.emoji = emoji.slice(0, MAX_EMOJI);
  if (parts.message) {
    delivery.message = message.slice(0, MAX_MESSAGE);
    const dest = parseDestination(p);
    if ("error" in dest) {
      if (!lenient) return { error: `Rejected: ${dest.error}.` };
    } else if (dest.kind !== "origin_thread") {
      delivery.destination = dest;
      const reason = trimmed(p["destination_reason"]);
      if (reason) delivery.destinationReason = reason.slice(0, MAX_REASON);
    }
  }
  // Private cited rationale for the "Why?" panel — applies to any posted
  // action (react / reply / react_and_reply); `ignore` returned earlier.
  const reasoning = trimmed(p["reasoning"]);
  if (reasoning) delivery.reasoning = reasoning.slice(0, MAX_REASONING);
  return { delivery };
}

export function buildTwinDeliverTool(
  agentSlug: string,
  ref: TwinDeliverRef,
): ToolDefinition {
  return {
    name: TWIN_DELIVER_TOOL_NAME,
    label: "Deliver Response",
    description: [
      "Deliver your response AS the user. This is the ONLY way your reply reaches",
      "anyone — any plain text you write is discarded and NEVER shown. Call this",
      "exactly ONCE, at the very end, after you've gathered the context you need.",
      "ONE call total: once you've called it, you are DONE — do NOT call it a second",
      "time (a repeat call is ignored and the first one stands).",
      "",
      "Pick an action:",
      "- react — react to the message with a single emoji; post no text.",
      "- reply — post a written reply in the user's own first-person voice; no emoji.",
      "- react_and_reply — do both.",
      "- ignore — you're confident no response is warranted: post NOTHING (no reply, no emoji, no DM). The turn ends silently. Prefer this over a low-value reply.",
      "",
      "A reply defaults to the thread you were mentioned in (`origin_thread`).",
      "Reply elsewhere ONLY when it's clearly the right place: set `destination`,",
      "fill the matching id field, and give a one-line `destination_reason`:",
      DEST_DESCRIBE,
      "",
      "Also pass `reasoning`: a short PRIVATE note (shown only to the user in a 'Why?'",
      "panel, NEVER posted) on why you're responding — and back each factual claim with",
      "the exact [clf-…#n] citation token copied verbatim from the tool result it came from.",
      "Those [clf-…] tokens go in `reasoning` ONLY — keep them out of `message`.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: [...TWIN_DELIVERY_ACTIONS],
          description: "What to do: react (emoji only), reply (text only), react_and_reply (both), or ignore (post nothing — stay silent).",
        },
        emoji: {
          type: "string",
          description: "A single emoji, e.g. 👍 ✅ 🎉 🙏. Required for action=react or react_and_reply.",
        },
        message: {
          type: "string",
          description: "The reply, written in the user's own first-person voice ('I', 'we') — NO meta-commentary, NO mention of tools/memory/steps, and NO [clf-…] citation tokens (citations go in `reasoning` ONLY, never in the posted reply). Required for action=reply or react_and_reply.",
        },
        destination: {
          type: "string",
          enum: [...DEST_KINDS],
          description:
            "Where to post the reply. OMIT (or `origin_thread`) to reply in the thread you were mentioned in — the default, right almost every time. " +
            "`origin_channel` = a NEW top-level message in that same channel. `dm_sender` = DM whoever mentioned you. `dm` = DM a specific person (also set `dm_user_id`). `channel` = a different channel (also set `destination_channel_id`). `thread` = a different existing thread (also set `destination_channel_id` AND `destination_conversation_id`). Look ids up with your Spaces tools. Ignored when action=react.",
        },
        destination_reason: {
          type: "string",
          description: "One short sentence on why you chose a non-default destination (e.g. 'the team tracks this in #ask-ai-v2'). Required whenever destination is not origin_thread.",
        },
        dm_user_id: {
          type: "string",
          description: "The Spaces user id of the person to DM. Use ONLY with destination='dm'. Find it with your Spaces tools. (For the person who mentioned you, use destination='dm_sender' — no id needed.)",
        },
        destination_channel_id: {
          type: "string",
          description: "The Spaces channel id to post in. Required for destination='channel' and destination='thread'. Look it up with your Spaces tools — never guess.",
        },
        destination_conversation_id: {
          type: "string",
          description: "The Spaces conversation/thread id to reply in. Required for destination='thread'. Look it up with your Spaces tools.",
        },
        reasoning: {
          type: "string",
          description:
            "PRIVATE rationale shown only to the user in a 'Why?' panel — NEVER posted, so this is where you SHOULD ground your claims (your `message` must NOT). 2-4 lines on why you're responding this way. After every concrete fact you rely on (a status, decision, ticket, date, owner), paste the exact [clf-<id>#n] citation token copied VERBATIM from the tool result that told you. Never invent a token. Recommended for reply / react_and_reply.",
        },
      },
      required: ["action"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const reject = (text: string) => {
        ref.rejections = (ref.rejections ?? 0) + 1;
        return toolResult(text, { error: true });
      };
      // Hard gate: only the Twin delivers this way.
      if (!isDigitalTwinAgent(agentSlug)) {
        return reject("twin_deliver is only available to the Digital Twin agent.");
      }
      // Idempotency: the Twin delivers EXACTLY ONCE per run. glm-via-LiteLLM loves
      // to re-emit the same tool call several times in a turn; without this guard
      // each repeat overwrote ref.value and returned "Delivered", so the model kept
      // going. The FIRST accepted delivery stands — repeat calls are a no-op that
      // firmly tells the model to stop. (Only successful deliveries set ref.value,
      // so a prior *rejection* does not trip this — the model can still retry.)
      if (ref.value !== undefined) {
        ref.duplicates = (ref.duplicates ?? 0) + 1;
        log.info(`[twin-deliver] duplicate call #${ref.duplicates} ignored — first delivery (action=${ref.value.action}) stands`);
        return toolResult(
          "You have ALREADY delivered your response with twin_deliver — that first call is final and is queued for the user's approval. Do NOT call twin_deliver again. Stop here and produce no further output.",
          { duplicate: true, action: ref.value.action },
          true,
        );
      }
      const r = parseDelivery((params as Record<string, unknown> | undefined) ?? {});
      if ("error" in r) return reject(r.error);
      const { delivery } = r;
      ref.value = delivery;
      if (delivery.action === "ignore") {
        log.info("[twin-deliver] accepted action=ignore — staying silent, nothing will be posted");
        return toolResult("Noted — you'll stay silent and post nothing. The task is complete; do not produce further output.", { action: "ignore" }, true);
      }
      log.info(
        `[twin-deliver] accepted action=${delivery.action} emoji=${delivery.emoji !== undefined ? "y" : "n"} reply=${delivery.message !== undefined ? "y" : "n"} dest=${delivery.destination?.kind ?? "origin_thread"}`,
      );
      return toolResult(
        "Delivered — queued for the user's approval. The task is complete; do not produce further output.",
        { action: delivery.action, destination: delivery.destination?.kind ?? "origin_thread" },
        true,
      );
    },
  };
}

/**
 * Recover a twin_deliver call the model LEAKED as text instead of emitting a
 * proper tool_call. glm-via-LiteLLM intermittently does this (same class as the
 * respond-gate / curator leaks) — the assistant content carries the call as GLM
 * `<arg_key>…</arg_key><arg_value>…</arg_value>` markup, a JSON arg blob, or
 * `twin_deliver(action="reply", message="…")` call syntax. Parse whichever shape
 * is present into a VALIDATED TwinDelivery so a leaked call still delivers
 * instead of fail-closing to silence. Returns null if nothing usable is found.
 * Exported for unit tests.
 */
export function recoverTwinDeliveryFromText(
  text: string,
): TwinDelivery | null {
  if (typeof text !== "string" || !text.includes("twin_deliver")) return null;
  const seg = text.slice(text.indexOf("twin_deliver"));

  // 1) GLM native <arg_key>/<arg_value> markup (the common leak).
  const args: Record<string, string> = parseArgMarkup(text);
  // 2) JSON arg blob after the tool name.
  if (!args["action"]) {
    const o = parseJsonObject(seg.match(/\{[\s\S]*\}/)?.[0] ?? "");
    try { if (o) for (const [k, v] of Object.entries(o)) args[k] = String(v); } catch { /* a value String() can't convert — keep what was copied */ }
  }
  // 3) Function-call syntax: twin_deliver(action="reply", message="...").
  if (!args["action"]) {
    const c = seg.match(/twin_deliver\s*\(([\s\S]*?)\)/);
    if (c?.[1]) {
      const argRe = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
      let a: RegExpExecArray | null;
      while ((a = argRe.exec(c[1])) !== null) args[a[1]!] = a[2]!.replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
  }

  const r = parseDelivery(args, true);
  return "error" in r ? null : r.delivery;
}

interface StoppableAgent {
  createLoopConfig?: (opts?: unknown) => {
    shouldStopAfterTurn?: (ctx: unknown) => boolean | Promise<boolean>;
  };
}

/**
 * End the pi loop at the first turn boundary after a delivery is accepted.
 *
 * `terminate: true` on the tool result only stops when EVERY result in the
 * batch terminates, and pi still drains queued steering after it. The
 * shouldStopAfterTurn hook runs before either, so it is the reliable stop.
 * It CHAINS the previous hook (mid-turn compaction installs one) — install it
 * after installMidTurnCompaction. Returns false when pi's shape has drifted.
 */
export function installStopAfterDelivery(agent: object, delivered: () => boolean): boolean {
  const a = agent as StoppableAgent;
  if (typeof a.createLoopConfig !== "function") {
    log.warn("[twin-deliver] pi createLoopConfig missing — stop-after-delivery relies on terminate only");
    return false;
  }
  const orig = a.createLoopConfig.bind(agent);
  a.createLoopConfig = (opts?: unknown) => {
    const cfg = orig(opts);
    const prev = cfg.shouldStopAfterTurn;
    cfg.shouldStopAfterTurn = async (ctx: unknown): Promise<boolean> => {
      if (delivered()) {
        log.info("[twin-deliver] delivery accepted — ending the run at this turn boundary");
        return true;
      }
      return prev ? Boolean(await prev(ctx)) : false;
    };
    return cfg;
  };
  return true;
}
