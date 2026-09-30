import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import type { AgentCreateField } from './types';
import './thinking-shimmer.css';

interface ChatFillHighlightProps {
  active: boolean;
  children: ReactNode;
  className?: string;
  /** inline = identity row; block = description / instructions. */
  placement?: 'inline' | 'block';
  field?: AgentCreateField;
  /** Anticipating next write (attention set, not yet streaming characters). */
  anticipating?: boolean;
}

/**
 * Marks the field being written. No bounding box and no pointer: the text of
 * inputs, textareas, labels and `[data-shimmer-text]` inside the host dims and
 * a soft band sweeps across it (thinking-shimmer.css, pure CSS). Under reduced
 * motion the text only dims.
 */
export function ChatFillHighlight({
  active,
  children,
  className,
  placement = 'block',
  field,
  anticipating = false,
}: ChatFillHighlightProps): ReactElement {
  return (
    <div
      className={cn('relative', active && 't-think-field', className)}
      data-agent-writing={active && !anticipating ? 'true' : 'false'}
      data-create-anticipate={anticipating && active ? 'true' : 'false'}
      data-create-placement={placement}
      data-create-shimmer={active ? 'true' : 'false'}
      {...(field ? { 'data-create-field': field } : {})}
      {...(active
        ? { 'data-testid': anticipating ? 'create-anticipate-shimmer' : 'create-writing-shimmer' }
        : {})}
    >
      {children}
    </div>
  );
}
