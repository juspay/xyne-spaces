import React from 'react';
import { Bot, ChevronDown } from 'lucide-react';

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
  return (
    <details
      open={!defaultCollapsed}
      data-testid='shared-agent-transcript'
      className='group my-1 overflow-hidden rounded-lg border border-border bg-muted/40'
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
      <div className='border-t border-border px-3 py-2 text-sm'>
        {renderBody ? (
          renderBody(content)
        ) : (
          <pre className='whitespace-pre-wrap break-words font-sans text-sm text-foreground'>
            {content}
          </pre>
        )}
      </div>
    </details>
  );
};
