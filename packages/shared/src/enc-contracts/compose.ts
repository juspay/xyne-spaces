import { z } from 'zod';
import { UnreadableString, isUnreadableSchema, reveal, unreadableString } from './unreadable-string.js';
import { buildForwardedMessageContent, createForwardedMessageXml, parseForwardedMessageXml } from '../forwardedMessage.js';
import { SlackBlockKitParser } from '../slack/blockKitParser.js';
import { applySlackHandleMentions, applySlackMentions, type SlackMentionTargets } from '../slack/mentions.js';
import { buildFlowFromBlockKit } from '../slack/flow.js';
import { flowFallbackLabel } from '../utils/flowCardLabel.js';
import type { SlackAttachment, SlackBlock } from '../slack/blockKitTypes.js';

/**
 * A value the server stores encrypted but cannot build itself, because it is made from values it
 * holds only encrypted (a forward's XML from the original message's text, a conversation's
 * `*_md` from its message). The backend sends the inputs, encrypted ones as they are stored;
 * the encryption service decrypts them, runs `build` (here, next to the plaintext) and returns
 * the result encrypted. The backend never reads the text it stores.
 *
 * `inputs` is the shape of what the backend sends: `unreadableString()` marks the values it holds
 * as `UnreadableString` (ciphertext, or plaintext while it is not encrypted); every other field
 * is plain data (ids, timestamps). `build` gets the same fields with the unreadable ones as
 * plain strings and must be pure: same inputs, same output, so a rebuild of an unchanged value
 * can be recognised.
 */
export interface ComposeTemplate<S extends z.ZodObject = z.ZodObject> {
  name: string;
  inputs: S;
  /** The fields `inputs` marks `unreadableString()`. */
  unreadableFields: readonly string[];
  build: (inputs: z.input<S>) => string;
}

export function defineComposeTemplate<S extends z.ZodObject>(template: {
  name: string;
  inputs: S;
  build: (inputs: z.input<S>) => string;
}): ComposeTemplate<S> {
  return {
    ...template,
    unreadableFields: Object.entries(template.inputs.shape)
      .filter(([, field]) => isUnreadableSchema(field))
      .map(([name]) => name),
  };
}

/** A template's inputs as the backend holds them: its unreadable fields as `UnreadableString`. */
export type ComposeInputs<T> = T extends ComposeTemplate<infer S> ? z.output<S> : never;

/**
 * What a compose gives back: the new value, encrypted the way the column stores it, or
 * `unchanged` when it equals the `current` value the caller passed (so it skips the write: two
 * encryptions of the same text never compare equal, the plaintexts do).
 */
export type ComposeResult = { unchanged: true } | { unchanged: false; value: UnreadableString };

/**
 * A forwarded message's content (`ForwardedMessage` XML): built from the original message as the
 * server read it and the forwarder's optional text, so nothing in it comes from the client but
 * that text. Re-forwarding a forward forwards its optional text when it has one, else what it
 * forwarded (`buildForwardedMessageContent`).
 */
export const forwardedMessageTemplate = defineComposeTemplate({
  name: 'forwardedMessage',
  inputs: z.object({
    originalMessageId: z.string(),
    originalSenderId: z.string(),
    originalSenderName: z.string().nullable(),
    originalCreatedAt: z.number(),
    originalConversationId: z.string(),
    originalChannelId: z.string().nullable(),
    originalMsgType: z.string().nullable(),
    originalContent: unreadableString(),
    optionalText: unreadableString().nullable(),
  }),
  build: inputs =>
    buildForwardedMessageContent({
      original: {
        messageId: inputs.originalMessageId,
        senderId: inputs.originalSenderId,
        content: inputs.originalContent,
        createdAt: inputs.originalCreatedAt,
        conversationId: inputs.originalConversationId,
        msgType: inputs.originalMsgType,
      },
      originalSenderName: inputs.originalSenderName,
      originalChannelId: inputs.originalChannelId,
      optionalText: inputs.optionalText,
    }),
});

