/**
 * Shared file type constants for file upload validation.
 * Uses a blocklist approach — all file types are allowed except dangerous extensions.
 */

/**
 * Dangerous file extensions that should be rejected
 */
export const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.pif',
  '.scr',
  '.vbs',
  '.jar',
  '.msi',
  '.dll',
  '.sys',
  '.bin',
  '.ps1',
  '.asp',
  '.jsp',
] as const;

/** How a file should be presented. Names match the canvas block types. */
export type MediaKind = 'image' | 'video' | 'audio' | 'file';

// Only what a browser will actually render. A format it cannot decode has to stay
// a plain file: image, video and audio blocks have no download button, so promoting
// one would leave a broken element and no way to get the file back out.
const EXTENSIONS_BY_KIND: Readonly<Record<Exclude<MediaKind, 'file'>, readonly string[]>> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'],
  video: ['.mp4', '.webm', '.ogv', '.mov', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus'],
};

// These carry a media mimetype but no browser renders them, so the prefix match
// below would otherwise promote them past the extension list.
const UNRENDERABLE_MIMETYPES: ReadonlySet<string> = new Set([
  'image/heic',
  'image/heif',
  'video/x-matroska',
  'video/x-msvideo',
  'video/avi',
  'video/x-ms-wmv',
  'video/mpeg',
  'audio/x-ms-wma',
]);

/** Classifies by mimetype, falling back to the extension when it says nothing. */
export function classifyMediaKind(mimeType?: string | null, fileName?: string | null): MediaKind {
  const mime = (mimeType ?? '').toLowerCase();

  if (!UNRENDERABLE_MIMETYPES.has(mime)) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }

  const name = (fileName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '' : name.slice(dot);
  if (extension) {
    for (const [kind, extensions] of Object.entries(EXTENSIONS_BY_KIND)) {
      if (extensions.includes(extension)) return kind as Exclude<MediaKind, 'file'>;
    }
  }

  return 'file';
}
