import { useState, type ReactNode } from 'react';
import { promptLines } from '@xyne/workflow-sdk/types';
import type { PauseState, PauseAction } from '@xyne/workflow-sdk';
import type { Citation } from '@xyne/workflow-sdk/builder';
import { usePauseInteraction } from '../../hooks/use-pause-interaction.js';
import { PauseFormRenderer, getFormDefaults, validatePauseForm } from './PauseFormRenderer.js';
import { cn } from '../shared/cn.js';
import { DisplayValue, Collapsible } from '../shared/AttachmentCard.js';
import { MarkdownView } from '../shared/MarkdownView.js';
import { OriginChipFor } from './origin/OriginTrace.js';
import { getFieldCitations } from './origin/origin-resolver.js';

/** Raw step config (refs intact) — used only to derive value origins. */
type RawConfig = Record<string, unknown> | undefined;

function rawDisplayValue(rawConfig: RawConfig, i: number): unknown {
  const d = (rawConfig?.['display'] as Array<{ value?: unknown }> | undefined)?.[i];
  return d?.value;
}
function rawFormField(rawConfig: RawConfig, i: number): unknown {
  return (rawConfig?.['form'] as { fields?: unknown[] } | undefined)?.fields?.[i];
}

const DEFAULT_ACTIONS: PauseAction[] = [
  { key: 'approve', label: 'Approve', style: 'primary' },
  { key: 'reject', label: 'Reject', style: 'danger', abort: true },
];

const submitsForm = (a: PauseAction): boolean => !a.abort && a.submitsForm !== false;

function clearTouchedErrors(
  errors: Record<string, string>,
  prevValues: Record<string, unknown>,
  nextValues: Record<string, unknown>,
): Record<string, string> {
  const touched = Object.keys(errors).filter((k) => !Object.is(prevValues[k], nextValues[k]));
  if (touched.length === 0) return errors;
  const next = { ...errors };
  for (const k of touched) delete next[k];
  return next;
}

export interface PauseInteractionPanelProps {
  executionId: string;
  pauseState: PauseState;
  /** Node-path of the gate this panel resolves (required for multi-gate runs). */
  nodePath?: string | undefined;
  onResumed?: ((action?: PauseAction) => void) | undefined;
  className?: string | undefined;
  /** When true, action buttons are not rendered — caller is responsible for them. */
  hideActions?: boolean;
  /** The paused step's raw config (refs intact) — used to derive value origins. */
  rawConfig?: Record<string, unknown> | undefined;
  /** The paused step's author citations (overlay). */
  citations?: Record<string, Citation[]> | undefined;
  /** Open the origin inspector for a value. */
  onInspectOrigin?: ((label: string, autoRefs: string[], citations: Citation[]) => void) | undefined;
}

