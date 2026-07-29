import { useState, useCallback, memo } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadAttachment } from './utils';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';

type DownloadButtonVariant = 'default' | 'overlay';

interface DownloadButtonProps {
  attachmentId: string;
  fileName: string;
  variant?: DownloadButtonVariant;
  onDownloadStart?: () => void;
  onDownloadComplete?: () => void;
  onDownloadError?: (error: Error) => void;
  showLabel?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<DownloadButtonVariant, string> = {
  default: 'text-muted-foreground flex-shrink-0 disabled:cursor-not-allowed',
  overlay: 'hover:bg-muted text-background',
} as const;

const ICON_SIZES: Record<DownloadButtonVariant, number> = {
  default: 15,
  overlay: 18,
} as const;

export const DownloadButton = memo<DownloadButtonProps>(
  ({
    attachmentId,
    fileName,
    variant = 'default',
    onDownloadStart,
    onDownloadComplete,
    onDownloadError,
    showLabel = false,
    className,
  }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownload = useCallback(
      async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();

        setIsDownloading(true);
        onDownloadStart?.();

        try {
          await downloadAttachment(attachmentId, fileName);
          onDownloadComplete?.();
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Download failed');
          onDownloadError?.(err);
          toast.error(`Failed to download ${fileName}`, {
            description: err.message || 'Please try again later.',
          });
        } finally {
          setIsDownloading(false);
        }
      },
      [attachmentId, fileName, onDownloadStart, onDownloadComplete, onDownloadError],
    );

    const buttonLabel = isDownloading ? 'Downloading...' : `Download ${fileName}`;

    return (
      <button
        type='button'
        onClick={e => void handleDownload(e)}
        disabled={isDownloading}
        className={`p-2 rounded-md text-foreground transition-colors duration-200 disabled:opacity-50 ${VARIANT_STYLES[variant]}`}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-busy={isDownloading}
        data-track-category='MESSAGE_ATTACHMENT'
        data-track-name='DownloadAttachment'
        data-track-metadata={JSON.stringify({ fileName, attachmentId })}
      >
        {isDownloading ? (
          <div className='flex items-center gap-2'>
            <Loader2 size={ICON_SIZES[variant]} className='animate-spin' aria-hidden='true' />
            {showLabel && <span className={cn('ml-2 text-sm', className)}>Downloading...</span>}
          </div>
        ) : (
          <div className='flex items-center gap-2'>
            <Download size={ICON_SIZES[variant]} aria-hidden='true' />
            {showLabel && <span className={cn('ml-2 text-sm', className)}>Download</span>}
          </div>
        )}
      </button>
    );
  },
);

DownloadButton.displayName = 'DownloadButton';
