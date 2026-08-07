/** Upload file bytes and receive attachment ids that catalog operations can reference. */

import { Resource } from './base.js';
import { attachmentsOperations } from '../registry/attachments.js';
import { newId } from '../core/ids.js';
import type {
  AttachmentUploadResponse,
  DraftAttachmentUploadResponse,
  UploadFileInput,
} from '../types/index.js';

export class AttachmentsResource extends Resource {
  /** Upload files for an impact or a form entity value. */
  upload(data: {
    entityId: string;
    entityType: 'IMPACT' | 'FORM_ENTITY_VALUE';
    files: UploadFileInput[];
  }): Promise<AttachmentUploadResponse> {
    return this.call(attachmentsOperations.upload, data);
  }

  /**
   * Upload files into a draft and return ids that can later be passed to
   * `messages.send`, `conversations.create`, or `tickets.create`.
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
