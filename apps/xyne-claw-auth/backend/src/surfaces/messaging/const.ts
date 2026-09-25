/** Tunables for the messaging-channel core. */

/** A webhook provider's endpoint-verification challenge is a short opaque
 *  token it generated. Echoing anything else would let a crafted link turn the
 *  verification endpoint into a reflector for the caller's own content. */
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** ConnectedSurface.surfaceTenantId prefix that marks a channel account row
 *  (vs Slack's "" org-level / team-id rows). Mirrored by the partial unique
 *  index in the messaging_channels migration. */
export const ACCOUNT_KEY_PREFIX = "acct_";

/** Per-account pod lease: renewed every LEASE_RENEW_MS, expires after
 *  LEASE_TTL_MS without renewal — the takeover latency after a hard pod kill. */
export const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_MS = 10_000;
/** How often every pod looks for unowned runnable accounts. */
export const SWEEP_MS = 15_000;

/** Redis TTL of the login artifact (QR string / device code). WhatsApp
 *  rotates QRs every ~20s; 60s keeps the latest one readable by any pod. */
export const LOGIN_ARTIFACT_TTL_S = 60;
/** Inbound message-id dedup window. */
export const DEDUP_TTL_S = 600;
/** Outbox items survive this long waiting for a pod to own the account. */
export const OUTBOX_TTL_S = 6 * 60 * 60;
/** Blocking pop timeout of the outbox drain loop (seconds). */
export const OUTBOX_POP_TIMEOUT_S = 5;

/** Typing keeps refreshing until the reply is delivered. This is only the
 *  backstop for a run that never reports back at all — without it a lost
 *  result would leave a number typing into someone's chat indefinitely.
 *  Matches ACTIVE_RUN_TTL_S so typing never stops while a run can still be live. */
export const TYPING_MAX_MS = 30 * 60 * 1_000;

/** How long we remember which run is working in a chat, for /stop and
 *  /status. Longer than any run should take, short enough that a lost result
 *  does not leave a stale answer forever. */
export const ACTIVE_RUN_TTL_S = 30 * 60;

/** How long a chat's typing count survives without a result. Generous, but
 *  bounded: a run whose result never arrives must not leave a number typing. */
export const TYPING_COUNT_TTL_S = 20 * 60;

/** Largest inbound file any channel will pull through the run pipeline.
 *  Core, not per-plugin: what a number will accept should not depend on which
 *  transport happens to be carrying it. Above this the message still reaches
 *  the agent with its caption and a note, which is more useful than silence
 *  and cheaper than dragging a phone video through a run. */
export const MAX_INBOUND_BYTES = 12 * 1024 * 1024;

export const REDIS_PREFIX = "claw:channel";
export const CONTROL_CHANNEL = `${REDIS_PREFIX}:control`;

/** `/slug task` or `@slug task` at the start of a message picks an agent. */
export const AGENT_ROUTE_RE = /^[@/]([a-z0-9][a-z0-9_-]*)(?:\s+|$)/i;
export const AGENTS_COMMAND_RE = /^[@/]agents\s*$/i;

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
/** Reaction dropped on the triggering message so the sender can see the run
 *  started before any text comes back. */
/** Replaces the ack once the run ends. WhatsApp allows one reaction per
 *  message, so this is a replacement, not a second emoji — which makes the
 *  reaction a progress signal rather than a receipt. */
export const DONE_REACTION = "\u2705";
export const ERROR_REACTION = "\u26A0\uFE0F";

export const DEFAULT_ACK_REACTION = "\u{1F440}";
/** How often a business number repeats "add your number in Claw" to one sender. */
export const UNLINKED_NOTICE_TTL_S = 60 * 60;

/** Unaddressed group messages carried forward as context on the next reply.
 *  Matches OpenClaw's default group context window. */
export const GROUP_HISTORY_LIMIT = 50;
/** Chatter is only useful while it is recent; it is never durable state. */
export const GROUP_CONTEXT_TTL_S = 12 * 60 * 60;

export const FAILURE_TEXT = "The agent couldn't complete this request. Please try again.";
/** A run that succeeded and said nothing. Rare, and almost always the model
 *  reasoning its way to an answer and then ending its turn without writing
 *  it — so the person is told what to do next rather than what happened. */
export const EMPTY_RESULT_TEXT =
  "I worked through that but didn't come back with anything. Ask again, or send /new to start fresh.";
/** Tell a flooding sender they were throttled at most once per window, so the
 *  notice cannot itself become the flood. */
export const RATE_LIMIT_NOTICE_TTL_S = 60;
export const RATE_LIMITED_TEXT =
  "That's a lot at once — I've paused on the last few. Give me a minute and send it again.";

export const NOT_LINKED_TEXT =
  "Your number isn't linked to a Xyne Claw user yet. Sign in to Xyne Claw and add this number, and I'll know who you are next time.";

