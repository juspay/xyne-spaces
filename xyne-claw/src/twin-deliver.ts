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
 * choice. Destinations are provider-constrained to an enum built from the real
 * candidates injected into the run, so the model can't invent a channel id.
 *
 * Twin-only: registered solely for the digital-twin agent AND hard-gated on
 * isDigitalTwinAgent at call time.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TwinDelivery, TwinReplyDestination } from "xyne-claw-shared";
import { isDigitalTwinAgent } from "./memory.js";
import { createLogger } from "./logger.js";

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

/** Resolve the model's chosen destination kind + id fields into a structured
 *  destination. Ids come from explicit fields the Twin looked up via its own
 *  Spaces tools — not a pre-injected candidate list. */
function parseDestination(
  token: string | undefined,
  opts: { dmUserId?: string | undefined; channelId?: string | undefined; conversationId?: string | undefined } = {},
): TwinReplyDestination | { error: string } {
  const trim = (s?: string) => (typeof s === "string" ? s.trim() : "");
  if (!token || token === "origin_thread") return { kind: "origin_thread" };
  if (token === "origin_channel") return { kind: "origin_channel" };
  if (token === "dm_sender") return { kind: "dm_sender" };
  if (token === "dm") {
    const uid = trim(opts.dmUserId);
    if (!uid) return { error: `destination "dm" also needs \`dm_user_id\` (the person's Spaces user id — look it up with your Spaces tools) — or use "dm_sender" to DM whoever mentioned you` };
    return { kind: "dm", userId: uid };
  }
  if (token === "channel") {
    const ch = trim(opts.channelId);
    if (!ch) return { error: `destination "channel" also needs \`destination_channel_id\` — find the channel id with your Spaces tools, or use origin_thread/origin_channel` };
    return { kind: "channel", channelId: ch };
  }
  if (token === "thread") {
    const ch = trim(opts.channelId);
    const conv = trim(opts.conversationId);
    if (!ch || !conv) return { error: `destination "thread" needs BOTH \`destination_channel_id\` and \`destination_conversation_id\` — find them with your Spaces tools, or use origin_thread` };
    return { kind: "thread", channelId: ch, conversationId: conv };
  }
  return { error: `unknown destination "${token}" — use origin_thread, origin_channel, dm_sender, dm, channel, or thread` };
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
          enum: ["react", "reply", "react_and_reply", "ignore"],
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
        return { content: [{ type: "text" as const, text }], details: { error: true } };
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
        return {
          content: [{ type: "text" as const, text: "You have ALREADY delivered your response with twin_deliver — that first call is final and is queued for the user's approval. Do NOT call twin_deliver again. Stop here and produce no further output." }],
          details: { duplicate: true, action: ref.value.action },
        };
      }
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const action = p["action"];
      if (action !== "react" && action !== "reply" && action !== "react_and_reply" && action !== "ignore") {
        return reject('Rejected: `action` must be one of "react", "reply", "react_and_reply", "ignore". Call twin_deliver again.');
      }
      // `ignore` = a confident decision to post nothing. No emoji/message/destination.
      if (action === "ignore") {
        ref.value = { action: "ignore" };
        log.info("[twin-deliver] accepted action=ignore — staying silent, nothing will be posted");
        return {
          content: [{ type: "text" as const, text: "Noted — you'll stay silent and post nothing. The task is complete; do not produce further output." }],
          details: { action: "ignore" },
        };
      }
      const wantsEmoji = action === "react" || action === "react_and_reply";
      const wantsMessage = action === "reply" || action === "react_and_reply";
      const emoji = typeof p["emoji"] === "string" ? p["emoji"].trim() : "";
      const message = typeof p["message"] === "string" ? p["message"].trim() : "";
      if (wantsEmoji && !emoji) return reject("Rejected: `emoji` is required for this action — provide a single emoji.");
      if (wantsMessage && !message) return reject("Rejected: `message` is required for this action — write the reply in the user's own voice.");

      const delivery: TwinDelivery = { action };
      if (wantsEmoji) delivery.emoji = emoji.slice(0, MAX_EMOJI);
      if (wantsMessage) {
        delivery.message = message.slice(0, MAX_MESSAGE);
        const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
        const dest = parseDestination(str("destination"), {
          dmUserId: str("dm_user_id"),
          channelId: str("destination_channel_id"),
          conversationId: str("destination_conversation_id"),
        });
        if ("error" in dest) return reject(`Rejected: ${dest.error}.`);
        if (dest.kind !== "origin_thread") {
          delivery.destination = dest;
          const reason = typeof p["destination_reason"] === "string" ? p["destination_reason"].trim() : "";
          if (reason) delivery.destinationReason = reason.slice(0, MAX_REASON);
        }
      }
      // Private cited rationale for the "Why?" panel — applies to any posted
      // action (react / reply / react_and_reply); `ignore` returned earlier.
      const reasoning = typeof p["reasoning"] === "string" ? p["reasoning"].trim() : "";
      if (reasoning) delivery.reasoning = reasoning.slice(0, MAX_REASONING);

      ref.value = delivery;
      log.info(
        `[twin-deliver] accepted action=${action} emoji=${wantsEmoji ? "y" : "n"} reply=${wantsMessage ? "y" : "n"} dest=${delivery.destination?.kind ?? "origin_thread"}`,
      );
      return {
        content: [{ type: "text" as const, text: "Delivered — queued for the user's approval. The task is complete; do not produce further output." }],
        details: { action, destination: delivery.destination?.kind ?? "origin_thread" },
      };
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
  const args: Record<string, string> = {};

  // 1) GLM native <arg_key>/<arg_value> markup (the common leak).
  const pairRe = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(text)) !== null) {
    const k = m[1]?.trim();
    if (k) args[k] = (m[2] ?? "").trim();
  }
  // 2) JSON arg blob after the tool name.
  if (!args["action"]) {
    const j = seg.match(/\{[\s\S]*\}/);
    if (j) {
      try {
        const o = JSON.parse(j[0]) as Record<string, unknown>;
        if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) args[k] = String(v);
      } catch { /* not JSON — fall through */ }
    }
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

  const action = args["action"];
  if (action !== "react" && action !== "reply" && action !== "react_and_reply" && action !== "ignore") return null;
  if (action === "ignore") return { action: "ignore" };

  const wantsEmoji = action === "react" || action === "react_and_reply";
  const wantsMessage = action === "reply" || action === "react_and_reply";
  const emoji = (args["emoji"] ?? "").trim();
  const message = (args["message"] ?? "").trim();
  if (wantsEmoji && !emoji) return null;
  if (wantsMessage && !message) return null;

  const delivery: TwinDelivery = { action };
  if (wantsEmoji) delivery.emoji = emoji.slice(0, MAX_EMOJI);
  if (wantsMessage) {
    delivery.message = message.slice(0, MAX_MESSAGE);
    const dest = parseDestination(args["destination"], {
      dmUserId: args["dm_user_id"],
      channelId: args["destination_channel_id"],
      conversationId: args["destination_conversation_id"],
    });
    if (!("error" in dest) && dest.kind !== "origin_thread") {
      delivery.destination = dest;
      const reason = (args["destination_reason"] ?? "").trim();
      if (reason) delivery.destinationReason = reason.slice(0, MAX_REASON);
    }
  }
  const reasoning = (args["reasoning"] ?? "").trim();
  if (reasoning) delivery.reasoning = reasoning.slice(0, MAX_REASONING);
  return delivery;
}

