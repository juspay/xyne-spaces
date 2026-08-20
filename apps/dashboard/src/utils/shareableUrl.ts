import { SHAREABLE_BASE_URL } from '../config';

/**
 * Shared, config-driven builder for user-shareable / deep links.
 *
 * Use this from plain functions / utilities that build links OUTSIDE React
 * render (where the `useShareableOrigin` hook is unavailable). Inside
 * components prefer `useShareableOrigin()`.
 *
 * The canonical origin comes from `SHAREABLE_BASE_URL` (config.ts) — the single
 * source of truth. Never read `window.location.origin` at call sites.
 */

/** The canonical origin for shareable links (no trailing slash, no workspace segment). */
export function getShareableBaseUrl(): string {
  return SHAREABLE_BASE_URL;
}

/**
 * Join the canonical shareable base with an app-relative path. The path may
 * already include the workspace segment, query string, and hash — all of which
 * are preserved verbatim.
 *
 *   buildShareableUrl('/ws_1/chat/canvas/c_9')      → `${base}/ws_1/chat/canvas/c_9`
 *   buildShareableUrl('/launch?path=%2Finvite%3F..') → `${base}/launch?path=...`
 */
export function buildShareableUrl(pathWithQueryAndHash: string): string {
  const base = SHAREABLE_BASE_URL.replace(/\/+$/, '');
  const path = pathWithQueryAndHash.startsWith('/')
    ? pathWithQueryAndHash
    : `/${pathWithQueryAndHash}`;
  return `${base}${path}`;
}
