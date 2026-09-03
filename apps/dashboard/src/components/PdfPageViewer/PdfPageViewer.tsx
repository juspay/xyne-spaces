import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Download, Maximize2, X, FileText } from 'lucide-react';

export interface PdfPageViewerProps {
  attachmentId: string;
  downloadUrl: string;
  filename: string;
  title: string;
  pageCount?: number;
  base64Data?: string | undefined;
}

export const PdfPageViewer: React.FC<PdfPageViewerProps> = ({
  downloadUrl,
  filename,
  title,
  base64Data,
}) => {
  const [presenting, setPresenting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const fullscreenRef = useRef<HTMLDivElement>(null);

  // Initialize preview URL from base64 if available
  useEffect(() => {
    if (base64Data) {
      setPreviewUrl(`data:application/pdf;base64,${base64Data}`);
    } else if (downloadUrl) {
      // Fetch PDF as blob for preview (avoids Content-Disposition: attachment issue)
      const fetchPdf = async () => {
        try {
          const { apiInstance } = await import('../../services/clients/apiClient');
          const response = await apiInstance.get(downloadUrl, {
            responseType: 'blob',
          });
          const blob = response.data as Blob;
          const blobUrl = URL.createObjectURL(blob);
          setPreviewUrl(blobUrl);
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[PdfPageViewer] Failed to load PDF for preview:'),
            error: error,
          });
        }
      };
      void fetchPdf();
    }

    // Cleanup blob URL on unmount
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [base64Data, downloadUrl]);

  const enterPresent = useCallback(() => {
    setPresenting(true);
    setTimeout(() => {
      void fullscreenRef.current?.requestFullscreen().catch(() => {
        // Fullscreen not supported or denied — overlay still shows
      });
    }, 50);
  }, []);

  const exitPresent = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  // Sync presenting state when user presses Esc
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && presenting) {
        setPresenting(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [presenting]);

  // Keyboard shortcuts in present mode
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitPresent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, exitPresent]);

  const handleDownload = useCallback(async () => {
    try {
      // If we have base64 data, download directly
      if (base64Data) {
        const link = document.createElement('a');
        link.href = `data:application/pdf;base64,${base64Data}`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      // Otherwise, fetch from API using the download URL
      const { apiInstance } = await import('../../services/clients/apiClient');

      const response = await apiInstance.get(downloadUrl, {
        responseType: 'blob',
      });

      const blob = response.data as Blob;
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[PdfPageViewer] Download failed:'),
        error: error,
      });
    }
  }, [downloadUrl, filename, base64Data]);

  const titleMaxChars = 30;
  const displayTitle = title.length > titleMaxChars ? `${title.slice(0, titleMaxChars)}…` : title;

  return (
    <>
      <div className='w-full rounded-xl border border-border bg-card overflow-hidden'>
        {/* Title bar */}
        <div className='flex items-center justify-between px-3 py-2 border-b border-border'>
          <div className='flex items-center gap-2 min-w-0'>
            <FileText size={14} className='text-muted-foreground flex-shrink-0' />
            <span
              className="text-xs font-semibold text-foreground font-['Inter'] truncate"
              title={title}
            >
              {displayTitle}
            </span>
          </div>
          <div className='flex items-center gap-2 ml-2 flex-shrink-0'>
            <button
              onClick={enterPresent}
              className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
              data-track-category='XyneAI'
              data-track-name='PDF_PREVIEW'
            >
              <Maximize2 size={12} />
              Preview
            </button>
            <div className='w-px h-3 bg-border' />
            <button
              onClick={() => void handleDownload()}
              className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
              data-track-category='XyneAI'
              data-track-name='PDF_DOWNLOAD'
            >
              <Download size={12} />
              Download
            </button>
          </div>
        </div>

        {/* PDF thumbnail/preview area */}
        <div className='p-3 bg-muted/30'>
          <div
            style={{ aspectRatio: '1/1.414' }}
            className='relative w-full max-h-[300px] overflow-hidden rounded bg-white border border-border'
          >
            {previewUrl ? (
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                title={filename}
                className='w-full h-full pointer-events-none'
                style={{ border: 'none' }}
              />
            ) : (
              <div className='w-full h-full flex items-center justify-center bg-muted'>
                <FileText size={48} className='text-muted-foreground' />
              </div>
            )}
            {/* Overlay gradient to indicate it's a preview */}
            <div className='absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none' />
          </div>
        </div>
      </div>

      {/* Fullscreen / Preview mode */}
      {presenting && (
        <div
          ref={fullscreenRef}
          role='dialog'
          aria-modal='true'
          aria-label='PDF preview'
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: '#1a1a1a',
            display: 'flex',
            flexDirection: 'column',
          }}
          data-track-category='XyneAI'
          data-track-name='PDF_FULLSCREEN_VIEWER'
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#2a2a2a',
              borderBottom: '1px solid #3a3a3a',
            }}
          >
            <div className='flex items-center gap-2 min-w-0'>
              <FileText size={16} className='text-gray-400 flex-shrink-0' />
              <span
                style={{
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={title}
              >
                {displayTitle}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => void handleDownload()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: '#3a3a3a',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
                data-track-category='XyneAI'
                data-track-name='PDF_FS_DOWNLOAD'
              >
                <Download size={14} />
                Download
              </button>
              <button
                onClick={exitPresent}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                  borderRadius: 6,
                  background: '#3a3a3a',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
                data-track-category='XyneAI'
                data-track-name='PDF_FS_CLOSE'
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* PDF Viewer */}
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {previewUrl ? (
              <iframe
                src={`${previewUrl}#toolbar=1&navpanes=1`}
                title={filename}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#1a1a1a',
                }}
              />
            ) : (
              <div className='w-full h-full flex items-center justify-center'>
                <FileText size={64} className='text-gray-600' />
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: '8px 16px',
              background: '#2a2a2a',
              borderTop: '1px solid #3a3a3a',
              textAlign: 'center',
              fontSize: 12,
              color: '#888',
            }}
          >
            Use the PDF toolbar for zoom and navigation • Press Esc to close
          </div>
        </div>
      )}
    </>
  );
};

export default PdfPageViewer;
