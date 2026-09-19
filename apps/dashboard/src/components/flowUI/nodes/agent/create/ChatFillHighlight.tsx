import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/utils/classNames';

interface ChatFillHighlightProps {
  active: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Cursor-style hover when chat writes a canvas control: a compositor-safe
 * ring (opacity + transform) and a small pointer that lands on the field.
 * Honors prefers-reduced-motion with a static ring only.
 */
export function ChatFillHighlight({
  active,
  children,
  className,
}: ChatFillHighlightProps): ReactElement {
  const reduceMotion = useReducedMotion() === true;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), reduceMotion ? 200 : 1400);
    return () => window.clearTimeout(timeout);
  }, [active, reduceMotion]);

  return (
    <div className={cn('relative', className)}>
      {children}
      {visible && (
        <motion.div
          aria-hidden
          data-testid='chat-fill-highlight'
          className='pointer-events-none absolute -inset-1 rounded-2xl ring-2 ring-ring will-change-[opacity,transform]'
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: reduceMotion ? 1 : [0, 1, 1, 0], scale: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 1.2, times: [0, 0.18, 0.7, 1], ease: 'easeOut' }
          }
        />
      )}
      {visible && !reduceMotion && (
        <motion.span
          aria-hidden
          className='pointer-events-none absolute -left-1 -top-1 z-10 text-foreground will-change-transform'
          initial={{ opacity: 0, x: -8, y: -8 }}
          animate={{ opacity: [0, 1, 1, 0], x: 0, y: 0 }}
          transition={{ duration: 1.2, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }}
        >
          <svg width='14' height='18' viewBox='0 0 14 18' fill='currentColor'>
            <path d='M1.2 1.1 12.4 9.2l-5.1.6 2.6 6.2-2.2.9-2.6-6.1-4 3.6V1.1Z' />
          </svg>
        </motion.span>
      )}
    </div>
  );
}
