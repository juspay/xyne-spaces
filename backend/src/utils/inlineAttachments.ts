import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';
import { logger } from '@/utils/logger';

interface PreparedAttachment {
  name: string;
  contentType: string;
  content: Buffer | string;
  attachmentId?: string;
}

interface ApplyInlineResult {
  body: string;
  attachments: OutgoingAttachment[];
  inlineCidByAttachmentId: Map<string, string>;
}

const cidFor = (attachmentId: string): string => `inline-${attachmentId}`;

/** Attachment id for an `<img>` tag: `data-att-id`, or recovered from its `/attachments/<id>/download` src. */
const extractAttachmentIdFromImgTag = (tag: string): string | null => {
  const dataAttMatch = /data-att-id="([^"]+)"/i.exec(tag);
  if (dataAttMatch) return dataAttMatch[1];
  const srcMatch = /\ssrc="[^"]*\/attachments\/([^/"]+)\/download[^"]*"/i.exec(tag);
  return srcMatch ? srcMatch[1] : null;
};

/** Pull every attachment id out of the body's `<img>` tags. */
const extractInlineIdsFromBody = (body: string): Set<string> => {
  const ids = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(body)) !== null) {
    const id = extractAttachmentIdFromImgTag(match[0]);
    if (id) ids.add(id);
  }
  return ids;
};

export const applyInlineAttachments = (
  body: string,
  preparedAttachments: PreparedAttachment[],
): ApplyInlineResult => {
  const inlineSet = extractInlineIdsFromBody(body);
  const inlineCidByAttachmentId = new Map<string, string>();

  const attachments: OutgoingAttachment[] = preparedAttachments.map(att => {
    if (att.attachmentId && inlineSet.has(att.attachmentId)) {
      const cid = cidFor(att.attachmentId);
      inlineCidByAttachmentId.set(att.attachmentId, cid);
      return {
        name: att.name,
        contentType: att.contentType,
        content: att.content,
        cid,
        isInline: true,
      };
    }
    return { name: att.name, contentType: att.contentType, content: att.content };
  });

  const rewrittenBody = body.replace(/<img\b[^>]*>/gi, tag => {
    const id = extractAttachmentIdFromImgTag(tag);
    if (!id) return tag;
    // inlineSet is derived from this body, so it can't tell a matched id from an unmatched one.
    const cid = inlineCidByAttachmentId.get(id);
    if (!cid) {
      logger.warn(`[inlineAttachments] no prepared attachment for data-att-id=${id}; leaving src unchanged`);
      return tag;
    }
    let next = tag.replace(/\ssrc="[^"]*"/i, ` src="cid:${cid}"`);
    if (!/\ssrc="/i.test(next)) {
      next = next.replace(/>$/, ` src="cid:${cid}">`);
    }
    return next;
  });

  return { body: rewrittenBody, attachments, inlineCidByAttachmentId };
};