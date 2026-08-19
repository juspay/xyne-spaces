/**
 * Email Operation Registry
 *
 * The support-desk email surface: drafts, signatures, read state, per-channel
 * configuration, and conversation labels.
 *
 * Drafts come in two shapes that share a table. A *reply* draft belongs to a
 * conversation and is keyed by it — hence `deleteDraft` taking a conversation
 * id rather than a draft id. A *compose* draft has no conversation yet and
 * carries its own subject and recipients.
 *
 * Sending mail is not in this catalog; these operations manage what surrounds it.
 */

import { query, mutator, firstOrNull } from './types.js';
import { now } from '../core/ids.js';
import type {
  ConversationLabel,
  EmailChannelPreference,
  EmailDraft,
  EmailSignature,
} from '../types/index.js';

/** Page cursor for sent mail, ordered by creation. */
export interface EmailCursor {
  id: string;
  createdAt: number;
}

/** Page cursor for drafts, ordered by last edit. */
export interface EmailDraftCursor {
  id: string;
  updatedAt: number;
}

export const emailOperations = {
  // ----- Reads -----

  /**
   * Emails on several conversations at once.
   * Maps to: Zero query 'getEmailsForConversationsV2'
   *
   * V2 takes `channelId` and `isMember`, which it forwards to the table ACL for
   * channel-membership gating rather than gating inside the query body. Same result
   * shape; the channel is now required.
   */
  listForConversations: query<
    { conversationIds: string[]; channelId: string; isMember?: boolean },
    unknown[]
  >('getEmailsForConversationsV2', {
    mapArgs: (args) => ({
      conversationIds: args.conversationIds,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    }),
  }),

  /**
   * Mail the current user has sent from a channel.
   * Maps to: Zero query 'userEmailsSent'
   */
  listSent: query<
    { channelId: string; limit?: number; start?: EmailCursor; scope?: string },
    unknown[]
  >('userEmailsSent', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.scope ? { scope: args.scope } : {}),
    }),
  }),

  /**
   * The current user's drafts in a channel.
   * Maps to: Zero query 'userEmailDrafts'
   */
  listDrafts: query<
    { channelId: string; limit?: number; start?: EmailDraftCursor },
    EmailDraft[]
  >('userEmailDrafts', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      limit: args.limit ?? 50,
      start: args.start ?? null,
    }),
  }),

  /**
   * The reply draft on one conversation, if any.
   * Maps to: Zero query 'getDraftForConversationV2'
   *
   * V2 adds `channelId` / `isMember` for ACL membership gating. Same result shape.
   *
   * The query returns a **list** — it has no `.one()` — ordered by `updatedAt`
   * descending, and there can legitimately be two rows (the caller's own draft and
   * a shared one with a null `userId`). The newest is the one to show, so
   * `mapResult` takes the first. While this was declared `EmailDraft | null` with
   * no mapping, callers received an array and every field read came back
   * `undefined`.
   */
  getDraftForConversation: query<
    { conversationId: string; channelId: string; isMember?: boolean },
    EmailDraft | null
  >('getDraftForConversationV2', {
    mapArgs: (args) => ({
      conversationId: args.conversationId,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    }),
    mapResult: (raw) => firstOrNull<EmailDraft>(raw),
  }),

  /**
   * Compose drafts in a channel — those not yet tied to a conversation.
   * Maps to: Zero query 'composeDraftsByChannel'
   */
  listComposeDrafts: query<{ channelId: string }, EmailDraft[]>('composeDraftsByChannel'),

  /**
   * The current user's signatures.
   * Maps to: Zero query 'userEmailSignatures'
   */
  listSignatures: query<void, EmailSignature[]>('userEmailSignatures'),

  /**
   * A channel's desk configuration.
   * Maps to: Zero query 'getEmailChannelPreference'
   *
   * At most one row exists per channel, but the query does not say `.one()`, so the
   * server sends a list. Unwrapped here rather than pushed onto callers.
   */
  getChannelPreference: query<{ channelId: string }, EmailChannelPreference | null>(
    'getEmailChannelPreference',
    { mapResult: (raw) => firstOrNull<EmailChannelPreference>(raw) }
  ),

  /**
   * Labels defined in a channel.
   * Maps to: Zero query 'conversationLabelsByChannelId'
   */
  listLabels: query<{ channelId: string }, ConversationLabel[]>(
    'conversationLabelsByChannelId'
  ),

  /**
   * Conversations carrying a given label.
   * Maps to: Zero query 'conversationLabelMappingsByLabelId'
   */
  listConversationsByLabel: query<{ labelId: string }, unknown[]>(
    'conversationLabelMappingsByLabelId'
  ),

  // ----- Drafts -----

  /**
   * Create or replace the reply draft on a conversation.
   * Maps to: Zero mutator 'emailDraft.upsert'
   */
  saveDraft: mutator<
    {
      id: string;
      conversationId: string;
      channelId: string;
      draftContent?: string;
      toRecipients?: unknown;
      ccRecipients?: unknown;
      bccRecipients?: unknown;
      attachmentIds?: string[];
    },
    void
  >('emailDraft.upsert', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),

  /**
   * Discard a conversation's reply draft. Keyed by conversation, not draft id.
   * Maps to: Zero mutator 'emailDraft.delete'
   */
  deleteDraft: mutator<{ conversationId: string }, void>('emailDraft.delete'),

  /**
   * Create or replace a compose draft.
   * Maps to: Zero mutator 'emailDraft.upsertComposeDraft'
   */
  saveComposeDraft: mutator<
    {
      id: string;
      channelId: string;
      subject?: string;
      fromAddress?: string;
      draftContent?: string;
      toRecipients?: unknown;
      ccRecipients?: unknown;
      bccRecipients?: unknown;
      attachmentIds?: string[];
    },
    void
  >('emailDraft.upsertComposeDraft', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),

  /**
   * Discard a compose draft.
   * Maps to: Zero mutator 'emailDraft.deleteComposeDraft'
   */
  deleteComposeDraft: mutator<{ id: string }, void>('emailDraft.deleteComposeDraft'),

  // ----- Read state -----

  /**
   * Mark a desk ticket's mail read up to a given email.
   * Maps to: Zero mutator 'emailRead.markAsRead'
   */
  markAsRead: mutator<{ id: string; ticketId: string; lastReadEmailId: string }, void>(
    'emailRead.markAsRead',
    {
      mapArgs: (args) => ({ ...args, updatedAt: now() }),
    }
  ),

  /**
   * Mark several tickets read at once.
   * Maps to: Zero mutator 'emailRead.bulkMarkAsRead'
   */
  bulkMarkAsRead: mutator<{ items: unknown[] }, void>('emailRead.bulkMarkAsRead', {
    mapArgs: (args) => ({ items: args.items, timestamp: now() }),
  }),

  /**
   * Mark several tickets unread.
   * Maps to: Zero mutator 'emailRead.bulkMarkAsUnread'
   */
  bulkMarkAsUnread: mutator<{ ticketIds: string[] }, void>('emailRead.bulkMarkAsUnread'),

  // ----- Signatures -----

  /**
   * Create a signature.
   * Maps to: Zero mutator 'emailSignature.create'
   */
  createSignature: mutator<{ id: string; name: string; content: string }, void>(
    'emailSignature.create',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Update a signature.
   * Maps to: Zero mutator 'emailSignature.update'
   */
  updateSignature: mutator<{ id: string; name: string; content: string }, void>(
    'emailSignature.update',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Delete a signature.
   * Maps to: Zero mutator 'emailSignature.delete'
   */
  deleteSignature: mutator<{ id: string }, void>('emailSignature.delete'),

  /**
   * Make a signature the default for new mail.
   * Maps to: Zero mutator 'emailSignature.setDefault'
   */
  setDefaultSignature: mutator<{ id: string }, void>('emailSignature.setDefault', {
    mapArgs: (args) => ({ id: args.id, timestamp: now() }),
  }),

  // ----- Channel configuration -----

  /**
   * Update a channel's desk configuration.
   * Maps to: Zero mutator 'emailChannelPreference.upsert'
   */
  setChannelPreference: mutator<
    {
      channelId: string;
      ownerUserId?: string;
      assigneeUserGroupId?: string;
      sendAsEmail?: boolean;
      defaultCc?: unknown;
      emailMergeMode?: string;
      twoStepSendEnabled?: boolean;
      autoDraftMode?: string;
      autoDraftAgentSlug?: string;
      metricsEnabled?: boolean;
    },
    void
  >('emailChannelPreference.upsert'),

  /**
   * Configure AI categorisation of incoming mail.
   * Maps to: Zero mutator 'emailChannelPreference.upsertClassificationConfig'
   */
  setClassificationConfig: mutator<
    {
      channelId: string;
      classificationEnabled: boolean;
      classificationPrompt: string;
      categoryField: string;
      subCategoryField?: string;
    },
    void
  >('emailChannelPreference.upsertClassificationConfig'),

  /**
   * Configure AI priority scoring of incoming mail.
   * Maps to: Zero mutator 'emailChannelPreference.upsertPriorityClassificationConfig'
   */
  setPriorityClassificationConfig: mutator<
    {
      channelId: string;
      priorityClassificationEnabled: boolean;
      priorityClassificationPrompt?: string;
      priorityClassificationThreshold?: number;
    },
    void
  >('emailChannelPreference.upsertPriorityClassificationConfig'),

  // ----- Labels -----

  /**
   * Create a label in a channel.
   * Maps to: Zero mutator 'conversationLabel.createLabel'
   */
  createLabel: mutator<
    { id: string; name: string; channelId: string; color?: string },
    void
  >('conversationLabel.createLabel', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Apply a label to a conversation.
   * Maps to: Zero mutator 'conversationLabel.applyLabel'
   */
  applyLabel: mutator<
    {
      mappingId: string;
      labelId: string;
      labelName: string;
      conversationId: string;
      channelId: string;
      color?: string;
    },
    void
  >('conversationLabel.applyLabel', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Remove the label from a conversation.
   * Maps to: Zero mutator 'conversationLabel.removeLabel'
   */
  removeLabel: mutator<{ conversationId: string; labelId: string }, void>(
    'conversationLabel.removeLabel'
  ),

  /**
   * Delete a label everywhere it is used.
   * Maps to: Zero mutator 'conversationLabel.deleteLabel'
   */
  deleteLabel: mutator<{ labelId: string }, void>('conversationLabel.deleteLabel'),
} as const;
