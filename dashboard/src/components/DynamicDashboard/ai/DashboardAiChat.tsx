import { ReactElement, useCallback, useState } from 'react';
import { ArrowUp, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { DashboardPlan } from '@xyne/shared';
import { GlassStar } from '../../icons/xyne-ai';
import { DashboardChatTranscript } from './DashboardChatTranscript';
import { ClearChatConfirmOverlay } from './ClearChatConfirmOverlay';
import { useDashboardAiStream } from '../../../hooks/useDashboardAiStream';
import type { ContextChip, DrillPayload } from './chatTypes';

export interface DashboardAiChatProps {
  dataSourceId: string | null;
  dashboardId?: string;
  currentPlan?: DashboardPlan;
  buildPrompt: (userText: string) => string;
  emptyStatePrompt: string;
  starterPrompts?: ReadonlyArray<string>;
  contextChips?: ReadonlyArray<ContextChip>;
  onClose?: () => void;
  dataSourcePicker?: ReactElement;
  trackCategory?: string;
  lastError?: string | null;
  className?: string;
  focusedComponentId?: string;
  onAddDrill?: (args: DrillPayload) => Promise<boolean>;
  // Called when a server-persisted tool (add/update/remove component,
  // set_dashboard_meta) completes, so the host can refetch the dashboard.
  onDashboardMutated?: () => void;
  // Intercept a completed drill_result (return true to consume it) — the
  // component editor uses this to populate the visual builder.
  onDrillResult?: (drill: DrillPayload, ctx: { abort: () => void }) => boolean | void;
}

export const DashboardAiChat = ({
  dataSourceId,
  dashboardId,
  currentPlan,
  buildPrompt,
  emptyStatePrompt,
  starterPrompts,
  contextChips,
  onClose,
  dataSourcePicker,
  trackCategory = 'DYNAMIC_DASHBOARD',
  lastError,
  className = 'flex flex-col h-full w-[360px] shrink-0 border-l border-border bg-background',
  focusedComponentId,
  onAddDrill,
  onDashboardMutated,
  onDrillResult,
}: DashboardAiChatProps): ReactElement => {
  const { turns, isStreaming, send, abort, suggestion, reset } = useDashboardAiStream({
    dataSourceId,
    ...(dashboardId ? { dashboardId } : {}),
    ...(currentPlan ? { currentPlan } : {}),
    buildPrompt,
    ...(lastError !== undefined ? { lastError } : {}),
    ...(focusedComponentId ? { focusedComponentId } : {}),
    ...(onDashboardMutated ? { onDashboardMutated } : {}),
    ...(onDrillResult ? { onDrillResult } : {}),
  });

  const [inputValue, setInputValue] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

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
    </div>
  );

  return (
    <aside className={className}>
      <div className='flex items-center justify-between h-12 px-4 border-b border-border shrink-0'>
        <button
          type='button'
          onClick={reset}
          className='inline-flex items-center gap-1.5 text-[15px] leading-5 font-medium text-foreground hover:bg-accent rounded-md px-1.5 py-0.5 -mx-1.5'
          aria-label='New chat'
          data-track-category={trackCategory}
          data-track-name='New_Chat'
        >
          <RotateCcw size={14} className='text-muted-foreground' />
          New chat
        </button>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={() => setConfirmClear(true)}
            className='inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:bg-accent transition-colors'
            aria-label='Clear chat history'
            data-track-category={trackCategory}
            data-track-name='Clear_Chat'
          >
            <Trash2 size={14} />
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
      </div>

      <DashboardChatTranscript
        turns={turns}
        isStreaming={isStreaming}
        emptyState={emptyState}
        suggestion={suggestion}
        onPickSuggestion={submit}
        trackCategory={trackCategory}
        {...(onAddDrill ? { onAddDrill } : {})}
      />

      <div className='m-4 rounded-2xl border border-input bg-card p-3 shrink-0 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15 transition-colors'>
        {(dataSourcePicker || (contextChips && contextChips.length > 0)) && (
          <div className='flex items-center gap-1.5 mb-2 flex-wrap'>
            {dataSourcePicker}
            {contextChips?.map(c => (
              <span
                key={c.label}
                className='inline-flex items-center gap-1 h-6 px-2 rounded-md bg-muted border border-border text-[12px] leading-4 text-foreground'
              >
                {c.icon}
                <span className='truncate' style={{ maxWidth: c.maxWidth ?? 180 }}>
                  {c.label}
                </span>
                {c.onRemove && (
                  <button
                    type='button'
                    onClick={c.onRemove}
                    className='ml-1 text-muted-foreground hover:text-foreground'
                    aria-label={`Remove ${c.label}`}
                    data-track-category={trackCategory}
                    data-track-name='Chat_Remove_Context_Chip'
                  >
                    <X size={12} />
                  </button>
                )}
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
            disabled={!isStreaming && !inputValue.trim()}
            className='inline-flex items-center justify-center w-8 h-8 rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed'
            aria-label={isStreaming ? 'Stop' : 'Send'}
            data-track-category={trackCategory}
            data-track-name={isStreaming ? 'Chat_Abort' : 'Chat_Send'}
          >
            {isStreaming ? <Loader2 size={14} className='animate-spin' /> : <ArrowUp size={15} />}
          </button>
        </div>
      </div>
      {confirmClear && (
        <ClearChatConfirmOverlay
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            reset();
          }}
        />
      )}
    </aside>
  );
};
