/**
 * Attachment utilities for Lotus
 *
 * Shared utilities for file type detection, formatting, and categorization.
 * Kept in sync with dashboard's MessageAttachment/utils.tsx.
 */

// MIME type to file extension mapping (kept in sync with dashboard)
export const MIME_TO_EXTENSION: Record<string, string> = {
  // Images
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
  'image/svg+xml': 'SVG',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/ico': 'ICO',

  // Videos
  'video/mp4': 'MP4',
  'video/avi': 'AVI',
  'video/mov': 'MOV',
  'video/wmv': 'WMV',
  'video/webm': 'WEBM',
  'video/mkv': 'MKV',
  'video/flv': 'FLV',
  'video/quicktime': 'MOV',

  // Audio
  'audio/mp3': 'MP3',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/ogg': 'OGG',
  'audio/aac': 'AAC',
  'audio/flac': 'FLAC',

  // Documents
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'text/rtf': 'RTF',
  'text/markdown': 'MD',

  // Archives
  'application/zip': 'ZIP',
  'application/x-rar-compressed': 'RAR',
  'application/x-7z-compressed': '7Z',
  'application/x-tar': 'TAR',
  'application/gzip': 'GZ',

  // Code files
  'text/javascript': 'JS',
  'application/javascript': 'JS',
  'text/typescript': 'TS',
  'text/x-typescript': 'TS',
  'text/tsx': 'TSX',
  'text/css': 'CSS',
  'text/html': 'HTML',
  'application/json': 'JSON',
  'text/xml': 'XML',
  'application/xml': 'XML',
  'text/x-python': 'PY',
  'text/x-c': 'C',
  'text/x-csrc': 'C',
  'text/x-c++src': 'CPP',
  'text/x-c++': 'CPP',
  'text/x-java-source': 'JAVA',
  'text/x-java': 'JAVA',
  'text/x-go': 'GO',
  'text/x-ruby': 'RB',
  'application/x-ruby': 'RB',
  'text/x-csharp': 'CS',
  'application/sql': 'SQL',
  'text/x-sql': 'SQL',
  'text/yaml': 'YML',
  'application/x-yaml': 'YML',
};

export interface MessageAttachment {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  url?: string | null;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Check if file type is an image based on MIME type
 */
export const isImageFile = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

/**
 * Check if file type is a video based on MIME type
 */
export const isVideoFile = (mimeType: string): boolean => {
  return mimeType.startsWith('video/');
};

/**
 * Check if file type is media (image or video)
 */
export const isMediaFile = (mimeType: string): boolean => {
  return isImageFile(mimeType) || isVideoFile(mimeType);
};

/**
 * Get file extension from MIME type, falling back to filename extension
 */
export const getFileExtension = (mimeType: string, fileName?: string): string => {
  const fromMime = MIME_TO_EXTENSION[mimeType];
  if (fromMime) return fromMime;

  // Fallback: extract extension from filename
  if (fileName) {
    const ext = fileName.split('.').pop()?.toUpperCase();
    if (ext && ext !== fileName.toUpperCase()) return ext;
  }

  return 'FILE';
};

/**
 * Format file size in human-readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return 'Unknown size';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  const decimals = i === 0 ? 0 : size < 10 ? 1 : 0;

  return `${size.toFixed(decimals)} ${units[i]}`;
};

/**
 * Truncate filename while preserving extension
 */
export const truncateFileName = (fileName: string, maxLength: number = 20): string => {
  if (fileName.length <= maxLength) return fileName;

  const lastDotIndex = fileName.lastIndexOf('.');

  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return `${fileName.substring(0, maxLength - 3)}...`;
  }

  const extension = fileName.substring(lastDotIndex);
  const nameWithoutExt = fileName.substring(0, lastDotIndex);

  const availableSpace = maxLength - 3 - extension.length;

  if (availableSpace <= 0) {
    return `...${extension}`;
  }

  return `${nameWithoutExt.substring(0, availableSpace)}...${extension}`;
};

/**
 * Categorize attachments into media (images/videos) and other files
 */
export const categorizeAttachments = <T extends MessageAttachment>(
  attachments: readonly T[],
): { media: T[]; files: T[] } => {
  const media: T[] = [];
  const files: T[] = [];

  for (const attachment of attachments) {
    if (isMediaFile(attachment.mimetype)) {
      media.push(attachment);
    } else {
      files.push(attachment);
    }
  }

  return { media, files };
};
