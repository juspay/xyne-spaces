import { useEffect, useMemo, useState } from 'react';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';

/**
 * Resolves `cid:<contentId>` references in an email body to authenticated
 * blob object URLs.
 *
 * Caller passes the email's attachment rows (already loaded via the
 * `email.attachments` Zero relation). Each inline image's `metadata.contentId`
 * is mapped to its row id; the bytes are fetched via the auth-aware blob
 * pipeline. Unresolved `cid:` refs render an inline-SVG placeholder so
 * recipients never see the browser's broken-image icon.
 */
export const useCidImageResolver = (
  attachments?: ReadonlyArray<{ id: string; metadata?: unknown }>,
): {
  rewrite: (html: string) => string;
  blobUrlToAttachmentId: Map<string, string>;
} => {
  // Map contentId → MessageAttachment.id (pure derivation, no effects).
  const cidToAttachmentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of attachments ?? []) {
      const meta = a.metadata as { contentId?: string } | null | undefined;
      if (meta?.contentId) map.set(meta.contentId, a.id);
    }
    return map;
  }, [attachments]);

  // Fetch each cid's blob once and stash a stable object URL.
  const [cidToBlobUrl, setCidToBlobUrl] = useState<Record<string, string>>({});
  useEffect(() => {
    if (cidToAttachmentId.size === 0) {
      setCidToBlobUrl({});
      return undefined;
    }
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const [cid, attId] of cidToAttachmentId) {
        try {
          const blob = await createPreviewUrl(attId);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          next[cid] = url;
        } catch {
          /* skip — rewrite will use the placeholder */
        }
      }
      if (!cancelled) setCidToBlobUrl(next);
    })();
    return () => {
      cancelled = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [cidToAttachmentId]);

  const rewrite = useMemo(() => {
    return (html: string): string => {
      if (!html) return html;
      return html.replace(/cid:([^\s"'>]+)/gi, (_match, rawCid: string) => {
        const cid = rawCid.trim();
        return cidToBlobUrl[cid] ?? CID_PLACEHOLDER;
      });
    };
  }, [cidToBlobUrl]);

  // Reverse map: blobUrl → attachmentId (for click-to-open via the viewer actor)
  const blobUrlToAttachmentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [cid, blobUrl] of Object.entries(cidToBlobUrl)) {
      const attId = cidToAttachmentId.get(cid);
      if (attId) map.set(blobUrl, attId);
    }
    return map;
  }, [cidToBlobUrl, cidToAttachmentId]);

  return { rewrite, blobUrlToAttachmentId };
};

/** Inline SVG — a muted square with a small image glyph. Data-URL so it
 *  works inside the sandboxed iframe with no network access required. */
const CID_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9aa3ab" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.2"/><path d="M21 15l-5-5L5 21"/></svg>`,
  );
