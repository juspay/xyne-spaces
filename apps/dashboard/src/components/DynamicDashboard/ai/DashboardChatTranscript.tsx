import { ReactElement, ReactNode, useEffect, useRef } from 'react';
import { UserBubble, AssistantBubble } from './chatBubbles';
import type { ChatTurn, DrillPayload, SuggestComponentsArgs } from './chatTypes';
import { DrillResultBubble } from './DrillResultBubble';

interface DashboardChatTranscriptProps {
  turns: ReadonlyArray<ChatTurn>;
  isStreaming: boolean;
  emptyState: ReactNode;
  suggestion?: SuggestComponentsArgs | null;
  onPickSuggestion?: (prompt: string) => void;
  onAddDrill?: (args: DrillPayload) => Promise<boolean>;
  trackCategory?: string;
}

function streamingTurnId(turns: ReadonlyArray<ChatTurn>): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t || t.drill) continue;
    return t.role === 'assistant' ? t.id : null;
  }
  return null;
}

export const DashboardChatTranscript = ({
  turns,
  isStreaming,
  emptyState,
  suggestion,
  onPickSuggestion,
  onAddDrill,
  trackCategory = 'DYNAMIC_DASHBOARD',
}: DashboardChatTranscriptProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const streamingId = streamingTurnId(turns);
  const isEmpty = turns.length === 0 && !suggestion;

  return (
    <div ref={scrollRef} className='flex-1 min-h-0 overflow-auto'>
      {isEmpty ? (
        emptyState
      ) : (
        <div className='px-4 py-4 space-y-3'>
          {turns.map(t => {
            if (t.drill) {
              return (
                <DrillResultBubble
                  key={t.id}
                  title={t.drill.title}
                  visualType={t.drill.visualType}
                  queryPlan={t.drill.queryPlan}
                  onAdd={args => onAddDrill?.(args) ?? Promise.resolve(false)}
                />
              );
            }
            if (t.role === 'user') return <UserBubble key={t.id} content={t.content} />;

            const streaming = isStreaming && streamingId === t.id;
            const hasContent = t.content || t.toolInvocations.length > 0 || t.reasoning;
            if (!hasContent && !streaming) return null;
            return (
              <AssistantBubble
                key={t.id}
                id={t.id}
                content={t.content}
                toolInvocations={t.toolInvocations}
                reasoning={t.reasoning}
                isStreaming={streaming}
              />
            );
          })}
          {suggestion && (
            <div className='space-y-2'>
              <div className='text-sm text-muted-foreground'>{suggestion.message}</div>
              <div className='flex flex-wrap gap-1.5'>
                {suggestion.suggestions.map(s => (
                  <button
                    key={s.prompt}
                    type='button'
                    onClick={() => onPickSuggestion?.(s.prompt)}
                    className='inline-flex items-center px-2.5 py-1 rounded-full border border-border bg-card text-[12px] text-foreground hover:bg-accent'
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
