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

import { op, firstOrNull } from './types.js';
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
   *
   * V2 takes `channelId` and `isMember`, which it forwards to the table ACL for
   * channel-membership gating rather than gating inside the query body. Same result
   * shape; the channel is now required.
   */
  listForConversations: op<{ conversationIds: string[]; channelId: string; isMember?: boolean }, unknown[]>('email.listForConversations', 'query'),

  /**
   * Mail the current user has sent from a channel.
   */
  listSent: op<{ channelId: string; limit?: number; start?: EmailCursor; scope?: string }, unknown[]>('email.listSent', 'query'),

  /**
   * The current user's drafts in a channel.
   */
  listDrafts: op<{ channelId: string; limit?: number; start?: EmailDraftCursor }, EmailDraft[]>('email.listDrafts', 'query'),

  /**
   * The reply draft on one conversation, if any.
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
  getDraftForConversation: op<{ conversationId: string; channelId: string; isMember?: boolean }, EmailDraft | null>('email.getDraftForConversation', 'query', {
    mapResult: (raw) => firstOrNull<EmailDraft>(raw),
  }),

  /**
   * Compose drafts in a channel — those not yet tied to a conversation.
   */
  listComposeDrafts: op<{ channelId: string }, EmailDraft[]>('email.listComposeDrafts', 'query'),

  /**
   * The current user's signatures.
   */
  listSignatures: op<void, EmailSignature[]>('email.listSignatures', 'query'),

  /**
   * A channel's desk configuration.
   *
   * At most one row exists per channel, but the query does not say `.one()`, so the
   * server sends a list. Unwrapped here rather than pushed onto callers.
   */
  getChannelPreference: op<{ channelId: string }, EmailChannelPreference | null>('email.getChannelPreference', 'query', {
    mapResult: (raw) => firstOrNull<EmailChannelPreference>(raw),
  }),

  /**
   * Labels defined in a channel.
   *
   * `isMember` is required by the schema but unread by the query body — an ACL
   * hint, supplied here so a caller does not have to know about it.
   */
  listLabels: op<{ channelId: string }, ConversationLabel[]>('email.listLabels', 'query'),

  /**
   * Conversations carrying a given label.
   */
  listConversationsByLabel: op<{ labelId: string }, unknown[]>('email.listConversationsByLabel', 'query'),

  // ----- Drafts -----

  /**
   * Create or replace the reply draft on a conversation.
   */
  saveDraft: op<{
      id: string;
      conversationId: string;
      channelId: string;
      draftContent?: string;
      toRecipients?: unknown;
      ccRecipients?: unknown;
      bccRecipients?: unknown;
      attachmentIds?: string[];
    }, void>('email.saveDraft', 'mutator'),

  /**
   * Discard a conversation's reply draft. Keyed by conversation, not draft id.
   */
  deleteDraft: op<{ conversationId: string }, void>('email.deleteDraft', 'mutator'),

  /**
   * Create or replace a compose draft.
   */
  saveComposeDraft: op<{
      id: string;
      channelId: string;
      subject?: string;
      fromAddress?: string;
      draftContent?: string;
      toRecipients?: unknown;
      ccRecipients?: unknown;
      bccRecipients?: unknown;
      attachmentIds?: string[];
    }, void>('email.saveComposeDraft', 'mutator'),

  /**
   * Discard a compose draft.
   */
  deleteComposeDraft: op<{ id: string }, void>('email.deleteComposeDraft', 'mutator'),

  // ----- Read state -----

  /**
   * Mark a desk ticket's mail read up to a given email.
   */
  markAsRead: op<{ id: string; ticketId: string; lastReadEmailId: string }, void>('email.markAsRead', 'mutator'),

  /**
   * Mark several tickets read at once.
   */
  bulkMarkAsRead: op<{ items: unknown[] }, void>('email.bulkMarkAsRead', 'mutator'),

  /**
   * Mark several tickets unread.
   */
  bulkMarkAsUnread: op<{ ticketIds: string[] }, void>('email.bulkMarkAsUnread', 'mutator'),

  // ----- Signatures -----

  /**
   * Create a signature.
   */
  createSignature: op<{ id: string; name: string; content: string }, void>('email.createSignature', 'mutator'),

  /**
   * Update a signature.
   */
  updateSignature: op<{ id: string; name: string; content: string }, void>('email.updateSignature', 'mutator'),

  /**
   * Delete a signature.
   */
  deleteSignature: op<{ id: string }, void>('email.deleteSignature', 'mutator'),

  /**
   * Make a signature the default for new mail.
   */
  setDefaultSignature: op<{ id: string }, void>('email.setDefaultSignature', 'mutator'),

  // ----- Channel configuration -----

  /**
   * Update a channel's desk configuration.
   */
  setChannelPreference: op<{
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
    }, void>('email.setChannelPreference', 'mutator'),

  /**
   * Configure AI categorisation of incoming mail.
   */
  setClassificationConfig: op<{
      channelId: string;
      classificationEnabled: boolean;
      classificationPrompt: string;
      categoryField: string;
      subCategoryField?: string;
    }, void>('email.setClassificationConfig', 'mutator'),

  /**
   * Configure AI priority scoring of incoming mail.
   */
  setPriorityClassificationConfig: op<{
      channelId: string;
      priorityClassificationEnabled: boolean;
      priorityClassificationPrompt?: string;
      priorityClassificationThreshold?: number;
    }, void>('email.setPriorityClassificationConfig', 'mutator'),

  // ----- Labels -----

  /**
   * Create a label in a channel.
   */
  createLabel: op<{ id: string; name: string; channelId: string; color?: string }, void>('email.createLabel', 'mutator'),

  /**
   * Apply a label to a conversation.
   */
  applyLabel: op<{
      mappingId: string;
      labelId: string;
      labelName: string;
      conversationId: string;
      channelId: string;
      color?: string;
    }, void>('email.applyLabel', 'mutator'),

  /**
   * Remove the label from a conversation.
   */
  removeLabel: op<{ conversationId: string; labelId: string }, void>('email.removeLabel', 'mutator'),

} as const;
