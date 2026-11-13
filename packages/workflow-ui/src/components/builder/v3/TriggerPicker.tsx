import { useCallback, useEffect, useId, useState } from 'react';
import type { TriggerSummary } from '@xyne/workflow-sdk';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';
import { ConnectorCatalog } from './ConnectorCatalog.js';

export interface TriggerPickerProps {
  open: boolean;
  onSelect: (type: string) => void;
  onClose: () => void;
}

export function TriggerPicker({ open, onSelect, onClose }: TriggerPickerProps) {
  const client = useWorkflowClient();
  const titleId = useId();
  const [triggers, setTriggers] = useState<TriggerSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.schema.triggers();
        if (!cancelled) setTriggers(result);
      } catch { /* unavailable */ }
    })();
    return () => { cancelled = true; };
  }, [client, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleSelect = useCallback((trigger: TriggerSummary) => {
    onSelect(trigger.type);
    onClose();
  }, [onSelect, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

      {/* Fixed height: switching between the connector list and a connector keeps the
          dialog still, and only the list scrolls. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[560px] max-h-[calc(100vh_-_2rem)] w-full max-w-md flex-col overflow-hidden rounded-[var(--wui-radius-lg)] border border-[var(--wui-border)] bg-[var(--wui-surface)] shadow-[var(--wui-shadow-lg)] animate-[wui-scale-in_180ms_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--wui-border)] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--wui-fg)]">Select Trigger</h2>
            <p className="mt-0.5 text-xs text-[var(--wui-fg-muted)]">Choose what starts your workflow</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <ConnectorCatalog className="flex-1" items={triggers} noun="trigger" onSelect={handleSelect} autoFocus />
      </div>
    </div>
  );
}
