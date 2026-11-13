/**
 * Shared citation ("+ source") wiring for the schema-form editors.
 *
 * Lives in its own module so every element-producing editor — top-level fields
 * (`EnhancedSchemaFormRenderer`), array rows (`ArrayItemRow`), and record entries
 * (`KeyValueEditor`) — can mount the control without import cycles. The rule is
 * uniform: render `<FieldSourceControl fieldPath={…} />` at each citable node,
 * with the node's composed config path. No step- or field-type knowledge here.
 */
import { createContext, useContext, useState } from 'react';
import type { WorkflowConfig, Citation } from '@xyne/workflow-sdk/builder';
import { tryCitationPath } from '@xyne/workflow-sdk/builder';
import { CitationEditor } from './CitationEditor.js';
import { cn } from '../../shared/cn.js';

/** Citation wiring shared with every field via context (avoids deep prop drilling). */
export interface CitationCtxValue {
  config: WorkflowConfig;
  atStepId: string;
  stepConfig: Record<string, unknown>;
  citations: Record<string, Citation[]>;
  onAdd: (fieldPath: string, citation: Citation) => void;
  onRemove: (citationPath: string, index: number) => void;
}

export const CitationCtx = createContext<CitationCtxValue | null>(null);

/**
 * Per-field "source" affordance — lists/adds author citations for one field.
 * Renders nothing when citations aren't wired (no provider / read-only), so it's
 * safe to mount unconditionally at any citable node.
 */
export function FieldSourceControl({ fieldPath }: { fieldPath: string }) {
  const ctx = useContext(CitationCtx);
  const [open, setOpen] = useState(false);
  if (!ctx) return null;
  const path = tryCitationPath(ctx.stepConfig, fieldPath);
  const existing = path ? (ctx.citations[path] ?? []) : [];
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Cite a source for this field"
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide transition-colors',
          existing.length > 0
            ? 'border-[var(--wui-status-paused)]/40 bg-[var(--wui-status-paused)]/10 text-[var(--wui-status-paused)]'
            : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
        )}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        {existing.length > 0 ? `source · ${String(existing.length)}` : 'source'}
      </button>
      {open && (
        <CitationEditor
          config={ctx.config}
          atStepId={ctx.atStepId}
          citations={existing}
          onAdd={(c) => ctx.onAdd(fieldPath, c)}
          onRemove={(i) => { if (path) ctx.onRemove(path, i); }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
