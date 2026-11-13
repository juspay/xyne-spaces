import { useCallback, useState } from 'react';
import type { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
import { useApprovalAI } from '../../hooks/use-approval-ai.js';
import { SharedChatPanel } from './ChatPanel.js';

/**
 * The "Ask AI" chat side panel over a single execution — shared by the
 * Approvals view (with an optional form-fill capability) and the execution
 * viewer (chat only). It owns its own chat + streaming + width/resize state so
 * high-frequency streaming snapshots re-render only this subtree.
 *
 * Form-fill is optional: pass `setFormValues` (and `formValues`/`hasForm`) to
 * enable the "AI suggested form values" banner. Without them the chat is a
 * read-only Q&A over the run — the backend never emits a form-fill without a
 * pause form, so the banner simply never shows.
 */
export function RunAiChat({
  executionId,
  aiClient,
  isOpen,
  onClose,
  formValues,
  setFormValues,
  hasForm = false,
  suggestions,
  emptyStateDescription = 'Ask about this run — where data came from, or to fill in the form.',
  placeholder = 'Ask about this run…',
}: {
  executionId: string;
  aiClient: AiBuilderClient;
  isOpen: boolean;
  onClose: () => void;
  /** Live form values — only for the approval form-fill capability. */
  formValues?: Record<string, unknown> | undefined;
  /** When provided, enables the AI form-fill "Apply suggestions" banner. */
  setFormValues?: ((v: Record<string, unknown>) => void) | undefined;
  hasForm?: boolean | undefined;
  /** Override the empty-state suggestion chips. */
  suggestions?: string[] | undefined;
  emptyStateDescription?: string | undefined;
  placeholder?: string | undefined;
}) {
  const { messages, pendingFormFill, isLoading, streaming, error: aiError, send, stop, clearFormFill, reset } =
    useApprovalAI(aiClient, executionId);
  const [draft, setDraft] = useState('');
  // Resizable width with a minimum; `resizing` disables the transition mid-drag.
  const [aiWidth, setAiWidth] = useState(400);
  const [resizing, setResizing] = useState(false);
  const onAiResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = aiWidth;
    const onMove = (ev: MouseEvent) => {
      setAiWidth(Math.min(640, Math.max(320, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [aiWidth]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || isLoading) return;
    const text = draft.trim();
    setDraft('');
    await send(text, formValues);
  }, [draft, isLoading, send, formValues]);

  // Form-fill banner only when a form-fill sink is wired (approval view).
  const values = formValues ?? {};
  const formFillBanner = pendingFormFill && setFormValues ? (
    <div className="shrink-0 border-b border-[var(--wui-status-completed)] bg-[color-mix(in_srgb,var(--wui-status-completed)_12%,transparent)] px-4 py-3">
      <p className="mb-2 text-[12px] font-medium text-[var(--wui-status-completed)]">AI suggested form values</p>
      <div className="mb-2 divide-y divide-[color-mix(in_srgb,var(--wui-status-completed)_20%,transparent)] rounded-lg border border-[var(--wui-status-completed)] bg-[var(--wui-surface)] overflow-hidden max-h-32 overflow-y-auto">
        {Object.entries(pendingFormFill).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 px-3 py-1.5">
            <span className="shrink-0 text-[11px] font-medium text-[var(--wui-status-completed)] min-w-0 truncate" style={{ maxWidth: '45%' }} title={key}>
              {key.replace(/_/g, ' ')}
            </span>
            <span className="ml-auto text-[11px] text-[var(--wui-status-completed)] font-mono truncate" title={String(value ?? '')}>
              {value === '' || value === null || value === undefined
                ? <span className="italic text-[var(--wui-status-completed)]">empty</span>
                : String(value)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => { setFormValues({ ...values, ...pendingFormFill }); clearFormFill(); }}
          className="flex-1 rounded-lg bg-[var(--wui-status-completed)] py-1.5 text-[12px] font-semibold text-[var(--wui-primary-fg)] transition hover:brightness-95">
          Apply suggestions
        </button>
        <button type="button" onClick={clearFormFill}
          className="rounded-lg border border-[var(--wui-status-completed)] px-3 py-1.5 text-[12px] text-[var(--wui-status-completed)] transition hover:bg-[color-mix(in_srgb,var(--wui-status-completed)_18%,transparent)]">
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  const defaultSuggestions = [
    'Where did this data come from?',
    ...(hasForm ? ['Can you fill in the form for me?'] : []),
    'Summarise what this workflow has done so far.',
  ];

  return (
    <SharedChatPanel
      isOpen={isOpen}
      messages={messages}
      isLoading={isLoading}
      streaming={streaming}
      error={aiError}
      draft={draft}
      onDraftChange={setDraft}
      onSend={handleSend}
      onStop={stop}
      onReset={reset}
      onClose={onClose}
      suggestions={suggestions ?? defaultSuggestions}
      emptyStateDescription={emptyStateDescription}
      placeholder={placeholder}
      canSend={!!draft.trim()}
      bannerSlot={formFillBanner}
      resizeHandle={
        <div
          className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-[color-mix(in_srgb,var(--wui-primary)_40%,transparent)] active:bg-[color-mix(in_srgb,var(--wui-primary)_55%,transparent)]"
          onMouseDown={onAiResizeStart}
        />
      }
      containerStyle={{
        width: isOpen ? `${String(aiWidth)}px` : '0px',
        minWidth: isOpen ? 320 : 0,
        opacity: isOpen ? 1 : 0,
        flexShrink: 0,
        transition: resizing ? 'none' : 'width 280ms cubic-bezier(0.4,0,0.2,1), opacity 280ms cubic-bezier(0.4,0,0.2,1)',
      }}
    />
  );
}
