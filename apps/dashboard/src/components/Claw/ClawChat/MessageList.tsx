import type { ReactElement } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { Message } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { MessageBubble } from './MessageBubble';
import { useStickyScroll } from './useStickyScroll';

interface MessageListProps {
  messages: Message[];
  onRetry?: (() => void) | undefined;
}

export function MessageList({ messages, onRetry }: MessageListProps): ReactElement {
  const { containerRef, isAtBottom, scrollToBottom, onScroll } = useStickyScroll(messages);

  if (messages.length === 0) {
    return (
      <div className='flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-2 px-6 text-center'>
        <Sparkles className='size-6 text-muted-foreground' />
        <p className='text-sm font-medium text-foreground'>Ask Claw anything</p>
        <p className='text-xs text-muted-foreground'>
          Claw can search your workspace, summarize threads, and help you get things done.
        </p>
      </div>
    );
  }

  return (
    <div className='relative min-h-0 flex-1'>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className='flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-3 py-3'
      >
        {messages.map(message => (
          <MessageBubble
            key={message.id}
            message={message}
            {...(message.type === 'bot' && message.errorInfo && onRetry ? { onRetry } : {})}
          />
        ))}
      </div>
      {!isAtBottom && (
        <button
          type='button'
          onClick={scrollToBottom}
          aria-label='Scroll to latest message'
          data-track-category='CLAW_CHAT'
          data-track-name='SCROLL_TO_BOTTOM'
          className={cn(
            'absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border',
            'bg-popover text-popover-foreground shadow-sm p-1.5 hover:bg-accent transition-colors',
          )}
        >
          <ArrowDown className='size-3.5' />
        </button>
      )}
    </div>
  );
}
