import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';

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

/** Pull every `data-att-id` value out of the body's `<img>` tags. */
const extractInlineIdsFromBody = (body: string): Set<string> => {
  const ids = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(body)) !== null) {
    const idMatch = /data-att-id="([^"]+)"/i.exec(match[0]);
    if (idMatch) ids.add(idMatch[1]);
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
    const idMatch = tag.match(/data-att-id="([^"]+)"/i);
    if (!idMatch) return tag;
    const id = idMatch[1];
    if (!inlineSet.has(id)) return tag;
    const cid = cidFor(id);
    let next = tag.replace(/\ssrc="[^"]*"/i, ` src="cid:${cid}"`);
    if (!/\ssrc="/i.test(next)) {
      next = next.replace(/>$/, ` src="cid:${cid}">`);
    }
    return next;
  });

  return { body: rewrittenBody, attachments, inlineCidByAttachmentId };
};
