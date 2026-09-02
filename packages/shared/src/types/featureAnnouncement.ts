export const FeatureAnnouncementStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type FeatureAnnouncementStatus =
  (typeof FeatureAnnouncementStatus)[keyof typeof FeatureAnnouncementStatus];

export const FEATURE_ANNOUNCEMENT_STATUSES = Object.values(FeatureAnnouncementStatus);

export const FeatureAnnouncementCtaType = {
  ROUTE: 'ROUTE',
  EXTERNAL: 'EXTERNAL',
} as const;

export type FeatureAnnouncementCtaType =
  (typeof FeatureAnnouncementCtaType)[keyof typeof FeatureAnnouncementCtaType];

export const FEATURE_ANNOUNCEMENT_CTA_TYPES = Object.values(FeatureAnnouncementCtaType);

export const SurfaceKind = {
  FEATURE_ANNOUNCEMENT: 'FEATURE_ANNOUNCEMENT',
} as const;

export type SurfaceKind = (typeof SurfaceKind)[keyof typeof SurfaceKind];

export const FEATURE_ANNOUNCEMENT_LIMITS = {
  MAX_PAGES: 5,
  MAX_TITLE_LENGTH: 80,
  MAX_DESCRIPTION_LENGTH: 280,
  MAX_KEY_LENGTH: 64,
  MAX_IMAGE_BYTES: 25 * 1024 * 1024,
  /**
   * Video is deliberately capped far below images. The card fetches media through the
   * authenticated API as a blob, so the whole clip downloads before the first frame —
   * there is no progressive playback to hide a large file behind.
   */
  MAX_VIDEO_BYTES: 8 * 1024 * 1024,
  /**
   * Autoplaying loops are ambient; anything longer belongs on a docs page. There is
   * deliberately no resolution cap — ordinary screenshots exceed any sensible one, and
   * the byte limits already bound what reaches a user.
   */
  MAX_VIDEO_DURATION_SECONDS: 30,
  /** A surface stops being offered once it has been opened this many times without a decision. */
  MAX_SEEN_COUNT: 3,
  /** Two `/seen` calls closer together than this belong to the same session. */
  SESSION_GAP_MS: 6 * 60 * 60 * 1000,
} as const;

export const FEATURE_ANNOUNCEMENT_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const FEATURE_ANNOUNCEMENT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

/** H.264 MP4 is what every screen recorder produces; WebM covers the rest. */
export const FEATURE_ANNOUNCEMENT_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

export const FEATURE_ANNOUNCEMENT_MEDIA_MIME_TYPES = [
  ...FEATURE_ANNOUNCEMENT_IMAGE_MIME_TYPES,
  ...FEATURE_ANNOUNCEMENT_VIDEO_MIME_TYPES,
] as const;

export function normalizeMimeType(contentType: string | null | undefined): string {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

export function isAnnouncementVideo(contentType: string | null | undefined): boolean {
  return (FEATURE_ANNOUNCEMENT_VIDEO_MIME_TYPES as readonly string[]).includes(
    normalizeMimeType(contentType),
  );
}

export function isAnnouncementImage(contentType: string | null | undefined): boolean {
  return (FEATURE_ANNOUNCEMENT_IMAGE_MIME_TYPES as readonly string[]).includes(
    normalizeMimeType(contentType),
  );
}

/** Byte ceiling for a given content type, or null when the type is not accepted at all. */
export function maxBytesForMedia(contentType: string | null | undefined): number | null {
  if (isAnnouncementVideo(contentType)) return FEATURE_ANNOUNCEMENT_LIMITS.MAX_VIDEO_BYTES;
  if (isAnnouncementImage(contentType)) return FEATURE_ANNOUNCEMENT_LIMITS.MAX_IMAGE_BYTES;
  return null;
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/**
 * Works out what to serve a stored object as.
 *
 * Stored metadata is preferred, but it cannot be relied on: a streamed upload can land
 * without a usable type — fake-gcs-server does exactly this in local development — leaving
 * an ordinary PNG recorded as application/octet-stream. Falling back to the extension of
 * the storage key keeps those objects renderable instead of failing the request.
 *
 * Returns null only when neither source yields a type this feature supports, which is the
 * one case worth refusing.
 */
export function resolveAnnouncementMediaType(
  storedContentType: string | null | undefined,
  storageKey: string | null | undefined,
): string | null {
  const stored = normalizeMimeType(storedContentType);
  if (isAnnouncementImage(stored) || isAnnouncementVideo(stored)) return stored;

  const extension = (storageKey || '').split('.').pop()?.toLowerCase() ?? '';
  const inferred = EXTENSION_MIME_TYPES[extension];
  return inferred ?? null;
}

export interface FeatureAnnouncementPage {
  title: string;
  description: string;
  mediaKey?: string | null;
  mediaAlt?: string | null;
}

/** A page as sent to the client: storage keys resolved to fetchable paths. */
export interface FeatureAnnouncementPageView {
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaAlt: string | null;
}

export interface FeatureAnnouncementView {
  id: string;
  key: string;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaAlt: string | null;
  ctaLabel: string | null;
  ctaType: FeatureAnnouncementCtaType | null;
  ctaTarget: string | null;
  pages: FeatureAnnouncementPageView[];
  progress: number | null;
}

export interface PendingAnnouncementsResponse {
  announcements: FeatureAnnouncementView[];
}

/**
 * A CTA is renderable only when the client understands its type and the target is
 * well-formed. Rows outlive and precede client deploys, so an unrecognised CTA must
 * degrade to a plain close rather than a dead button.
 */
export function isRenderableCta(
  announcement: Pick<FeatureAnnouncementView, 'ctaLabel' | 'ctaType' | 'ctaTarget'>,
): boolean {
  const { ctaLabel, ctaType, ctaTarget } = announcement;
  if (!ctaLabel || !ctaType || !ctaTarget) return false;
  if (ctaType === FeatureAnnouncementCtaType.ROUTE) return isInternalRoute(ctaTarget);
  if (ctaType === FeatureAnnouncementCtaType.EXTERNAL) return isHttpUrl(ctaTarget);
  return false;
}

/**
 * A single leading slash only. `//host` and `/\host` are protocol-relative and would
 * navigate off-origin if handed to a router or an anchor.
 */
export function isInternalRoute(target: string): boolean {
  return /^\/(?![/\\])/.test(target);
}

export function isHttpUrl(target: string): boolean {
  try {
    const { protocol } = new URL(target);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
