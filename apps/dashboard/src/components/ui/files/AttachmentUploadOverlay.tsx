import React from 'react';
import * as Progress from '@radix-ui/react-progress';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import {
  formatUploadBytes,
  uploadPercent,
  type AttachmentUploadState,
} from '../../../utils/attachmentUploadProgress';

interface Props {
  upload: AttachmentUploadState;
  fileName: string;
  onRetry?: (() => void) | undefined;
}

function UploadBar({ upload }: { upload: AttachmentUploadState }): React.ReactElement {
  const percent = upload.phase === 'processing' ? 100 : uploadPercent(upload);
  return (
    <Progress.Root
      value={percent}
      max={100}
      aria-label='Upload progress'
      className='relative h-1 w-full overflow-hidden rounded-full bg-foreground/15'
    >
      <Progress.Indicator
        className={`h-full w-full bg-primary transition-transform duration-200 ease-out ${
          upload.phase === 'processing' ? 'animate-pulse' : ''
        }`}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </Progress.Root>
  );
}

function RetryButton({
  fileName,
  onRetry,
  compact,
}: {
  fileName: string;
  onRetry?: (() => void) | undefined;
  compact: boolean;
}): React.ReactElement | null {
  if (!onRetry) return null;
  return (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        onRetry();
      }}
      onKeyDown={e => e.stopPropagation()}
      data-track-category='MESSAGE_ATTACHMENT'
      data-track-name='RETRY_ATTACHMENT_UPLOAD'
      aria-label={`Retry uploading ${fileName}`}
      title='Retry upload'
      className={
        compact
          ? 'flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-destructive shadow-sm hover:bg-background'
          : 'flex items-center gap-1 text-xs font-medium text-destructive hover:underline'
      }
    >
      <RotateCcw className='size-3' />
      Retry
    </button>
  );
}

export const AttachmentUploadTileOverlay: React.FC<Props> = ({ upload, fileName, onRetry }) => {
  if (upload.phase === 'failed') {
    return (
      <div
        className='absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl bg-background/75 backdrop-blur-[1px]'
        title={upload.error ? `Upload failed: ${upload.error}` : 'Upload failed'}
        role='status'
        aria-label={`${fileName} failed to upload`}
      >
        <AlertCircle className='size-4 text-destructive' />
        <RetryButton fileName={fileName} onRetry={onRetry} compact />
      </div>
    );
  }

  return (
    <div
      className='absolute inset-0 z-10 flex flex-col justify-between rounded-xl bg-background/60 p-1.5'
      role='status'
      aria-label={
        upload.phase === 'processing'
          ? `Finishing upload of ${fileName}`
          : `Uploading ${fileName}, ${uploadPercent(upload)}%`
      }
    >
      <div className='flex flex-1 items-center justify-center'>
        {upload.phase === 'processing' ? (
          <Loader2 className='size-4 animate-spin text-foreground' />
        ) : (
          <span className='rounded bg-background/80 px-1 text-[10px] font-semibold tabular-nums text-foreground'>
            {uploadPercent(upload)}%
          </span>
        )}
      </div>
      <UploadBar upload={upload} />
    </div>
  );
};

export const AttachmentUploadRowStatus: React.FC<Props> = ({ upload, fileName, onRetry }) => {
  if (upload.phase === 'failed') {
    return (
      <span className='flex items-center gap-2 text-xs text-destructive' role='status'>
        <span title={upload.error}>Upload failed</span>
        <RetryButton fileName={fileName} onRetry={onRetry} compact={false} />
      </span>
    );
  }
  return (
    <span className='flex flex-col gap-1' role='status'>
      <span className='text-xs tabular-nums text-muted-foreground'>
        {upload.phase === 'processing'
          ? 'Finishing…'
          : `${formatUploadBytes(upload.loaded)} / ${formatUploadBytes(upload.total)}`}
      </span>
      <UploadBar upload={upload} />
    </span>
  );
};
