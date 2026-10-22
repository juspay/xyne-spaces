import crypto from 'crypto';
import type {
  IncomingRequest,
  ProviderEvent,
  ProviderMessage,
  ProviderRequest,
} from '../../core/types';
import {
  SlackEnvelopeSchema,
  SlackMemberEventSchema,
  SlackMessageEventSchema,
  type SlackMessage,
} from './types';

const MAX_REQUEST_AGE_SECONDS = 5 * 60;

/** Subtypes that carry someone's message; joins, topics, pins and the rest are not synced. */
const SYNCED_SUBTYPES = new Set<string | undefined>([
  undefined,
  'thread_broadcast',
  'file_share',
  'bot_message',
  'me_message',
]);

function header(headers: IncomingRequest['headers'], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Slack's v0 request signature, rejecting requests older than 5 minutes (replays). */
export function verifySlackSignature(request: IncomingRequest, signingSecret: string): boolean {
  const signature = header(request.headers, 'x-slack-signature');
  const timestamp = header(request.headers, 'x-slack-request-timestamp');
  if (!signature || !timestamp) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_REQUEST_AGE_SECONDS) return false;

  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${request.rawBody}`)
    .digest('hex');
  const expected = Buffer.from(`v0=${hmac}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/** Slack's sign-in page for a person's own token; `chat:write` lets Mirror post, edit and delete as them. */
export function buildSlackUserAuthUrl(
  clientId: string,
  state: string,
  redirectUri: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: 'chat:write,files:write',
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export function parseSlackEvent(body: unknown): ProviderRequest {
  const envelope = SlackEnvelopeSchema.parse(body);
  if (envelope.type === 'url_verification') {
    return { kind: 'challenge', response: { challenge: envelope.challenge } };
  }
  return {
    kind: 'event',
    externalWorkspaceId: envelope.team_id,
    event: toProviderEvent(envelope.event),
  };
}

function toProviderEvent(raw: unknown): ProviderEvent | null {
  const member = SlackMemberEventSchema.safeParse(raw);
  if (member.success) {
    const type = member.data.type === 'member_joined_channel' ? 'member_joined' : 'member_left';
    return { type, channelId: member.data.channel, userId: member.data.user };
  }

  const parsed = SlackMessageEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;

  if (event.subtype === 'message_deleted') {
    return event.deleted_ts
      ? { type: 'message_deleted', channelId: event.channel, messageId: event.deleted_ts }
      : null;
  }
  if (event.subtype === 'message_changed') {
    if (!event.message) return null;
    // A deleted thread parent stays as a tombstone.
    if (event.message.subtype === 'tombstone') {
      return { type: 'message_deleted', channelId: event.channel, messageId: event.message.ts };
    }
    // Slack also sends message_changed for unfurls and reply counts; only a text change is an edit.
    if (event.message.text === event.previous_message?.text) return null;
    return { type: 'message_edited', message: toProviderMessage(event.message, event.channel) };
  }
  if (!SYNCED_SUBTYPES.has(event.subtype)) return null;
  return { type: 'message_created', message: toProviderMessage(event, event.channel) };
}

export function toProviderMessage(message: SlackMessage, channelId: string): ProviderMessage {
  const isReply = !!message.thread_ts && message.thread_ts !== message.ts;
  return {
    channelId,
    id: message.ts,
    threadId: isReply ? message.thread_ts : undefined,
    authorId: message.user,
    botId: message.bot_id,
    appId: message.app_id,
    authorName: message.bot_profile?.name ?? message.username,
    text: message.text ?? '',
    attachments: message.attachments,
    files: (message.files ?? []).flatMap((file) =>
      file.url_private
        ? [
            {
              name: file.name ?? file.id,
              mimeType: file.mimetype ?? 'application/octet-stream',
              size: file.size ?? 0,
              url: file.url_private,
            },
          ]
        : []
    ),
    createdAt: slackTsToDate(message.ts),
    replyBroadcast: message.subtype === 'thread_broadcast',
    raw: message,
  };
}

function slackTsToDate(ts: string): Date {
  return new Date(Number(ts) * 1000);
}

const escapeMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function prefixAuthor(authorName: string, text: string): string {
  const author = `*${escapeMrkdwn(authorName)}*`;
  return text ? `${author}: ${text}` : author;
}