/**
 * An edited forward's content: the stored forward with its optional text replaced, everything it
 * forwards (the original's text, sender, date, ids) kept as stored. The client sends only the new
 * text, so an edit cannot change what the forward quotes. Refused when the stored content is not
 * a forward.
 */
export const forwardedMessageEditTemplate = defineComposeTemplate({
  name: 'forwardedMessageEdit',
  inputs: z.object({
    storedContent: unreadableString(),
    optionalText: unreadableString().nullable(),
  }),
  build: inputs => {
    const stored = parseForwardedMessageXml(inputs.storedContent);
    if (!stored) throw new Error('forwardedMessageEdit: the stored content is not a forwarded message');
    return createForwardedMessageXml({ ...stored, optionalText: inputs.optionalText || null });
  },
});

const slackUserTargetSchema = z.union([
  z.object({ id: z.string(), name: z.string(), email: z.string().optional(), picture: z.string().optional() }),
  z.object({ unknownName: z.string() }),
]);
const slackGroupTargetSchema = z.union([
  z.object({ id: z.string(), name: z.string(), alias: z.string().optional(), description: z.string().optional() }),
  z.object({ unknownName: z.string() }),
]);
const slackChannelTargetSchema = z.union([
  z.object({ id: z.string(), name: z.string(), isPrivate: z.boolean() }),
  z.object({ unknownName: z.string() }),
]);

/** What the Slack ids a message mentions refer to, as the backend looked them up (SlackMentionTargets). */
export const slackMentionTargetsSchema = z.object({
  users: z.record(z.string(), slackUserTargetSchema),
  groups: z.record(z.string(), slackGroupTargetSchema),
  channels: z.record(z.string(), slackChannelTargetSchema),
});

/**
 * A Xyne Apps message's content (HTML) from Slack-format input: `text` (mrkdwn), `attachments`
 * and `blocks` (Block Kit), with Slack mentions turned into Xyne mention spans first, then
 * Block Kit converted to HTML (SlackBlockKitParser). What the chat controller and the
 * Slack-compatible API build when they parse a bot's message; here so the encryption service
 * can build it from `text` it holds encrypted. `mentions` is what the backend looked up for the
 * ids the `slackMention*` facts found. `attachments` and `blocks` are plain for now (the ingress
 * transit proxy encrypts top-level strings only).
 */
export const slackMessageContentTemplate = defineComposeTemplate({
  name: 'slackMessageContent',
  inputs: z.object({
    text: unreadableString().nullable(),
    attachments: z.array(z.any()).nullable(),
    blocks: z.array(z.any()).nullable(),
    mentions: slackMentionTargetsSchema,
  }),
  build: inputs => {
    const mentions = inputs.mentions as SlackMentionTargets;
    const text = inputs.text ? applySlackMentions(inputs.text, mentions, false) : undefined;
    const attachments = inputs.attachments?.length
      ? (JSON.parse(applySlackMentions(JSON.stringify(inputs.attachments), mentions, true)) as SlackAttachment[])
      : undefined;
    const blocks = inputs.blocks?.length
      ? (JSON.parse(applySlackMentions(JSON.stringify(inputs.blocks), mentions, true)) as SlackBlock[])
      : undefined;
    return new SlackBlockKitParser().parse({ text, attachments, blocks });
  },
});

function encodeHtmlAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** `value` with `replacements` applied to its JSON (stringified blocks / attachments); unchanged when empty. */
function mapJson<T>(value: T[] | undefined, apply: (json: string) => string): T[] | undefined {
  return value?.length ? (JSON.parse(apply(JSON.stringify(value))) as T[]) : undefined;
}

