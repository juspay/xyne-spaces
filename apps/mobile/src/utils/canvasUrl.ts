import type { ImperativeRouter as Router } from 'expo-router';
import { TRUSTED_ORIGINS } from '@xyne/shared';

import { DASHBOARD_ORIGIN } from '@/src/config';

const TRUSTED_ORIGIN_SET = new Set([
  ...TRUSTED_ORIGINS.map(origin => origin.replace(/\/$/, '')),
  DASHBOARD_ORIGIN.replace(/\/$/, ''),
]);

const CANVAS_PATH_PATTERN = /\/chat\/canvas\/([^/?#\s]+)/;

const isTrustedAbsoluteUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return TRUSTED_ORIGIN_SET.has(parsed.origin);
  } catch {
    return false;
  }
};

const decodeCanvasId = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** Extract dashboard canvas viewAccessId from a trusted shareable canvas URL. */
export const extractCanvasViewId = (canvasUrl: string | undefined | null): string | null => {
  if (!canvasUrl) return null;
  return extractCanvasViewIdFromLink(canvasUrl);
};

/** Parse a markdown link target or path that points at /chat/canvas/:id. */
export const extractCanvasViewIdFromLink = (url: string): string | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const hasAbsoluteScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasAbsoluteScheme && !isTrustedAbsoluteUrl(trimmed)) {
    return null;
  }

  const match = trimmed.match(CANVAS_PATH_PATTERN);
  if (!match?.[1]) return null;

  return decodeCanvasId(match[1]);
};

/** Open a dashboard canvas in the Lotus WebView overlay (/chat/canvas/:id). */
export const openDashboardCanvas = (router: Router, canvasId: string): void => {
  router.push({
    pathname: '/(protected)/canvas',
    params: { canvasId },
  });
};

/** Returns true when the URL was handled as an in-app canvas deep link. */
export const tryOpenDashboardCanvasFromUrl = (router: Router, url: string): boolean => {
  const canvasId = extractCanvasViewIdFromLink(url);
  if (!canvasId) return false;
  openDashboardCanvas(router, canvasId);
  return true;
};
