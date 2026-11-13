import { useCallback, useRef, useState } from 'react';
import type { WorkflowConfig, WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import { VariablePickerPopover } from './VariablePickerPopover.js';
import { OptionSuggestions, type FieldOptionsScope } from './field-options.js';
import { cn } from '../../shared/cn.js';
import { isStepConfigArray } from '../../../utils/branch-detection.js';

export interface VariableRefInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  config: WorkflowConfig;
  atStepId: string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** Compact mode — smaller padding for inline usage */
  compact?: boolean | undefined;
  /** Restrict the picker to refs of this schema type (array/string/number/boolean/object). */
  filterType?: string | undefined;
  /**
   * Turns the box into a suggesting one: the owning component is asked what this
   * field's values usually are, and matches appear underneath as the author
   * types.
   *
   * Suggestions, never a gate — the box stays exactly as typeable as it was, and
   * a `{{ref}}` is still written the same way. Omit for a field nobody can
   * enumerate.
   */
  suggest?: {
    scope: FieldOptionsScope;
    /** Dotted path of the field being edited, as `getOptions` receives it. */
    field: string;
    /** The whole component config, so a loader can narrow by sibling fields. */
    config: Record<string, unknown>;
  } | undefined;
}

/** Extract all step IDs from a config tree. */
function collectStepIds(steps: WorkflowStepConfig[]): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    ids.add(step.id);
    if (step.config && typeof step.config === 'object') {
      const cfg = step.config as Record<string, unknown>;
      for (const val of Object.values(cfg)) {
        if (isStepConfigArray(val)) {
          for (const id of collectStepIds(val)) ids.add(id);
        }
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          for (const sub of Object.values(val as Record<string, unknown>)) {
            if (isStepConfigArray(sub)) {
              for (const id of collectStepIds(sub)) ids.add(id);
            }
          }
        }
      }
    }
  }
  return ids;
}

/** Parse {{...}} refs from a string. Returns [beforeText, ref, afterText, ...] segments. */
function parseRefs(text: string): Array<{ type: 'text' | 'ref'; value: string }> {
  const segments: Array<{ type: 'text' | 'ref'; value: string }> = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'ref', value: match[1]! });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

/** Check if a ref's root step ID exists in the config. */
function isRefBroken(refPath: string, stepIds: Set<string>): boolean {
  const rootId = refPath.split('.')[0]!;
  // "trigger" and "execution" are always valid
  if (rootId === 'trigger' || rootId === 'execution') return false;
  return !stepIds.has(rootId);
}

export function VariableRefInput({
  value,
  onChange,
  config,
  atStepId,
  placeholder,
  disabled,
  className,
  compact,
  filterType,
  suggest,
}: VariableRefInputProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stringValue = String(value ?? '');
  const hasRefs = stringValue.includes('{{');

  const handleInsertRef = useCallback((refString: string) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart ?? stringValue.length;
      const end = input.selectionEnd ?? stringValue.length;
      const newVal = stringValue.slice(0, start) + refString + stringValue.slice(end);
      onChange(newVal);
    } else {
      onChange(stringValue + refString);
    }
  }, [stringValue, onChange]);

  // Render inline ref chips when the input has {{...}} values and is not focused
  const stepIds = hasRefs ? collectStepIds(config.steps) : new Set<string>();
  const segments = hasRefs ? parseRefs(stringValue) : [];

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <textarea
          ref={inputRef}
          rows={1}
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'w-full rounded-lg border pr-9 align-top',
            // Grow with content (incl. pasted multi-line markdown) instead of
            // scrolling; preserves newlines that a single-line input would strip.
            'resize-none [field-sizing:content] min-h-[2.25rem] max-h-56 overflow-y-auto whitespace-pre-wrap break-words',
            compact ? 'rounded-md px-2.5 py-1.5 text-xs min-h-[1.875rem]' : 'px-3 py-2 text-sm',
            'bg-white text-[var(--wui-fg)]',
            'outline-none transition-all',
            'border-[var(--wui-border)] focus:border-[var(--wui-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
            disabled && 'opacity-60 cursor-not-allowed bg-[var(--wui-bg-subtle)]',
          )}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setSuggesting(false);
          }}
          onClick={(e) => e.stopPropagation()}
          onFocus={() => setSuggesting(true)}
          onBlur={() => setSuggesting(false)}
        />

        {/* {{}} toggle button — top-right so it stays put as the field grows */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowPicker(!showPicker); }}
          disabled={disabled}
          className={cn(
            'absolute right-1.5 top-1.5 flex h-6 items-center rounded px-1 text-[10px] font-bold transition-colors',
            showPicker
              ? 'bg-indigo-100 text-indigo-600'
              : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-500',
          )}
          title="Insert variable reference"
        >
          {'{{ }}'}
        </button>
      </div>

      {/* Ref chips preview */}
      {hasRefs && segments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {segments.map((seg, i) => {
            if (seg.type === 'text') return null;
            const broken = isRefBroken(seg.value, stepIds);
            return (
              <span
                key={i}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono',
                  broken
                    ? 'bg-red-50 text-red-500 ring-1 ring-red-200'
                    : 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200/60',
                )}
              >
                {broken && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                  </svg>
                )}
                {`{{${seg.value}}}`}
              </span>
            );
          })}
        </div>
      )}

      {/* What this field's values usually are — shown while the box has focus. */}
      {suggest && suggesting && !showPicker && !stringValue.includes('{{') && (
        <OptionSuggestions
          scope={suggest.scope}
          field={suggest.field}
          config={suggest.config}
          search={stringValue}
          onPick={(picked) => {
            onChange(picked);
            setSuggesting(false);
          }}
        />
      )}

      {/* Variable picker popover */}
      {showPicker && (
        <VariablePickerPopover
          config={config}
          atStepId={atStepId}
          filterType={filterType}
          onSelect={handleInsertRef}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
