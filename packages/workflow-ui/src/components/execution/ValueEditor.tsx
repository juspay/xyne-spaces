/**
 * ValueEditor — recursive structured editor for arbitrary JSON values.
 *
 * Aesthetic: instrument-panel / inspector. Each field is one row. Modified
 * rows get an amber rail on the left. Nested objects/arrays recurse with a
 * deeper indent rail. Type pills tell you what each field accepts.
 *
 * Strict mode: the shape is locked to the original value. Users can only
 * UPDATE existing keys/items, not add or remove. Type changes are rejected
 * by the input controls themselves.
 */

import { useState } from 'react';
import { cn } from '../shared/cn.js';

// ─── Types ───

export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

export interface ValueEditorError {
  /** Dot-and-bracket path: e.g. "tools[0]", "config.maxTurns". */
  path: string;
  message: string;
}

export interface ValueEditorProps {
  /** The current edited value at this position. */
  value: unknown;
  /** The original value, used for diff highlighting + type lock + reset. */
  original: unknown;
  /** Display label (object key or array index). Omit for the root. */
  label?: string | undefined;
  /** Path segments from the root — used to label nested errors. */
  path?: string[] | undefined;
  /** Nesting depth — used for the left rail indent. */
  depth?: number | undefined;
  /** Called with the new value at this position whenever the user edits. */
  onChange: (next: unknown) => void;
  /** Called when a child reports an error. Bubbles up to the dialog. */
  onError?: ((errors: ValueEditorError[]) => void) | undefined;
}

// ─── Pure helpers ───

export function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function joinPath(segments: string[]): string {
  if (segments.length === 0) return '';
  let out = '';
  for (const s of segments) {
    if (/^\d+$/.test(s)) {
      out += `[${s}]`;
    } else if (out) {
      out += `.${s}`;
    } else {
      out += s;
    }
  }
  return out;
}

/** Walk a value tree and produce a flat list of validation errors. */
export function validateValueTree(
  value: unknown,
  original: unknown,
  path: string[] = [],
): ValueEditorError[] {
  const errors: ValueEditorError[] = [];

  const originalKind = kindOf(original);
  const currentKind = kindOf(value);

  if (originalKind !== currentKind) {
    errors.push({
      path: joinPath(path),
      message: `Expected ${originalKind}, got ${currentKind}.`,
    });
    return errors;
  }

  if (currentKind === 'object') {
    const cv = value as Record<string, unknown>;
    const ov = original as Record<string, unknown>;
    for (const key of Object.keys(ov)) {
      errors.push(...validateValueTree(cv[key], ov[key], [...path, key]));
    }
    // Strict mode: reject keys not in original
    for (const key of Object.keys(cv)) {
      if (!(key in ov)) {
        errors.push({
          path: joinPath([...path, key]),
          message: `Field "${key}" was not in the original input.`,
        });
      }
    }
  }
  if (currentKind === 'array') {
    const cv = value as unknown[];
    const ov = original as unknown[];
    if (cv.length !== ov.length) {
      errors.push({
        path: joinPath(path),
        message: `Array length must stay ${ov.length} (got ${cv.length}).`,
      });
    }
    for (let i = 0; i < Math.min(cv.length, ov.length); i++) {
      errors.push(...validateValueTree(cv[i], ov[i], [...path, String(i)]));
    }
  }

  return errors;
}

// ─── Tiny primitives ───

function TypePill({ kind, className }: { kind: ValueKind; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-sm border border-[var(--wui-border)] bg-[var(--wui-surface)] px-1 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--wui-fg-muted)]',
        className,
      )}
      title={`type: ${kind}`}
    >
      {kind}
    </span>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Reset to original"
      className="flex h-5 w-5 items-center justify-center rounded text-[var(--wui-fg-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wui-status-paused)_12%,transparent)] hover:text-[var(--wui-status-paused)]"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </button>
  );
}

// ─── Field controls (primitives) ───

function StringInput({
  value,
  onChange,
  isDirty,
}: {
  value: string;
  onChange: (next: string) => void;
  isDirty: boolean;
}) {
  const lineCount = value.split('\n').length;
  const rows = Math.min(18, Math.max(1, lineCount));
  const isMultiLine = lineCount > 1 || value.length > 60;

  if (!isMultiLine) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full bg-transparent font-mono text-[12px] text-[var(--wui-fg)]',
          'border-0 border-b border-dotted py-1 outline-none transition-colors',
          isDirty ? 'border-[var(--wui-status-paused)] focus:border-[var(--wui-status-paused)]' : 'border-[var(--wui-border)] focus:border-[var(--wui-border-strong)]',
        )}
      />
    );
  }
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      rows={rows}
      className={cn(
        'w-full resize-y rounded-sm bg-transparent px-2 py-1.5 font-mono text-[12px] leading-[1.55] text-[var(--wui-fg)]',
        'border outline-none transition-colors',
        isDirty
          ? 'border-[var(--wui-status-paused)] bg-[color-mix(in_srgb,var(--wui-status-paused)_10%,transparent)] focus:border-[var(--wui-status-paused)] focus:bg-[var(--wui-surface)]'
          : 'border-[var(--wui-border)] focus:border-[var(--wui-border-strong)] focus:bg-[var(--wui-surface)]',
      )}
    />
  );
}

