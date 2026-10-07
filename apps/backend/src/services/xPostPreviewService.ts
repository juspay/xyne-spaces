import axios from 'axios';
import { parse } from 'node-html-parser';
import { logger } from '@/utils/logger';
import { assertHostIsExternal } from '@/utils/ssrfGuard';

/**
 * X (x.com / twitter.com) post reader.
 *
 * Uses the public, unauthenticated oEmbed endpoint instead of scraping the page:
 * x.com only serves OG tags to crawlers it recognises, so the generic OG scraper
 * gets an empty JS shell. oEmbed returns the author and the full post text with no
 * API key and no login.
 */

const OEMBED_ENDPOINT = 'https://publish.twitter.com/oembed';
const OEMBED_HOST = 'publish.twitter.com';
const OEMBED_TIMEOUT_MS = 5000;

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

export interface XPostRef {
  /** Canonical https://x.com/<user>/status/<id> form. */
  url: string;
  postId: string;
  handle: string;
}

export interface XPostContent {
  author?: string;
  authorUrl?: string;
  text: string;
}

export type XPostFetchResult =
  | { ok: true; post: XPostContent }
  /** `unavailable` = X said the post is gone/protected (404/403); otherwise a transient error. */
  | { ok: false; unavailable: boolean; reason: string };

/**
 * Detect an X status URL. Returns null for profiles, search, etc.
 * Accepts /<user>/status/<id> and /i/web/status/<id>, with or without trailing segments
 * (/photo/1, /analytics) and query strings.
 */
export function parseXPostUrl(raw: string): XPostRef | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!X_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const statusIdx = segments.findIndex(s => s === 'status' || s === 'statuses');
  if (statusIdx < 1) return null;

  const postId = segments[statusIdx + 1];
  if (!postId || !/^\d{1,25}$/.test(postId)) return null;

  const handle = segments[statusIdx - 1] === 'web' && segments[0] === 'i' ? 'i' : segments[statusIdx - 1]!;
  if (!/^[A-Za-z0-9_]{1,30}$/.test(handle)) return null;

  return { url: `https://x.com/${handle}/status/${postId}`, postId, handle };
}

/**
 * Turn the oEmbed blockquote into plain text: keep the <p> body, drop the trailing
 * "— Author (@handle) date" attribution line, collapse whitespace, decode entities.
 */
export function extractPostTextFromOEmbedHtml(html: string): string {
  const root = parse(html);
  const paragraph = root.querySelector('blockquote p') ?? root.querySelector('p');
  const source = paragraph ?? root;

  // <br> are meaningful line breaks in posts.
  source.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

  const text = source.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return decodeEntities(text);
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/** Fetch author + plain text for a post through oEmbed. Never throws. */
export async function fetchXPost(ref: XPostRef): Promise<XPostFetchResult> {
  try {
    await assertHostIsExternal(OEMBED_HOST);

    const response = await axios.get<{ author_name?: string; author_url?: string; html?: string }>(
      OEMBED_ENDPOINT,
      {
        params: { url: ref.url, omit_script: 1, dnt: true },
        timeout: OEMBED_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: 512 * 1024,
        validateStatus: () => true,
        headers: { Accept: 'application/json' },
      },
    );

    if (response.status === 404 || response.status === 403) {
      return { ok: false, unavailable: true, reason: `oEmbed ${response.status}` };
    }
    if (response.status !== 200 || !response.data?.html) {
      return { ok: false, unavailable: false, reason: `oEmbed status ${response.status}` };
    }

    const text = extractPostTextFromOEmbedHtml(response.data.html);
    if (!text) return { ok: false, unavailable: false, reason: 'oEmbed returned empty text' };

    return {
      ok: true,
      post: {
        text,
        ...(response.data.author_name && { author: response.data.author_name }),
        ...(response.data.author_url && { authorUrl: response.data.author_url }),
      },
    };
  } catch (error) {
    logger.warn('[XPostPreview] oEmbed fetch failed', { postId: ref.postId, error });
    return { ok: false, unavailable: false, reason: error instanceof Error ? error.message : 'unknown' };
  }
}
