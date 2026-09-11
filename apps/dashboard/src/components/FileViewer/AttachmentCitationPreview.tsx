/**
 * AttachmentCitationPreview
 *
 * A lightweight slide-in panel for opening a message-attachment citation at a
 * specific page/sheet.  Uses CitationPdfViewer (no XState) for PDFs so that
 * initialPage scrolling works reliably.  All other extensions use the same
 * viewer components as the main FileViewerModal.
 *
 * The existing AttachmentGalleryModal is left completely untouched.
 *
 * Open by calling:
 *   attachmentCitationPreviewStore.open({ attachmentId, fileName, mimeType, initialPage })
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, FileText } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { fetchFile, downloadFile } from '../../services/clients/fileFetchService';
import { CitationPdfViewer } from './CitationPdfViewer';
import { DocxViewer } from './DocxViewer';
import CsvViewer from './CsvViewer';
import ExcelViewer from './ExcelViewer';
import ReadmeViewer from './ReadmeViewer';
import TxtViewer from './TxtViewer';
import HtmlViewer from './HtmlViewer';
import ImageViewer from './ImageViewer';
import PptxFileViewer from './PptxFileViewer';
import { DocumentOperationsProvider } from '../../contexts/DocumentOperationsContext';
import type { DocumentOperations } from '../../contexts/DocumentOperationsContext';
import { useScopedFind } from '../../hooks/useScopedFind';

// ----------------------------------------------------------------- store

export interface AttachmentCitationRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  /** 1-based page number (PDFs only). */
  initialPage?: number;
  /** Chunk text to highlight after the viewer opens. */
  chunkText?: string;
  /** 0-based chunk index (used as cache key). */
  chunkIndex?: number;
}

type Listener = () => void;

class AttachmentCitationPreviewStore {
  private state: { isOpen: boolean; ref: AttachmentCitationRef | null } = {
    isOpen: false,
    ref: null,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  getSnapshot() {
    return this.state;
  }

  open(ref: AttachmentCitationRef) {
    // Strip Vespa <hi> highlight tags that can appear in file names from search results
    const cleanedRef = {
      ...ref,
      fileName: ref.fileName.replace(/<\/?hi>/gi, ''),
    };
    this.state = { isOpen: true, ref: cleanedRef };
    this.notify();
  }

  close() {
    this.state = { isOpen: false, ref: this.state.ref };
    this.notify();
  }
}

export const attachmentCitationPreviewStore = new AttachmentCitationPreviewStore();

// --------------------------------------------------------- hook

function useStore() {
  const [snap, setSnap] = useState(() => attachmentCitationPreviewStore.getSnapshot());
  useEffect(() => {
    const unsub = attachmentCitationPreviewStore.subscribe(() =>
      setSnap(attachmentCitationPreviewStore.getSnapshot()),
    );
    return () => {
      unsub();
    };
  }, []);
  return snap;
}

// --------------------------------------------------------- helpers

function getExtension(mimeType: string, fileName: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return 'docx';
  if (mimeType === 'application/msword') return 'doc';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType === 'text/plain') return 'txt';
  if (mimeType === 'text/html') return 'html';
  if (mimeType === 'application/vnd.ms-excel') return 'xls';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return 'xlsx';
  if (mimeType === 'text/csv') return 'csv';
  if (mimeType === 'text/tsv') return 'tsv';
  if (mimeType === 'application/vnd.ms-powerpoint') return 'ppt';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    return 'pptx';
  if (mimeType.startsWith('image/')) return 'image';
  // fall back to filename extension
  return fileName.toLowerCase().split('.').pop() ?? '';
}

function getDefaultMimeType(ext: string): string {
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'html':
      return 'text/html';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'csv':
      return 'text/csv';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    default:
      return 'application/octet-stream';
  }
}

// --------------------------------------------------------- inner component