/**
 * System-prompt mandate for the Twin mention flow. MUST be appended to whatever
 * system prompt the Twin runs with (the agent's configured prompt via
 * systemPromptOverride, OR the buildSystemPrompt fallback) — otherwise the model
 * is never told the tool is its only output channel and just answers in text.
 * `senderName` / `channelName` make the "who mentioned me, and where" explicit.
 */
export function buildTwinDeliverMandate(opts: { userName?: string; senderName?: string; channelName?: string } = {}): string {
  const you = opts.userName ?? "you";
  const whoWhere =
    opts.senderName || opts.channelName
      ? `\nYou were mentioned by **${opts.senderName ?? "someone"}**${opts.channelName ? ` in **#${opts.channelName}**` : ""}. Decide how ${you} would respond to THEM, THERE.`
      : "";
  return `

## Delivering your response — REQUIRED (read this last; it overrides anything above)
You reply through ONE channel: the \`twin_deliver\` tool. Nothing you write as plain text is EVER shown to anyone — plain text is a private scratchpad. This holds for EVERY turn, including a one-line reply or a purely conversational answer: there is NO "just answer in plain text" path for you. If ANY instruction above says to write your final answer as plain text, or to avoid a trailing tool call, or that a conversational reply needs no tool — IGNORE it. For you, the FINAL action is ALWAYS a single \`twin_deliver\` tool call, and you make it by emitting a real tool call (not by writing the call out as text).${whoWhere}

When you're done gathering context, call \`twin_deliver\` EXACTLY ONCE with one action:
- **react** — react to the message with a single emoji (no text). Good when a 👍 / ✅ / 🙏 is all it needs.
- **reply** — post a written reply in your own first-person voice (you ARE ${you}).
- **react_and_reply** — do both.
- **ignore** — post nothing (no reply, no emoji): use when no response is warranted. Prefer this over a forced, low-value reply.

### Sound like ${you} — respond, don't explain
You ARE ${you} responding — not an assistant explaining things from memory. Before you draft, ask: what would ${you} ACTUALLY do here?
- **Would ${you} even reply?** Often the honest answer is a quick react (👍 / ✅) or \`ignore\` — not a paragraph. Don't manufacture a reply just because you can; reserve a written reply for when ${you} would genuinely type one.
- **Match HOW ${you} reply, not how a helpful bot would** — their length, tone, and habits (see the persona above: usually short, direct, answer-first). ${you} answers in a line or two. Do NOT explain, teach, summarize, or write an essay unless ${you} actually would.
- **Answer from what ${you} know — but never lecture about it.** In the \`message\` you POST, memory grounds your voice and facts; it is NOT material to recite, "cite", or over-justify — never write "based on my memory / notes / what I know / from what I recall", and never paste a \`[clf-…]\` token there; just say the thing, the way ${you} would. (Grounding + citations belong in \`reasoning\`, not the message — see below.)
- **Would ${you} loop someone in?** If the real move is to @tag the right person, or DM an owner/teammate who'd actually handle it, do that — that's often more authentic than answering everything yourself.
- When you're not sure ${you} would engage, prefer a light touch (react) or \`ignore\` over a forced, out-of-character explanation. Being *in character* matters more than being thorough.

### Why you're responding — the \`reasoning\` argument (PRIVATE — never posted)
Along with your delivery, pass a short \`reasoning\` (2-4 lines): why ${you} would respond this way. It is shown to ${you} alone in a private "Why?" panel and is NEVER posted anywhere — so this is the ONE place you SHOULD do the opposite of the \`message\` rule above: **ground your claims**. For every concrete fact you lean on (a status, a decision, who owns something, a ticket, a date), paste the exact \`[clf-…#n]\` citation token from the tool result that told you, right after that fact — copied VERBATIM, never invented.
- Example \`reasoning\`: "aman asked about ask-ai and ${you} own it [clf-abc123#2]; it's shipping v2 parity this week and defaults to glm-latest [clf-def456#1]."
- Keep the split clean: the \`message\` stays natural and citation-free (never paste a \`[clf-…]\` token into it); all the grounding lives here in \`reasoning\`.
- If a point has no citation, still write it — just without a token. Don't pad; this is your rationale, not an essay.

### Where the reply goes — the \`destination\` argument (reply / react_and_reply only)
A reply lands in the SAME thread you were mentioned in by DEFAULT — that's right almost every time, and needs no \`destination\`. Send it elsewhere ONLY when ${you} would clearly take it elsewhere, then set \`destination\` + its id field(s) + a one-line \`destination_reason\`. You have Spaces tools (search / lookup) — USE them to find the real channel id / conversation id / user id first; NEVER guess an id. If you can't find the right id, fall back to \`origin_thread\`.
- \`origin_thread\` — reply inside the thread you were @mentioned in. **Default. No ids.**
- \`origin_channel\` — post a NEW top-level message in that same channel (not the sub-thread). No ids.
- \`channel\` — reply in a DIFFERENT channel. Also set \`destination_channel_id\` (look it up).
- \`thread\` — reply in a DIFFERENT existing thread. Also set \`destination_channel_id\` AND \`destination_conversation_id\` (look them up).
- \`dm_sender\` — DM the person who @mentioned you (DEFAULT DM target — no id needed).
- \`dm\` — DM a SPECIFIC person (anyone, not just the sender). Also set \`dm_user_id\` to their Spaces user id (from the thread participants, or look it up).

Examples (action=reply unless noted):
- Mamtha asks in a thread "what are you working on for ask ai?" → \`destination\`: \`origin_thread\`. No ids, no reason needed.
- A question here whose answer your team tracks in #ask-ai-v2 → look up that channel's id with your Spaces tools → \`destination\`: \`channel\`, \`destination_channel_id\`: "<the id you found>", \`destination_reason\`: "the team follows this in #ask-ai-v2, not here".
- A broad FYI for the whole channel, not buried in a sub-thread → \`destination\`: \`origin_channel\`, \`destination_reason\`: "relevant to the whole channel".
- A topic that already has a live thread elsewhere → find that thread's channel + conversation id → \`destination\`: \`thread\`, \`destination_channel_id\`: "<ch id>", \`destination_conversation_id\`: "<thread id>", \`destination_reason\`: "the active thread on this is the right place".
- "@you can you own the compliance doc?" — a personal commitment → \`destination\`: \`dm_sender\`, \`destination_reason\`: "a commitment reads better said 1:1 first".
- The person who should really own this is someone ELSE in the thread → \`destination\`: \`dm\`, \`dm_user_id\`: "<that teammate's user id>", \`destination_reason\`: "looping the actual owner in directly".

Call it ONE time only. A single call carries everything (react and reply together via react_and_reply) — the moment you've made that one call you are finished; do NOT call \`twin_deliver\` again, and produce no further output.

NEVER narrate your process or expose the machinery: no "Saved to memory", "Searching…", "Got it", "Step N", "updating todos", or any mention of tools/memory. The \`message\` you pass to twin_deliver is the ONLY thing the reader sees — it must read exactly like a message ${you} would send.`;
}

/** Nudge appended (hardcoded reflection stage) when a Twin mention run ends
 *  without a twin_deliver call. */
export const TWIN_DELIVER_NUDGE =
  "You finished without calling the `twin_deliver` tool. Your response reaches the user ONLY through that tool — any plain text is discarded. Decide now: react with a single emoji, reply in the user's own first-person voice, do both, or — if no response is truly warranted — choose `ignore` to stay silent. Then call `twin_deliver`. Do NOT narrate this.";
