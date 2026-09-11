import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Database, Download, Share2, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { XyneAIStar } from '../../icons/xyne-ai';
import { detectFileType, FILE_TYPE_CONFIG } from '../../FileViewer/utils';
import { fetchFile, downloadFile } from '../../../services/clients/fileFetchService';
import { apiInstance } from '../../../services/clients/apiClient';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { KbCodeViewer } from './KbCodeViewer';
import { KbTxtViewer } from './KbTxtViewer';
import { KbPdfViewer } from './KbPdfViewer';
import { VespaDocView } from './VespaDocView';
import { ShareLinkModal } from '../../knowledgeBaseV2/components/ShareLinkModal';

// KB-local override map. Substitutes the shared viewers with the thin
// wrappers under `./Kb*Viewer.tsx`, which supply the full-size shell the KB
// route lays out against. Keys mirror the `FileType.type` strings emitted by
// `detectFileType`. Unmapped types fall through to the shared
// FILE_TYPE_CONFIG entry untouched.
const KB_VIEWER_OVERRIDES: Record<
  string,
  React.ComponentType<{
    source: File;
    fileName?: string;
    width?: number;
    height?: number;
    initialPage?: number;
    highlightQuery?: string;
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
  /** 1-based page to open the PDF on (from a citation deep-link `?page=`). */
  initialPage?: number;
  /** 0-based cited chunk index (from `?chunkIndex=`) — resolves a highlight snippet. */
  initialChunkIndex?: number;
  onOpenChat?: (docId: string, docName: string) => void;
}> = ({ handleBackNavigation, fileId, initialPage, initialChunkIndex, onOpenChat }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const [highlightQuery, setHighlightQuery] = useState<string | undefined>(undefined);
  const [vespaInspectorOpen, setVespaInspectorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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

  // Resolve the cited chunk's highlight snippet. Best-effort: on any failure we
  // leave it unset and the viewer degrades to a page-only jump.
  useEffect(() => {
    setHighlightQuery(undefined);
    if (!fileId || initialChunkIndex === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiInstance.get(`/collections/items/${fileId}/chunk`, {
          params: { index: initialChunkIndex },
        });
        if (cancelled) return;
        const chunkText = (res.data as { chunkText?: string | null })?.chunkText;
        if (typeof chunkText === 'string' && chunkText.trim().length >= 2) {
          setHighlightQuery(chunkText.trim());
        }
      } catch {
        // best-effort — leave highlight unset
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, initialChunkIndex]);

  useEffect(() => {
    setVespaInspectorOpen(false);
  }, [fileId]);

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
            data-track-category='knowledge-base'
            data-track-name='BACK_FROM_FILE_VIEWER'
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
              data-track-category='knowledge-base'
              data-track-name='BACK_FROM_FILE_VIEWER'
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
      <div className={`${config.wrapperClass} bg-background max-w-full max-h-full`}>
        <ViewerComponent
          source={fileData}
          fileName={file.name}
          {...(containerWidth ? { width: containerWidth } : {})}
          {...(initialPage ? { initialPage } : {})}
          {...(highlightQuery ? { highlightQuery } : {})}
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
    // `bg-background` is the shared page surface, so the file panel sits on
    // the same colour as the listing it came from.
    <div className='h-full w-full flex flex-col bg-background' ref={contentRef}>
      {/* Two-row toolbar, mirroring KnowledgeBaseV2Screen's header/breadcrumbRow
          split: an actions row (Ask AI / Vespa / Share / Download) with the
          divider, then a nav row below it (back / filename · meta). */}
      <div className='flex flex-shrink-0 items-center justify-end gap-2 border-b border-border bg-background px-5 py-2.5'>
        {onOpenChat && (
          <Tooltip content='Ask AI about this file' side='bottom'>
            <button
              type='button'
              onClick={() => onOpenChat(file.fileId, file.name)}
              aria-label='Ask AI'
              data-track-category='knowledge-base'
              data-track-name='file-viewer-open-ai-chat'
              className='inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition hover:bg-muted'
            >
              <XyneAIStar size={22} />
            </button>
          </Tooltip>
        )}

        <Tooltip content='View Vespa document' side='bottom'>
          <button
            type='button'
            onClick={() => setVespaInspectorOpen(open => !open)}
            aria-label='View Vespa document'
            aria-pressed={vespaInspectorOpen}
            data-track-category='knowledge-base'
            data-track-name='file-viewer-vespa-document'
            className={`grid h-8 w-8 place-items-center rounded-md transition ${
              vespaInspectorOpen
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Database className='h-4 w-4' strokeWidth={1.75} />
          </button>
        </Tooltip>

        <Tooltip content='Share' side='bottom'>
          <button
            type='button'
            onClick={() => setShareOpen(true)}
            aria-label='Share'
            data-track-category='knowledge-base'
            data-track-name='file-viewer-share'
            className='grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-primary'
          >
            <Share2 className='h-4 w-4' strokeWidth={1.75} />
          </button>
        </Tooltip>

        <button
          type='button'
          onClick={() => {
            void handleDownload();
          }}
          data-ph-capture-attribute-track-id='download_document'
          aria-label='Download'
          title='Download'
          className='grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
          data-track-category='knowledge-base'
          data-track-name='file-viewer-download'
        >
          <Download className='h-4 w-4' strokeWidth={1.75} />
        </button>
      </div>

      <div className='flex min-w-0 items-center gap-2 px-5 py-2.5'>
        <button
          type='button'
          onClick={handleBackNavigation}
          aria-label='Back'
          title='Back'
          className='grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
          data-track-category='knowledge-base'
          data-track-name='file-viewer-back'
        >
          <ArrowLeft className='h-3.5 w-3.5' strokeWidth={1.75} />
        </button>

        <div className='min-w-0 flex flex-1 items-baseline gap-2'>
          <span className='truncate text-[13.5px] font-medium text-foreground' title={file.name}>
            {file.name}
          </span>
          <span className='flex-shrink-0 text-[12px] text-muted-foreground'>
            {extLabel(file.name)} · {formatBytes(file.size)}
          </span>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 bg-background'>
        <div className='min-w-0 flex-1 overflow-auto'>{renderContent()}</div>
        {vespaInspectorOpen && fileId && (
          <aside
            className='flex h-full w-[420px] max-w-[45vw] flex-shrink-0 flex-col border-l border-border bg-background'
            aria-label='Vespa document inspector'
          >
            <div className='flex h-10 flex-shrink-0 items-center gap-2 border-b border-border px-3'>
              <Database className='h-4 w-4 text-muted-foreground' aria-hidden strokeWidth={1.75} />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[13px] font-medium text-foreground'>Vespa document</p>
              </div>
              <button
                type='button'
                onClick={() => setVespaInspectorOpen(false)}
                aria-label='Close Vespa document inspector'
                title='Close'
                data-track-category='knowledge-base'
                data-track-name='file-viewer-close-vespa-document'
                className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
              >
                <X className='h-4 w-4' strokeWidth={1.75} />
              </button>
            </div>
            <div className='min-h-0 flex-1'>
              <VespaDocView itemId={fileId} name={file.name} />
            </div>
          </aside>
        )}
      </div>

      {shareOpen && (
        <ShareLinkModal
          isOpen
          onClose={() => setShareOpen(false)}
          title={file.name}
          link={`${window.location.origin}${window.location.pathname}`}
        />
      )}
    </div>
  );
};
