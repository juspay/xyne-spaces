import React, { useEffect, useRef, useState } from 'react';
import { Presentation, Download } from 'lucide-react';
import type { BaseViewerProps } from './utils';
import PdfViewer from './PdfViewer';
import { apiInstance } from '../../services/clients/apiClient';
import { logger, Event as LogEvent } from '../../utils/logger';

/**
 * .ppt/.pptx viewer for the shared FileViewer registry — converts the
 * already-fetched raw file to PDF server-side (LibreOffice, via the backend's
 * /api/office-conversion/pdf endpoint) and hands the result to the existing
 * PdfViewer.
 *
 * Why not parse the OOXML client-side and render it directly (the prior
 * approach): that means reimplementing pieces of PowerPoint's own layout
 * engine — placeholder inheritance, theme colors, custom freeform geometry,
 * picture recolor/crop effects — one gap at a time, and OOXML is too large a
 * spec to ever get pixel-exact that way. LibreOffice already implements the
 * full spec, so shelling out to it for the actual rendering (the same
 * approach Drive/Slack/Notion previews use) gets genuine fidelity instead of
 * an ever-growing list of approximations.
 */
const PptxFileViewer: React.FC<BaseViewerProps> = props => {
  const { source, fileName } = props;
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setPdfFile(null);
    setStatus('loading');
    if (!source) return;

    let cancelled = false;
    const formData = new FormData();
    formData.append('file', source, source.name);

    apiInstance
      .post('/office-conversion/pdf', formData, { responseType: 'blob' })
      .then(response => {
        if (cancelled) return;
        const blob = response.data as Blob;
        const displayName = (fileName ?? source.name).replace(/\.(pptx|ppt)$/i, '.pdf');
        setPdfFile(new File([blob], displayName, { type: 'application/pdf' }));
        setStatus('ready');
      })
      .catch(error => {
        if (cancelled) return;
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[PptxFileViewer] Failed to convert .pptx file to PDF:'),
          error,
        });
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [source, fileName]);

  useEffect(() => {
    if (!source) return;
    const url = URL.createObjectURL(source);
    objectUrlRef.current = url;
    return () => {
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
    };
  }, [source]);

  const displayName = fileName ?? 'Presentation';

  if (status === 'loading') {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-action-primary mx-auto mb-3' />
          <p className='text-muted-foreground dark:text-muted text-sm'>Loading presentation...</p>
        </div>
      </div>
    );
  }

  if (status === 'error' || !pdfFile) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center'>
        <div className='flex h-20 w-20 items-center justify-center rounded-lg bg-orange-500 shadow-lg'>
          <Presentation size={40} className='text-white' />
        </div>
        <div>
          <h3 className='text-base font-semibold text-foreground'>PowerPoint Presentation</h3>
          <p className='mt-2 max-w-md text-sm text-muted-foreground'>
            Preview is not available for this file.
            <br />
            Download the file to view it.
          </p>
        </div>
        {objectUrlRef.current && (
          <a
            href={objectUrlRef.current}
            download={displayName}
            className='inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700'
          >
            <Download size={16} />
            Download Presentation
          </a>
        )}
      </div>
    );
  }

  return <PdfViewer {...props} source={pdfFile} fileName={displayName} />;
};

export default PptxFileViewer;
