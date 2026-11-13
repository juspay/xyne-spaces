import { useEffect, useId, useMemo, useState } from 'react';
import { SchemaFormRenderer } from '../schema-form/SchemaFormRenderer.js';
import {
  groupFieldsByLayout,
  useSchemaForm,
  type SchemaFormField,
} from '../../hooks/use-schema-form.js';
import { cn } from '../shared/cn.js';
import type { WorkflowRunNaming } from '@xyne/workflow-sdk/builder';

const FORM_LABEL = { label: 'text-sm font-semibold text-[var(--wui-fg)]' } as const;

function isAttachmentField(field: SchemaFormField): boolean {
  return (
    field.format === 'attachment' ||
    (field.type === 'array' && field.itemSchema?.['format'] === 'attachment')
  );
}


function isWideField(field: SchemaFormField): boolean {
  if (isAttachmentField(field)) return false;
  if (field.discriminator) return true;
  return field.type === 'object' || field.type === 'array';
}

function chunkByWidth(
  fields: readonly SchemaFormField[],
): Array<{ wide: true; field: SchemaFormField } | { wide: false; fields: SchemaFormField[] }> {
  const chunks: Array<{ wide: true; field: SchemaFormField } | { wide: false; fields: SchemaFormField[] }> = [];
  for (const field of fields) {
    if (isWideField(field)) {
      chunks.push({ wide: true, field });
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last && !last.wide) last.fields.push(field);
    else chunks.push({ wide: false, fields: [field] });
  }
  return chunks;
}

const EMPTY_SCHEMA: Record<string, unknown> = { type: 'object' };

export interface TriggerFormModalProps {
  inputSchema?: Record<string, unknown> | undefined;
  workflowName?: string | undefined;
  /** When `{ mode: 'user' }`, the form asks for this run's identifier. */
  runNaming?: WorkflowRunNaming | undefined;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

/** The trigger-payload key the runtime lifts the typed identifier out of. */
const RUN_IDENTIFIER_FIELD = '__runIdentifier';

export function TriggerFormModal({
  inputSchema,
  workflowName,
  runNaming,
  onSubmit,
  onClose,
}: TriggerFormModalProps) {
  const asksForName = runNaming?.mode === 'user';
  // Starts empty, not as the workflow's name: every run would otherwise begin
  // with the same identifier — the one that tells runs apart least — and the
  // clash check would refuse the second run.
  const [runName, setRunName] = useState('');
  /** A second look before submitting a blank name, or the workflow's own name. */
  const [confirmation, setConfirmation] = useState<'empty' | 'workflow-name' | null>(null);
  const schema = inputSchema ?? EMPTY_SCHEMA;
  const form = useSchemaForm({ schema });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nothingToCollect = form.fields.length === 0 && !asksForName;

  const groups = useMemo(() => groupFieldsByLayout(form.fields, schema), [form.fields, schema]);
  const headingId = useId();

  // Only a sectioned schema earns the full-page form: collapsible sections and
  // two-up field rows need the width. Everything else — a handful of fields, or
  // nothing to collect at all — keeps the centered dialog, where a full-screen
  // takeover for three inputs was the complaint.
  const hasSections = useMemo(() => groups.some((group) => group.title !== null), [groups]);

  const initialCollapsed = useMemo(() => {
    const closed = new Set<number>();
    let first = true;
    groups.forEach((group, i) => {
      if (group.title === null) return;
      if (first) { first = false; return; }
      closed.add(i);
    });
    return closed;
  }, [groups]);

  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => { setCollapsed(initialCollapsed); }, [initialCollapsed]);

  useEffect(() => {
    const failing = groups.reduce<number[]>((acc, group, i) => {
      if (group.fields.some((f) => form.errors[f.path])) acc.push(i);
      return acc;
    }, []);
    if (failing.length === 0) return;
    setCollapsed((prev) => {
      if (!failing.some((i) => prev.has(i))) return prev;
      const next = new Set(prev);
      for (const i of failing) next.delete(i);
      return next;
    });
  }, [form.errors, groups]);

