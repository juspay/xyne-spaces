import { ReactElement, useCallback, useState } from 'react';
import { ArrowUp, Loader2, RotateCcw, X } from 'lucide-react';
import type { DashboardPlan } from '@xyne/shared';
import { GlassStar } from '../../icons/xyne-ai';
import { DashboardChatTranscript } from './DashboardChatTranscript';
import { useDashboardAiStream } from './useDashboardAiStream';
import type { ContextChip, ToolCallHandler } from './chatTypes';

export interface DashboardAiChatProps {
  dataSourceId: string | null;
  currentPlan?: DashboardPlan;
  buildPrompt: (userText: string) => string;
  onToolCall: ToolCallHandler;
  emptyStatePrompt: string;
  starterPrompts?: ReadonlyArray<string>;
  contextChips?: ReadonlyArray<ContextChip>;
  onClose?: () => void;
  dataSourcePicker?: ReactElement;
  noDataSourceMessage?: string;
  trackCategory?: string;
  lastError?: string | null;
  className?: string;
}

export const DashboardAiChat = ({
  dataSourceId,
  currentPlan,
  buildPrompt,
  onToolCall,
  emptyStatePrompt,
  starterPrompts,
  contextChips,
  onClose,
  dataSourcePicker,
  trackCategory = 'DYNAMIC_DASHBOARD',
  lastError,
  className = 'flex flex-col h-full w-[360px] shrink-0 border-l border-border bg-background',
}: DashboardAiChatProps): ReactElement => {
  const { turns, isStreaming, send, abort, suggestion } = useDashboardAiStream({
    dataSourceId,
    ...(currentPlan ? { currentPlan } : {}),
    buildPrompt,
    onToolCall,
    ...(lastError !== undefined ? { lastError } : {}),
  });

  const [inputValue, setInputValue] = useState('');

  const submit = useCallback(
    (override?: string) => {
      const text = (override ?? inputValue).trim();
      if (!text) return;
      send(text);
      if (!override) setInputValue('');
    },
    [inputValue, send],
  );

  const handleSendClick = useCallback(() => {
    if (isStreaming) {
      abort();
      return;
    }
    submit();
  }, [isStreaming, abort, submit]);

  const canSend = !isStreaming;

  const emptyState = (
    <div className='flex flex-col items-center justify-center h-full px-4'>
      <div className='mb-9'>
        <GlassStar shouldRotate={true} />
      </div>
      <h2 className='text-center text-foreground text-[24px] leading-[28px] font-semibold mb-6 md:mb-9 max-w-[300px]'>
        {emptyStatePrompt}
      </h2>
      {starterPrompts && starterPrompts.length > 0 && (
        <div className='flex flex-wrap justify-center gap-2 max-w-md'>
          {starterPrompts.map(q => (
            <button
              key={q}
              type='button'
              onClick={() => submit(q)}
              disabled={isStreaming}
              className='px-[12px] py-[6px] rounded-full border border-border hover:bg-accent bg-card transition-colors text-muted-foreground font-medium text-[12px] leading-[22px] disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category={trackCategory}
              data-track-name='Pick_Starter_Prompt'
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {dataSourcePicker && (
        <div className='mt-6 w-full max-w-[280px] text-left'>{dataSourcePicker}</div>
      )}
    </div>
  );

  return (
    <aside className={className}>
      <div className='flex items-center justify-between h-12 px-4 border-b border-border shrink-0'>
        <button
          type='button'
          className='inline-flex items-center gap-1.5 text-[15px] leading-5 font-medium text-foreground hover:bg-accent rounded-md px-1.5 py-0.5 -mx-1.5'
          aria-label='Chat history'
          data-track-category={trackCategory}
          data-track-name='Open_Chat_History'
        >
          <RotateCcw size={14} className='text-muted-foreground' />
          New chat
        </button>
        {onClose && (
          <button
            type='button'
            onClick={onClose}
            className='inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:bg-accent transition-colors'
            aria-label='Close chat'
            data-track-category={trackCategory}
            data-track-name='Close_Chat'
          >
            <X size={14} />
          </button>
        )}
      </div>

      <DashboardChatTranscript
        turns={turns}
        isStreaming={isStreaming}
        emptyState={emptyState}
        suggestion={suggestion}
        onPickSuggestion={submit}
        trackCategory={trackCategory}
      />

      <div className='m-4 rounded-2xl border border-input bg-card p-3 shrink-0 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15 transition-colors'>
        {contextChips && contextChips.length > 0 && (
          <div className='flex items-center gap-1.5 mb-2 flex-wrap'>
            {contextChips.map(c => (
              <span
                key={c.label}
                className='inline-flex items-center gap-1 h-6 px-2 rounded-md bg-muted border border-border text-[12px] leading-4 text-foreground'
              >
                {c.icon}
                <span className='truncate' style={{ maxWidth: c.maxWidth ?? 180 }}>
                  {c.label}
                </span>
              </span>
            ))}
          </div>
        )}
        <textarea
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder='Ask anything…'
          rows={2}
          disabled={isStreaming}
          data-track-category={trackCategory}
          data-track-name='Chat_Input_Change'
          className='w-full text-sm text-foreground caret-foreground placeholder:text-muted-foreground outline-none resize-none bg-transparent'
        />
        <div className='flex items-center justify-end mt-1'>
          <button
            type='button'
            onClick={handleSendClick}
            disabled={!isStreaming && (!inputValue.trim() || !canSend)}
            className='inline-flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
            aria-label={isStreaming ? 'Stop' : 'Send'}
            data-track-category={trackCategory}
            data-track-name={isStreaming ? 'Chat_Abort' : 'Chat_Send'}
          >
            {isStreaming ? <Loader2 size={14} className='animate-spin' /> : <ArrowUp size={15} />}
          </button>
        </div>
      </div>
    </aside>
  );
};
