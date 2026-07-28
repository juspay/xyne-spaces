/**
 * The Slack wire contract: every inbound shape this surface accepts, in one
 * reviewable place. Schemas live here rather than next to any one consumer —
 * the adapter parses events, the routes parse slash commands and OAuth
 * callbacks, and none of them should reach into another's internals.
 *
 * All of this is untrusted network input, so callers use `safeParse` and treat
 * a failure as "ignore quietly", never as an exception.
 */
import { z } from "zod";

/** Slack sends "" for absent fields often enough that presence isn't enough. */
const nonEmptyString = z.string().min(1);

/**
 * Fields every inbound event we act on must carry.
 *
 * `subtype` and `bot_id` are pinned to `undefined` — that is the whole
 * ignore-policy expressed as a type: bot echoes (bot_id) would loop the agent
 * against itself, and any subtype means this is an edit/join/file_share rather
 * than a person talking to us. Slack's own GenericMessageEvent declares
 * `subtype: undefined` for exactly this discrimination.
 *
 * `text` allows "" (a mention with no words is still a real mention);
 * `thread_ts` stays a loose string so a malformed value degrades to
 * "no thread" instead of dropping the whole message.
 */
const inboundEventBase = {
  subtype: z.undefined(),
  bot_id: z.undefined(),
  user: nonEmptyString,
  channel: nonEmptyString,
  text: z.string(),
  thread_ts: z.string().optional(),
};

export const inboundEventSchema = z.discriminatedUnion("type", [
  z.object({ ...inboundEventBase, type: z.literal("app_mention") }),
  // Only IM messages qualify: a non-mention message in a channel is not for us.
  z.object({ ...inboundEventBase, type: z.literal("message"), channel_type: z.literal("im") }),
]);

/**
 * Slack's outer Events API envelope. @slack/types models the inner events but
 * not this wrapper, so it is declared here.
 *
 * `url_verification` is deliberately absent: the route answers that challenge
 * before parsing, so this schema only describes events we act on.
 */
export const eventEnvelopeSchema = z.object({
  type: z.literal("event_callback"),
  team_id: nonEmptyString,
  event_id: nonEmptyString,
  event: inboundEventSchema,
});

export type SlackEventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/**
 * The slice of `ConnectedSurface.config` this surface owns.
 *
 * Every field is `.catch(undefined)` so one corrupt value degrades that field
 * alone instead of blanking the whole config — this is a hand-editable Json
 * column, not a controlled payload.
 *
 * READ-ONLY VIEW. The column also carries keys this schema does not model
 * (`signingSecret`, per-team installs); writers must spread the RAW object,
 * never this parsed result, or those keys are silently destroyed.
 */
export const slackConnectionConfigSchema = z.object({
  configAccessToken: z.string().min(1).optional().catch(undefined),
  configRefreshToken: z.string().min(1).optional().catch(undefined),
  configTokenStatus: z.string().optional().catch(undefined),
  configTokenRotatedAt: z.string().optional().catch(undefined),
  appId: z.string().min(1).optional().catch(undefined),
});

export type SlackConnectionConfig = z.infer<typeof slackConnectionConfigSchema>;

/** Typed read of a connection's config. Never throws: an unreadable column
 *  reads as "nothing configured", which every caller already handles. */
export function readSlackConnectionConfig(config: unknown): SlackConnectionConfig {
  const parsed = slackConnectionConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : {};
}
