import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify';
import { Image as ImageIcon } from 'lucide-react';
import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  attachmentViewerActor,
  type AttachmentRef,
} from '../../../machines/attachmentViewerMachine';
import { preprocessEmailHtml } from './preprocessEmailHtml';
import { collapseQuotedHistory } from './collapseQuotedHistory';
import { useCidImageResolver } from './useCidImageResolver';

interface EmailBodyRendererProps {
  body: string;
  /** Unique key so each email's blocked-images choice is independent */
  emailId?: string;
  /** Email attachments (loaded via Zero relation) — used to resolve cid: refs */
  /** Called when a mailto link inside the email body is clicked */
  onMailtoClick?: ((email: string) => void) | undefined;
  /** Scroll the parent container to the bottom after the iframe loads. Only true for the latest email. */
  autoScroll?: boolean;
  attachments?: ReadonlyArray<{
    id: string;
    metadata?: unknown;
    mimetype?: string | null;
    originalFilename?: string | null;
    size?: number | null;
  }>;
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

const buildPurifier = (): DOMPurifyInstance => {
  const purifier = DOMPurify();
  purifier.setConfig({
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'meta', 'link', 'base'],
    FORBID_ATTR: ['srcset'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    WHOLE_DOCUMENT: false,
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['target'],
  });
  purifier.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return purifier;
};

let emailBodyPurifier: DOMPurifyInstance | undefined;

const getEmailBodyPurifier = (): DOMPurifyInstance => {
  emailBodyPurifier ??= buildPurifier();
  return emailBodyPurifier;
};

const isRemoteUrl = (value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.startsWith('cid:')) return false;
  if (trimmed.startsWith('data:')) return false;
  return (
    trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')
  );
};

