import axios from 'axios';
import { logger } from './logger';
import { API_BASE_URL } from '../config';

// Sandboxed iframes without `allow-same-origin` run from an opaque origin:
// their subresource loads carry no cookies, so an <img> pointing at an
// authenticated endpoint (e.g. /api/users/:id/picture) both renders broken
// AND returns a 401 that the Electron main-process interceptor treats as
// "session expired" — wiping cookies and logging the user out (XYNE phantom
// logout). This module rewrites those images to data: URIs, fetched with
// credentials from the parent context, BEFORE the HTML enters the iframe.

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const MAX_IMAGES = 50;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const authenticatedOrigins = (): Set<string> => {
  const origins = new Set<string>([window.location.origin]);
  try {
    origins.add(new URL(API_BASE_URL, window.location.origin).origin);
  } catch {
    // API_BASE_URL is relative in some lanes — window origin already covers it.
  }
  return origins;
};

const blobToDataUri = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject): void => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as string);
    reader.onerror = (): void => reject(new Error(reader.error?.message ?? 'FileReader failed'));
    reader.readAsDataURL(blob);
  });

export interface InlineImagesResult {
  html: string;
  /** False when no authenticated-origin images were found — callers can keep the original bytes. */
  changed: boolean;
}

/**
 * Rewrites every <img> that points at an authenticated Xyne origin into a
 * data: URI fetched with credentials, so the HTML can be rendered inside an
 * opaque-origin sandboxed iframe without cookieless 401s.
 *
 * @param baseUrl Base used to resolve relative image URLs — pass the URL the
 *   document was served from (defaults to the current page, which is what a
 *   `srcDoc` iframe would resolve against).
 */
export async function inlineAuthenticatedImages(
  html: string,
  baseUrl: string = window.location.href,
): Promise<InlineImagesResult> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const origins = authenticatedOrigins();

  const targets = Array.from(doc.querySelectorAll('img')).filter(img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return false;
    try {
      const resolved = new URL(src, baseUrl);
      return (
        (resolved.protocol === 'https:' || resolved.protocol === 'http:') &&
        origins.has(resolved.origin)
      );
    } catch {
      return false;
    }
  });

  if (targets.length === 0) {
    return { html, changed: false };
  }

  if (targets.length > MAX_IMAGES) {
    logger.warn('iframe_image_inline_capped', {
      total: targets.length,
      cap: MAX_IMAGES,
    });
  }

  await Promise.all(
    targets.slice(0, MAX_IMAGES).map(async img => {
      const src = img.getAttribute('src') ?? '';
      const resolved = new URL(src, baseUrl).toString();
      try {
        const response = await axios.get<Blob>(resolved, {
          responseType: 'blob',
          withCredentials: true,
        });
        const blob = response.data;
        if (blob.size > MAX_IMAGE_BYTES) throw new Error(`too large (${blob.size} bytes)`);
        img.setAttribute('src', await blobToDataUri(blob));
      } catch (error) {
        // Neutralize rather than leave the original src: a cookieless retry
        // from inside the iframe is exactly the request this module exists
        // to prevent.
        img.setAttribute('src', TRANSPARENT_PIXEL);
        logger.warn('iframe_image_inline_failed', {
          imageUrl: resolved,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      img.removeAttribute('crossorigin');
      img.removeAttribute('srcset');
    }),
  );

  // Anything past the cap must not fire cookieless either.
  for (const img of targets.slice(MAX_IMAGES)) {
    img.setAttribute('src', TRANSPARENT_PIXEL);
    img.removeAttribute('crossorigin');
    img.removeAttribute('srcset');
  }

  const doctype = doc.doctype ? '<!DOCTYPE html>' : '';
  return { html: `${doctype}${doc.documentElement.outerHTML}`, changed: true };
}
