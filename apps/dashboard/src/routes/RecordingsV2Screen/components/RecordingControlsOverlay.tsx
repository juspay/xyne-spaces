import type { ReactElement } from 'react';
import { CommandCmd, MicOn, Spinner } from '@xyne/icons';
import { motion, useReducedMotion } from 'framer-motion';
import { usePlatform } from '../../../hooks/usePlatform';
import type { RecordingState } from '../../../stores/recordingStore';
import { cn } from '../../../utils/classNames';

export interface RecordingControlsOverlayProps {
  status: RecordingState['status'];
  onStart: () => void;
}

const RecordingControlsOverlay = ({
  status,
  onStart,
}: RecordingControlsOverlayProps): ReactElement | null => {
  const { isMac: isApplePlatform } = usePlatform();
  const shouldReduceMotion = useReducedMotion();
  const isStarting = status === 'starting';
  const isStopping = status === 'stopping';

  if (status === 'recording' || status === 'paused') return null;

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.14, ease: 'easeOut' }}
      style={{ transformOrigin: 'center bottom' }}
      className='pointer-events-none absolute bottom-[calc(85px+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 min-[700px]:bottom-6'
    >
      <div
        className='pointer-events-auto mx-auto flex h-12 w-60 max-w-full items-center justify-center rounded-full border border-primary-foreground/15 bg-primary p-1.5 text-primary-foreground shadow-xl ring-1 ring-primary-foreground/10'
        role='region'
        aria-label='Recording controls'
      >
        {isStarting || isStopping ? (
          <div className='flex h-9 w-full items-center justify-center gap-2.5 px-2.5'>
            <span className='flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-foreground/10 text-primary-foreground'>
              <Spinner size={16} className='animate-spin motion-reduce:animate-none' />
            </span>
            <span className='whitespace-nowrap pr-1 text-sm font-medium'>
              {isStopping ? 'Stopping recording…' : 'Starting recording…'}
            </span>
          </div>
        ) : (
          <button
            type='button'
            onClick={onStart}
            className='flex h-9 w-full min-w-0 cursor-pointer items-center justify-center gap-2.5 rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60 focus-visible:ring-offset-2 focus-visible:ring-offset-primary'
            aria-label='Start recording'
            aria-keyshortcuts='Meta+Alt+X Control+Alt+X'
            data-track-category='RecordingControlsOverlay'
            data-track-name='start_recording'
          >
            <span className='flex size-5 shrink-0 items-center justify-center text-primary-foreground'>
              <MicOn size={15} strokeWidth={2.2} variant='Contrast' />
            </span>
            <span className='whitespace-nowrap text-sm font-semibold tracking-tight'>
              Start recording
            </span>
            <span className='ml-1 hidden items-center gap-1 sm:flex' aria-hidden='true'>
              <kbd
                className={cn(
                  'flex h-5 items-center justify-center rounded-md border border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80 shadow-xs',
                  isApplePlatform ? 'w-5' : 'min-w-8 px-1 font-sans text-[9px] font-semibold',
                )}
              >
                {isApplePlatform ? <CommandCmd size={12} strokeWidth={1.8} /> : 'Ctrl'}
              </kbd>
              <kbd
                className={cn(
                  'flex h-5 items-center justify-center rounded-md border border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80 shadow-xs',
                  isApplePlatform ? 'w-5' : 'min-w-8 px-1 font-sans text-[9px] font-semibold',
                )}
              >
                {isApplePlatform ? (
                  <span aria-label='Option' className='text-[9px]'>
                    ⌥
                  </span>
                ) : (
                  'Alt'
                )}
              </kbd>
              <kbd className='flex size-5 items-center justify-center rounded-md border border-primary-foreground/20 bg-primary-foreground/10 font-mono text-[10px] font-semibold text-primary-foreground/80 shadow-xs'>
                X
              </kbd>
            </span>
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default RecordingControlsOverlay;
