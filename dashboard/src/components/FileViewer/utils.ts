import TxtViewer from './TxtViewer';
import DocxViewer from './DocxViewer';
import CsvViewer from './CsvViewer';
import ReadmeViewer from './ReadmeViewer';
import ExcelViewer from './ExcelViewer';
import ImageViewer from './ImageViewer';
import PdfViewer from './PdfViewer';
import VideoViewer from './VideoViewer';
import JsonViewer from './JsonViewer';

export interface BaseViewerProps {
  source: File | null;
  fileName?: string;
  attachmentId?: string;
  width?: number;
  height?: number;
  initialTime?: number;
  onExpand?: () => void;
}

export interface FileTypeConfig<P = BaseViewerProps> {
  mimeTypes: string[];
  extensions: string[];
  component: React.ComponentType<P>;
  wrapperClass: string;
  displayName: string;
}

export const FILE_TYPE_CONFIG: Record<string, FileTypeConfig<BaseViewerProps>> = {
  video: {
    mimeTypes: ['video/'],
    extensions: ['.mp4', '.webm', '.mov', '.avi'],
    component: VideoViewer,
    wrapperClass: 'h-full w-full',
    displayName: 'Video',
  },
  image: {
    mimeTypes: ['image/'],
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'],
    component: ImageViewer,
    wrapperClass: 'h-full w-full',
    displayName: 'Image',
  },
  csv: {
    mimeTypes: ['text/csv'],
    extensions: ['.csv'],
    component: CsvViewer,
    wrapperClass: 'h-full overflow-auto p-4',
    displayName: 'CSV Spreadsheet',
  },
  excel: {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    extensions: ['.xlsx', '.xls'],
    component: ExcelViewer,
    wrapperClass: 'h-full overflow-auto p-4',
    displayName: 'Excel Spreadsheet',
  },
  docx: {
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions: ['.docx'],
    component: DocxViewer,
    wrapperClass: 'h-full overflow-auto',
    displayName: 'Word Document',
  },
  markdown: {
    mimeTypes: ['text/markdown'],
    extensions: ['.md', '.markdown'],
    component: ReadmeViewer,
    wrapperClass: 'h-full overflow-auto',
    displayName: 'Markdown Document',
  },
  json: {
    mimeTypes: ['application/json'],
    extensions: ['.json'],
    component: JsonViewer,
    wrapperClass: 'h-full overflow-auto p-4',
    displayName: 'JSON File',
  },
  text: {
    mimeTypes: ['text/', 'application/xml'],
    extensions: ['.txt', '.log', '.xml', '.js', '.ts', '.css', '.html'],
    component: TxtViewer,
    wrapperClass: 'h-full overflow-auto p-4',
    displayName: 'Text File',
  },
  pdf: {
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    component: PdfViewer,
    wrapperClass: 'h-full w-full',
    displayName: 'PDF Document',
  },
};

// File type detection result
export interface FileType {
  type: string;
  component: React.ComponentType<BaseViewerProps>;
  wrapperClass: string;
  displayName: string;
}

/**
 * Detects file type based on MIME type and filename
 */
export const detectFileType = (mimeType: string, fileName: string): FileType | null => {
  // Normalize inputs
  const normalizedMimeType = mimeType.toLowerCase();
  const normalizedFileName = fileName.toLowerCase();

  // Check each file type configuration
  for (const [typeKey, config] of Object.entries(FILE_TYPE_CONFIG)) {
    // Check MIME type match
    const mimeTypeMatch = config.mimeTypes.some(mime =>
      normalizedMimeType.startsWith(mime.toLowerCase()),
    );

    // Check extension match
    const extensionMatch = config.extensions.some(ext =>
      normalizedFileName.endsWith(ext.toLowerCase()),
    );

    if (mimeTypeMatch || extensionMatch) {
      return {
        type: typeKey,
        component: config.component,
        wrapperClass: config.wrapperClass,
        displayName: config.displayName,
      };
    }
  }

  return null;
};

/**
 * Formats file size in bytes to human readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};
