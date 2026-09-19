import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/utils/classNames';

interface ChatFillHighlightProps {
  active: boolean;
  children: ReactNode;
  className?: string;
  /** inline = identity row; block = description / instructions. */
  placement?: 'inline' | 'block';
}

/**
 * Cursor stays inside the field for the whole write. Sending, Q&A, and
 * waiting-on-the-model never set `active`. Reduced motion: static ring only.
 */
export function ChatFillHighlight({
  active,
  children,
  className,
  placement = 'block',
}: ChatFillHighlightProps): ReactElement {
  const reduceMotion = useReducedMotion() === true;
  const [visible, setVisible] = useState(false);
  const caretTop = placement === 'inline' ? 6 : 28;
  const caretLeft = placement === 'inline' ? 4 : 0;

  useEffect(() => {
    setVisible(active);
  }, [active]);

  return (
    <div className={cn('relative', className)} data-agent-writing={active ? 'true' : 'false'}>
      {children}
      {visible && (
        <motion.div
          aria-hidden
          data-testid='chat-fill-highlight'
          className='pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-ring will-change-[opacity,transform]'
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
        />
      )}
      {visible && !reduceMotion && (
        <motion.span
          aria-hidden
          className='pointer-events-none absolute z-10 text-foreground will-change-transform'
          initial={{ opacity: 0, x: -14, y: -14 }}
          animate={{ opacity: 1, x: caretLeft + 2, y: caretTop - 4 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <svg width='14' height='18' viewBox='0 0 14 18' fill='currentColor'>
            <path d='M1.2 1.1 12.4 9.2l-5.1.6 2.6 6.2-2.2.9-2.6-6.1-4 3.6V1.1Z' />
          </svg>
        </motion.span>
      )}
      {visible && !reduceMotion && (
        <motion.span
          aria-hidden
          data-testid='chat-fill-caret'
          className='pointer-events-none absolute z-10 w-[2px] rounded-full bg-foreground will-change-opacity'
          style={{ left: caretLeft, top: caretTop, height: placement === 'inline' ? 18 : 22 }}
          initial={{ opacity: 1 }}
          animate={{ opacity: [1, 1, 0, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            times: [0, 0.45, 0.55, 1],
            ease: 'linear',
          }}
        />
      )}
    </div>
  );
}
