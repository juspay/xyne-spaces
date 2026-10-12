import { lazy } from 'react';
import { heicWebpDownloadUrl, isHeicAttachment } from '../../services/heicAttachmentService';
import type { PreviewFile, Previewer } from './types';

const MB = 1024 * 1024;

const TextPreview = lazy(() => import('./previewers/TextPreview'));
const MarkdownPreview = lazy(() => import('./previewers/MarkdownPreview'));
const HtmlPreview = lazy(() => import('./previewers/HtmlPreview'));
const CsvPreview = lazy(() => import('./previewers/CsvPreview'));
const SpreadsheetPreview = lazy(() => import('./previewers/SpreadsheetPreview'));
const ImagePreview = lazy(() => import('./previewers/ImagePreview'));
const VideoPreview = lazy(() => import('./previewers/VideoPreview'));
const PdfPreview = lazy(() => import('./previewers/PdfPreview'));
const LegacyPreview = lazy(() => import('./previewers/LegacyPreview'));

/**
 * Every previewer, in the order they are tried. A new one is a component under
 * previewers/ and an entry here: the frame, its toolbar, loading, failures, the
 * too-large state and download all come with it.
 */
export const PREVIEWERS: readonly Previewer[] = [
  {
    id: 'image',
    label: 'Image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif'],
    // Named, not `image/`: a TIFF is an image no browser but Safari draws.
    mimeTypes: [
      'image/png',
      'image/jpeg',
      'image/pjpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/bmp',
      'image/x-ms-bmp',
      'image/heic',
      'image/heif',
    ],
    // An iPhone photo comes as the WebP the server derives from it.
    reads: {
      kind: 'file',
      source: file =>
        isHeicAttachment(file.mimetype, file.name) ? heicWebpDownloadUrl(file.id) : file.id,
    },
    maxBytes: 50 * MB,
    skeleton: 'media',
    component: ImagePreview,
  },
  {
    id: 'video',
    label: 'Video',
    extensions: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'],
    mimeTypes: ['video/'],
    reads: { kind: 'stream' },
    skeleton: 'media',
    component: VideoPreview,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['md', 'markdown'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    reads: { kind: 'file' },
    maxBytes: 5 * MB,
    skeleton: 'document',
    component: MarkdownPreview,
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['html', 'htm'],
    mimeTypes: ['text/html'],
    reads: { kind: 'file' },
    maxBytes: 10 * MB,
    skeleton: 'document',
    component: HtmlPreview,
  },
  {
    id: 'csv',
    label: 'CSV',
    extensions: ['csv', 'tsv'],
    mimeTypes: ['text/csv', 'text/tab-separated-values'],
    reads: { kind: 'file' },
    maxBytes: 20 * MB,
    skeleton: 'grid',
    component: CsvPreview,
  },
  {
    id: 'spreadsheet',
    label: 'Spreadsheet',
    extensions: ['xlsx', 'xls', 'xlsm', 'ods'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroenabled.12',
      'application/vnd.oasis.opendocument.spreadsheet',
    ],
    reads: { kind: 'file' },
    maxBytes: 30 * MB,
    skeleton: 'grid',
    component: SpreadsheetPreview,
  },
  {
    id: 'code',
    label: 'Code',
    extensions: [
      'json',
      'jsonl',
      'xml',
      'yaml',
      'yml',
      'toml',
      'ini',
      'conf',
      'sql',
      'py',
      'js',
      'mjs',
      'cjs',
      'ts',
      'tsx',
      'jsx',
      'sh',
      'bash',
      'java',
      'go',
      'rs',
      'rb',
      'c',
      'h',
      'cpp',
      'hpp',
      'diff',
      'patch',
      'gradle',
    ],
    mimeTypes: ['application/json', 'application/xml', 'text/xml', 'application/sql'],
    reads: { kind: 'file' },
    maxBytes: 5 * MB,
    skeleton: 'text',
    // The text previewer: numbered lines, coloured for the language the name says.
    component: TextPreview,
  },
  {
    id: 'text',
    label: 'Text',
    extensions: ['txt', 'log', 'text'],
    // Plain text only: RTF, also `text/`, is markup no one wants to read raw.
    mimeTypes: ['text/plain'],
    reads: { kind: 'file' },
    maxBytes: 5 * MB,
    skeleton: 'text',
    component: TextPreview,
  },
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    // Fetched a piece at a time by the viewer, so no size is too large to open.
    reads: { kind: 'stream' },
    skeleton: 'document',
    component: PdfPreview,
  },
  // Until these have previewers of their own (documents and slides as PDFs the
  // server makes, in the PDF previewer), the app's existing viewers draw them.
  {
    id: 'word',
    label: 'Word document',
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    reads: { kind: 'stream' },
    skeleton: 'document',
    component: LegacyPreview,
  },
  {
    id: 'slides',
    label: 'Slides',
    extensions: ['pptx', 'ppt'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
    ],
    reads: { kind: 'stream' },
    skeleton: 'document',
    component: LegacyPreview,
  },
];

/** A file name's extension, lower case and without the dot; empty when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * The previewer for a file: by its extension, which says more than the type a
 * browser guessed at upload, else by its type. Null when nothing previews it.
 */
export function previewerFor(file: Pick<PreviewFile, 'name' | 'mimetype'>): Previewer | null {
  const extension = extensionOf(file.name);
  if (extension) {
    const byExtension = PREVIEWERS.find(previewer => previewer.extensions.includes(extension));
    if (byExtension) return byExtension;
  }
  const mime = (file.mimetype.split(';')[0] ?? '').trim().toLowerCase();
  if (!mime) return null;
  return (
    PREVIEWERS.find(previewer =>
      previewer.mimeTypes.some(type =>
        type.endsWith('/') ? mime.startsWith(type) : mime === type,
      ),
    ) ?? null
  );
}
