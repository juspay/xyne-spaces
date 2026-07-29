import { apiInstance } from '../../../services/clients/apiClient';

export interface ComposerUploadResult {
  attachmentIds: string[];
  failures?: Array<{ filename: string; error: string }>;
}

export async function uploadComposerAttachments(params: {
  files: File[];
  conversationId?: string | null;
  channelId?: string | null;
  mode?: 'reply' | 'compose';
}): Promise<ComposerUploadResult> {
  const { files, conversationId, channelId, mode = 'reply' } = params;
  if (files.length === 0) return { attachmentIds: [] };

  const url =
    mode === 'compose'
      ? `/email/channels/${channelId}/upload-attachments`
      : `/email/${conversationId}/upload-attachments`;

  const formData = new FormData();
  files.forEach(file => formData.append('files', file));

  const res = await apiInstance.post<ComposerUploadResult>(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data ?? { attachmentIds: [] };
}
