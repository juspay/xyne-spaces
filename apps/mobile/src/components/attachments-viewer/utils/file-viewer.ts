export type AttachmentFileCategory =
  'image' | 'video' | 'audio' | 'pdf' | 'csv' | 'html' | 'code' | 'text' | 'unsupported';

const codeExtensions = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rb',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.cs',
  '.sql',
  '.yml',
  '.yaml',
  '.json',
  '.md',
  '.markdown',
  '.css',
  '.xml',
];

const officeExtensions = ['.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt'];

// Extension → mimetype, used to hand the Android ACTION_VIEW intent a precise type
// when the server gave us a generic/empty one. Without this, Office files resolve
// to no handler app and the open falls through to "save", instead of offering
// Sheets/Docs/Drive like other chat apps.
const EXTENSION_MIME_TYPES = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.csv', 'text/csv'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.txt', 'text/plain'],
  ['.rtf', 'application/rtf'],
  ['.zip', 'application/zip'],
]);

/**
 * Returns the best mimetype to open a file with. Trusts a specific server mimetype,
 * but when it's missing or generic (`application/octet-stream`) it derives one from
 * the filename extension so the OS can match a handler app.
 */
export const resolveAttachmentMimeType = (
  mimetype?: string | null,
  filename?: string | null,
): string => {
  const mime = (mimetype ?? '').trim();
  const isGeneric =
    mime.length === 0 ||
    mime.toLowerCase() === 'application/octet-stream' ||
    mime.toLowerCase() === 'binary/octet-stream';
  if (!isGeneric) return mime;

  const name = (filename ?? '').toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? name.slice(dotIndex) : '';
  return EXTENSION_MIME_TYPES.get(extension) ?? 'application/octet-stream';
};

/** Word / Excel / PowerPoint binaries — no in-app preview, open via device viewer. */
const isOfficeDocument = (mime: string, name: string): boolean => {
  if (officeExtensions.some(extension => name.endsWith(extension))) return true;
  return (
    mime.includes('officedocument') || // OOXML: spreadsheetml / wordprocessingml / presentationml
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint'
  );
};

export const getAttachmentFileCategory = (
  mimetype: string,
  filename?: string | null,
): AttachmentFileCategory => {
  const mime = resolveAttachmentMimeType(mimetype, filename).toLowerCase();
  const name = (filename ?? '').toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime === 'text/csv' || name.endsWith('.csv')) return 'csv';
  if (mime === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) return 'html';

  if (isOfficeDocument(mime, name)) return 'unsupported';

  if (
    codeExtensions.some(extension => name.endsWith(extension)) ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('python') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('yaml') ||
    mime.includes('sql')
  ) {
    return 'code';
  }
  if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.log')) return 'text';

  return 'unsupported';
};

/** Image or video for chat bubbles / paint. Uses filename when the server mime is generic. */
export const getAttachmentMediaKind = (
  mimetype?: string | null,
  filename?: string | null,
): 'image' | 'video' | null => {
  const category = getAttachmentFileCategory(mimetype ?? '', filename);
  if (category === 'image' || category === 'video') return category;
  return null;
};

export const parseCsvRows = (text: string): string[][] =>
  text.split(/\r?\n/).map(row => row.split(',').map(cell => cell.trim()));

export const sanitizeCacheFileName = (filename?: string | null): string => {
  const fallback = 'attachment';
  const value = filename && filename.trim().length > 0 ? filename.trim() : fallback;
  return value
    .split('')
    .map(char => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_');
};
