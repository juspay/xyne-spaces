/**
 * Email Resource
 *
 * The support-desk email surface: drafts, signatures, read state, channel
 * configuration, and labels.
 *
 * Sending mail is not exposed here. These operations manage everything around
 * the send.
 */

import { Resource } from './base.js';
import {
  emailOperations,
  type EmailCursor,
  type EmailDraftCursor,
} from '../registry/email.js';
import { newId } from '../core/ids.js';
import type {
  ConversationLabel,
  EmailChannelPreference,
  EmailDraft,
  EmailSignature,
} from '../types/index.js';

export class EmailResource extends Resource {
  /** List the emails on several conversations at once. */
  listForConversations(
    conversationIds: string[],
    channelId: string,
    isMember?: boolean
  ): Promise<unknown[]> {
    return this.call(emailOperations.listForConversations, {
      conversationIds,
      channelId,
      ...(isMember !== undefined ? { isMember } : {}),
    });
  }

  /** List mail the current user has sent from a channel. */
  listSent(
    channelId: string,
    options?: { limit?: number; start?: EmailCursor; scope?: string }
  ): Promise<unknown[]> {
    return this.call(emailOperations.listSent, { channelId, ...options });
  }

  // ----- Drafts -----

  /** List the current user's drafts in a channel. */
  listDrafts(
    channelId: string,
    options?: { limit?: number; start?: EmailDraftCursor }
  ): Promise<EmailDraft[]> {
    return this.call(emailOperations.listDrafts, { channelId, ...options });
  }

  /** Get the reply draft on a conversation, if there is one. */
  getDraftForConversation(
    conversationId: string,
    channelId: string,
    isMember?: boolean
  ): Promise<EmailDraft | null> {
    return this.call(emailOperations.getDraftForConversation, {
      conversationId,
      channelId,
      ...(isMember !== undefined ? { isMember } : {}),
    });
  }

  /** List compose drafts in a channel — those not yet tied to a conversation. */
  listComposeDrafts(channelId: string): Promise<EmailDraft[]> {
    return this.call(emailOperations.listComposeDrafts, { channelId });
  }