function NumberInput({
  value,
  onChange,
  isDirty,
}: {
  value: number;
  onChange: (next: number) => void;
  isDirty: boolean;
}) {
  const hasError = !Number.isFinite(value);
  return (
    <input
      type="number"
      step="any"
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === '' ? Number.NaN : Number(raw));
      }}
      className={cn(
        'w-32 bg-transparent font-mono text-[12px] text-[var(--wui-fg)]',
        'border-0 border-b border-dotted py-1 outline-none transition-colors',
        '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        hasError
          ? 'border-[var(--wui-status-failed)] text-[var(--wui-status-failed)] focus:border-[var(--wui-status-failed)]'
          : isDirty
          ? 'border-[var(--wui-status-paused)] focus:border-[var(--wui-status-paused)]'
          : 'border-[var(--wui-border)] focus:border-[var(--wui-border-strong)]',
      )}
    />
  );
}

function BooleanInput({
  value,
  onChange,
  isDirty,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  isDirty: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-flex overflow-hidden rounded-sm border text-[10px]',
        isDirty ? 'border-[var(--wui-status-paused)]' : 'border-[var(--wui-border)]',
      )}
    >
      {(['true', 'false'] as const).map((opt) => {
        const selected = (value ? 'true' : 'false') === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt === 'true')}
            className={cn(
              'px-2 py-0.5 font-mono uppercase tracking-wider transition-colors',
              selected
                ? isDirty
                  ? 'bg-[color-mix(in_srgb,var(--wui-status-paused)_18%,transparent)] text-[var(--wui-status-paused)]'
                  : 'bg-[var(--wui-bg-muted)] text-[var(--wui-fg)]'
                : 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)]',
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Recursive ValueEditor ───

export function ValueEditor({
  value,
  original,
  label,
  path = [],
  depth = 0,
  onChange,
}: ValueEditorProps) {
  const originalKind = kindOf(original);
  const currentKind = kindOf(value);
  const typeMismatch = originalKind !== currentKind;
  const isDirty = !deepEqual(value, original);

  if (currentKind === 'object' && originalKind === 'object') {
    return (
      <ObjectEditor
        value={value as Record<string, unknown>}
        original={original as Record<string, unknown>}
        label={label}
        path={path}
        depth={depth}
        isDirty={isDirty}
        onChange={onChange}
      />
    );
  }

  if (currentKind === 'array' && originalKind === 'array') {
    return (
      <ArrayEditor
        value={value as unknown[]}
        original={original as unknown[]}
        label={label}
        path={path}
        depth={depth}
        isDirty={isDirty}
        onChange={onChange}
      />
    );
  }

  return (
    <ScalarRow
      value={value}
      original={original}
      originalKind={originalKind}
      label={label}
      path={path}
      depth={depth}
      isDirty={isDirty}
      typeMismatch={typeMismatch}
      onChange={onChange}
    />
  );
}

// ─── Row primitives ───

function FieldLabel({
  label,
  kind,
  isDirty,
  isArrayIndex,
}: {
  label: string | undefined;
  kind: ValueKind;
  isDirty: boolean;
  isArrayIndex: boolean;
}) {
  if (!label) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          'font-mono text-[11px] leading-none',
          isArrayIndex ? 'text-[var(--wui-fg-muted)]' : 'text-[var(--wui-fg)]',
          isDirty && !isArrayIndex && 'text-[var(--wui-status-paused)]',
        )}
      >
        {isArrayIndex ? `[${label}]` : label}
      </span>
      <TypePill kind={kind} />
    </div>
  );
}

interface ScalarRowProps {
  value: unknown;
  original: unknown;
  originalKind: ValueKind;
  label: string | undefined;
  path: string[];
  depth: number;
  isDirty: boolean;
  typeMismatch: boolean;
  onChange: (next: unknown) => void;
}

