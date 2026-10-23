import { z } from 'zod';

export const SlackCredentialsSchema = z.object({
  botToken: z.string().trim().startsWith('xoxb-', 'Must be a Slack bot token (xoxb-…)'),
  signingSecret: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
});
export type SlackCredentials = z.infer<typeof SlackCredentialsSchema>;

export const SlackFileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mimetype: z.string().optional(),
  size: z.number().optional(),
  url_private: z.string().optional(),
});

// Only the fields the gateway reads; zod drops the rest.
const slackMessageFields = {
  ts: z.string(),
  thread_ts: z.string().optional(),
  subtype: z.string().optional(),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  app_id: z.string().optional(),
  username: z.string().optional(),
  bot_profile: z.object({ name: z.string().optional() }).optional(),
  text: z.string().optional(),
  attachments: z.array(z.unknown()).optional(),
  blocks: z.array(z.unknown()).optional(),
  files: z.array(SlackFileSchema).optional(),
};

export const SlackMessageSchema = z.object(slackMessageFields);
export type SlackMessage = z.infer<typeof SlackMessageSchema>;

export const SlackMessageEventSchema = z.object({
  type: z.literal('message'),
  channel: z.string(),
  ...slackMessageFields,
  message: SlackMessageSchema.optional(),
  previous_message: SlackMessageSchema.optional(),
  deleted_ts: z.string().optional(),
});

export const SlackMemberEventSchema = z.object({
  type: z.enum(['member_joined_channel', 'member_left_channel']),
  channel: z.string(),
  user: z.string(),
});

export const SlackEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url_verification'), challenge: z.string().max(200) }),
  z.object({ type: z.literal('event_callback'), team_id: z.string(), event: z.unknown() }),
]);
