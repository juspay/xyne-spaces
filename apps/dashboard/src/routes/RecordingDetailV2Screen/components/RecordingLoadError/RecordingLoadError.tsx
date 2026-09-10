import type { ReactElement } from 'react';
import { AlertCircle, ArrowLeft, LockClose, UturnLeft } from '@xyne/icons';
import { Button } from '../../../../components/ui/Button/Button';
import { cn } from '../../../../utils/classNames';
import { describeRecordingLoadFailure, type RecordingLoadFailure } from './recordingLoadError.util';

export interface RecordingLoadErrorProps {
  failure: RecordingLoadFailure;
  viewerEmail?: string | undefined;
  onBack: () => void;
}

export function RecordingLoadError({
  failure,
  viewerEmail,
  onBack,
}: RecordingLoadErrorProps): ReactElement {
  const isAccessWall = failure.kind === 'no-access';
  const copy = describeRecordingLoadFailure(failure);

  return (
    <div
      data-testid='recording-detail-v2-page'
      className='relative flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      <div className='h-full w-full overflow-y-auto'>
        <div className='mx-auto flex min-h-full w-full max-w-[860px] flex-col px-4 py-6'>
          <header className='mb-6'>
            {/* The one live control up here: getting back out. */}
            <nav aria-label='Breadcrumb' className='mb-3'>
              <ol className='flex items-center gap-1.5 text-sm'>
                <li>
                  <button
                    type='button'
                    onClick={onBack}
                    className='flex items-center gap-1.5 text-muted-foreground transition-colors duration-300 hover:text-foreground'
                    data-track-category='RecordingDetailV2'
                    data-track-name='breadcrumb_recordings_from_error'
                  >
                    <UturnLeft className='size-3.5' variant='Stroke' aria-hidden='true' />
                    Recordings
                  </button>
                </li>
                <li aria-hidden='true' className='text-muted-foreground'>
                  /
                </li>
                <li aria-hidden='true'>
                  <Bar className='h-3 w-44' />
                </li>
              </ol>
            </nav>

            {/* Title, date and chips: known to exist, not known to us. */}
            <div aria-hidden='true'>
              <div className='mb-4'>
                <div className='flex h-9 items-center'>
                  <Frame className='h-7 w-[24rem] max-w-full rounded-lg' />
                </div>
                <div className='mt-2.5 flex h-5 items-center'>
                  <Bar className='h-3 w-52' />
                </div>
              </div>

              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Frame className='h-7 w-16 rounded-lg' />
                  <Frame className='h-7 w-32 rounded-lg' />
                  <Frame className='h-7 w-8 rounded-lg' />
                </div>
                <Frame className='h-8 w-24 rounded-xl' />
              </div>
            </div>
          </header>

          <div className='flex flex-col pt-2'>
            {/* The player's slot, carrying the reason instead. */}
            <div className='mb-6 rounded-2xl border border-dotted border-border bg-card px-6 py-10'>
              <div role='alert' className='mx-auto flex max-w-[420px] flex-col items-center'>
                <span
                  className={cn(
                    'flex size-11 items-center justify-center rounded-full ring-1',
                    isAccessWall
                      ? 'bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25'
                      : 'bg-destructive/10 text-destructive ring-destructive/20',
                  )}
                  aria-hidden='true'
                >
                  {isAccessWall ? (
                    <LockClose className='size-5' strokeWidth={1.9} />
                  ) : (
                    <AlertCircle className='size-5' strokeWidth={1.9} />
                  )}
                </span>

                <h1 className='mt-5 text-balance text-center text-[17px] font-semibold tracking-[-0.01em] text-foreground'>
                  {copy.title}
                </h1>
                <p className='mt-2 max-w-[38ch] text-pretty text-center text-sm leading-6 text-muted-foreground'>
                  {copy.description}
                </p>

                <Button
                  type='button'
                  size={null}
                  onClick={onBack}
                  className='mt-6 h-9 gap-2 rounded-full bg-foreground px-5 text-[13px] font-medium text-background shadow-sm hover:bg-foreground/90 hover:text-background'
                  data-track-category='RecordingDetailV2'
                  data-track-name='back_to_recordings_from_error'
                >
                  <ArrowLeft className='size-4' aria-hidden='true' />
                  Back to recordings
                </Button>

                {/* Being on the other account is a quiet, common cause of an access wall. */}
                {isAccessWall && viewerEmail && (
                  <p className='mt-6 text-center text-xs text-muted-foreground/70'>
                    Signed in as{' '}
                    <span className='font-medium text-muted-foreground'>{viewerEmail}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A soft bar standing in for a run of text that never arrived. */
function Bar({ className }: { className: string }): ReactElement {
  return <div className={cn('rounded-full bg-muted', className)} />;
}

/** A dotted outline standing in for a control or a container. */
function Frame({ className }: { className: string }): ReactElement {
  return <div className={cn('border border-dotted border-border', className)} />;
}

export default RecordingLoadError;