const blockRemoteImages = (root: HTMLElement): number => {
  const images = root.querySelectorAll('img[src]');
  let blockedCount = 0;
  images.forEach(img => {
    const src = img.getAttribute('src') || '';
    if (isRemoteUrl(src)) {
      img.setAttribute('data-blocked-src', src);
      img.setAttribute('src', TRANSPARENT_PIXEL);
      img.setAttribute('data-xd-blocked', 'true');
      blockedCount += 1;
    }
  });
  const elementsWithBg = root.querySelectorAll('[style*="background"]');
  elementsWithBg.forEach(el => {
    const style = el.getAttribute('style') || '';
    const urlMatch = style.match(/url\((['"]?)([^'")]+)\1\)/i);
    if (urlMatch && urlMatch[2] && isRemoteUrl(urlMatch[2])) {
      const cleaned = style.replace(/background(-image)?\s*:\s*url\([^)]+\)\s*;?/gi, '');
      el.setAttribute('style', cleaned);
    }
  });
  return blockedCount;
};

const IFRAME_STYLES = `
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #202124;
    background: #ffffff;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    overflow-y: hidden;
  }
  html {
    overflow-x: auto;
    overscroll-behavior: contain;
  }
  body { padding: 4px 2px; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre, code { overflow-wrap: anywhere; word-wrap: break-word; white-space: pre-wrap; }
  td, th { overflow-wrap: normal; word-wrap: normal; }
  ::-webkit-scrollbar { height: 8px; width: 8px; }
  ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.35); }
  ::-webkit-scrollbar-track { background: transparent; }
  a { color: #1a73e8; }
  blockquote {
    border-left: 3px solid #dadce0;
    margin: 8px 0;
    padding: 0 12px;
    color: #5f6368;
  }
  .xd-quoted-history {
    margin: 8px 0;
    padding: 0;
    border-left: 3px solid #dadce0;
  }
  details.xd-quote-details > summary {
    cursor: pointer;
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    margin: 4px 0;
    background: #f1f3f4;
    border-radius: 10px;
    font-size: 12px;
    color: #5f6368;
    user-select: none;
  }
  details.xd-quote-details > summary::-webkit-details-marker { display: none; }
  details.xd-quote-details > summary::before {
    content: '⋯';
    font-weight: 700;
    letter-spacing: 1px;
  }
  details.xd-quote-details > summary:hover { background: #e8eaed; }
  details.xd-quote-details[open] > summary::before { content: '⋮'; }
  details.xd-quote-details > .xd-quote-body {
    padding: 8px 12px;
    color: #5f6368;
  }
  a.email-recipient-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    vertical-align: baseline;
    margin: 0 2px;
    padding: 2px 6px 2px 2px;
    border-radius: 6px;
    background: #f1f3f4;
    color: #202124;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    white-space: nowrap;
    text-decoration: none !important;
    cursor: pointer;
    user-select: none;
  }
  a.email-recipient-pill:hover {
    background: #e8eaed;
    color: #202124;
  }
  a.email-recipient-pill .email-recipient-pill-initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 4px;
    background: #dadce0;
    font-size: 10px;
    font-weight: 500;
    color: #5f6368;
  }
  a.email-recipient-pill .email-recipient-pill-label {
    line-height: 20px;
  }
`;

const wrapQuotesInDetails = (doc: Document): void => {
  const wrappers = doc.querySelectorAll('.xd-quoted-history[data-xd-quote="true"]');
  wrappers.forEach(wrapper => {
    if (wrapper.getAttribute('data-xd-wrapped') === 'true') return;
    const details = doc.createElement('details');
    details.className = 'xd-quote-details';
    const summary = doc.createElement('summary');
    summary.textContent = '';
    summary.setAttribute('aria-label', 'Show trimmed content');
    const body = doc.createElement('div');
    body.className = 'xd-quote-body';
    while (wrapper.firstChild) {
      body.appendChild(wrapper.firstChild);
    }
    details.appendChild(summary);
    details.appendChild(body);
    wrapper.appendChild(details);
    wrapper.setAttribute('data-xd-wrapped', 'true');
  });
};

interface RecipientPillData {
  email: string;
  name: string;
  userId?: string;
  picture?: string;
}

const parseMailtoEmail = (href: string): string | null => {
  if (!href.toLowerCase().startsWith('mailto:')) return null;
  let remainder = href.slice(7);
  const queryIdx = remainder.indexOf('?');
  if (queryIdx >= 0) remainder = remainder.slice(0, queryIdx);
  const angleMatch = remainder.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1]) return angleMatch[1].trim();
  return remainder.trim() || null;
};

const extractMentionName = (text: string, fallbackEmail?: string): string => {
  const trimmed = text.trim();
  if (trimmed.startsWith('+')) {
    const name = trimmed.slice(1).trim();
    if (name) return name;
  }
  if (trimmed) return trimmed;
  if (fallbackEmail) {
    const local = fallbackEmail.split('@')[0]?.trim();
    if (local) return local;
  }
  return fallbackEmail || 'Recipient';
};

const isIngestedMentionAnchor = (anchor: Element): boolean => {
  if (anchor.hasAttribute('data-recipient-pill')) return false;
  if (anchor.classList.contains('email-recipient-pill')) return false;
  const href = anchor.getAttribute('href') || '';
  if (!parseMailtoEmail(href)) return false;
  return (anchor.textContent || '').trim().startsWith('+');
};

const isRecipientMentionLink = (anchor: Element): boolean =>
  anchor.hasAttribute('data-recipient-pill') || anchor.classList.contains('email-recipient-pill');

const buildRecipientPillAnchor = (doc: Document, data: RecipientPillData): HTMLAnchorElement => {
  const anchor = doc.createElement('a');
  anchor.href = `mailto:${data.email}`;
  anchor.className = 'email-recipient-pill';
  anchor.setAttribute('data-recipient-pill', '');
  anchor.setAttribute('data-recipient-email', data.email);
  anchor.setAttribute('data-recipient-name', data.name);
  if (data.userId) anchor.setAttribute('data-user-id', data.userId);
  if (data.picture) anchor.setAttribute('data-user-picture', data.picture);

  const initial = doc.createElement('span');
  initial.className = 'email-recipient-pill-initial';
  initial.textContent = (data.name.charAt(0) || data.email.charAt(0) || '?').toUpperCase();

  const label = doc.createElement('span');
  label.className = 'email-recipient-pill-label';
  label.textContent = `+${data.name}`;

  anchor.appendChild(initial);
  anchor.appendChild(label);
  return anchor;
};

const replaceWithRecipientPill = (
  element: Element,
  doc: Document,
  data: RecipientPillData,
): void => {
  const anchor = buildRecipientPillAnchor(doc, data);
  element.parentNode?.replaceChild(anchor, element);
};

/** Unify platform pills and ingested Gmail / third-party mention mailto links. */
const normalizeRecipientMentions = (root: HTMLElement, doc: Document): void => {
  root.querySelectorAll('span[data-recipient-pill]').forEach(pill => {
    const email = pill.getAttribute('data-recipient-email');
    if (!email) return;
    const name =
      pill.getAttribute('data-recipient-name') || extractMentionName(pill.textContent || '', email);
    const pillData: RecipientPillData = { email, name };
    const userId = pill.getAttribute('data-user-id');
    const picture = pill.getAttribute('data-user-picture');
    if (userId) pillData.userId = userId;
    if (picture) pillData.picture = picture;
    replaceWithRecipientPill(pill, doc, pillData);
  });

  const ingestedMentions: Element[] = [];
  root.querySelectorAll('a[href]').forEach(anchor => {
    if (isIngestedMentionAnchor(anchor)) ingestedMentions.push(anchor);
  });
  ingestedMentions.forEach(chip => {
    const href = chip.getAttribute('href') || '';
    const email = parseMailtoEmail(href);
    if (!email) return;
    const name =
      chip.getAttribute('data-recipient-name') || extractMentionName(chip.textContent || '', email);
    replaceWithRecipientPill(chip, doc, { email, name });
  });
};

const looksLikeHtml = (value: string): boolean => /<\/?[a-z][\s\S]*>/i.test(value);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface BuiltDoc {
  srcdoc: string;
  hasBlockedImages: boolean;
}

const buildIframeSrcdoc = (
  rawBody: string,
  showRemoteImages: boolean,
  rewriteCidRefs: (html: string) => string,
): BuiltDoc => {
  if (!rawBody || !rawBody.trim()) {
    return {
      srcdoc: `<!doctype html><html><head><style>${IFRAME_STYLES}</style></head><body><p style="color:#5f6368;font-style:italic;">No content</p></body></html>`,
      hasBlockedImages: false,
    };
  }

  const preprocessed = preprocessEmailHtml(rawBody);
  const htmlInput = looksLikeHtml(preprocessed)
    ? preprocessed
    : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(preprocessed)}</pre>`;

  const purifier = getEmailBodyPurifier();
  const sanitized = purifier.sanitize(htmlInput, { RETURN_DOM_FRAGMENT: false });
  const cidResolved = rewriteCidRefs(sanitized);

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${cidResolved}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) {
    return {
      srcdoc: `<!doctype html><html><head><style>${IFRAME_STYLES}</style></head><body>${cidResolved}</body></html>`,
      hasBlockedImages: false,
    };
  }

  collapseQuotedHistory(root, doc);
  wrapQuotesInDetails(doc);
  normalizeRecipientMentions(root, doc);

  let blockedCount = 0;
  if (!showRemoteImages) {
    blockedCount = blockRemoteImages(root);
  }

  const finalBody = root.innerHTML;
  const srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<base target="_blank">
<style>${IFRAME_STYLES}</style>
</head>
<body>${finalBody}</body>
</html>`;

  return { srcdoc, hasBlockedImages: blockedCount > 0 };
};

