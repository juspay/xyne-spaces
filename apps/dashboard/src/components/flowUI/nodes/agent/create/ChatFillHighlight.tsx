import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/utils/classNames';
import type { AgentCreateField } from './types';

interface ChatFillHighlightProps {
  active: boolean;
  children: ReactNode;
  className?: string;
  /** inline = identity row; block = description / instructions. */
  placement?: 'inline' | 'block';
  field?: AgentCreateField;
}

/**
 * Ring on the field currently being written. The Figma write pointer lives on
 * the canvas overlay so it can travel between fields instead of teleporting.
 */
export function ChatFillHighlight({
  active,
  children,
  className,
  placement = 'block',
  field,
}: ChatFillHighlightProps): ReactElement {
  const reduceMotion = useReducedMotion() === true;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(active);
  }, [active]);

  return (
    <div
      className={cn('relative', className)}
      data-agent-writing={active ? 'true' : 'false'}
      data-create-placement={placement}
      {...(field ? { 'data-create-field': field } : {})}
    >
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
    </div>
  );
}
