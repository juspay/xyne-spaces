/** Direct multipart operations for file bytes that are outside the Zero catalog. */

import { api } from './types.js';
import { appendFiles, appendOptional } from '../core/form-data.js';
import type {
  AttachmentUploadResponse,
  DraftAttachmentUploadResponse,
  UploadFileInput,
} from '../types/index.js';

export interface UploadAttachmentsInput {
  entityId: string;
  entityType: 'IMPACT' | 'FORM_ENTITY_VALUE';
  files: UploadFileInput[];
}

export interface UploadDraftAttachmentsInput {
  attachmentIds: string[];
  draftMessageId: string;
  channelId: string;
  conversationId?: string;
  files: UploadFileInput[];
}

export const attachmentsOperations = {
  /** Maps to: POST /api/sdk/attachments */
  upload: api<UploadAttachmentsInput, AttachmentUploadResponse>(
    'POST',
    '/api/sdk/attachments',
    {
      mapArgs: (args) => {
        const form = new FormData();
        form.append('entityId', args.entityId);
        form.append('entityType', args.entityType);
        appendFiles(form, args.files);
        return form;
      },
    }
  ),

  /** Maps to: POST /api/sdk/draft-attachments */
  uploadDraft: api<UploadDraftAttachmentsInput, DraftAttachmentUploadResponse>(
    'POST',
    '/api/sdk/draft-attachments',
    {
      mapArgs: (args) => {
        const form = new FormData();
        form.append('attachmentIds', JSON.stringify(args.attachmentIds));
        form.append('draftMessageId', args.draftMessageId);
        form.append('channelId', args.channelId);
        appendOptional(form, 'conversationId', args.conversationId);
        appendFiles(form, args.files, { includeThumbnails: true });
        return form;
      },
    }
  ),
} as const;