  /**
   * Create or replace the reply draft on a conversation.
   *
   * There is one reply draft per conversation, so saving again replaces it.
   *
   * @returns The draft id
   *
   * @example
   * await sdk.email.saveDraft({
   *   conversationId: 'conv-1',
   *   channelId: 'channel-desk',
   *   draftContent: '<p>Thanks for reaching out.</p>',
   * });
   */
  async saveDraft(data: {
    id?: string;
    conversationId: string;
    channelId: string;
    draftContent?: string;
    toRecipients?: unknown;
    ccRecipients?: unknown;
    bccRecipients?: unknown;
    attachmentIds?: string[];
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(emailOperations.saveDraft, { ...data, id });
    return { id };
  }

  /**
   * Discard a conversation's reply draft.
   *
   * Takes the conversation id, not the draft id — drafts are keyed by the
   * conversation they reply to.
   */
  deleteDraft(conversationId: string): Promise<void> {
    return this.call(emailOperations.deleteDraft, { conversationId });
  }

  /**
   * Create or replace a compose draft — a new email not yet tied to a thread.
   *
   * @returns The draft id
   */
  async saveComposeDraft(data: {
    id?: string;
    channelId: string;
    subject?: string;
    fromAddress?: string;
    draftContent?: string;
    toRecipients?: unknown;
    ccRecipients?: unknown;
    bccRecipients?: unknown;
    attachmentIds?: string[];
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(emailOperations.saveComposeDraft, { ...data, id });
    return { id };
  }

  /** Discard a compose draft. */
  deleteComposeDraft(id: string): Promise<void> {
    return this.call(emailOperations.deleteComposeDraft, { id });
  }

  // ----- Read state -----

  /** Mark a desk ticket's mail read up to a given email. */
  markAsRead(data: {
    id?: string;
    ticketId: string;
    lastReadEmailId: string;
  }): Promise<void> {
    return this.call(emailOperations.markAsRead, { ...data, id: data.id ?? newId() });
  }

  /** Mark several tickets read at once. */
  bulkMarkAsRead(items: unknown[]): Promise<void> {
    return this.call(emailOperations.bulkMarkAsRead, { items });
  }

  /** Mark several tickets unread. */
  bulkMarkAsUnread(ticketIds: string[]): Promise<void> {
    return this.call(emailOperations.bulkMarkAsUnread, { ticketIds });
  }

  // ----- Signatures -----

  /** List the current user's signatures. */
  listSignatures(): Promise<EmailSignature[]> {
    return this.call(emailOperations.listSignatures, undefined);
  }

  /**
   * Create a signature.
   *
   * @returns The signature id
   */
  async createSignature(data: { name: string; content: string }): Promise<{ id: string }> {
    const id = newId();
    await this.call(emailOperations.createSignature, { id, ...data });
    return { id };
  }

  /** Update a signature. */
  updateSignature(id: string, data: { name: string; content: string }): Promise<void> {
    return this.call(emailOperations.updateSignature, { id, ...data });
  }

  /** Delete a signature. */
  deleteSignature(id: string): Promise<void> {
    return this.call(emailOperations.deleteSignature, { id });
  }

  /** Make a signature the default for new mail. */
  setDefaultSignature(id: string): Promise<void> {
    return this.call(emailOperations.setDefaultSignature, { id });
  }

  // ----- Channel configuration -----

  /** Get a channel's desk configuration. */
  getChannelPreference(channelId: string): Promise<EmailChannelPreference | null> {
    return this.call(emailOperations.getChannelPreference, { channelId });
  }

  /** Update a channel's desk configuration. */
  setChannelPreference(
    channelId: string,
    data: {
      ownerUserId?: string;
      assigneeUserGroupId?: string;
      sendAsEmail?: boolean;
      defaultCc?: unknown;
      emailMergeMode?: string;
      twoStepSendEnabled?: boolean;
      autoDraftMode?: string;
      autoDraftAgentSlug?: string;
      metricsEnabled?: boolean;
    }
  ): Promise<void> {
    return this.call(emailOperations.setChannelPreference, { channelId, ...data });
  }

  /** Configure AI categorisation of incoming mail. */
  setClassificationConfig(data: {
    channelId: string;
    classificationEnabled: boolean;
    classificationPrompt: string;
    categoryField: string;
    subCategoryField?: string;
  }): Promise<void> {
    return this.call(emailOperations.setClassificationConfig, data);
  }

  /** Configure AI priority scoring of incoming mail. */
  setPriorityClassificationConfig(data: {
    channelId: string;
    priorityClassificationEnabled: boolean;
    priorityClassificationPrompt?: string;
    priorityClassificationThreshold?: number;
  }): Promise<void> {
    return this.call(emailOperations.setPriorityClassificationConfig, data);
  }

  // ----- Labels -----

  /** List the labels defined in a channel. */
  listLabels(channelId: string): Promise<ConversationLabel[]> {
    return this.call(emailOperations.listLabels, { channelId });
  }

  /** List the conversations carrying a given label. */
  listConversationsByLabel(labelId: string): Promise<unknown[]> {
    return this.call(emailOperations.listConversationsByLabel, { labelId });
  }

  /**
   * Create a label in a channel.
   *
   * @returns The label id
   */
  async createLabel(data: {
    name: string;
    channelId: string;
    color?: string;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(emailOperations.createLabel, { id, ...data });
    return { id };
  }

  /**
   * Apply a label to a conversation.
   *
   * @returns The id of the mapping row
   */
  async applyLabel(data: {
    labelId: string;
    labelName: string;
    conversationId: string;
    channelId: string;
    color?: string;
  }): Promise<{ mappingId: string }> {
    const mappingId = newId();
    await this.call(emailOperations.applyLabel, { mappingId, ...data });
    return { mappingId };
  }

  /**
   * Remove a label from a conversation.
   *
   * Takes the label as well as the conversation — one thread can carry several.
   */
  removeLabel(conversationId: string, labelId: string): Promise<void> {
    return this.call(emailOperations.removeLabel, { conversationId, labelId });
  }

}