export const EmailBodyRenderer = ({
  body,
  emailId,
  attachments,
  onMailtoClick,
  autoScroll = false,
}: EmailBodyRendererProps): JSX.Element => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onMailtoClickRef = useRef(onMailtoClick);
  onMailtoClickRef.current = onMailtoClick;
  const [height, setHeight] = useState<number>(24);
  const [showRemoteImages, setShowRemoteImages] = useState<boolean>(false);
  const quoteOpenRef = useRef(false);

  useEffect(() => {
    setShowRemoteImages(false);
    quoteOpenRef.current = false;
  }, [emailId]);

  const { rewrite: rewriteCidRefs, blobUrlToAttachmentId } = useCidImageResolver(attachments, body);

  // Refs so the iframe's event handler always sees the latest values without
  // needing to re-register on every render.
  const blobUrlToAttIdRef = useRef<Map<string, string>>(new Map());
  blobUrlToAttIdRef.current = blobUrlToAttachmentId;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const { srcdoc, hasBlockedImages } = useMemo(
    () => buildIframeSrcdoc(body, showRemoteImages, rewriteCidRefs),
    [body, showRemoteImages, rewriteCidRefs],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const measure = (): void => {
      const body = iframe.contentDocument?.body;
      if (!body) return;
      let next = body.scrollHeight;
      // When body content is wider than the viewport, html shows our 8px
      // horizontal scrollbar. Without compensating here, body overflows the
      // shortened viewport by 8px and a phantom vertical scrollbar appears.
      if (body.scrollWidth > body.clientWidth) next += 8;
      if (next > 0) setHeight(next);
    };

    const handleLoad = (): void => {
      measure();
      const contentDoc = iframe.contentDocument;
      if (!contentDoc) return;

      contentDoc.querySelectorAll('img').forEach(img => {
        img.addEventListener('load', measure);
        img.addEventListener('error', measure);
      });

      const quoteDetails = contentDoc.querySelector<HTMLDetailsElement>('details.xd-quote-details');
      if (quoteDetails) {
        quoteDetails.open = quoteOpenRef.current;
        quoteDetails.addEventListener('toggle', () => {
          quoteOpenRef.current = quoteDetails.open;
        });
      }

      // Capture-phase image click handler — registered before the anchor handler
      // below so it intercepts first. Uses refs for latest blobUrl→attachmentId
      // and attachment metadata without needing to re-register on every render.
      contentDoc.addEventListener(
        'click',
        e => {
          const img = (e.target as HTMLElement | null)?.closest?.('img');
          if (!img) return;
          e.preventDefault();
          const src = img.getAttribute('src');
          if (
            !src ||
            src === TRANSPARENT_PIXEL ||
            img.getAttribute('data-xd-blocked') ||
            src.startsWith('cid:')
          )
            return;
          e.stopPropagation();

          const blobMap = blobUrlToAttIdRef.current;
          const atts = attachmentsRef.current;
          const clickedAttId = blobMap.get(src);
          if (!clickedAttId || !atts) return;

          // Build gallery in attachments order (not blobMap insertion order which
          // is async blob-fetch completion order). Track startIndex as we go.
          const inlineAttIds = new Set(blobMap.values());
          const inlineRefs: AttachmentRef[] = [];
          let startIndex = 0;
          for (const att of atts) {
            if (!inlineAttIds.has(att.id)) continue;
            if (att.id === clickedAttId) startIndex = inlineRefs.length;
            inlineRefs.push({
              attachmentId: att.id,
              fileName: att.originalFilename ?? 'image',
              fileUrl: `/attachments/${att.id}/download`,
              mimeType: att.mimetype ?? 'image/jpeg',
              fileSize: att.size ?? 0,
            });
          }

          attachmentViewerActor.send({ type: 'OPEN', attachments: inlineRefs, startIndex });
        },
        true,
      );

      const findScrollContainer = (el: HTMLElement): HTMLElement | Window => {
        let cur: HTMLElement | null = el.parentElement;
        while (cur) {
          const style = window.getComputedStyle(cur);
          const overflowY = style.overflowY;
          if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            cur.scrollHeight > cur.clientHeight
          ) {
            return cur;
          }
          cur = cur.parentElement;
        }
        return window;
      };

      if (autoScroll) {
        requestAnimationFrame(() => {
          const container = findScrollContainer(iframe);
          if (container instanceof HTMLElement) {
            const nearBottom =
              container.scrollHeight - container.scrollTop - container.clientHeight < 300;
            if (container.scrollTop === 0 || nearBottom) {
              container.scrollTop = container.scrollHeight;
            }
          }
        });
      }

      const hasNestedScrollable = (el: HTMLElement, deltaY: number): boolean => {
        for (let cur: HTMLElement | null = el; cur; cur = cur.parentElement) {
          const overflowY = contentDoc.defaultView?.getComputedStyle(cur).overflowY;
          if (
            (overflowY !== 'auto' && overflowY !== 'scroll') ||
            cur.scrollHeight <= cur.clientHeight
          )
            continue;
          const atTop = cur.scrollTop <= 0;
          const atBottom = cur.scrollTop + cur.clientHeight >= cur.scrollHeight - 1;
          if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
        }
        return false;
      };

      contentDoc.addEventListener(
        'wheel',
        e => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          const target = e.target as HTMLElement | null;
          if (target && hasNestedScrollable(target, e.deltaY)) return;

          const container = findScrollContainer(iframe);
          container.scrollBy({ top: e.deltaY, left: 0 });
          e.preventDefault();
        },
        { passive: false },
      );

      contentDoc.addEventListener(
        'click',
        e => {
          const anchor = (e.target as HTMLElement | null)?.closest?.('a');
          if (!anchor) return;
          const href = anchor.getAttribute('href');
          if (!href) return;
          e.preventDefault();
          e.stopPropagation();
          const mailtoEmail = parseMailtoEmail(href);
          if (mailtoEmail && isRecipientMentionLink(anchor)) {
            const onMentionClick = onMailtoClickRef.current;
            if (onMentionClick) {
              onMentionClick(mailtoEmail);
              return;
            }
          }
          const text = (anchor.textContent || '').trim();
          const isCopyLink = anchor.getAttribute('data-action') === 'copy-link' || text === href;
          if (isCopyLink) {
            navigator.clipboard
              .writeText(href)
              .then(() => toast.success('Link copied to clipboard'))
              .catch(() => toast.error('Failed to copy link'));
            return;
          }
          window.open(href, '_blank', 'noopener,noreferrer');
        },
        true,
      );

      if (typeof ResizeObserver !== 'undefined' && contentDoc.body) {
        resizeObserver = new ResizeObserver(() => measure());
        resizeObserver.observe(contentDoc.body);
      }

      mutationObserver = new MutationObserver(() => measure());
      mutationObserver.observe(contentDoc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open'],
      });
    };

    iframe.addEventListener('load', handleLoad);
    return (): void => {
      iframe.removeEventListener('load', handleLoad);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [srcdoc, autoScroll]);

  return (
    <div className='w-full'>
      {hasBlockedImages && !showRemoteImages && (
        <div className='mb-3 flex items-center gap-2 text-xs text-muted-foreground'>
          <ImageIcon size={14} className='shrink-0' />
          <span>Images are blocked.</span>
          <button
            type='button'
            onClick={() => setShowRemoteImages(true)}
            className='text-primary hover:underline font-medium cursor-pointer'
            data-track-category='Support'
            data-track-name='ShowEmailImages'
            data-track-metadata={JSON.stringify({ emailId })}
          >
            Show images
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title='Email body'
        srcDoc={srcdoc}
        sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
        referrerPolicy='no-referrer'
        className='w-full block border-0 rounded-md'
        style={{ height: `${height}px` }}
      />
    </div>
  );
};