  const toggle = (i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });
  };

  const handleSubmit = async (confirmed = false) => {
    if (!form.validate()) return;
    if (asksForName && !confirmed) {
      const typed = runName.trim();
      if (!typed) { setConfirmation('empty'); return; }
      if (workflowName && typed.toLocaleLowerCase() === workflowName.trim().toLocaleLowerCase()) {
        setConfirmation('workflow-name');
        return;
      }
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        ...form.values,
        // Travels with the payload; the runtime lifts it out before the
        // trigger input is validated or stored.
        ...(asksForName ? { [RUN_IDENTIFIER_FIELD]: runName.trim() } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Back to the form, so a taken name can be changed right there.
      setConfirmation(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn('fixed inset-0 z-50 flex', !hasSections && 'items-center justify-center')}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div
        className={cn(
          'relative z-10 bg-[var(--wui-surface)]',
          hasSections
            ? 'flex h-full w-full flex-col'
            : 'w-full max-w-lg rounded-xl border border-[var(--wui-border)] shadow-xl',
          'animate-[wui-fade-in_150ms_ease-out]',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--wui-border)] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[var(--wui-fg)]">
            {workflowName ? `${workflowName}` : 'Run Workflow'}
          </h3>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)] transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {confirmation ? (
          // A question, not a form — so it takes the middle of the screen (or
          // the whole dialog) with its answers beside it. Going back to name the
          // run is the recommended answer, so it is the primary button.
          <div className={hasSections ? 'flex flex-1 items-center justify-center overflow-y-auto px-6 py-8' : 'px-6 py-8'}>
            <div
              className={cn(
                'w-full text-center',
                // Full page: a card in the middle of the screen. Dialog: the
                // dialog is already the card, so no second border inside it.
                hasSections && 'max-w-md rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)] px-8 py-8 shadow-sm',
              )}
            >
              <p className="text-sm font-semibold text-[var(--wui-fg)]">
                {confirmation === 'empty' ? 'No run name was entered' : 'This is the same as the workflow name'}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--wui-fg-muted)]">
                {confirmation === 'empty'
                  ? 'If you continue, a unique name with the date and time will be created for this run.'
                  : 'A different name makes this run easier to find later. Go back to change it, or continue with this name.'}
              </p>
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => { setConfirmation(null); }}
                  disabled={isSubmitting}
                  className="rounded-md bg-[var(--wui-primary)] px-4 py-1.5 text-[13px] font-semibold text-[var(--wui-primary-fg)] transition-colors hover:bg-[var(--wui-primary-hover)] disabled:opacity-50"
                >
                  Go back
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit(true)}
                  disabled={isSubmitting}
                  className="rounded-md border border-[var(--wui-border)] px-4 py-1.5 text-[13px] font-medium text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-muted)] disabled:opacity-50"
                >
                  {isSubmitting ? 'Running...' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        ) : (
        <div className={hasSections ? 'flex-1 overflow-y-auto' : 'max-h-[60vh] overflow-y-auto'}>
          <div
            className={cn(
              'space-y-4',
              hasSections ? 'mx-auto w-full max-w-[65%] px-6 py-8' : 'px-5 py-4',
            )}
          >
            {asksForName && (
              // Its own card in the full-page form, like the sections below it;
              // a plain field at the top of the dialog, like the dialog's others.
              <div className={hasSections ? 'rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)] px-5 py-4' : undefined}>
                <label htmlFor={`${headingId}-run-name`} className={FORM_LABEL.label}>
                  Name this run
                </label>
                <p className="mt-0.5 text-xs text-[var(--wui-fg-muted)]">
                  Please provide an identifying name for this workflow run.
                </p>
                <input
                  id={`${headingId}-run-name`}
                  aria-label="Workflow run identifier"
                  value={runName}
                  onChange={(e) => { setRunName(e.target.value); }}
                  placeholder="For example: Rahul Sharma - Aadhaar verification"
                  className="mt-2 w-full rounded-lg border border-[var(--wui-border)] bg-[var(--wui-bg)] px-3 py-2 text-[13px] text-[var(--wui-fg)] outline-none transition-colors placeholder:text-[var(--wui-fg-muted)] focus:border-[var(--wui-primary)]"
                />
              </div>
            )}

            {nothingToCollect && (
              <p className="text-[13px] leading-relaxed text-[var(--wui-fg-muted)]">
                This will start a new run{workflowName ? <> of <span className="font-medium text-[var(--wui-fg)]">{workflowName}</span></> : ''}. No input is required.
              </p>
            )}

            {hasSections && groups.map((group, i) => {
              const open = group.title === null || !collapsed.has(i);
              const failing = group.fields.filter((f) => form.errors[f.path]).length;
              const panelId = `${headingId}-${String(i)}`;
              return (
                <div
                  key={`${group.title ?? ''}#${String(i)}`}
                  className="overflow-hidden rounded-xl border border-[var(--wui-border)] bg-[var(--wui-surface)]"
                >
                  {group.title !== null && (
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      aria-expanded={open}
                      aria-controls={panelId}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-[var(--wui-fg)]',
                        'hover:bg-[var(--wui-bg-subtle)] transition-colors',
                        open && 'border-b border-[var(--wui-border)]',
                      )}
                    >
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className={cn(
                          'flex-shrink-0 text-[var(--wui-fg-muted)] transition-transform',
                          open && 'rotate-90',
                        )}
                        aria-hidden="true"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      <h4 className="text-[15px] font-semibold">
                        {group.title}
                      </h4>
                      {/* What a closed section is holding, so it is not a blind box. */}
                      {!open && (
                        <span
                          className={cn(
                            'ml-auto text-[10px] font-medium tabular-nums',
                            failing > 0
                              ? 'text-[var(--wui-status-failed)]'
                              : 'text-[var(--wui-fg-subtle)]',
                          )}
                        >
                          {failing > 0
                            ? `${String(failing)} to fix`
                            : `${String(group.fields.length)} field${group.fields.length === 1 ? '' : 's'}`}
                        </span>
                      )}
                    </button>
                  )}
                  {/* Closed sections unmount their inputs; the values live in the
                      form, so nothing typed is lost by collapsing. */}
                  {open && (
                    <div id={panelId} className="space-y-4 px-5 py-4">
                      {chunkByWidth(group.fields).map((chunk, ci) =>
                        chunk.wide ? (
                          <SchemaFormRenderer
                            key={chunk.field.path}
                            fields={[chunk.field]}
                            values={form.values}
                            errors={form.errors}
                            onChange={(path, value) => form.setFieldValue(path, value)}
                            compactUploads
                            classNames={FORM_LABEL}
                          />
                        ) : (
                          // `items-start` so a long description under one field
                          // does not stretch its neighbour's control to match.
                          <div
                            key={`row-${String(ci)}`}
                            className="grid grid-cols-1 items-start gap-x-8 gap-y-4 sm:grid-cols-2"
                          >
                            {chunk.fields.map((field) => (
                              <SchemaFormRenderer
                                key={field.path}
                                fields={[field]}
                                values={form.values}
                                errors={form.errors}
                                onChange={(path, value) => form.setFieldValue(path, value)}
                                compactUploads
                                classNames={FORM_LABEL}
                              />
                            ))}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!hasSections && !nothingToCollect && (
              <SchemaFormRenderer
                fields={form.fields}
                values={form.values}
                errors={form.errors}
                onChange={(path, value) => form.setFieldValue(path, value)}
                compactUploads
                classNames={FORM_LABEL}
              />
            )}
          </div>
        </div>
        )}

        {/* Footer — hidden during the check, which carries its own buttons. */}
        {!confirmation && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--wui-border)] px-5 py-3">
          {error && (
            <span className="mr-auto truncate text-xs text-[var(--wui-status-failed)]" title={error}>{error}</span>
          )}
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-[var(--wui-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-[var(--wui-primary-fg)] transition-colors',
              'bg-[var(--wui-primary)] hover:bg-[var(--wui-primary-hover)]',
              isSubmitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isSubmitting ? 'Running...' : 'Run'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
