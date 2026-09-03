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
  ConversationLabelMapping,
  Email,
  EmailChannelPreference,
  EmailDraft,
  EmailReadMarker,
  EmailSignature,
} from '../types/index.js';

export class EmailResource extends Resource {
  /**
   * List the emails on several conversations at once.
   *
   * @param conversationIds - Threads to read.
   * @param channelId - Desk channel they belong to.
   * @param isMember - ACL hint; leave unset unless you know otherwise.
   * @returns Emails across every thread named.
   * @example
   * const emails = await sdk.email.listForConversations(['conv-1'], 'channel-desk');
   */
  listForConversations(
    conversationIds: string[],
    channelId: string,
    isMember?: boolean
  ): Promise<Email[]> {
    return this.call(emailOperations.listForConversations, {
      conversationIds,
      channelId,
      ...(isMember !== undefined ? { isMember } : {}),
    });
  }

  /**
   * List mail the caller has sent from a channel.
   *
   * @param channelId - Desk channel to read.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.scope - Narrow the listing, e.g. to one mailbox.
   * @returns One page of sent mail, newest first.
   * @example
   * const sent = await sdk.email.listSent('channel-desk', { limit: 20 });
   */
  listSent(
    channelId: string,
    options?: { limit?: number; start?: EmailCursor; scope?: string }
  ): Promise<Email[]> {
    return this.call(emailOperations.listSent, { channelId, ...options });
  }

  // ----- Drafts -----

  /**
   * List the caller's reply drafts in a channel.
   *
   * @param channelId - Desk channel to read.
   * @returns Their drafts there.
   * @example
   * const drafts = await sdk.email.listDrafts('channel-desk');
   */
  listDrafts(
    channelId: string,
    options?: { limit?: number; start?: EmailDraftCursor }
  ): Promise<EmailDraft[]> {
    return this.call(emailOperations.listDrafts, { channelId, ...options });
  }

  /**
   * Get the reply draft on a conversation.
   *
   * @param conversationId - Thread to read.
   * @param channelId - Desk channel it belongs to.
   * @returns The draft, or `null` if there is none.
   * @example
   * const draft = await sdk.email.getDraftForConversation('conv-1', 'channel-desk');
   */
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

  /**
   * List compose drafts in a channel — new mail not yet tied to a thread.
   *
   * @param channelId - Desk channel to read.
   * @returns The caller's compose drafts.
   * @example
   * const drafts = await sdk.email.listComposeDrafts('channel-desk');
   */
  listComposeDrafts(channelId: string): Promise<EmailDraft[]> {
    return this.call(emailOperations.listComposeDrafts, { channelId });
  }

  /**
   * Create or replace the reply draft on a conversation.
   *
   * There is one reply draft per conversation, so saving again replaces it.
   *
   * @param data - The draft to save.
   * @param data.id - Existing draft to overwrite. Generated if omitted.
   * @param data.conversationId - Thread being replied to.
   * @param data.channelId - Desk channel it belongs to.
   * @param data.draftContent - Body, as HTML.
   * @param data.toRecipients - Recipient addresses.
   * @param data.ccRecipients - Copied addresses.
   * @param data.bccRecipients - Blind-copied addresses.
   * @param data.attachmentIds - Ids from `sdk.attachments.uploadDraft`.
   * @returns The draft id.
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
    toRecipients?: string[];
    ccRecipients?: string[];
    bccRecipients?: string[];
    attachmentIds?: string[];
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(emailOperations.saveDraft, { ...data, id });
    return { id };
  }

  /**
   * Discard a conversation's reply draft.
   *
   * Takes the conversation id, not the draft id — reply drafts are keyed by the
   * conversation they reply to.
   *
   * @param conversationId - Thread whose draft to discard.
   * @example
   * await sdk.email.deleteDraft('conv-1');
   */
  deleteDraft(conversationId: string): Promise<void> {
    return this.call(emailOperations.deleteDraft, { conversationId });
  }

