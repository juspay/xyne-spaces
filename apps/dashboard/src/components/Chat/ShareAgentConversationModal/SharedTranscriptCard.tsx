import React, { useState } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { ExpandableMessage } from '../ExpandableMessage/ExpandableMessage';

const TRANSCRIPT_PREVIEW_MAX_HEIGHT = 480;

export interface SharedTranscriptCardProps {
  content: string;

  agentName: string;

  messageCount?: number;

  defaultCollapsed?: boolean;

  renderBody?: (content: string) => React.ReactNode;
}

export const SharedTranscriptCard: React.FC<SharedTranscriptCardProps> = ({
  content,
  agentName,
  messageCount,
  defaultCollapsed = false,
  renderBody,
}) => {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);
  return (
    <details
      open={isOpen}
      onToggle={event => setIsOpen(event.currentTarget.open)}
      data-testid='shared-agent-transcript'
      className='group my-1 overflow-hidden rounded-lg border border-border bg-muted'
    >
      <summary className='flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground'>
        <span className='flex items-center gap-2'>
          <Bot size={15} />
          Shared conversation with {agentName}
          {typeof messageCount === 'number' ? (
            <span className='text-xs font-normal text-muted-foreground'>
              · {messageCount} message(s)
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={16}
          className='transition-transform group-open:rotate-180 text-muted-foreground'
        />
      </summary>
      {isOpen ? (
        <div className='border-t border-border px-3 py-2 text-sm'>
          <ExpandableMessage
            maxHeight={TRANSCRIPT_PREVIEW_MAX_HEIGHT}
            fadeColor='hsl(var(--muted))'
          >
            {renderBody ? (
              renderBody(content)
            ) : (
              <pre className='whitespace-pre-wrap break-words font-sans text-sm text-foreground'>
                {content}
              </pre>
            )}
          </ExpandableMessage>
        </div>
      ) : null}
    </details>
  );
};
