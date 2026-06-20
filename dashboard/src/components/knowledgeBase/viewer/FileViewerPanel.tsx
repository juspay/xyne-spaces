import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Button } from '../../ui/Button';
import { detectFileType, FILE_TYPE_CONFIG } from '../../FileViewer/utils';
import { fetchFile, downloadFile } from '../../../services/clients/fileFetchService';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { KbCodeViewer } from './KbCodeViewer';
import { KbTxtViewer } from './KbTxtViewer';
import { KbPdfViewer } from './KbPdfViewer';

// KB-local override map. Substitutes the shared viewers with the thin
// wrappers under `./Kb*Viewer.tsx`, which apply `fileViewerOverrides.css`
// so the inner surfaces pick up the cream / midnight `ai-page-bg` instead
// of the shared `bg-background`. Keys mirror the `FileType.type` strings
// emitted by `detectFileType`. Unmapped types fall through to the shared
// FILE_TYPE_CONFIG entry untouched.
const KB_VIEWER_OVERRIDES: Record<
  string,
  React.ComponentType<{
    source: File;
    fileName?: string;
    width?: number;
    height?: number;
  }>
> = {
  code: KbCodeViewer,
  text: KbTxtViewer,
  pdf: KbPdfViewer,
};

// Minimal file viewer panel. One thin toolbar (back / filename · meta /
// download) above the existing FILE_TYPE_CONFIG preview switch. Mirrors
// xyne-search/ui2/src/components/PdfViewer.tsx's toolbar chrome — no
// gradient overlay, no Ask AI button, no breadcrumb row.

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function extLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase();
  return ext && ext !== name.toUpperCase() ? ext : 'File';
}

export const FileViewerPanel: React.FC<{
  handleBackNavigation: () => void;
  fileId: string | undefined;
}> = ({ handleBackNavigation, fileId }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileIdRef = useRef<string | undefined>(fileId);
  fileIdRef.current = fileId;
  const { nodes } = useProjectCollections();

  useEffect(() => {
    const updateWidth = () => {
      if (contentRef.current) {
        setContainerWidth(contentRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const getFileTypeFromMimeType = (mimeType: string): string | null => {
    if (mimeType && mimeType !== 'application/octet-stream') {
      return mimeType;
    }
    return null;
  };

  const getFileTypeFromName = (fileName: string): string => {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      md: 'text/markdown',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      csv: 'text/csv',
    };
    return mimeTypes[extension] || 'application/octet-stream';
  };

  const file = useMemo(() => {
    if (!fileId || !nodes[fileId]) {
      return null;
    }

    const node = nodes[fileId];
    const mimeType = node.mimeType || '';
    const name = node.name || '';

    const fileType = getFileTypeFromMimeType(mimeType) || getFileTypeFromName(name);

    return {
      id: fileId,
      // Stable file UUID = Vespa docId. Falls back to route id if missing.
      fileId: node.fileId ?? fileId,
      name,
      type: fileType,
      size: node.size || 0,
      mimeType,
    };
  }, [fileId, nodes]);

  const [fileForId, setFileForId] = useState<{ file: File; fileId: string } | null>(null);

  useEffect(() => {
    if (!fileId) {
      setFileForId(null);
      setFileData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setFileForId(null);
    setFileData(null);
    const requestedFileId = fileId;

    const loadFile = async (): Promise<void> => {
      try {
        const fetched = await fetchFile(
          `/collections/items/${requestedFileId}/download`,
          file?.name ?? requestedFileId,
          file?.mimeType ?? 'application/octet-stream',
        );
        if (requestedFileId !== fileIdRef.current) return;
        setFileForId({ file: fetched, fileId: requestedFileId });
      } catch {
        if (requestedFileId !== fileIdRef.current) return;
        setError('Failed to load file. Please try again.');
        setFileForId(null);
        setFileData(null);
      } finally {
        if (requestedFileId === fileIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    if (fileForId && fileForId.fileId === fileId) {
      setFileData(fileForId.file);
    } else {
      setFileData(null);
    }
  }, [fileForId, fileId]);

  if (!file) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center'>
          <p className='text-muted-foreground'>No file selected</p>
          <Button
            variant='outline'
            className='mt-4'
            onClick={() => {
              handleBackNavigation();
            }}
          >
            <ArrowLeft size={16} />
            Back to Collections
          </Button>
        </div>
      </div>
    );
  }

  const fileType = detectFileType(file.type, file.name);

  const renderContent = (): React.ReactElement | null => {
    if (isLoading) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-ring mx-auto mb-2'></div>
            <p className='text-muted-foreground'>Loading file...</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center'>
            <p className='text-destructive mb-4'>{error}</p>
            <Button
              variant='outline'
              onClick={() => {
                handleBackNavigation();
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
          </div>
        </div>
      );
    }

    if (!fileType || !fileData) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center text-muted-foreground'>
            <p>Preview not available for this file type</p>
          </div>
        </div>
      );
    }

    const config = FILE_TYPE_CONFIG[fileType.type];

    if (!config) {
      return (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center text-muted-foreground'>
            <p>Preview not available for this file type</p>
          </div>
        </div>
      );
    }

    // Prefer the KB-local wrapper when one exists for this file type so
    // the inner surface matches the page bg; otherwise fall through to
    // the shared viewer that chat / citations also use.
    const ViewerComponent = KB_VIEWER_OVERRIDES[fileType.type] ?? config.component;

    return (
      <div className={`${config.wrapperClass} ai-page-bg max-w-full max-h-full`}>
        <ViewerComponent
          source={fileData}
          fileName={file.name}
          {...(containerWidth ? { width: containerWidth } : {})}
        />
      </div>
    );
  };

  const handleDownload = async (): Promise<void> => {
    try {
      if (!fileId || !file) return;
      await downloadFile(`/collections/items/${fileId}/download`, file.name);
    } catch {
      setError('Failed to download file. Please try again.');
    }
  };

  return (
    // `ai-page-bg` is the KB root's background class — warm cream in
    // classic/summer_breeze, near-black in midnight. Pulling it onto the
    // viewer page so the file panel sits on the same surface as the
    // listing it came from instead of a flat white.
    <div className='h-full w-full flex flex-col ai-page-bg' ref={contentRef}>
      {/* Slim toolbar — back / filename · meta / download. Mirrors
          xyne-search's PdfViewer top bar; no gradient, no Ask-AI. */}
      <div className='flex h-12 flex-shrink-0 items-center gap-3 border-b border-border ai-page-bg px-3'>
        <button
          type='button'
          onClick={handleBackNavigation}
          aria-label='Back'
          title='Back'
          className='grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
          data-track-category='knowledge-base'
          data-track-name='file-viewer-back'
        >
          <ArrowLeft className='h-4 w-4' strokeWidth={1.75} />
        </button>

        <div className='min-w-0 flex flex-1 items-baseline gap-2'>
          <span className='truncate text-[13.5px] font-medium text-foreground' title={file.name}>
            {file.name}
          </span>
          <span className='flex-shrink-0 text-[12px] text-muted-foreground'>
            {extLabel(file.name)} · {formatBytes(file.size)}
          </span>
        </div>

        <button
          type='button'
          onClick={() => {
            void handleDownload();
          }}
          aria-label='Download'
          title='Download'
          className='grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
          data-track-category='knowledge-base'
          data-track-name='file-viewer-download'
        >
          <Download className='h-4 w-4' strokeWidth={1.75} />
        </button>
      </div>

      <div className='flex-1 overflow-auto ai-page-bg'>{renderContent()}</div>
    </div>
  );
};
