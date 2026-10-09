import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface FileKind {
  /** What the row shows beside the name, in the column the artifact type uses. */
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * A file's kind comes from its mime type, with the filename only as a fallback:
 * browsers hand us `application/octet-stream` often enough that an extension is
 * the more honest answer when the mime type says nothing.
 */
const BY_MIME: ReadonlyArray<readonly [RegExp, FileKind]> = [
  [/^image\//, { label: 'Image', icon: FileImage }],
  [/^video\//, { label: 'Video', icon: FileVideo }],
  [/^audio\//, { label: 'Audio', icon: FileAudio }],
  [/^application\/pdf$/, { label: 'PDF', icon: FileText }],
  [/^text\/markdown$|^text\/x-markdown$/, { label: 'Markdown', icon: FileText }],
  [/^text\/html$/, { label: 'HTML', icon: FileCode }],
  [/^text\/csv$/, { label: 'CSV', icon: FileSpreadsheet }],
  [
    /spreadsheetml|ms-excel|opendocument\.spreadsheet/,
    { label: 'Spreadsheet', icon: FileSpreadsheet },
  ],
  [
    /presentationml|ms-powerpoint|opendocument\.presentation/,
    { label: 'Slides', icon: Presentation },
  ],
  [/wordprocessingml|msword|opendocument\.text/, { label: 'Document', icon: FileText }],
  [/^application\/(json|xml)$|javascript|typescript/, { label: 'Code', icon: FileCode }],
  [/zip|x-tar|gzip|x-7z|x-rar/, { label: 'Archive', icon: FileArchive }],
  [/^text\//, { label: 'Text', icon: FileText }],
];

const BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  pdf: { label: 'PDF', icon: FileText },
  md: { label: 'Markdown', icon: FileText },
  markdown: { label: 'Markdown', icon: FileText },
  html: { label: 'HTML', icon: FileCode },
  htm: { label: 'HTML', icon: FileCode },
  csv: { label: 'CSV', icon: FileSpreadsheet },
  xlsx: { label: 'Spreadsheet', icon: FileSpreadsheet },
  xls: { label: 'Spreadsheet', icon: FileSpreadsheet },
  pptx: { label: 'Slides', icon: Presentation },
  ppt: { label: 'Slides', icon: Presentation },
  docx: { label: 'Document', icon: FileText },
  doc: { label: 'Document', icon: FileText },
  txt: { label: 'Text', icon: FileText },
  json: { label: 'Code', icon: FileCode },
  zip: { label: 'Archive', icon: FileArchive },
};

export function fileKind(mimetype: string, filename: string): FileKind {
  const mime = mimetype.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime && mime !== 'application/octet-stream') {
    for (const [pattern, kind] of BY_MIME) {
      if (pattern.test(mime)) return kind;
    }
  }
  const extension = filename.includes('.') ? (filename.split('.').pop() ?? '').toLowerCase() : '';
  return BY_EXTENSION[extension] ?? { label: 'File', icon: File };
}

/** Sizes read as they do everywhere else a file is listed: whole units, one decimal. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
