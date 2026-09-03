/**
 * Attachments Resource
 *
 * Upload file bytes and receive attachment ids that other operations reference.
 *
 * Files are uploaded first and referenced afterwards: send the bytes here, then
 * pass the returned ids to whatever should carry them.
 */

import { Resource } from './base.js';
import { attachmentsOperations } from '../registry/attachments.js';
import { newId } from '../core/ids.js';
import type {
  AttachmentUploadResponse,
  DraftAttachmentUploadResponse,
  UploadFileInput,
} from '../types/index.js';

export class AttachmentsResource extends Resource {
  /**
   * Upload files against an existing impact or form entity value.
   *
   * @param data - What the files belong to, and the files themselves.
   * @param data.entityId - Id of the impact or form entity value.
   * @param data.entityType - Which of the two `entityId` refers to.
   * @param data.files - Files to upload.
   * @returns The stored attachments, with the ids to reference them by.
   * @example
   * const { attachments } = await sdk.attachments.upload({
   *   entityId: 'impact-1',
   *   entityType: 'IMPACT',
   *   files: [{ file: blob, filename: 'trace.log' }],
   * });
   */
  upload(data: {
    entityId: string;
    entityType: 'IMPACT' | 'FORM_ENTITY_VALUE';
    files: UploadFileInput[];
  }): Promise<AttachmentUploadResponse> {
    return this.call(attachmentsOperations.upload, data);
  }

  /**
   * Upload files into a draft, before the thing carrying them exists.
   *
   * Use this when composing: upload first, then pass the returned ids as
   * `attachmentIds` to `messages.send`, `conversations.create`, or
   * `tickets.create`.
   *
   * @param data - Where the draft lives, and the files themselves.
   * @param data.channelId - Channel the draft belongs to.
   * @param data.conversationId - Thread being replied to, when there is one.
   * @param data.files - Files to upload.
   * @returns The draft attachments, with the ids to pass on.
   * @example
   * const { attachments } = await sdk.attachments.uploadDraft({
   *   channelId: 'channel-1',
   *   files: [{ file: blob, filename: 'screenshot.png' }],
   * });
   * await sdk.messages.send({
   *   conversationId: 'conv-1',
   *   content: 'See attached',
   *   attachmentIds: attachments.map((a) => a.id),
   * });
   */
  uploadDraft(data: {
    channelId: string;
    conversationId?: string;
    files: UploadFileInput[];
  }): Promise<DraftAttachmentUploadResponse> {
    return this.call(attachmentsOperations.uploadDraft, {
      ...data,
      draftMessageId: newId(),
      attachmentIds: data.files.map(() => newId()),
    });
  }
}
