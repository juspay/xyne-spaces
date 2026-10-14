import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import { API_BASE_URL } from '@/src/config';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { mtlsFetch } from '@/src/utils/mtlsHttpClient';
import { mtlsMultipartUpload } from '@/src/utils/mtlsFileUpload';

import {
  getEmailAttachmentUploadPath,
  parseEmailAttachmentUploadBody,
  parseEmailAttachmentUploadError,
  requireCompleteEmailAttachmentUpload,
} from './mailbox-reply.attachments';

export async function deleteMailboxEmailAttachment(attachmentId: string): Promise<void> {
  const normalizedId = attachmentId.trim();
  if (!normalizedId) return;

  const headers = await buildAuthenticatedHeaders();
  const response = await mtlsFetch(
    `${API_BASE_URL}/attachments/${encodeURIComponent(normalizedId)}`,
    {
      method: 'DELETE',
      headers,
    },
  );

  if (response.statusCode >= 200 && response.statusCode < 300) return;
  if (response.statusCode === 404) return;

  throw new Error('Unable to remove attachment.');
}

export async function uploadMailboxEmailAttachments(params: {
  files: readonly Pick<ComposerAttachment, 'localUri' | 'originalFilename' | 'mimetype'>[];
  composerMode: 'reply' | 'compose';
  conversationId?: string | null | undefined;
  channelId?: string | null | undefined;
}): Promise<string[]> {
  if (params.files.length === 0) return [];

  const path = getEmailAttachmentUploadPath(params);
  const headers = await buildAuthenticatedHeaders();
  const response = await mtlsMultipartUpload({
    url: `${API_BASE_URL}${path}`,
    files: params.files.map(file => ({
      uri: file.localUri,
      name: file.originalFilename,
      type: file.mimetype,
    })),
    headers,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(parseEmailAttachmentUploadError(response.statusCode, response.body));
  }

  return requireCompleteEmailAttachmentUpload(
    params.files.length,
    parseEmailAttachmentUploadBody(response.body),
  );
}