  /**
   * Create or replace a compose draft — a new email not yet tied to a thread.
   *
   * @param data - The draft to save.
   * @param data.id - Existing draft to overwrite. Generated if omitted.
   * @param data.channelId - Desk channel it belongs to.
   * @param data.subject - Subject line.
   * @param data.fromAddress - Address to send from.
   * @param data.draftContent - Body, as HTML.
   * @param data.toRecipients - Recipient addresses.
   * @param data.ccRecipients - Copied addresses.
   * @param data.bccRecipients - Blind-copied addresses.
   * @param data.attachmentIds - Ids from `sdk.attachments.uploadDraft`.
   * @returns The draft id.
   * @example
   * const { id } = await sdk.email.saveComposeDraft({
   *   channelId: 'channel-desk',
   *   subject: 'Refund update',
   *   toRecipients: ['merchant@example.com'],
   * });
   */
  async saveComposeDraft(data: {
    id?: string;
    channelId: string;
    subject?: string;
    fromAddress?: string;
    draftContent?: string;
    toRecipients?: string[];
    ccRecipients?: string[];
    bccRecipients?: string[];
    attachmentIds?: string[];
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(emailOperations.saveComposeDraft, { ...data, id });
    return { id };
  }

  /**
   * Discard a compose draft.
   *
   * @param id - Id of the draft.
   * @example
   * await sdk.email.deleteComposeDraft('draft-1');
   */
  deleteComposeDraft(id: string): Promise<void> {
    return this.call(emailOperations.deleteComposeDraft, { id });
  }

  // ----- Read state -----

  /**
   * Mark a desk ticket's mail read up to a given email.
   *
   * @param data.id - Existing read marker to update. Generated if omitted.
   * @param data.ticketId - Desk ticket being marked.
   * @param data.lastReadEmailId - Most recent email the caller has read.
   * @example
   * await sdk.email.markAsRead({ ticketId: 'ticket-1', lastReadEmailId: 'email-9' });
   */
  markAsRead(data: {
    id?: string;
    ticketId: string;
    lastReadEmailId: string;
  }): Promise<void> {
    return this.call(emailOperations.markAsRead, { ...data, id: data.id ?? newId() });
  }

  /**
   * Mark several desk tickets read at once.
   *
   * @param items - Each ticket with the last email read on it.
   * @example
   * await sdk.email.bulkMarkAsRead([{ id: 'email-9', ticketId: 'ticket-1' }]);
   */
  bulkMarkAsRead(items: EmailReadMarker[]): Promise<void> {
    return this.call(emailOperations.bulkMarkAsRead, { items });
  }

  /**
   * Mark several desk tickets unread.
   *
   * @param ticketIds - Tickets to mark.
   * @example
   * await sdk.email.bulkMarkAsUnread(['ticket-1', 'ticket-2']);
   */
  bulkMarkAsUnread(ticketIds: string[]): Promise<void> {
    return this.call(emailOperations.bulkMarkAsUnread, { ticketIds });
  }

  // ----- Signatures -----

  /**
   * List the caller's email signatures.
   *
   * @returns Their signatures, including which is the default.
   * @example
   * const signatures = await sdk.email.listSignatures();
   */
  listSignatures(): Promise<EmailSignature[]> {
    return this.call(emailOperations.listSignatures, undefined);
  }

  /**
   * Create an email signature.
   *
   * @param data.name - Display name for the signature.
   * @param data.content - The signature body, as HTML.
   * @returns The new signature's id.
   * @example
   * const { id } = await sdk.email.createSignature({ name: 'Support', content: '<p>Team</p>' });
   */
  async createSignature(data: { name: string; content: string }): Promise<{ id: string }> {
    const id = newId();
    await this.call(emailOperations.createSignature, { id, ...data });
    return { id };
  }

  /**
   * Update a signature.
   *
   * @param id - Id of the signature.
   * @param data.name - New display name.
   * @param data.content - New body, as HTML.
   * @example
   * await sdk.email.updateSignature('sig-1', { name: 'Support', content: '<p>Team</p>' });
   */
  updateSignature(id: string, data: { name: string; content: string }): Promise<void> {
    return this.call(emailOperations.updateSignature, { id, ...data });
  }

  /**
   * Delete a signature.
   *
   * @param id - Id of the signature.
   * @example
   * await sdk.email.deleteSignature('sig-1');
   */
  deleteSignature(id: string): Promise<void> {
    return this.call(emailOperations.deleteSignature, { id });
  }

  /**
   * Make a signature the default for new mail.
   *
   * @param id - Id of the signature.
   * @example
   * await sdk.email.setDefaultSignature('sig-1');
   */
  setDefaultSignature(id: string): Promise<void> {
    return this.call(emailOperations.setDefaultSignature, { id });
  }

  // ----- Channel configuration -----

  /**
   * Get a channel's desk configuration.
   *
   * @param channelId - Desk channel to read.
   * @returns Its configuration, or `null` if none has been set.
   * @example
   * const prefs = await sdk.email.getChannelPreference('channel-desk');
   */
  getChannelPreference(channelId: string): Promise<EmailChannelPreference | null> {
    return this.call(emailOperations.getChannelPreference, { channelId });
  }

  /**
   * Update a channel's desk configuration.
   *
   * @param channelId - Desk channel to configure.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.ownerUserId - Who owns the desk.
   * @param data.assigneeUserGroupId - Group new mail is routed to.
   * @param data.sendAsEmail - Send replies as email rather than chat.
   * @param data.defaultCc - Addresses copied on every reply.
   * @param data.emailMergeMode - How incoming mail is merged into threads.
   * @param data.twoStepSendEnabled - Require a confirmation before sending.
   * @param data.autoDraftMode - When replies are drafted automatically.
   * @param data.autoDraftAgentSlug - Agent that writes those drafts.
   * @param data.metricsEnabled - Collect desk metrics for this channel.
   * @example
   * await sdk.email.setChannelPreference('channel-desk', { sendAsEmail: true });
   */
  setChannelPreference(
    channelId: string,
    data: {
      ownerUserId?: string;
      assigneeUserGroupId?: string;
      sendAsEmail?: boolean;
      defaultCc?: string[];
      emailMergeMode?: string;
      twoStepSendEnabled?: boolean;
      autoDraftMode?: string;
      autoDraftAgentSlug?: string;
      metricsEnabled?: boolean;
    }
  ): Promise<void> {
    return this.call(emailOperations.setChannelPreference, { channelId, ...data });
  }

  /**
   * Configure automatic categorisation of incoming mail.
   *
   * @param data.channelId - Desk channel to configure.
   * @param data.classificationEnabled - Whether categorisation runs.
   * @param data.classificationPrompt - Instruction used to categorise.
   * @param data.categoryField - Field the category is written to.
   * @param data.subCategoryField - Field the sub-category is written to.
   * @example
   * await sdk.email.setClassificationConfig({
   *   channelId: 'channel-desk',
   *   classificationEnabled: true,
   *   classificationPrompt: 'Classify by refund, chargeback or other.',
   *   categoryField: 'category',
   * });
   */
  setClassificationConfig(data: {
    channelId: string;
    classificationEnabled: boolean;
    classificationPrompt: string;
    categoryField: string;
    subCategoryField?: string;
  }): Promise<void> {
    return this.call(emailOperations.setClassificationConfig, data);
  }

  /**
   * Configure automatic priority scoring of incoming mail.
   *
   * @param data.channelId - Desk channel to configure.
   * @param data.priorityClassificationEnabled - Whether scoring runs.
   * @param data.priorityClassificationPrompt - Instruction used to score.
   * @param data.priorityClassificationThreshold - Score above which mail is escalated.
   * @example
   * await sdk.email.setPriorityClassificationConfig({
   *   channelId: 'channel-desk',
   *   priorityClassificationEnabled: true,
   * });
   */
  setPriorityClassificationConfig(data: {
    channelId: string;
    priorityClassificationEnabled: boolean;
    priorityClassificationPrompt?: string;
    priorityClassificationThreshold?: number;
  }): Promise<void> {
    return this.call(emailOperations.setPriorityClassificationConfig, data);
  }

  // ----- Labels -----

  /**
   * List the labels defined in a channel.
   *
   * @param channelId - Channel to read.
   * @returns The labels available there.
   * @example
   * const labels = await sdk.email.listLabels('channel-desk');
   */
  listLabels(channelId: string): Promise<ConversationLabel[]> {
    return this.call(emailOperations.listLabels, { channelId });
  }

  /**
   * List the conversations carrying a given label.
   *
   * @param labelId - Label to look up.
   * @returns One mapping per thread carrying it.
   * @example
   * const threads = await sdk.email.listConversationsByLabel('label-1');
   */
  listConversationsByLabel(labelId: string): Promise<ConversationLabelMapping[]> {
    return this.call(emailOperations.listConversationsByLabel, { labelId });
  }

  /**
   * Create a label in a channel.
   *
   * @param data.name - Display name.
   * @param data.channelId - Channel the label belongs to.
   * @param data.color - Display colour.
   * @returns The new label's id.
   * @example
   * const { id } = await sdk.email.createLabel({ name: 'Refunds', channelId: 'channel-desk' });
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
   * @param data.labelId - Label to apply.
   * @param data.labelName - The label's name, stored alongside the mapping.
   * @param data.conversationId - Thread to label.
   * @param data.channelId - Channel the thread belongs to.
   * @param data.color - The label's colour.
   * @returns The mapping's id, needed to remove it later.
   * @example
   * const { mappingId } = await sdk.email.applyLabel({
   *   labelId: 'label-1',
   *   labelName: 'Refunds',
   *   conversationId: 'conv-1',
   *   channelId: 'channel-desk',
   * });
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
   *
   * @param conversationId - Thread to unlabel.
   * @param labelId - Label to remove.
   * @example
   * await sdk.email.removeLabel('conv-1', 'label-1');
   */
  removeLabel(conversationId: string, labelId: string): Promise<void> {
    return this.call(emailOperations.removeLabel, { conversationId, labelId });
  }

}
