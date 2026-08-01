import { type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PlaySmall } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';

interface ResumeRecordingButtonProps {
  recordingExternalId: string;
}

export const ResumeRecordingButton = ({
  recordingExternalId,
}: ResumeRecordingButtonProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const activeExternalId = useRecordingStore(context => context.externalId);
  const status = useRecordingStore(context => context.status);

  const isPaused = activeExternalId === recordingExternalId && status === 'paused';

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-6 z-40 flex justify-center'>
      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <Button
              type='button'
              variant='default'
              size='sm'
              onClick={() => sendRecordingEvent({ type: 'resumeRecording' })}
              className='pointer-events-auto flex h-9 items-center gap-2 rounded-full bg-foreground w-40 text-xs font-medium text-background shadow-lg hover:bg-foreground/90 active:scale-95 motion-reduce:transform-none'
              aria-label='Resume recording'
              data-track-category='RecordingDetailV2'
              data-track-name='resume_recording_floating'
            >
              <PlaySmall size={14} variant='Solid' />
              Resume R ecording
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ResumeRecordingButton;
