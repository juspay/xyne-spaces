import type { NormalizedData } from '@/integrations/core/types';

export type MetaDmAttachment = { type: string; payload?: { url?: string } };

// Attachment types whose payload.url is the file itself. Others (shared posts and links,
// locations, templates) point at web pages or carry no file, so there is nothing to store.
const DOWNLOADABLE_ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file']);

/** Attachments of an Instagram/Messenger DM that core ingestion can download and store. */
export function toDownloadableMetaAttachments(
  attachments: MetaDmAttachment[],
): NonNullable<NormalizedData['attachments']> {
  return attachments.flatMap((attachment, index) => {
    const url = attachment.payload?.url;
    if (!DOWNLOADABLE_ATTACHMENT_TYPES.has(attachment.type) || !url?.startsWith('https://')) {
      return [];
    }
    // Meta sends no file name. Files keep the name from the URL path; media get a generic
    // name with the URL's extension (the download step only infers one for images and documents).
    let urlName = '';
    try {
      urlName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    } catch {
      return [];
    }
    const extension = /\.[a-z0-9]{2,5}$/i.exec(urlName)?.[0] ?? '';
    const fileName =
      attachment.type === 'file' && extension
        ? urlName
        : `${attachment.type}-${index + 1}${extension}`;
    return [{ fileName, fileUrl: url }];
  });
}

/**
 * Body for a DM. A message with no text still needs one: name what was attached, or point the
 * agent at the platform when none of it can be stored.
 */
export function metaDmBody(
  text: string | undefined,
  attachments: MetaDmAttachment[],
  downloadableCount: number,
  platform: string,
): string {
  if (text) return text;
  if (downloadableCount > 0) {
    return `[Attachment: ${attachments.map((attachment) => attachment.type).join(', ')}]`;
  }
  return attachments.length > 0 ? `[Attachment received — open ${platform} to view]` : '';
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Meta's link is the only copy of an attachment until we store the file. When a download failed,
 * append that link to the body so the agent can still open it (it expires on Meta's side).
 */
export function appendFailedAttachmentLinks(
  content: string,
  attachments: NonNullable<NormalizedData['attachments']>,
  storedUrls: Array<string | undefined>,
): string {
  const failed = attachments.filter((attachment) => !storedUrls.includes(attachment.fileUrl));
  if (failed.length === 0) return content;
  const links = failed.map(
    (attachment) =>
      `<a href="${escapeHtml(attachment.fileUrl)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(attachment.fileName)}</a>`,
  );
  return `${content}<br>Could not save ${failed.length === 1 ? 'this attachment' : 'these attachments'}: ${links.join(', ')}`;
}
