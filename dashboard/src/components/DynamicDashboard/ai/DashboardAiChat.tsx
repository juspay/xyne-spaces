import { ReactElement, useCallback, useState } from 'react';
import { ArrowUp, ChevronDown, Loader2, Plus, Sparkles, X } from 'lucide-react';
import type { DashboardPlan } from '@xyne/shared';
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
  className = 'flex flex-col h-full w-[360px] shrink-0 border-l border-xyne-gray-200 bg-white',
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
    <div className='flex flex-col items-center justify-center h-full text-center px-6'>
      <img
        src='/images/ai-orb.png'
        alt=''
        aria-hidden='true'
        className='w-24 h-24 mb-6 object-contain select-none'
      />
      <h3 className='text-base leading-6 font-semibold text-xyne-gray-900 max-w-[260px]'>
        {emptyStatePrompt}
      </h3>
      {starterPrompts && starterPrompts.length > 0 && (
        <div className='mt-6 flex flex-wrap items-center justify-center gap-1.5 max-w-[280px]'>
          {starterPrompts.map(q => (
            <button
              key={q}
              type='button'
              onClick={() => submit(q)}
              disabled={isStreaming}
              className='inline-flex items-center px-2.5 py-1 rounded-full border border-xyne-gray-200 bg-white text-[12px] text-xyne-gray-900 hover:bg-xyne-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'
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
      <div className='flex items-center justify-between h-12 px-4 border-b border-xyne-gray-200 shrink-0'>
        <button
          type='button'
          className='inline-flex items-center gap-1 text-[15px] leading-5 font-medium text-xyne-gray-900 hover:bg-xyne-gray-100 rounded-md px-1.5 py-0.5 -mx-1.5'
          aria-label='Chat history'
          data-track-category={trackCategory}
          data-track-name='Open_Chat_History'
        >
          New chat
          <ChevronDown size={14} className='text-xyne-gray-400' />
        </button>
        {onClose && (
          <button
            type='button'
            onClick={onClose}
            className='inline-flex items-center justify-center w-7 h-7 rounded-lg text-xyne-gray-600 hover:bg-xyne-gray-100 transition-colors'
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

      <div className='m-3 mt-0 rounded-xl border border-xyne-orange-200 bg-white p-3 shrink-0'>
        {contextChips && contextChips.length > 0 && (
          <div className='flex items-center gap-1.5 mb-2 flex-wrap'>
            {contextChips.map(c => (
              <span
                key={c.label}
                className='inline-flex items-center gap-1 h-6 px-2 rounded-md bg-xyne-orange-50 border border-xyne-orange-200 text-[12px] leading-4 text-xyne-gray-900'
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
          className='w-full text-sm text-xyne-gray-900 caret-xyne-gray-900 placeholder:text-xyne-gray-400 outline-none resize-none bg-transparent'
        />
        <div className='flex items-center justify-between mt-1'>
          <div className='flex items-center gap-1.5'>
            <button
              type='button'
              className='p-1 rounded text-xyne-gray-500 hover:bg-xyne-gray-100'
              aria-label='Add context'
              data-track-category={trackCategory}
              data-track-name='Chat_Add_Context'
            >
              <Plus size={14} />
            </button>
            <button
              type='button'
              className='p-1 rounded text-xyne-gray-500 hover:bg-xyne-gray-100'
              aria-label='Slash commands'
              data-track-category={trackCategory}
              data-track-name='Chat_Slash_Commands'
            >
              <Sparkles size={14} />
            </button>
          </div>
          <button
            type='button'
            onClick={handleSendClick}
            disabled={!isStreaming && (!inputValue.trim() || !canSend)}
            className='inline-flex items-center justify-center w-7 h-7 rounded-full bg-xyne-gray-900 text-white transition-colors hover:bg-xyne-gray-1000 disabled:bg-xyne-gray-300 disabled:cursor-not-allowed'
            aria-label={isStreaming ? 'Stop' : 'Send'}
            data-track-category={trackCategory}
            data-track-name={isStreaming ? 'Chat_Abort' : 'Chat_Send'}
          >
            {isStreaming ? <Loader2 size={12} className='animate-spin' /> : <ArrowUp size={14} />}
          </button>
        </div>
      </div>
    </aside>
  );
};
