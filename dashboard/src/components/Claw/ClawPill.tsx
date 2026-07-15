import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Minus } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { CLOSE_SPRING, OPEN_SPRING } from './claw.motion';
import { ClawMark } from './ClawMark';
import { useClawTabStatus } from './ClawConversationContext';

interface ClawPillProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export function ClawPill({ isOpen, onOpen, onClose }: ClawPillProps): React.ReactElement {
  const { isStreaming, hasUnseenAnswer, hasError } = useClawTabStatus();
  const isThinking = !isOpen && isStreaming;

  const handleClick = useCallback(() => {
    if (!isOpen) onOpen();
  }, [isOpen, onOpen]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isOpen) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    },
    [isOpen, onOpen],
  );

  return (
    <div
      data-slot='claw-pill'
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={isOpen ? undefined : 'button'}
      tabIndex={isOpen ? -1 : 0}
      aria-label={isOpen ? undefined : isThinking ? 'Claw is thinking. Open Claw' : 'Open Claw'}
      title={isOpen ? undefined : isThinking ? 'Claw is thinking' : 'Open Claw'}
      data-thinking={isThinking ? 'true' : undefined}
      data-track-category='CLAW_OVERLAY'
      data-track-name='OPEN_PANEL'
      className={cn(
        'relative isolate flex shrink-0 select-none items-center gap-2 overflow-hidden',
        isOpen
          ? 'h-14 justify-between border-b border-border/50 px-4'
          : cn(
              'h-full w-full cursor-pointer justify-center focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              isThinking ? 'px-3' : 'px-4',
            ),
      )}
    >
      <AnimatePresence initial={false} mode='popLayout'>
        {!isThinking && (
          <motion.div
            key='claw-mark'
            layout='position'
            initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
            transition={isOpen ? OPEN_SPRING : CLOSE_SPRING}
            className='relative z-10 flex shrink-0 items-center justify-center'
          >
            <ClawMark size={22} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode='popLayout' initial={false}>
        {isOpen ? (
          <motion.div
            key='claw-header'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className='relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2'
          >
            <span className='truncate text-sm font-semibold text-foreground'>Claw</span>
            <button
              type='button'
              onClick={onClose}
              aria-label='Minimize Claw'
              title='Minimize Claw'
              data-track-category='CLAW_OVERLAY'
              data-track-name='MINIMIZE_PANEL'
              className='flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            >
              <Minus className='size-4' strokeWidth={2.25} />
            </button>
          </motion.div>
        ) : (
          <motion.span
            key='claw-label'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className='relative z-10 flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-foreground'
          >
            {isStreaming ? (
              <span role='status' aria-live='polite' className='flex min-w-0 items-center'>
                <span className='claw-thinking-text truncate'>Thinking…</span>
              </span>
            ) : hasError ? (
              <>
                <AlertCircle className='size-3.5 shrink-0 text-destructive' />
                <span className='truncate'>Claw</span>
              </>
            ) : (
              <>
                <span className='truncate'>Claw</span>
                {hasUnseenAnswer && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                    aria-label='New answer'
                    className='size-1.5 shrink-0 rounded-full bg-primary'
                  />
                )}
              </>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
