import { useCallback, useEffect, useId, useState } from 'react';
import type { StepSummary } from '@xyne/workflow-sdk';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';
import { ConnectorCatalog } from './ConnectorCatalog.js';
import type { CatalogSection } from './ConnectorCatalog.js';

export interface StepPickerContext {
  afterStepId?: string | undefined;
  inBranch?: { stepId: string; branchKey: string } | undefined;
}

export interface StepPickerProps {
  open: boolean;
  context: StepPickerContext;
  onSelect: (type: string, context: StepPickerContext) => void;
  onClose: () => void;
}

/** One connector's steps under a heading per category, in the order categories first appear. */
function sectionsByCategory(steps: readonly StepSummary[]): CatalogSection<StepSummary>[] {
  const byCategory = new Map<string, StepSummary[]>();
  for (const step of steps) {
    const category = step.category || 'other';
    const members = byCategory.get(category);
    if (members) members.push(step);
    else byCategory.set(category, [step]);
  }
  return Array.from(byCategory, ([category, members]) => ({ key: category, label: category, items: members }));
}

export function StepPicker({ open, context, onSelect, onClose }: StepPickerProps) {
  const client = useWorkflowClient();
  const titleId = useId();
  const [steps, setSteps] = useState<StepSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.schema.steps();
        if (!cancelled) setSteps(result);
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

  const handleSelect = useCallback((step: StepSummary) => {
    onSelect(step.type, context);
    onClose();
  }, [onSelect, onClose, context]);

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
        className="relative flex h-[600px] max-h-[calc(100vh_-_2rem)] w-full max-w-lg flex-col overflow-hidden rounded-[var(--wui-radius-lg)] border border-[var(--wui-border)] bg-[var(--wui-surface)] shadow-[var(--wui-shadow-lg)] animate-[wui-scale-in_180ms_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--wui-border)] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--wui-fg)]">Add Step</h2>
            <p className="mt-0.5 text-xs text-[var(--wui-fg-muted)]">Choose a step type to add to your workflow</p>
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

        <ConnectorCatalog
          className="flex-1"
          items={steps}
          noun="step"
          onSelect={handleSelect}
          sectionsOf={sectionsByCategory}
          autoFocus
        />
      </div>
    </div>
  );
}
