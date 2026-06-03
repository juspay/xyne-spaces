import { ReactElement } from 'react';
import { ToolInvocationList } from '../../Chat/XyneAISidebar/components/ToolInvocationList';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

export const UserBubble = ({ content }: { content: string }): ReactElement => (
  <div className='flex justify-end'>
    <div className='max-w-[88%] px-3 py-2 rounded-2xl rounded-tr-sm bg-accent text-foreground text-sm whitespace-pre-wrap'>
      {content}
    </div>
  </div>
);

interface AssistantBubbleProps {
  content: string;
  toolInvocations: ToolInvocation[];
  isStreaming: boolean;
}

export const AssistantBubble = ({
  content,
  toolInvocations,
  isStreaming,
}: AssistantBubbleProps): ReactElement => (
  <div className='flex flex-col gap-2'>
    {content && (
      <div className='text-sm text-foreground whitespace-pre-wrap leading-relaxed'>
        {content}
        {isStreaming && (
          <span className='inline-block w-1 h-3.5 ml-0.5 bg-foreground/60 align-middle animate-pulse' />
        )}
      </div>
    )}
    {!content && isStreaming && (
      <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
        <span className='inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse' />
        Thinking…
      </div>
    )}
    {toolInvocations.length > 0 && (
      <div className='rounded-lg bg-muted/40 border border-border p-2'>
        <ToolInvocationList invocations={toolInvocations} />
      </div>
    )}
  </div>
);
