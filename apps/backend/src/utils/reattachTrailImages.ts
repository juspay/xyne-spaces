import { storageService } from '@/services/storage/index';
import { logger } from '@/utils/logger';
import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';

interface PriorAttachmentRow {
  id: string;
  url: string;
  originalFilename: string;
  mimetype: string;
  metadata: unknown;
}

/** Pull every `cid:<value>` referenced inside `<img>` tags in the body. */
const collectCidsFromImgTags = (body: string): Set<string> => {
  const cids = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(body)) !== null) {
    const srcMatch = /src=["']cid:([^"'\s>]+)["']/i.exec(match[0]);
    if (srcMatch?.[1]) cids.add(srcMatch[1].trim());
  }
  return cids;
};

export const reattachTrailImages = async (params: {
  body: string;
  excludeCids: Iterable<string>;
  priorAttachments: PriorAttachmentRow[];
}): Promise<OutgoingAttachment[]> => {
  const { body, excludeCids, priorAttachments } = params;

  const wantedCids = collectCidsFromImgTags(body);
  const skip = new Set(excludeCids);
  for (const cid of skip) wantedCids.delete(cid);
  if (wantedCids.size === 0) return [];

  const cidToRow = new Map<string, PriorAttachmentRow>();
  for (const row of priorAttachments) {
    const meta = row.metadata as { contentId?: string } | null | undefined;
    if (meta?.contentId && wantedCids.has(meta.contentId) && !cidToRow.has(meta.contentId)) {
      cidToRow.set(meta.contentId, row);
    }
  }

  if (cidToRow.size === 0) return [];

  const fetched = await Promise.allSettled(
    [...cidToRow.entries()].map(async ([cid, row]) => {
      const content = await storageService.getFileBuffer(row.url);
      return {
        name: row.originalFilename,
        contentType: row.mimetype,
        content,
        cid,
        isInline: true,
      } satisfies OutgoingAttachment;
    }),
  );

  const out: OutgoingAttachment[] = [];
  fetched.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      out.push(res.value);
    } else {
      const cid = [...cidToRow.keys()][i];
      logger.warn(
        `[reattachTrailImages] failed to load prior attachment for cid=${cid}: ${res.reason instanceof Error ? res.reason.message : 'unknown'}`,
      );
    }
  });
  return out;
};