/**
 * A Slack-compatible message's content (`chat.postMessage` / `chat.update` / `chat.postEphemeral`
 * on /apps/slack): what the Slack adapter's processContent builds, step by step, so the
 * encryption service can build it from `text` it holds encrypted.
 *
 * 1. Legacy handle mentions (`<@harry.sharma>`) rewritten by `handles` (postMessage only; `{}`
 *    elsewhere), in text, blocks and attachments.
 * 2. With blocks or attachments: a flow card (`<div data-flow-json>`) built with `idMaps`, else
 *    HTML (SlackBlockKitParser) with mentions applied.
 * 3. Text only: with `mrkdwn` not true, the text with mentions applied (no formatting); else the
 *    text as HTML.
 *
 * `handles`, `mentions` and `idMaps` are what the backend looked up for the ids the
 * `slackMention*` facts found; `screenId` is the flow card's id (given, so the build is pure).
 */
export const slackChatContentTemplate = defineComposeTemplate({
  name: 'slackChatContent',
  inputs: z.object({
    text: unreadableString().nullable(),
    attachments: z.array(z.any()).nullable(),
    blocks: z.array(z.any()).nullable(),
    mrkdwn: z.boolean().nullable(),
    handles: z.record(z.string(), z.string()),
    mentions: slackMentionTargetsSchema,
    idMaps: z.object({ users: z.record(z.string(), z.string()), groups: z.record(z.string(), z.string()) }),
    screenId: z.string(),
  }),
  build: inputs => {
    const mentions = inputs.mentions as SlackMentionTargets;
    const handles = inputs.handles;
    const text = inputs.text ? applySlackHandleMentions(inputs.text, handles) : undefined;
    const blocks = mapJson(inputs.blocks as SlackBlock[] | null ?? undefined, json => applySlackHandleMentions(json, handles));
    const attachments = mapJson(inputs.attachments as SlackAttachment[] | null ?? undefined, json => applySlackHandleMentions(json, handles));

    if (blocks?.length || attachments?.length) {
      const flow = buildFlowFromBlockKit({ text, blocks, attachments }, inputs.idMaps, inputs.screenId);
      if (flow) {
        const escapedJSON = JSON.stringify(flow).replace(/"/g, '&quot;');
        return `<div data-flow-json="${escapedJSON}">${encodeHtmlAttr(flowFallbackLabel(flow))}</div>`;
      }
      return new SlackBlockKitParser().parse({
        text: text ? applySlackMentions(text, mentions, false) : undefined,
        blocks: mapJson(blocks, json => applySlackMentions(json, mentions, true)),
        attachments: mapJson(attachments, json => applySlackMentions(json, mentions, true)),
      });
    }

    // mrkdwn:false disables formatting but Slack still resolves mention tokens
    if (inputs.mrkdwn !== true && text) return applySlackMentions(text, mentions, false);
    if (text) return new SlackBlockKitParser().parse({ text: applySlackMentions(text, mentions, false) });
    return '';
  },
});

/** Every compose template, by name: the names the encryption service and the transformer accept. */
export const COMPOSE_TEMPLATES = {
  forwardedMessage: forwardedMessageTemplate,
  forwardedMessageEdit: forwardedMessageEditTemplate,
  slackMessageContent: slackMessageContentTemplate,
  slackChatContent: slackChatContentTemplate,
} as const;

export type ComposeTemplateName = keyof typeof COMPOSE_TEMPLATES;

export function isComposeTemplateName(name: unknown): name is ComposeTemplateName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(COMPOSE_TEMPLATES, name);
}

/**
 * Runs template `name` on `inputs` as they arrive over the wire (unreadable fields as plain
 * strings): validated against the template's shape, then built. The transformer's one entry
 * point; the backend runs it too, on the values it holds, when database encryption is off.
 * Throws on an unknown template or inputs that do not match.
 */
export function runComposeTemplate(name: string, inputs: unknown): string {
  if (!isComposeTemplateName(name)) throw new Error(`unknown compose template "${name}"`);
  const template: ComposeTemplate = COMPOSE_TEMPLATES[name];
  const parsed = template.inputs.parse(inputs) as Record<string, unknown>;
  const plain: Record<string, unknown> = { ...parsed };
  for (const field of template.unreadableFields) {
    const value = parsed[field];
    if (value instanceof UnreadableString) plain[field] = reveal(value);
  }
  return template.build(plain as z.input<typeof template.inputs>);
}
