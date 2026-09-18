/** Tunables for the messaging-channel core. */

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

export const REDIS_PREFIX = "claw:channel";
export const CONTROL_CHANNEL = `${REDIS_PREFIX}:control`;

/** `/slug task` or `@slug task` at the start of a message picks an agent. */
export const AGENT_ROUTE_RE = /^[@/]([a-z0-9][a-z0-9_-]*)(?:\s+|$)/i;
export const AGENTS_COMMAND_RE = /^[@/]agents\s*$/i;

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
/** Reaction dropped on the triggering message so the sender can see the run
 *  started before any text comes back. */
export const DEFAULT_ACK_REACTION = "\u{1F440}";
/** How often a business number repeats "add your number in Claw" to one sender. */
export const UNLINKED_NOTICE_TTL_S = 60 * 60;

/** Unaddressed group messages carried forward as context on the next reply.
 *  Matches OpenClaw's default group context window. */
export const GROUP_HISTORY_LIMIT = 50;
/** Chatter is only useful while it is recent; it is never durable state. */
export const GROUP_CONTEXT_TTL_S = 12 * 60 * 60;

export const FAILURE_TEXT = "The agent couldn't complete this request. Please try again.";
export const NOT_LINKED_TEXT =
  "Your number isn't linked to a Xyne Claw user yet. Sign in to Xyne Claw and add this number, and I'll know who you are next time.";

