import {
  FEATURE_ANNOUNCEMENT_LIMITS,
  isAnnouncementVideo,
  maxBytesForMedia,
  normalizeMimeType,
} from '@xyne/shared';

const { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } =
  FEATURE_ANNOUNCEMENT_LIMITS;

export const MEDIA_ACCEPT_ATTRIBUTE =
  'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** Shown next to the upload controls so the rules are visible before a file is chosen. */
export const MEDIA_HINT =
  `Images (PNG, JPEG, WebP, GIF) up to ${formatBytes(MAX_IMAGE_BYTES)} · ` +
  `Video (MP4, WebM) up to ${formatBytes(MAX_VIDEO_BYTES)} and ${MAX_VIDEO_DURATION_SECONDS}s. ` +
  `Any resolution.`;

function describeType(file: File): string {
  const type = normalizeMimeType(file.type);
  if (type) return type;
  const extension = file.name.includes('.') ? file.name.split('.').pop() : null;
  return extension ? `.${extension.toLowerCase()} files` : 'that file type';
}

function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (duration: number | null): void => {
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = (): void =>
      finish(Number.isFinite(video.duration) ? video.duration : null);
    // An unreadable container is not necessarily invalid — some codecs report no metadata
    // in every browser. The server still enforces type and size, so let it through.
    video.onerror = (): void => finish(null);
    video.src = objectUrl;
  });
}

/**
 * Pre-upload checks, so a rejected file fails instantly instead of after a slow upload.
 * The server enforces type and size independently; this only mirrors those two, plus a
 * duration check that is impractical server-side.
 *
 * There is deliberately no resolution limit: ordinary screenshots are far larger than any
 * cap worth setting, and the byte limit already bounds what actually reaches a user.
 */
export async function validateAnnouncementMedia(file: File): Promise<string | null> {
  const contentType = normalizeMimeType(file.type);
  const maxBytes = maxBytesForMedia(contentType);

  if (maxBytes === null) {
    return `${describeType(file)} can't be used here. Upload a PNG, JPEG, WebP or GIF image, or an MP4 or WebM video.`;
  }

  const isVideo = isAnnouncementVideo(contentType);
  if (file.size > maxBytes) {
    const kind = isVideo ? 'Video' : 'Image';
    const extra = isVideo
      ? ' Trimming the clip or exporting at a lower bitrate usually gets it under.'
      : ' Exporting as JPEG or WebP usually gets it under.';
    return `${kind} is ${formatBytes(file.size)} — the limit is ${formatBytes(maxBytes)}.${extra}`;
  }

  if (!isVideo) return null;

  const duration = await probeVideoDuration(file);
  if (duration !== null && duration > MAX_VIDEO_DURATION_SECONDS) {
    return `Clip is ${Math.round(duration)}s — the limit is ${MAX_VIDEO_DURATION_SECONDS}s. Trim it and upload again.`;
  }
  return null;
}
