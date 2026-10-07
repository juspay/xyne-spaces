import { ReactElement, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { TurnTimeline } from '../../Chat/XyneAISidebar/components/TurnTimeline';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { createMarkdownComponents } from '../../../utils/markdownComponents';

export const UserBubble = ({ content }: { content: string }): ReactElement => (
  <div className='flex gap-3 justify-end'>
    <div className='max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm text-foreground whitespace-pre-wrap break-words'>
      {content}
    </div>
  </div>
);

interface AssistantBubbleProps {
  id: string;
  content: string;
  toolInvocations: ToolInvocation[];
  reasoning?: string | undefined;
  isStreaming: boolean;
}

export const AssistantBubble = ({
  id,
  content,
  toolInvocations,
  reasoning,
  isStreaming,
}: AssistantBubbleProps): ReactElement => {
  const markdownComponents = useMemo(() => createMarkdownComponents(id), [id]);
  const renderMarkdown = (text: string): ReactElement => (
    <div className='bot-markdown-content text-sm text-foreground leading-6'>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );

  return (
    <div className='flex gap-3 justify-start'>
      <div className='flex-shrink-0 mt-2.5'>
        <img src='/svgs/icons/ai-bot-gradient-star.svg' alt='AI' width='16' height='16' />
      </div>
      <div className='flex-1 min-w-0 max-w-full overflow-hidden'>
        <TurnTimeline
          message={{ toolInvocations, ...(reasoning ? { reasoning } : {}), isStreaming }}
          renderText={text => renderMarkdown(text)}
          legacyAnswer={content ? renderMarkdown(content) : null}
        />
      </div>
    </div>
  );
};
