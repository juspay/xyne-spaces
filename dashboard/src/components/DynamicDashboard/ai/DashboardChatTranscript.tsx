import { ReactElement, ReactNode, useEffect, useRef } from 'react';
import { UserBubble, AssistantBubble } from './chatBubbles';
import type { ChatTurn, SuggestComponentsArgs } from './chatTypes';

interface DashboardChatTranscriptProps {
  turns: ReadonlyArray<ChatTurn>;
  isStreaming: boolean;
  emptyState: ReactNode;
  suggestion?: SuggestComponentsArgs | null;
  onPickSuggestion?: (prompt: string) => void;
  className?: string;
  innerClassName?: string;
  trackCategory?: string;
}

export const DashboardChatTranscript = ({
  turns,
  isStreaming,
  emptyState,
  suggestion,
  onPickSuggestion,
  className = 'flex-1 min-h-0 overflow-auto',
  innerClassName = 'px-4 py-4 space-y-3',
  trackCategory = 'DYNAMIC_DASHBOARD',
}: DashboardChatTranscriptProps): ReactElement => {
  let assistantStreamingId: string | null = null;
  if (turns.length > 0) {
    const last = turns[turns.length - 1];
    if (last && last.role === 'assistant') assistantStreamingId = last.id;
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [turns]);

  const isEmpty = turns.length === 0 && !suggestion;

  return (
    <div ref={scrollRef} className={className}>
      {isEmpty ? (
        emptyState
      ) : (
        <div className={innerClassName}>
          {turns.map(t =>
            t.role === 'user' ? (
              <UserBubble key={t.id} content={t.content} />
            ) : (
              <AssistantBubble
                key={t.id}
                content={t.content}
                toolInvocations={t.toolInvocations}
                isStreaming={isStreaming && assistantStreamingId === t.id}
              />
            ),
          )}
          {suggestion && (
            <div className='space-y-2'>
              <div className='text-sm text-xyne-gray-600'>{suggestion.message}</div>
              <div className='flex flex-wrap gap-1.5'>
                {suggestion.suggestions.map(s => (
                  <button
                    key={s.prompt}
                    type='button'
                    onClick={() => onPickSuggestion?.(s.prompt)}
                    className='inline-flex items-center px-2.5 py-1 rounded-full border border-xyne-gray-200 bg-white text-[12px] text-xyne-gray-900 hover:bg-xyne-gray-50'
                    data-track-category={trackCategory}
                    data-track-name='Ai_Suggestion_Chip_Click'
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
