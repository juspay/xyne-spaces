/**
 * The channel-neutral account config stored in `ConnectedSurface.config`, and
 * the admin-API body shapes. Plugin residue lives under `config.channel` and is
 * validated by the plugin's own schema, never here.
 *
 * Stored config is read leniently (unknown keys kept, missing keys defaulted)
 * so a rolling deploy that adds a field never bricks an account; admin input
 * is parsed strictly.
 */
import { z } from "zod";
import { DEFAULT_ACK_REACTION, DEFAULT_RATE_LIMIT_PER_MINUTE, GROUP_HISTORY_LIMIT } from "./const.js";

/** What the AGENT may do on a channel beyond replying in the chat that
 *  triggered the run (OpenClaw's `actions` block). */
export interface AgentActionGates {
  /** Send to chats other than the one that triggered the run. */
  sendToOtherChats: boolean;
  reactions: boolean;
  listGroups: boolean;
}

/** One shape for every channel; a plugin embeds this in its residue schema and
 *  overrides only the defaults its transport can honour. */
export function agentActionsSchema(defaults: Partial<AgentActionGates> = {}) {
  const value: AgentActionGates = { sendToOtherChats: false, reactions: true, listGroups: true, ...defaults };
  return z
    .object({
      sendToOtherChats: z.boolean().default(value.sendToOtherChats),
      reactions: z.boolean().default(value.reactions),
      listGroups: z.boolean().default(value.listGroups),
    })
    .default(value);
}

export const DM_POLICIES = ["linked", "disabled"] as const;
/**
 * Three older names all collapse to "linked".
 *
 * "pairing" was this policy while unknown senders were handed a code to get
 * approved. "open" and "allowlist" admitted unlinked senders because there was
 * an account-wide fallback user for them to run AS. With no fallback, a run
 * belongs to its sender or to nobody, so admitting an unlinked sender only
 * ever produces the same "add your number" reply — the three settings had
 * become one. Accounts configured earlier still carry the old names on disk.
 */
const DM_POLICY_ALIASES: Record<string, string> = { pairing: "linked", open: "linked", allowlist: "linked" };
export const GROUP_POLICIES = ["allowlist", "open", "disabled"] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];
export type GroupPolicy = (typeof GROUP_POLICIES)[number];

const idList = z.array(z.string().trim().min(1)).max(500);

/** The knobs the policy engine reads. Pure data; see policy.ts. */
export const accountPolicySchema = z.object({
  dmPolicy: z.preprocess((value) => (typeof value === "string" ? (DM_POLICY_ALIASES[value] ?? value) : value), z.enum(DM_POLICIES).default("linked")),
  groupPolicy: z.enum(GROUP_POLICIES).default("allowlist"),
  /** Group/chat ids the account answers in under groupPolicy "allowlist". */
  groupAllowlist: idList.default([]),
  /** In groups, only answer when @mentioned or replied-to. */
  requireMention: z.boolean().default(true),
  /** How many unaddressed group messages to carry forward as context on the
   *  next reply. 0 disables it — the agent then only ever sees what was said
   *  directly to it. */
  groupHistoryLimit: z.number().int().min(0).max(200).default(GROUP_HISTORY_LIMIT),
  /** Emoji reaction sent on the triggering message when a run starts. Empty
   *  string turns it off; blank config gets the default. */
  ackReaction: z.string().trim().max(8).default(DEFAULT_ACK_REACTION),
  rateLimitPerMinute: z.number().int().min(1).max(600).default(DEFAULT_RATE_LIMIT_PER_MINUTE),
});
export type AccountPolicy = z.infer<typeof accountPolicySchema>;

export const CONN_STATES = ["pending_login", "connected", "disconnected", "logged_out"] as const;

export const accountConfigSchema = accountPolicySchema.extend({
  label: z.string().trim().min(1).max(120).default("Untitled account"),
  /** Admin intent. "running" = keep this account connected somewhere. */
  desiredState: z.enum(["running", "stopped"]).default("stopped"),
  /** Observed transport state, written by the owning pod. */
  connState: z.enum(CONN_STATES).default("disconnected"),
  selfId: z.string().optional(),
  /** The account's second address, when the transport has one (WhatsApp's
   *  LID). Durable: the socket can come back from a login without it, and the
   *  owner's own chat is unrecognisable without it. */
  selfAltId: z.string().optional(),
  displayId: z.string().optional(),
  lastConnectedAt: z.string().optional(),
  lastDisconnect: z.object({ code: z.number().optional(), reason: z.string().optional(), at: z.string() }).optional(),
  createdByUserId: z.string().optional(),
  /** Whose account this is on a user-scoped channel (see AccountScope). The
   *  creator to begin with, but kept separate from createdByUserId because
   *  access is gated on it — an admin creating an account for someone else
   *  must not silently own it. Absent on org-scoped channels. */
  ownerUserId: z.string().optional(),
  /** Plugin residue; opaque here. */
  channel: z.unknown().optional(),
});
export type AccountConfig = z.infer<typeof accountConfigSchema>;

/** Lenient read of a stored config blob: defaults fill gaps, unparseable
 *  fields fall back to defaults instead of failing the whole account. */
export function parseAccountConfig(raw: unknown): AccountConfig {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const strict = accountConfigSchema.safeParse(base);
  if (strict.success) return strict.data;
  // Field-wise salvage: keep every key that parses on its own.
  const salvaged: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(accountConfigSchema.shape)) {
    if (!(key in base)) continue;
    const one = (fieldSchema as z.ZodType).safeParse(base[key]);
    if (one.success) salvaged[key] = one.data;
  }
  return accountConfigSchema.parse(salvaged);
}

/** Only the policy slice of a config (what policy.ts needs). */
export function policyOf(config: AccountConfig): AccountPolicy {
  return accountPolicySchema.parse(config);
}

// ── admin API bodies (strict) ──

export const createAccountBodySchema = z.object({
  orgId: z.string().trim().min(1).optional(),
  /** Optional: a name to tell several accounts apart. Defaults to the agent's
   *  name, which is the only identity a personal number needs. */
  label: z.string().trim().min(1).max(120).optional(),
  /** Default agent for the account; must exist in the org. */
  agentSlug: z.string().trim().min(1),
  channel: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

export const updateAccountBodySchema = accountPolicySchema
  .partial()
  .extend({
    orgId: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    agentSlug: z.string().trim().min(1).optional(),
    channel: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

export const loginBodySchema = z.object({
  orgId: z.string().trim().min(1).optional(),
  /** For a single-secret token login (e.g. a Telegram bot token). */
  token: z.string().trim().min(1).optional(),
  /** For multi-field token logins: one entry per plugin loginField. */
  secrets: z.record(z.string(), z.string().trim().min(1)).optional(),
});

/** What someone types in Claw to link their own number. The phone is checked
 *  for shape here and turned into a channel sender id by the plugin. */
export const linkNumberBodySchema = z.object({
  phone: z.string().trim().min(6).max(24),
});

/** Conversation ids flow into filesystem paths in claw; keep them to the safe
 *  charset that /internal/run enforces. */
export function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
