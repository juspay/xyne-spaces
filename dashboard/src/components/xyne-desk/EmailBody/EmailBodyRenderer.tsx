import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify';
import { Image as ImageIcon } from 'lucide-react';
import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { preprocessEmailHtml } from './preprocessEmailHtml';
import { collapseQuotedHistory } from './collapseQuotedHistory';

interface EmailBodyRendererProps {
  body: string;
  /** Unique key so each email's blocked-images choice is independent */
  emailId?: string;
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
  }
  body { padding: 4px 2px; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
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

const buildIframeSrcdoc = (rawBody: string, showRemoteImages: boolean): BuiltDoc => {
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

  const purifier = buildPurifier();
  const sanitized = purifier.sanitize(htmlInput, { RETURN_DOM_FRAGMENT: false });

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${sanitized}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) {
    return {
      srcdoc: `<!doctype html><html><head><style>${IFRAME_STYLES}</style></head><body>${sanitized}</body></html>`,
      hasBlockedImages: false,
    };
  }

  collapseQuotedHistory(root, doc);
  wrapQuotesInDetails(doc);

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

export const EmailBodyRenderer = ({ body, emailId }: EmailBodyRendererProps): JSX.Element => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(24);
  const [showRemoteImages, setShowRemoteImages] = useState<boolean>(false);

  useEffect(() => {
    setShowRemoteImages(false);
  }, [emailId]);

  const { srcdoc, hasBlockedImages } = useMemo(
    () => buildIframeSrcdoc(body, showRemoteImages),
    [body, showRemoteImages],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const measure = (): void => {
      const docEl = iframe.contentDocument?.documentElement;
      if (!docEl) return;
      const next = Math.max(docEl.scrollHeight, docEl.offsetHeight);
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

      if (typeof ResizeObserver !== 'undefined' && contentDoc.documentElement) {
        resizeObserver = new ResizeObserver(() => measure());
        resizeObserver.observe(contentDoc.documentElement);
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
  }, [srcdoc]);

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
        className='w-full block border-0 bg-white rounded-md'
        style={{ height: `${height}px` }}
      />
    </div>
  );
};
