/**
 * Shared pieces of the conversational-flow editor: the vocabulary of screen types, and
 * inputs that commit on blur (each commit rewrites the workflow config, so the
 * author types freely and the flow re-reads once).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  CircleStop,
  LayoutList,
  MessageSquareText,
  PenLine,
  Route,
  Sparkles,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../shared/cn.js';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { type ConversationalFlow, type NewScreenType, type Screen, type ScreenKind, treeOrder } from '@xyne/workflow-sdk/conversational-flow';

/**
 * One change to the workflow. Every control in the editor makes its change this
 * way; a refused edit surfaces as a message and changes nothing.
 */
export type Edit = (change: (config: WorkflowConfig) => WorkflowConfig) => boolean;

export interface KindMeta {
  label: string;
  /** What choosing it means, in the author's terms. */
  hint: string;
  color: string;
  Icon: LucideIcon;
}

export const KIND: Record<ScreenKind, KindMeta> = {
  menu: { label: 'Menu', hint: 'A message and options that lead to more screens.', color: 'var(--wui-cf-menu)', Icon: LayoutList },
  message: { label: 'Message', hint: 'Says something, then offers the way back or to finish.', color: 'var(--wui-cf-message)', Icon: MessageSquareText },
  input: { label: 'Input', hint: 'Asks for something, then opens the one screen inside it.', color: 'var(--wui-cf-menu)', Icon: PenLine },
  'ask-ai': { label: 'Ask AI', hint: 'An agent answers from your systems and sources until they move on.', color: 'var(--wui-cf-ai)', Icon: Sparkles },
  router: { label: 'Router', hint: 'Reads what they typed and opens the screen that fits.', color: 'var(--wui-cf-ai)', Icon: Route },
  end: { label: 'Finish', hint: 'Ends the conversation; what it carries is the outcome.', color: 'var(--wui-cf-end)', Icon: CircleStop },
  handoff: { label: 'Hand off', hint: 'Passes the conversation to a person.', color: 'var(--wui-cf-end)', Icon: UserRound },
  custom: { label: 'Custom steps', hint: 'Steps this editor doesn’t draw. Open them as steps.', color: 'var(--wui-cf-end)', Icon: Wrench },
};

/** A small coloured label for a screen type. */
export function KindTag({ kind, className }: { kind: ScreenKind; className?: string }) {
  const { label, color, Icon } = KIND[kind];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} aria-hidden />
      {label}
    </span>
  );
}

const field =
  'w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-2.5 py-1.5 text-[13px] text-[var(--wui-fg)] outline-none transition-colors placeholder:text-[var(--wui-fg-subtle,var(--wui-fg-muted))] hover:border-[var(--wui-border-strong,var(--wui-border))] focus:border-[var(--wui-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wui-primary)_18%,transparent)] disabled:cursor-not-allowed disabled:opacity-60';

interface CommitProps {
  id?: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** A `<datalist>` to suggest from. Still free text — the suggestions are a shortcut. */
  list?: string;
  'aria-label'?: string;
}

export function CommitInput({ value, onCommit, className, ...rest }: CommitProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(field, className)}
    />
  );
}

export function CommitTextarea({
  value,
  onCommit,
  className,
  rows = 3,
  footer,
  onBraces,
  ...rest
}: CommitProps & {
  rows?: number;
  /**
   * Rendered under the box, and handed a way to put text where the cursor is —
   * which is how a value is inserted while writing rather than pasted after.
   */
  footer?: (insert: (text: string) => void) => ReactNode;
  /** Called when someone types `{{`, the unambiguous "I want a value here". */
  onBraces?: (insert: (text: string) => void) => void;
}) {
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const insert = (text: string) => {
    const el = area.current;
    const from = el?.selectionStart ?? draft.length;
    const to = el?.selectionEnd ?? from;
    const next = draft.slice(0, from) + text + draft.slice(to);
    setDraft(next);
    // Picking a value is the whole intent; there is nothing to wait for.
    onCommit(next);
    requestAnimationFrame(() => {
      el?.focus();
      const at = from + text.length;
      el?.setSelectionRange(at, at);
    });
  };

  const area_ = (
    <textarea
      {...rest}
      ref={area}
      rows={rows}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const at = e.target.selectionStart;
        if (onBraces && e.target.value.slice(Math.max(0, at - 2), at) === '{{') onBraces(insert);
      }}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(field, 'resize-y leading-relaxed', className)}
    />
  );

  if (!footer) return area_;
  return (
    <div className="flex flex-col gap-1.5">
      {area_}
      {footer(insert)}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(field, props.className)} />;
}