function ScalarRow({
  value,
  original,
  originalKind,
  label,
  depth,
  isDirty,
  typeMismatch,
  onChange,
}: ScalarRowProps) {
  const isArrayIndex = label !== undefined && /^\d+$/.test(label);
  const handleReset = () => onChange(original);

  const renderInput = () => {
    if (typeMismatch) {
      return (
        <span className="font-mono text-[11px] text-[var(--wui-status-failed)]">
          type changed — reset to edit
        </span>
      );
    }
    switch (originalKind) {
      case 'string':
        return (
          <StringInput
            value={value as string}
            onChange={(s) => onChange(s)}
            isDirty={isDirty}
          />
        );
      case 'number':
        return (
          <NumberInput
            value={typeof value === 'number' ? value : Number.NaN}
            onChange={(n) => onChange(n)}
            isDirty={isDirty}
          />
        );
      case 'boolean':
        return (
          <BooleanInput
            value={value as boolean}
            onChange={(b) => onChange(b)}
            isDirty={isDirty}
          />
        );
      case 'null':
        return (
          <span className="font-mono text-[11px] italic text-[var(--wui-fg-muted)]">null</span>
        );
      default:
        return null;
    }
  };

  return (
    <Row depth={depth} isDirty={isDirty} isArrayIndex={isArrayIndex}>
      <FieldLabel
        label={label}
        kind={originalKind}
        isDirty={isDirty}
        isArrayIndex={isArrayIndex}
      />
      <div className="min-w-0 flex-1">{renderInput()}</div>
      {isDirty && !typeMismatch && <ResetButton onClick={handleReset} />}
    </Row>
  );
}

function Row({
  children,
  depth,
  isDirty,
  isArrayIndex,
}: {
  children: React.ReactNode;
  depth: number;
  isDirty: boolean;
  isArrayIndex?: boolean;
}) {
  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 border-l-2 py-1.5 pl-3 pr-1 transition-colors',
        isDirty
          ? 'border-[var(--wui-status-paused)] bg-[color-mix(in_srgb,var(--wui-status-paused)_8%,transparent)]'
          : 'border-transparent hover:bg-[var(--wui-bg-muted)]',
        isArrayIndex && 'opacity-95',
      )}
      style={{ marginLeft: depth > 0 ? 0 : undefined }}
    >
      {children}
    </div>
  );
}

// ─── Object editor ───

interface ObjectEditorProps {
  value: Record<string, unknown>;
  original: Record<string, unknown>;
  label?: string | undefined;
  path: string[];
  depth: number;
  isDirty: boolean;
  onChange: (next: Record<string, unknown>) => void;
}

function ObjectEditor({
  value,
  original,
  label,
  path,
  depth,
  isDirty,
  onChange,
}: ObjectEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const keys = Object.keys(original);
  const changedChildKeys = keys.filter((k) => !deepEqual(value[k], original[k]));

  return (
    <div className="space-y-px">
      {label !== undefined && (
        <Row depth={depth} isDirty={isDirty}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className={cn('transition-transform', collapsed ? '' : 'rotate-90')}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <FieldLabel label={label} kind="object" isDirty={isDirty} isArrayIndex={false} />
          <span className="font-mono text-[10px] text-[var(--wui-fg-muted)]">
            {`{${String(keys.length)}}`}
          </span>
          {changedChildKeys.length > 0 && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--wui-status-paused)_18%,transparent)] px-1.5 py-px font-mono text-[9px] text-[var(--wui-status-paused)]">
              {changedChildKeys.length} changed
            </span>
          )}
        </Row>
      )}
      {!collapsed && (
        <div
          className={cn(
            'space-y-px',
            label !== undefined && 'ml-3 border-l border-dashed border-[var(--wui-border)] pl-2',
          )}
        >
          {keys.map((key) => (
            <ValueEditor
              key={key}
              value={value[key]}
              original={original[key]}
              label={key}
              path={[...path, key]}
              depth={depth + 1}
              onChange={(childNext) => onChange({ ...value, [key]: childNext })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Array editor ───

interface ArrayEditorProps {
  value: unknown[];
  original: unknown[];
  label?: string | undefined;
  path: string[];
  depth: number;
  isDirty: boolean;
  onChange: (next: unknown[]) => void;
}

function ArrayEditor({
  value,
  original,
  label,
  path,
  depth,
  isDirty,
  onChange,
}: ArrayEditorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const changedItemCount = original.filter((o, i) => !deepEqual(value[i], o)).length;

  return (
    <div className="space-y-px">
      {label !== undefined && (
        <Row depth={depth} isDirty={isDirty}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className={cn('transition-transform', collapsed ? '' : 'rotate-90')}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <FieldLabel label={label} kind="array" isDirty={isDirty} isArrayIndex={false} />
          <span className="font-mono text-[10px] text-[var(--wui-fg-muted)]">
            {`[${String(original.length)}]`}
          </span>
          {changedItemCount > 0 && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--wui-status-paused)_18%,transparent)] px-1.5 py-px font-mono text-[9px] text-[var(--wui-status-paused)]">
              {changedItemCount} changed
            </span>
          )}
        </Row>
      )}
      {!collapsed && (
        <div
          className={cn(
            'space-y-px',
            label !== undefined && 'ml-3 border-l border-dashed border-[var(--wui-border)] pl-2',
          )}
        >
          {original.map((item, i) => (
            <ValueEditor
              key={i}
              value={value[i]}
              original={item}
              label={String(i)}
              path={[...path, String(i)]}
              depth={depth + 1}
              onChange={(childNext) => {
                const next = value.slice();
                next[i] = childNext;
                onChange(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
