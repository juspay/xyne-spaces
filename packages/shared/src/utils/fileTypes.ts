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

// Needed because browsers hand back '' or application/octet-stream often enough
// that mimetype alone misclassifies real media as plain files.
const EXTENSIONS_BY_KIND: Readonly<Record<Exclude<MediaKind, 'file'>, readonly string[]>> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.heic'],
  video: ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.mpeg', '.mpg', '.wmv'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.wma'],
};

/** Classifies by mimetype, falling back to the extension when it says nothing. */
export function classifyMediaKind(mimeType?: string | null, fileName?: string | null): MediaKind {
  const mime = (mimeType ?? '').toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';

  const name = (fileName ?? '').toLowerCase();
  const extension = name.slice(name.lastIndexOf('.'));
  if (extension.length > 1) {
    for (const [kind, extensions] of Object.entries(EXTENSIONS_BY_KIND)) {
      if (extensions.includes(extension)) return kind as Exclude<MediaKind, 'file'>;
    }
  }

  return 'file';
}
