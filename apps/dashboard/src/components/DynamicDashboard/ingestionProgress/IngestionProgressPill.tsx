import { ReactElement } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import {
  overallPercent,
  ingestionCount,
  type IngestionProgress,
} from '../../../hooks/useIngestionProgress';

export interface IngestionProgressPillProps {
  progress: IngestionProgress;
  onClick: () => void;
  onDismiss: () => void;
}

export const IngestionProgressPill = ({
  progress,
  onClick,
  onDismiss,
}: IngestionProgressPillProps): ReactElement => {
  const { status } = progress;
  const running = status === 'running';
  const pct = overallPercent(progress);
  const count = ingestionCount(progress);

  const label = running
    ? `Profiling ${progress.name ?? 'source'}…`
    : status === 'complete'
      ? `${progress.name ?? 'Source'} ready`
      : status === 'partial'
        ? `${progress.name ?? 'Source'} ready · ${progress.failed} failed`
        : `${progress.name ?? 'Source'} failed`;

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      data-track-category='DYNAMIC_DASHBOARD'
      data-track-name='Open_Ingestion_Progress'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'mx-4 mb-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors',
        running
          ? 'bg-xyne-gray-50 border-xyne-gray-200 text-xyne-gray-700 hover:bg-xyne-gray-100'
          : status === 'complete'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
            : status === 'partial'
              ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
              : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100',
      )}
      title='Show profiling details'
    >
      <div className='flex items-center gap-1.5'>
        {running ? (
          <Loader2 className='animate-spin motion-reduce:animate-none size-3 shrink-0' />
        ) : status === 'complete' ? (
          <CheckCircle2 className='size-3 shrink-0' />
        ) : status === 'partial' ? (
          <AlertTriangle className='size-3 shrink-0' />
        ) : (
          <AlertCircle className='size-3 shrink-0' />
        )}
        <span className='truncate'>{label}</span>
        <span className='ml-auto font-mono tabular-nums shrink-0'>{count}</span>
        {!running && (
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onDismiss();
            }}
            className='p-0.5 rounded hover:bg-black/5 shrink-0'
            aria-label='Dismiss'
            data-track-category='DYNAMIC_DASHBOARD'
            data-track-name='Dismiss_Ingestion_Progress'
          >
            <X size={11} />
          </button>
        )}
      </div>
      {running && (
        <div className='mt-1.5 h-0.5 rounded-full bg-xyne-gray-200 overflow-hidden'>
          <div
            className='h-full bg-xyne-gray-900 transition-[width] duration-300'
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
};