const AttachmentCitationPreviewInner: React.FC = () => {
  const { isOpen, ref } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentOperationsRef = useRef<DocumentOperations>({} as DocumentOperations);

  // useScopedFind — provides highlightText / clearHighlights for the viewer
  const { highlightText, clearHighlights } = useScopedFind(containerRef, {
    documentId: ref?.attachmentId,
  });

  // Wire the highlight functions onto documentOperationsRef so CitationPdfViewer
  // can call them via the same ref it exposes goToPage on
  useEffect(() => {
    if (documentOperationsRef.current) {
      documentOperationsRef.current.highlightText = highlightText;
      documentOperationsRef.current.clearHighlights = clearHighlights;
    }
  }, [highlightText, clearHighlights]);

  // Fetch file whenever the ref changes and the panel is open
  useEffect(() => {
    if (!isOpen || !ref) {
      setFile(null);
      setFetchError(null);
      clearHighlights();
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setFetchError(null);
    setFile(null);
    clearHighlights();

    // Clear PDF-specific operations so a stale goToPage from a previously
    // opened PDF doesn't cause useScopedFind to take the PDF code path for
    // non-PDF files (DOCX, TXT, etc.).
    const ext = getExtension(ref.mimeType, ref.fileName);
    if (ext !== 'pdf') {
      delete documentOperationsRef.current.goToPage;
      delete documentOperationsRef.current.waitForPageReady;
    }

    fetchFile(ref.attachmentId, ref.fileName, ref.mimeType)
      .then(f => {
        if (ctrl.signal.aborted) return;
        setFile(f);
      })
      .catch(err => {
        if (ctrl.signal.aborted) return;
        setFetchError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ref]);

  // Once the file is loaded, trigger highlight
  useEffect(() => {
    if (!file || !ref?.chunkText) return;
    // Give the viewer one tick to mount then highlight
    const t = setTimeout(() => {
      // pageIndex is 0-based; initialPage is 1-based
      const pageIndex = ref.initialPage !== undefined ? ref.initialPage - 1 : undefined;
      void highlightText(
        ref.chunkText!,
        ref.chunkIndex ?? 0,
        pageIndex,
        true, // waitForTextLayer
      );
    }, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, ref]);

  // Build the correct viewer based on extension — mirrors xyne CitationPreview
  const viewerElement = useMemo(() => {
    if (!file || !ref) return null;

    const ext = getExtension(ref.mimeType, ref.fileName);
    const fileWithType = new File([file], ref.fileName, {
      type: file.type || getDefaultMimeType(ext),
    });

    switch (ext) {
      case 'pdf':
        return (
          <CitationPdfViewer
            source={fileWithType}
            initialPage={ref.initialPage ?? 1}
            documentOperationsRef={documentOperationsRef}
          />
        );
      case 'md':
      case 'markdown':
        return <ReadmeViewer source={fileWithType} />;
      case 'docx':
      case 'doc':
        return <DocxViewer source={fileWithType} />;
      case 'xlsx':
      case 'xls':
        return <ExcelViewer source={fileWithType} />;
      case 'csv':
      case 'tsv':
        return <CsvViewer source={fileWithType} />;
      case 'pptx':
      case 'ppt':
        return <PptxFileViewer source={fileWithType} />;
      case 'txt':
      case 'text':
        return <TxtViewer source={fileWithType} />;
      case 'html':
        return <HtmlViewer source={fileWithType} />;
      case 'image':
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'svg':
        return <ImageViewer source={fileWithType} />;
      default:
        return (
          <div className='flex flex-col items-center justify-center h-full p-6 text-gray-500 dark:text-gray-400'>
            <FileText size={48} className='mb-4' />
            <p className='text-center text-sm'>Preview not available for this file type.</p>
          </div>
        );
    }
  }, [file, ref]);

  const handleDownload = () => {
    if (!ref) return;
    downloadFile(ref.attachmentId, ref.fileName).catch(error => {
      logger.error(Event.FRONTEND_ERROR, {
        type: 'attachment_download',
        message: 'Failed to download attachment',
        error,
      });
    });
  };

  const close = () => attachmentCitationPreviewStore.close();

  return (
    <Dialog.Root
      open={isOpen}
      modal={false}
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        {isOpen && (
          <div className='fixed inset-0 z-[70] pointer-events-none backdrop-blur-[2px] bg-black/10' />
        )}
        <Dialog.Content
          className='fixed z-[71] flex flex-col bg-white dark:bg-[#1E1E1E] shadow-2xl rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 left-14 right-[35vw] mx-auto top-1/2 -translate-y-1/2 w-[min(700px,48vw)] h-[85vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          aria-label='Citation file preview'
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          {/* Header */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0'>
            <div className='flex flex-col min-w-0'>
              <Dialog.Title className='text-sm font-semibold text-gray-900 dark:text-gray-100 truncate'>
                {ref?.fileName ?? 'File Preview'}
              </Dialog.Title>
              {ref?.initialPage && ref.initialPage > 1 && (
                <span className='text-xs text-gray-500 dark:text-gray-400'>
                  Page {ref.initialPage}
                </span>
              )}
            </div>
            <div className='flex items-center gap-2 flex-shrink-0'>
              <button
                onClick={handleDownload}
                className='p-1.5 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
                title='Download'
                data-track-category='CitationPreview'
                data-track-name='DOWNLOAD_FILE'
              >
                <Download className='h-4 w-4' />
              </button>
              <Dialog.Close asChild>
                <button
                  className='p-1.5 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
                  title='Close'
                >
                  <X className='h-4 w-4' />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Body */}
          <div className='flex-1 overflow-auto min-h-0'>
            {loading && (
              <div className='flex items-center justify-center h-full'>
                <div className='flex flex-col items-center gap-3'>
                  <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600' />
                  <p className='text-sm text-gray-500 dark:text-gray-400'>Loading file…</p>
                </div>
              </div>
            )}

            {fetchError && !loading && (
              <div className='flex items-center justify-center h-full p-6'>
                <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md text-center'>
                  <p className='text-red-800 dark:text-red-200 font-semibold'>
                    Failed to load file
                  </p>
                  <p className='text-red-600 dark:text-red-300 text-sm mt-1'>{fetchError}</p>
                </div>
              </div>
            )}

            {!loading && !fetchError && (
              // containerRef scopes useScopedFind's text search to the viewer area
              <div ref={containerRef} className='h-full' data-container-ref='true'>
                {viewerElement}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

// --------------------------------------------------------- exported component
// Wraps the inner component in DocumentOperationsProvider so useScopedFind
// can access documentOperationsRef through context.

export const AttachmentCitationPreview: React.FC = () => (
  <DocumentOperationsProvider>
    <AttachmentCitationPreviewInner />
  </DocumentOperationsProvider>
);

export default AttachmentCitationPreview;
import { Event, logger } from '../../utils/logger';
