import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';

export const MAX_EMAIL_ATTACHMENT_FILES = 10;
export const MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type MailboxEmailAttachmentStatus = 'uploading' | 'uploaded' | 'failed';

export type MailboxEmailAttachment = {
  clientId: string;
  serverId: string | null;
  originalFilename: string;
  mimetype: string;
  size: number;
  localUri: string;
  status: MailboxEmailAttachmentStatus;
  error?: string;
};

export type EmailAttachmentSelection = {
  accepted: ComposerAttachment[];
  skippedTooLarge: string[];
  droppedForCount: number;
};

export type EmailAttachmentUploadResult = {
  attachmentIds: string[];
  failures: Array<{ filename: string; error: string }>;
};

export function getEmailAttachmentUploadPath(params: {
  composerMode: 'reply' | 'compose';
  conversationId?: string | null | undefined;
  channelId?: string | null | undefined;
}): string {
  if (params.composerMode === 'compose') {
    const channelId = params.channelId?.trim() ?? '';
    if (!channelId) {
      throw new Error('Desk is still loading.');
    }
    return `/email/channels/${encodeURIComponent(channelId)}/upload-attachments`;
  }

  const conversationId = params.conversationId?.trim() ?? '';
  if (!conversationId) {
    throw new Error('Reply details are still loading.');
  }
  return `/email/${encodeURIComponent(conversationId)}/upload-attachments`;
}

export function selectEmailAttachments(
  existingCount: number,
  picked: readonly ComposerAttachment[],
): EmailAttachmentSelection {
  const skippedTooLarge: string[] = [];
  const underSize = picked.filter(file => {
    if (file.size > MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES) {
      skippedTooLarge.push(file.originalFilename);
      return false;
    }
    return true;
  });

  const availableSlots = Math.max(0, MAX_EMAIL_ATTACHMENT_FILES - existingCount);
  const accepted = underSize.slice(0, availableSlots);
  const droppedForCount = underSize.length - accepted.length;

  return { accepted, skippedTooLarge, droppedForCount };
}

export function describeEmailAttachmentSelection(
  selection: EmailAttachmentSelection,
): string | null {
  const parts: string[] = [];

  if (selection.skippedTooLarge.length > 0) {
    const count = selection.skippedTooLarge.length;
    parts.push(
      `Skipped ${count} file${count > 1 ? 's' : ''} over ${MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES / (1024 * 1024)}MB: ${selection.skippedTooLarge.join(', ')}`,
    );
  }

  if (selection.droppedForCount > 0) {
    parts.push(
      `You can attach at most ${MAX_EMAIL_ATTACHMENT_FILES} files per email. Dropped ${selection.droppedForCount}.`,
    );
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

export function mailboxAttachmentFromPicked(picked: ComposerAttachment): MailboxEmailAttachment {
  return {
    clientId: picked.attachmentId,
    serverId: null,
    originalFilename: picked.originalFilename,
    mimetype: picked.mimetype,
    size: picked.size,
    localUri: picked.localUri,
    status: 'uploading',
  };
}

export function uploadedMailboxAttachmentIds(
  attachments: readonly MailboxEmailAttachment[],
): string[] {
  return attachments
    .filter(
      (attachment): attachment is MailboxEmailAttachment & { serverId: string } =>
        attachment.status === 'uploaded' && Boolean(attachment.serverId),
    )
    .map(attachment => attachment.serverId);
}

export function parseEmailAttachmentUploadBody(body: string): EmailAttachmentUploadResult {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { attachmentIds: [], failures: [] };
    }

    const record = parsed as Record<string, unknown>;
    const attachmentIds = Array.isArray(record['attachmentIds'])
      ? record['attachmentIds'].filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : [];
    const failures = Array.isArray(record['failures'])
      ? record['failures'].flatMap(item => {
          if (!item || typeof item !== 'object') return [];
          const failure = item as Record<string, unknown>;
          const filename = typeof failure['filename'] === 'string' ? failure['filename'] : '';
          const error = typeof failure['error'] === 'string' ? failure['error'] : '';
          if (!filename && !error) return [];
          return [{ filename: filename || 'file', error: error || 'Upload failed' }];
        })
      : [];

    return { attachmentIds, failures };
  } catch {
    return { attachmentIds: [], failures: [] };
  }
}

export function requireCompleteEmailAttachmentUpload(
  fileCount: number,
  result: EmailAttachmentUploadResult,
): string[] {
  if (result.failures.length > 0) {
    throw new Error(
      result.failures.map(failure => `${failure.filename}: ${failure.error}`).join('; '),
    );
  }

  if (result.attachmentIds.length !== fileCount) {
    throw new Error(
      `Attachment upload incomplete: expected ${fileCount}, got ${result.attachmentIds.length}`,
    );
  }

  return result.attachmentIds;
}

export function parseEmailAttachmentUploadError(statusCode: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (typeof record['message'] === 'string' && record['message'].trim()) {
        return record['message'];
      }
      if (typeof record['error'] === 'string' && record['error'].trim()) {
        return record['error'];
      }
    }
  } catch {
    // Fall through to status-based messages.
  }

  if (statusCode === 401) return 'You need to sign in again before attaching files.';
  if (statusCode === 403) return 'You do not have access to attach files in this desk.';
  if (statusCode === 404) return 'This email thread is no longer available.';
  return 'Unable to upload attachments.';
}
