import { useState, type ReactElement } from 'react';
import { Download, FolderOpen, Pause, Play, X } from 'lucide-react';
import Popover from '../ui/Popover';
import { cn } from '../../utils/classNames';
import { ToolbarButton } from './ToolbarButton';
import {
  actOnDownload,
  clearFinishedDownloads,
  useBrowserDownloads,
  type BrowserDownload,
} from './downloads';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function statusOf(download: BrowserDownload): string {
  if (download.state === 'completed') return size(download.received);
  if (download.state === 'cancelled') return 'Cancelled';
  if (download.state === 'interrupted') return 'Failed';
  const so = download.total
    ? `${size(download.received)} of ${size(download.total)}`
    : size(download.received);
  return download.paused ? `Paused · ${so}` : so;
}

function RowButton(props: {
  label: string;
  onClick: () => void;
  trackName: string;
  children: ReactElement;
}): ReactElement {
  return (
    <button
      type='button'
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      className='flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:text-foreground'
      data-track-category='BROWSER'
      data-track-name={props.trackName}
    >
      {props.children}
    </button>
  );
}

/**
 * The browser's downloads, as Chrome keeps them: a button in the bar — filling as
 * files come in — that lists them, each to open or find in Finder once in, or to
 * pause or cancel while coming. Nothing until the first download.
 */
export function DownloadsButton(props: {
  /** Smaller, for a slim header. */
  compact?: boolean;
}): ReactElement | null {
  const downloads = useBrowserDownloads();
  const [open, setOpen] = useState(false);
  if (downloads.length === 0) return null;

  const coming = downloads.filter(download => download.state === 'progressing');
  const received = coming.reduce((sum, download) => sum + download.received, 0);
  const total = coming.reduce((sum, download) => sum + download.total, 0);
  const progress = coming.length > 0 && total > 0 ? received / total : null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='end'
      className='w-80 p-1.5'
      trigger={
        <ToolbarButton
          label={coming.length > 0 ? `Downloading ${coming.length}` : 'Downloads'}
          pressed={open}
          trackCategory='BROWSER'
          trackName='DownloadsOpened'
          className={cn('relative', props.compact && 'size-6')}
        >
          <Download className={props.compact ? 'size-3.5' : 'size-4'} />
          {/* How far the files coming in have got, as a ring round the button. */}
          {coming.length > 0 && (
            <svg
              aria-hidden='true'
              viewBox='0 0 28 28'
              className={cn('absolute inset-0 -rotate-90', props.compact ? 'size-6' : 'size-7')}
            >
              <circle
                cx='14'
                cy='14'
                r='12'
                fill='none'
                strokeWidth='2'
                className='stroke-border'
              />
              {progress !== null && (
                <circle
                  cx='14'
                  cy='14'
                  r='12'
                  fill='none'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeDasharray={2 * Math.PI * 12}
                  strokeDashoffset={2 * Math.PI * 12 * (1 - progress)}
                  className='stroke-primary transition-[stroke-dashoffset] duration-300'
                />
              )}
            </svg>
          )}
        </ToolbarButton>
      }
    >
      <div className='flex items-center justify-between px-2 pb-1 pt-0.5'>
        <p className='text-[12.5px] font-medium text-foreground'>Downloads</p>
        {downloads.some(download => download.state !== 'progressing') && (
          <button
            type='button'
            onClick={clearFinishedDownloads}
            className='rounded px-1 text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground'
            data-track-category='BROWSER'
            data-track-name='DownloadsCleared'
          >
            Clear
          </button>
        )}
      </div>
      <div className='max-h-80 overflow-y-auto'>
        {downloads.map(download => {
          const done = download.state === 'completed';
          const opens = done && download.canOpen;
          const coming = download.state === 'progressing';
          return (
            <div key={download.id} className='flex items-center gap-2 rounded-lg px-2 py-1.5'>
              <button
                type='button'
                disabled={!opens}
                onClick={() => actOnDownload(download.id, 'open')}
                title={
                  opens
                    ? `Open ${download.filename}`
                    : done
                      ? `${download.filename} runs something when opened: open it from Finder, where macOS checks it first`
                      : download.filename
                }
                className='min-w-0 flex-1 text-left outline-none disabled:cursor-default'
                data-track-category='BROWSER'
                data-track-name='DownloadOpened'
              >
                <span
                  className={cn(
                    'block truncate text-[12.5px]',
                    download.state === 'cancelled' || download.state === 'interrupted'
                      ? 'text-muted-foreground line-through'
                      : 'text-foreground',
                  )}
                >
                  {download.filename}
                </span>
                <span className='block text-[11.5px] text-muted-foreground'>
                  {statusOf(download)}
                </span>
                {coming && download.total > 0 && (
                  <span className='mt-1 block h-1 overflow-hidden rounded-full bg-muted'>
                    <span
                      className='block h-full rounded-full bg-primary transition-[width] duration-300'
                      style={{ width: `${(download.received / download.total) * 100}%` }}
                    />
                  </span>
                )}
              </button>
              {done && (
                <RowButton
                  label='Show in Finder'
                  onClick={() => actOnDownload(download.id, 'show')}
                  trackName='DownloadShown'
                >
                  <FolderOpen className='size-3.5' />
                </RowButton>
              )}
              {coming && (
                <RowButton
                  label={download.paused ? 'Resume' : 'Pause'}
                  onClick={() => actOnDownload(download.id, download.paused ? 'resume' : 'pause')}
                  trackName={download.paused ? 'DownloadResumed' : 'DownloadPaused'}
                >
                  {download.paused ? <Play className='size-3.5' /> : <Pause className='size-3.5' />}
                </RowButton>
              )}
              {coming && (
                <RowButton
                  label='Cancel'
                  onClick={() => actOnDownload(download.id, 'cancel')}
                  trackName='DownloadCancelled'
                >
                  <X className='size-3.5' />
                </RowButton>
              )}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
