// ============================================================================
// MEDIA VIEWER COMPONENT
// ============================================================================
// Full-screen viewer for file attachments
// ============================================================================

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import {
  getFileCategory,
  parseCSV,
  isBrowserSupported as checkBrowserSupport,
} from '../utils/files';
import type { MediaViewerProps } from './Files.types';
import { useScope, useShortcutById } from '../../../shortcuts';

export const MediaViewer: React.FC<MediaViewerProps> = ({
  file,
  isOpen,
  onClose,
  showDownload = false,
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<string[][] | null>(null);

  const category = getFileCategory(file);
  const isBrowserSupported = checkBrowserSupport(file);

  useScope('modal', isOpen);

  useShortcutById(
    'modal.close',
    () => {
      onClose();
    },
    {
      enabled: isOpen,
    },
  );

  // Create object URL and read file content
  useEffect((): (() => void) | void => {
    if (!file) return;

    const url = URL.createObjectURL(file);
    setObjectUrl(url);

    // Read text-based files
    if (category === 'text' || category === 'csv') {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>): void => {
        const text = e.target?.result as string;
        setTextContent(text);

        // Parse CSV data
        if (category === 'csv') {
          setCsvData(parseCSV(text));
        }
      };
      reader.readAsText(file);
    }

    return (): void => {
      URL.revokeObjectURL(url);
      setTextContent(null);
      setCsvData(null);
    };
  }, [file, category]);

  // Handle body scroll lock
  useEffect((): (() => void) | void => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }

    return (): void => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !objectUrl) return null;

  const handleDownload = (): void => {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderContent = (): React.ReactElement | null => {
    switch (category) {
      case 'image':
        return (
          <img
            src={objectUrl}
            alt={file.name}
            className='w-full h-full object-contain max-h-[90vh]'
          />
        );

      case 'video':
        return (
          <video src={objectUrl} controls autoPlay className='w-full h-full max-h-[90vh]'>
            <track kind='captions' />
          </video>
        );

      case 'audio':
        return (
          <div className='bg-background rounded-lg p-12 flex flex-col items-center justify-center gap-6'>
            <div className='text-center'>
              <p className='text-lg font-semibold text-foreground mb-2'>{file.name}</p>
              <p className='text-sm text-muted-foreground'>Audio file</p>
            </div>
            <audio src={objectUrl} controls autoPlay className='w-full max-w-md'>
              <track kind='captions' />
            </audio>
          </div>
        );

      case 'pdf':
        return (
          <iframe
            src={objectUrl}
            title={file.name}
            className='w-full h-[90vh] bg-background rounded-lg'
          />
        );

      case 'csv':
        return csvData && csvData.length > 0 ? (
          <div className='bg-background rounded-lg p-6 max-h-[90vh] overflow-auto'>
            <table className='min-w-full divide-y divide-border'>
              <thead className='bg-muted sticky top-0'>
                <tr>
                  {csvData[0]?.map((header, index) => (
                    <th
                      key={index}
                      className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className='bg-background divide-y divide-border'>
                {csvData.slice(1).map((row, rowIndex) => (
                  <tr key={rowIndex} className='hover:bg-muted'>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className='px-6 py-4 whitespace-nowrap text-sm text-foreground'
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null;

      case 'text':
        return textContent ? (
          <div className='bg-background rounded-lg p-6 max-h-[90vh] overflow-auto'>
            <pre className='text-sm font-mono whitespace-pre-wrap break-words text-foreground'>
              {textContent}
            </pre>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  return createPortal(
    <div
      role='button'
      tabIndex={0}
      aria-label='File viewer - click or press Enter to close'
      className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 pointer-events-auto'
      onClick={onClose}
      data-track-category='FileViewer'
      data-track-name='CLOSE_MEDIA_VIEWER_BACKDROP'
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* Header Controls */}
      <div className='absolute top-4 left-4 right-4 flex items-center justify-between z-10'>
        <p className='text-white text-sm font-medium truncate max-w-md'>{file.name}</p>

        <div className='flex items-center gap-2'>
          {showDownload && (
            <button
              onClick={(e): void => {
                e.stopPropagation();
                handleDownload();
              }}
              data-track-category='FileViewer'
              data-track-name='DOWNLOAD_FROM_MEDIA_VIEWER'
              className='p-2 rounded-full hover:bg-background/10 transition-colors text-white'
              title='Download file'
            >
              <Download className='h-6 w-6' />
            </button>
          )}
          <button
            onClick={onClose}
            data-track-category='FileViewer'
            data-track-name='CLOSE_MEDIA_VIEWER'
            className='p-2 rounded-full hover:bg-background/10 transition-colors text-white'
            title='Close (Esc)'
          >
            <X className='h-6 w-6' />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        role='presentation'
        className='max-w-7xl max-h-[90vh] w-full mx-4'
        onClick={(e): void => e.stopPropagation()}
        onKeyDown={(e): void => e.stopPropagation()}
      >
        {isBrowserSupported ? (
          renderContent()
        ) : (
          <div className='bg-background rounded-lg p-12 text-center flex flex-col items-center justify-center gap-6'>
            <div>
              <p className='text-lg font-semibold text-foreground mb-2'>{file.name}</p>
              <p className='text-muted-foreground'>Viewing in browser not supported</p>
            </div>
            <button
              onClick={onClose}
              data-track-category='FileViewer'
              data-track-name='CLOSE_MEDIA_VIEWER'
              className='px-6 py-2 bg-muted-foreground text-white rounded-lg hover:bg-foreground transition-colors'
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