export function PauseInteractionPanel({
  executionId,
  pauseState,
  nodePath,
  onResumed,
  className,
  hideActions = false,
  rawConfig,
  citations,
  onInspectOrigin,
}: PauseInteractionPanelProps) {
  const fieldCitations = (fieldPath: string): Citation[] =>
    getFieldCitations(rawConfig, citations, fieldPath);
  const {
    actions,
    isSubmitting,
    error,
    formValues,
    setFormValues: updateFormValues,
    formErrors,
    handleAction,
  } = usePauseInteractionState(executionId, pauseState, onResumed, nodePath);

  return (
    <div
      className={cn(
        'rounded-[var(--wui-radius)] border border-[var(--wui-status-paused)] bg-[var(--wui-status-paused)]/5 p-3',
        className,
      )}
    >
      {/* Reason */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <MarkdownView className="text-sm font-medium text-[var(--wui-fg)]">{pauseState.reason}</MarkdownView>
        <OriginChipFor raw={rawConfig?.['reason']} citations={fieldCitations('reason')} label="Reason" onInspect={onInspectOrigin} />
      </div>

      {/* Prompt */}
      {promptLines(pauseState).length > 0 && (
        <div className="mb-3 flex items-start justify-between gap-2">
          {/* Said one after another, so shown one under another. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {promptLines(pauseState).map((line, at) => (
              <MarkdownView key={at} className="text-sm text-[var(--wui-fg-muted)]">{line}</MarkdownView>
            ))}
          </div>
          <OriginChipFor raw={rawConfig?.['prompt']} citations={fieldCitations('prompt')} label="Prompt" onInspect={onInspectOrigin} />
        </div>
      )}

      {/* Display sections (read-only) */}
      {pauseState.display && pauseState.display.length > 0 && (
        <div className="mb-3 space-y-2">
          {pauseState.display.map((section, i) => (
            <DisplaySection
              key={section.label}
              label={section.label}
              value={section.value}
              chip={
                <OriginChipFor
                  raw={rawDisplayValue(rawConfig, i)}
                  citations={fieldCitations(`display.${String(i)}`)}
                  label={section.label}
                  onInspect={onInspectOrigin}
                />
              }
            />
          ))}
        </div>
      )}

      {/* Form (editable) */}
      {pauseState.form && (
        <div className="mb-3">
          <PauseFormRenderer
            form={pauseState.form}
            values={formValues}
            onChange={updateFormValues}
            disabled={isSubmitting}
            errors={formErrors}
            renderFieldChip={(field, i) => (
              <OriginChipFor
                raw={rawFormField(rawConfig, i)}
                citations={fieldCitations(`form.fields.${String(i)}`)}
                label={field.label}
                onInspect={onInspectOrigin}
              />
            )}
          />
        </div>
      )}

      {/* Action buttons — hidden when caller owns them */}
      {!hideActions && (
        <div className="flex gap-2">
          {actions.map((action) => (
            <ActionButton
              key={action.key}
              action={action}
              onClick={() => handleAction(action)}
              disabled={isSubmitting}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-2 text-xs text-[var(--wui-status-failed)]">
          {error.message}
        </div>
      )}
    </div>
  );
}

/**
 * Headless variant — exposes interaction state so the caller can render
 * action buttons wherever it wants (e.g. a sticky footer).
 */
export interface PauseInteractionState {
  actions: PauseAction[];
  isSubmitting: boolean;
  error: Error | null;
  formValues: Record<string, unknown>;
  setFormValues: (v: Record<string, unknown>) => void;
  formErrors: Record<string, string>;
  handleAction: (action: PauseAction) => void;
}

export function usePauseInteractionState(
  executionId: string,
  pauseState: PauseState,
  onResumed?: (action?: PauseAction) => void,
  nodePath?: string,
): PauseInteractionState {
  const { executeAction, isSubmitting, error } = usePauseInteraction({
    executionId,
    nodePath,
    onResume: onResumed,
  });
  const [formValues, setFormValues] = useState<Record<string, unknown>>(
    () => getFormDefaults(pauseState.form),
  );
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const actions = pauseState.actions ?? DEFAULT_ACTIONS;

  const updateFormValues = (next: Record<string, unknown>) => {
    setFormValues(next);
    setFormErrors((prev) => clearTouchedErrors(prev, formValues, next));
  };

  const handleAction = (action: PauseAction) => {
    if (submitsForm(action)) {
      const errs = validatePauseForm(pauseState.form, formValues);
      setFormErrors(errs);
      if (Object.keys(errs).length > 0) return; 
    } else {
      setFormErrors({});
    }
    void executeAction(action, formValues);
  };

  return {
    actions,
    isSubmitting,
    error,
    formValues,
    setFormValues: updateFormValues,
    formErrors,
    handleAction,
  };
}

function DisplaySection({ label, value, chip }: { label: string; value: unknown; chip?: ReactNode }) {
  const hasValue = !(value === null || value === undefined || value === '');
  return (
    <div className="overflow-hidden rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)]">
      <div className={cn(
        'flex items-start justify-between gap-2 bg-[var(--wui-bg-subtle)] px-2.5 py-1.5',
        hasValue && 'border-b border-[var(--wui-border)]',
      )}>
        <Collapsible className="min-w-0 flex-1" maxClass="max-h-40">
          <MarkdownView bare className="text-[11px] font-semibold text-[var(--wui-fg)]">
            {label}
          </MarkdownView>
        </Collapsible>
        {chip}
      </div>
      {hasValue && (
        <DisplayValue value={value} className="px-2.5 py-2 text-sm text-[var(--wui-fg)]" />
      )}
    </div>
  );
}

function ActionButton({
  action,
  onClick,
  disabled,
}: {
  action: PauseAction;
  onClick: () => void;
  disabled: boolean;
}) {
  const style = action.style ?? 'default';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 rounded-[var(--wui-radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors',
        disabled && 'opacity-50 cursor-not-allowed',
        style === 'primary' && 'bg-[var(--wui-status-completed)] text-[var(--wui-primary-fg)] hover:opacity-90',
        style === 'danger' && 'border border-[var(--wui-status-failed)]/30 text-[var(--wui-status-failed)] hover:bg-[var(--wui-status-failed)]/5',
        style === 'default' && 'border border-[var(--wui-border)] text-[var(--wui-fg)] hover:bg-[var(--wui-bg-subtle)]',
      )}
    >
      {action.label}
    </button>
  );
}
