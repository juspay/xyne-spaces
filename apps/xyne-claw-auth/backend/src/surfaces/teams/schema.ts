/**
 * Microsoft Teams: config residue, the secrets an admin supplies at connect
 * time, the Bot Framework constants, and the feature flag.
 *
 * The account is an Azure Bot registration: its Microsoft App ID and a client
 * secret. Teams POSTs every activity to the bot's messaging endpoint, which is
 * this account's webhook URL, so there is nothing to keep connected.
 */
import { z } from "zod";
import { agentActionsSchema } from "../messaging/schema.js";

export const SECRET_APP_ID = "app-id";
export const SECRET_APP_PASSWORD = "app-password";

/** Where the Bot Connector publishes the keys it signs inbound requests with.
 *  Public Azure cloud only; sovereign clouds publish their own. */
export const BOTFRAMEWORK_OPENID_METADATA_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
/** `iss` of every token the Bot Connector sends a bot. */
export const BOTFRAMEWORK_ISSUER = "https://api.botframework.com";
/** Scope of the token the bot presents when it calls the Bot Connector. */
export const BOTFRAMEWORK_SCOPE = "https://api.botframework.com/.default";
/** Token authority for a multi-tenant bot registration. A single-tenant one
 *  uses its own tenant id instead (`appTenantId`). */
export const MULTI_TENANT_AUTHORITY = "botframework.com";
export const LOGIN_ORIGIN = "https://login.microsoftonline.com";
/** Scope of the app-only token used to read a sender's directory entry. */
export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
export const GRAPH_ORIGIN = "https://graph.microsoft.com";

/** The only Bot Framework channel this plugin answers. Web Chat, the Emulator
 *  and every other channel an Azure Bot can be wired to are refused. */
export const TEAMS_CHANNEL_ID = "msteams";

/** A tenant id or object id: a GUID, compared lower-case everywhere. */
export const guidSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a GUID")
  .transform((value) => value.toLowerCase());

export const teamsConfigSchema = z
  .object({
    /** Teams bots cannot react to messages or list the teams they are in
     *  through the Bot Connector, so neither action is on by default. */
    agentActions: agentActionsSchema({ reactions: false, listGroups: false }),
    /**
     * The Entra tenant the App ID was registered in, for a SingleTenant bot.
     * Absent ⇒ a MultiTenant registration, whose outbound tokens come from the
     * shared botframework.com authority.
     */
    appTenantId: guidSchema.optional(),
    // Which tenants may talk to this account is not per-account config: a
    // tenant is bound to the org once, by an org admin (tenants.ts).
  })
  .strict();
export type TeamsConfig = z.infer<typeof teamsConfigSchema>;

/** Lenient read of stored residue: an unparseable blob means defaults, and a
 *  key this version no longer knows (the old `allowedTenantIds`) is ignored
 *  rather than costing the account its `appTenantId`. */
export function teamsConfigOf(raw: unknown): TeamsConfig {
  const parsed = teamsConfigSchema.strip().safeParse(raw ?? {});
  return parsed.success ? parsed.data : teamsConfigSchema.parse({});
}

/**
 * TEAMS_CHANNEL_ENABLED gates the whole channel: off ⇒ the plugin is never
 * registered, so its webhook answers 404, no account starts, and the admin API
 * does not know the channel exists. Off by default.
 */
export function teamsChannelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "on", "yes"].includes((env["TEAMS_CHANNEL_ENABLED"] ?? "").trim().toLowerCase());
}