/**
 * A select that looks like one.
 *
 * The native control draws its own arrow, but only at the far edge of whatever
 * width it has — on a narrow inline control that reads as a label with a stray
 * mark beside it. So the arrow is drawn here, right after the text, and the
 * control is sized to its content: a thing you can tell is a thing you can open.
 */
export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex min-w-0 items-center">
      <select
        {...rest}
        className={cn(
          field,
          'cursor-pointer appearance-none truncate pr-6 disabled:cursor-not-allowed',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-[var(--wui-fg-muted)]"
        aria-hidden
      />
    </span>
  );
}

/** Every screen an option can lead to: the menu in outline order, then the rest. */
export function ScreenPicker({
  id,
  flow,
  value,
  onChange,
  disabled,
  placeholder,
  className,
  only,
  'aria-label': ariaLabel,
}: {
  id?: string;
  flow: ConversationalFlow;
  value: string;
  onChange: (screenId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Narrows the list when only some screens will do — somewhere to move to, say. */
  only?: (screen: Screen) => boolean;
  'aria-label'?: string;
}) {
  const keep = only ?? (() => true);
  const menu = treeOrder(flow).filter(keep);
  const rest = flow.screens.filter((s) => s.depth === -1 && s.kind !== 'router').filter(keep);
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      <optgroup label="Screens">
        {menu.map((s) => (
          <option key={s.id} value={s.id}>
            {' '.repeat(s.depth)}
            {s.title}
          </option>
        ))}
      </optgroup>
      {rest.length > 0 && (
        <optgroup label="Also in this flow">
          {rest.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

/** A numbered, uppercase heading that opens a block of the inspector: "01  MESSAGE". */
export function SectionHead({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h3 className="flex items-baseline gap-3 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--wui-fg)]">
      <span className="font-mono text-[var(--wui-primary)]">{n}</span>
      {children}
    </h3>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-[var(--wui-fg)]">
        {children}
      </label>
      {hint && <span className="text-[11.5px] text-[var(--wui-fg-muted)]">{hint}</span>}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  tone = 'default',
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        tone === 'danger'
          ? 'hover:bg-[color-mix(in_srgb,var(--wui-status-failed)_12%,transparent)] hover:text-[var(--wui-status-failed)]'
          : 'hover:bg-[color-mix(in_srgb,var(--wui-fg)_7%,transparent)] hover:text-[var(--wui-fg)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--wui-primary)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--wui-radius-sm)] px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-[var(--wui-primary)] font-semibold text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)]',
        variant === 'secondary' && 'border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] text-[var(--wui-fg)] hover:bg-[var(--wui-bg-muted)]',
        variant === 'ghost' && 'text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] hover:text-[var(--wui-fg)]',
        variant === 'danger' && 'text-[var(--wui-status-failed)] hover:bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--wui-primary)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

const NEW_TYPES: NewScreenType[] = ['menu', 'message', 'ask-ai', 'end', 'handoff'];

/** Choose a screen type — each one described in the author's terms. */
export function TypeChoice({ value, onChange, disabled }: { value: NewScreenType; onChange: (t: NewScreenType) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Screen type" className="grid grid-cols-2 gap-1.5">
      {NEW_TYPES.map((t) => {
        const meta = KIND[t];
        const on = value === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={meta.hint}
            onClick={() => onChange(t)}
            className={cn(
              'flex items-center gap-2 rounded-[var(--wui-radius-sm)] border px-2.5 py-2 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'border-transparent font-semibold text-[var(--wui-fg)]' : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
            style={on ? { background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${meta.color}` } : undefined}
          >
            <meta.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
