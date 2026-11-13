import { useState } from 'react';
import type { WorkflowConfig, Citation } from '@xyne/workflow-sdk/builder';
import { VariablePickerPopover } from './VariablePickerPopover.js';
import { cn } from '../../shared/cn.js';

export interface CitationEditorProps {
  config: WorkflowConfig;
  atStepId: string;
  /** Existing citations for this field. */
  citations: Citation[];
  onAdd: (citation: Citation) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
  className?: string | undefined;
}

/**
 * Per-field author-citations editor. Lists the field's citations and lets the
 * author add one: pick a reference (unconstrained — any value or attachment) via
 * the existing variable picker, then give it an optional label + description.
 */
export function CitationEditor({
  config,
  atStepId,
  citations,
  onAdd,
  onRemove,
  onClose,
  className,
}: CitationEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftRef, setDraftRef] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [pagePickerOpen, setPagePickerOpen] = useState(false);

  // The optional page-number field only applies to attachment (document) sources.
  const isAttachment = draftType === 'attachment' || draftType === 'attachment[]';

  const resetDraft = () => {
    setDraftRef(null);
    setDraftType(null);
    setLabel('');
    setDescription('');
    setPageNumber('');
    setPagePickerOpen(false);
  };

  const commit = () => {
    if (!draftRef) return;
    onAdd({
      ref: draftRef,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(isAttachment && pageNumber.trim() ? { pageNumber: pageNumber.trim() } : {}),
    });
    resetDraft();
  };

  return (
    <div
      className={cn(
        'absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg)] p-2.5 shadow-xl',
        'animate-[wui-scale-in_150ms_ease-out]',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wui-fg-muted)]">
          Sources
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-5 w-5 place-items-center rounded text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* Existing citations */}
      {citations.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {citations.map((c, i) => (
            <li key={`${c.ref}-${String(i)}`} className="flex items-start gap-2 rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-[var(--wui-fg)]">{c.label || c.ref}</div>
                {c.label && <div className="truncate font-mono text-[10px] text-[var(--wui-fg-muted)]">{c.ref}</div>}
                {c.pageNumber && <div className="truncate font-mono text-[10px] text-[var(--wui-fg-muted)]">page: {c.pageNumber}</div>}
                {c.description && <div className="mt-0.5 text-[11px] text-[var(--wui-fg-muted)]">{c.description}</div>}
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label="Remove source"
                className="shrink-0 rounded p-0.5 text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg)] hover:text-[var(--wui-status-failed)]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add flow */}
      {draftRef === null ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[var(--wui-border)] px-2 py-1.5 text-[12px] font-medium text-[var(--wui-fg-muted)] hover:border-[var(--wui-primary)] hover:text-[var(--wui-fg)]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add source
          </button>
          {pickerOpen && (
            <VariablePickerPopover
              config={config}
              atStepId={atStepId}
              onSelect={(ref, schemaType) => { setDraftRef(ref); setDraftType(schemaType ?? null); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-1.5 rounded-md border border-[var(--wui-border)] p-2">
          <div className="truncate font-mono text-[10.5px] text-[var(--wui-fg-muted)]" title={draftRef}>{draftRef}</div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 text-[12px] text-[var(--wui-fg)] outline-none focus:border-[var(--wui-primary)]"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full resize-y rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 text-[12px] text-[var(--wui-fg)] outline-none focus:border-[var(--wui-primary)]"
          />
          {/* Attachment sources only: optional page number, literal or {{linked}}. */}
          {isAttachment && (
            <div className="relative flex items-center gap-1">
              <input
                type="text"
                value={pageNumber}
                onChange={(e) => setPageNumber(e.target.value)}
                placeholder="Page number (optional)"
                className="w-full rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 text-[12px] text-[var(--wui-fg)] outline-none focus:border-[var(--wui-primary)]"
              />
              <button
                type="button"
                onClick={() => setPagePickerOpen((o) => !o)}
                aria-label="Link page number to a variable"
                title="Link to a variable"
                className="shrink-0 grid h-6 w-6 place-items-center rounded-md border border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:border-[var(--wui-primary)] hover:text-[var(--wui-fg)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              </button>
              {pagePickerOpen && (
                <VariablePickerPopover
                  config={config}
                  atStepId={atStepId}
                  onSelect={(ref) => { setPageNumber(ref); setPagePickerOpen(false); }}
                  onClose={() => setPagePickerOpen(false)}
                />
              )}
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={resetDraft} className="rounded-md px-2 py-1 text-[12px] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]">Cancel</button>
            <button type="button" onClick={commit} className="rounded-md bg-[var(--wui-status-completed)] px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
