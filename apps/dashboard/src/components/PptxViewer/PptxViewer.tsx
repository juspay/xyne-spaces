import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Download, X, Presentation } from 'lucide-react';
import { PptSlideViewer } from '../PptSlideViewer';
import type { PptSlide } from '../PptSlideViewer';

export interface PptxViewerProps {
  attachmentId: string;
  downloadUrl: string;
  filename: string;
  title: string;
  base64Data?: string | undefined;
  slides?: PptSlide[] | undefined;
  slideCount?: number | undefined;
}

export const PptxViewer: React.FC<PptxViewerProps> = ({
  attachmentId,
  downloadUrl,
  filename,
  title,
  base64Data,
  slides,
  slideCount,
}) => {
  const [presenting, setPresenting] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  // Check if we have slide data for rendering
  const hasSlideData = slides && slides.length > 0;

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
        link.href = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64Data}`;
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
        message: String('[PptxViewer] Download failed:'),
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
            <Presentation size={14} className='text-muted-foreground flex-shrink-0' />
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
              data-track-name='PPTX_PREVIEW'
            >
              Preview
            </button>
            <div className='w-px h-3 bg-border' />
            <button
              onClick={() => void handleDownload()}
              className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
              data-track-category='XyneAI'
              data-track-name='PPTX_DOWNLOAD'
            >
              <Download size={12} />
              Download
            </button>
          </div>
        </div>

        {/* PPTX thumbnail/preview area */}
        <div className='p-3 bg-muted/30'>
          {hasSlideData ? (
            // Show first slide preview using PptSlideViewer
            <button
              onClick={enterPresent}
              className='w-full relative overflow-hidden rounded bg-white border border-border hover:opacity-90 transition-opacity'
              style={{ aspectRatio: '16/9', maxHeight: '200px' }}
              data-track-category='XyneAI'
              data-track-name='PPTX_SLIDE_PREVIEW'
            >
              <div className='w-full h-full overflow-hidden'>
                <PptSlideViewer
                  attachmentId={attachmentId || ''}
                  downloadUrl={downloadUrl}
                  filename={filename}
                  title={title}
                  slideCount={slideCount || slides.length}
                  slides={slides}
                />
              </div>
              {/* Overlay to indicate clickability */}
              <div className='absolute inset-0 bg-black/5 hover:bg-black/0 transition-colors' />
            </button>
          ) : (
            // Show PowerPoint icon when no slide data
            <button
              onClick={enterPresent}
              className='w-full relative overflow-hidden rounded bg-gradient-to-br from-orange-50 to-orange-100 border border-border flex items-center justify-center hover:opacity-90 transition-opacity'
              style={{ aspectRatio: '16/9', maxHeight: '200px' }}
              data-track-category='XyneAI'
              data-track-name='PPTX_ICON_PREVIEW'
            >
              <div className='flex flex-col items-center gap-2'>
                <div className='w-16 h-16 rounded-lg bg-orange-500 flex items-center justify-center shadow-lg'>
                  <Presentation size={32} className='text-white' />
                </div>
                <span className="text-xs text-muted-foreground font-['Inter']">
                  Click to preview
                </span>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen / Preview mode */}
      {presenting && (
        <div
          ref={fullscreenRef}
          role='dialog'
          aria-modal='true'
          aria-label='PPTX preview'
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: '#1a1a1a',
            display: 'flex',
            flexDirection: 'column',
          }}
          data-track-category='XyneAI'
          data-track-name='PPTX_FULLSCREEN_VIEWER'
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
              <Presentation size={16} className='text-orange-400 flex-shrink-0' />
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
                  background: '#ea580c',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                }}
                data-track-category='XyneAI'
                data-track-name='PPTX_FS_DOWNLOAD'
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
                data-track-name='PPTX_FS_CLOSE'
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* PPTX Viewer Content */}
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              position: 'relative',
              background: '#1a1a1a',
              padding: '16px',
            }}
          >
            {hasSlideData ? (
              // Render slides using PptSlideViewer
              <div className='w-full h-full max-w-4xl mx-auto'>
                <PptSlideViewer
                  attachmentId={attachmentId || ''}
                  downloadUrl={downloadUrl}
                  filename={filename}
                  title={title}
                  slideCount={slideCount || slides.length}
                  slides={slides}
                />
              </div>
            ) : (
              // Show placeholder when no slide data
              <div className='w-full h-full flex items-center justify-center'>
                <div className='text-center p-8'>
                  <div className='w-24 h-24 rounded-lg bg-orange-500 flex items-center justify-center mx-auto mb-6 shadow-lg'>
                    <Presentation size={48} className='text-white' />
                  </div>
                  <h3 className="text-xl font-semibold text-white font-['Inter'] mb-3">
                    PowerPoint Presentation
                  </h3>
                  <p className="text-sm text-gray-400 font-['Inter'] mb-6 max-w-md">
                    Slide preview is not available for this file.
                    <br />
                    Please download the file to view it.
                  </p>
                  <button
                    onClick={() => void handleDownload()}
                    data-track-category='XyneAI'
                    data-track-name='PPTX_FS_DOWNLOAD'
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '12px 24px',
                      borderRadius: 8,
                      background: '#ea580c',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    <Download size={18} />
                    Download Presentation
                  </button>
                </div>
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
            Press Esc to close • Download to view in PowerPoint
          </div>
        </div>
      )}
    </>
  );
};

export default PptxViewer;
