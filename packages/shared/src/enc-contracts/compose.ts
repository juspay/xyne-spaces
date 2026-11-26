import { z } from 'zod';
import { UnreadableString, isUnreadableSchema, reveal, unreadableString } from './unreadable-string.js';
import { buildForwardedMessageContent, createForwardedMessageXml, parseForwardedMessageXml } from '../forwardedMessage.js';
import {
  addReplyToData,
  buildInitialMessageMd,
  parseRepliesMd,
  serializeParentMessageMd,
  serializeRepliesMd,
} from '../utils/activityMetadataParser.js';
import type { ConversationAnchorType } from '../utils/activityMetadataParser.js';
import type { MessageType } from '../zero/schema.js';

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

/** `conversations.initial_message_md`: the conversation's first message, as `buildInitialMessageMd` writes it. */
export const initialMessageMdTemplate = defineComposeTemplate({
  name: 'initialMessageMd',
  inputs: z.object({
    messageId: z.string().min(1),
    conversationId: z.string(),
    workspaceId: z.string().nullable().optional(),
    senderId: z.string(),
    content: unreadableString(),
    msgType: z.string(),
    createdAt: z.number(),
    hasAttachment: z.boolean().optional(),
    edited: z.boolean().optional(),
    isDeleted: z.boolean().optional(),
    showInChannel: z.boolean().optional(),
    visibleTo: z.string().nullable().optional(),
    metadata: z.unknown().optional(),
    nudgeCount: z.number().nullable().optional(),
    isSent: z.boolean().optional(),
    reactions_md: z.string().nullable().optional(),
    link_preview_md: unreadableString().nullable().optional(),
    childConversationId: z.string().nullable().optional(),
  }),
  build: inputs => {
    const md = buildInitialMessageMd({ ...inputs, msgType: inputs.msgType as MessageType });
    if (md === null) throw new Error('initialMessageMd: no messageId');
    return md;
  },
});

/** `conversations.parent_message_md`: the message a thread or sub-ticket hangs off, as `serializeParentMessageMd` writes it. */
export const parentMessageMdTemplate = defineComposeTemplate({
  name: 'parentMessageMd',
  inputs: z.object({
    messageId: z.string().min(1),
    conversationId: z.string().nullable().optional(),
    channelId: z.string().nullable().optional(),
    senderId: z.string(),
    content: unreadableString(),
    msgType: z.string(),
    createdAt: z.number(),
    anchorType: z.string().nullable().optional(),
  }),
  build: inputs => {
    const md = serializeParentMessageMd({
      ...inputs,
      msgType: inputs.msgType as MessageType,
      anchorType: inputs.anchorType as ConversationAnchorType | null | undefined,
    });
    if (md === null) throw new Error('parentMessageMd: no messageId');
    return md;
  },
});

/** `conversations.replies_md` with `replierId` added as the latest replier, as `addReplyToData` does. */
export const repliesMdAddReplierTemplate = defineComposeTemplate({
  name: 'repliesMdAddReplier',
  inputs: z.object({
    repliesMd: unreadableString().nullable(),
    replierId: z.string().min(1),
  }),
  build: inputs => {
    const md = serializeRepliesMd(addReplyToData(parseRepliesMd(inputs.repliesMd), inputs.replierId));
    if (md === null) throw new Error('repliesMdAddReplier: no repliers');
    return md;
  },
});

/** Every compose template, by name: the names the encryption service and the transformer accept. */
export const COMPOSE_TEMPLATES = {
  forwardedMessage: forwardedMessageTemplate,
  forwardedMessageEdit: forwardedMessageEditTemplate,
  initialMessageMd: initialMessageMdTemplate,
  parentMessageMd: parentMessageMdTemplate,
  repliesMdAddReplier: repliesMdAddReplierTemplate,
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
