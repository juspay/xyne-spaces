import type { ComponentType } from 'react';
import {
  Cube,
  CurlyBracesCodeDefault,
  FileDefault,
  FilePdfFormat,
  FileText,
  GridTable,
  Markdown,
  MusicQuaverNote,
  PhotoImageDefault,
  PresentationBargraph,
  VideoRecording,
} from '@xyne/icons';

/** The colour a format is known by. Drawn as a tint behind its mark, never a solid block. */
export type FileTone =
  | 'red'
  | 'blue'
  | 'green'
  | 'orange'
  | 'slate'
  | 'violet'
  | 'amber'
  | 'pink'
  | 'teal'
  | 'gray';

export interface FileKind {
  /** What the row shows beside the name, in the column the artifact type uses. */
  label: string;
  icon: ComponentType<{ className?: string }>;
  tone: FileTone;
  /**
   * The letters a format is known by, drawn instead of a glyph where one exists:
   * W, X and P for the Office apps, PDF, and Markdown's own M↓ mark. At row size
   * they read where a pictogram would blur.
   */
  mark?: string;
}

const PDF: FileKind = { label: 'PDF', icon: FilePdfFormat, tone: 'red', mark: 'PDF' };
const MARKDOWN: FileKind = { label: 'Markdown', icon: Markdown, tone: 'slate', mark: 'M↓' };
const WORD: FileKind = { label: 'Word', icon: FileText, tone: 'blue', mark: 'W' };
const EXCEL: FileKind = { label: 'Excel', icon: GridTable, tone: 'green', mark: 'X' };
const POWERPOINT: FileKind = {
  label: 'PowerPoint',
  icon: PresentationBargraph,
  tone: 'orange',
  mark: 'P',
};
// OpenDocument files keep the colour of their kind but not an Office letter.
const DOCUMENT: FileKind = { label: 'Document', icon: FileText, tone: 'blue' };
const SPREADSHEET: FileKind = { label: 'Spreadsheet', icon: GridTable, tone: 'green' };
const SLIDES: FileKind = { label: 'Slides', icon: PresentationBargraph, tone: 'orange' };
const CSV: FileKind = { label: 'CSV', icon: GridTable, tone: 'green' };
const IMAGE: FileKind = { label: 'Image', icon: PhotoImageDefault, tone: 'violet' };
const VIDEO: FileKind = { label: 'Video', icon: VideoRecording, tone: 'pink' };
const AUDIO: FileKind = { label: 'Audio', icon: MusicQuaverNote, tone: 'teal' };
const HTML: FileKind = { label: 'HTML', icon: CurlyBracesCodeDefault, tone: 'amber' };
const CODE: FileKind = { label: 'Code', icon: CurlyBracesCodeDefault, tone: 'amber' };
const ARCHIVE: FileKind = { label: 'Archive', icon: Cube, tone: 'amber' };
const TEXT: FileKind = { label: 'Text', icon: FileText, tone: 'gray' };
const OTHER: FileKind = { label: 'File', icon: FileDefault, tone: 'gray' };

/**
 * A file's kind comes from its mime type, with the filename only as a fallback:
 * browsers hand us `application/octet-stream` often enough that an extension is
 * the more honest answer when the mime type says nothing.
 */
const BY_MIME: ReadonlyArray<readonly [RegExp, FileKind]> = [
  [/^image\//, IMAGE],
  [/^video\//, VIDEO],
  [/^audio\//, AUDIO],
  [/^application\/pdf$/, PDF],
  [/^text\/markdown$|^text\/x-markdown$/, MARKDOWN],
  [/^text\/html$/, HTML],
  [/^text\/csv$/, CSV],
  [/spreadsheetml|ms-excel/, EXCEL],
  [/opendocument\.spreadsheet/, SPREADSHEET],
  [/presentationml|ms-powerpoint/, POWERPOINT],
  [/opendocument\.presentation/, SLIDES],
  [/wordprocessingml|msword/, WORD],
  [/opendocument\.text/, DOCUMENT],
  [/^application\/(json|xml)$|javascript|typescript/, CODE],
  [/zip|x-tar|gzip|x-7z|x-rar/, ARCHIVE],
  [/^text\//, TEXT],
];

const BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  pdf: PDF,
  md: MARKDOWN,
  markdown: MARKDOWN,
  html: HTML,
  htm: HTML,
  csv: CSV,
  xlsx: EXCEL,
  xls: EXCEL,
  ods: SPREADSHEET,
  pptx: POWERPOINT,
  ppt: POWERPOINT,
  odp: SLIDES,
  docx: WORD,
  doc: WORD,
  odt: DOCUMENT,
  txt: TEXT,
  json: CODE,
  zip: ARCHIVE,
};

export function fileKind(mimetype: string, filename: string): FileKind {
  const mime = mimetype.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime && mime !== 'application/octet-stream') {
    for (const [pattern, kind] of BY_MIME) {
      if (pattern.test(mime)) return kind;
    }
  }
  const extension = filename.includes('.') ? (filename.split('.').pop() ?? '').toLowerCase() : '';
  return BY_EXTENSION[extension] ?? OTHER;
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
