import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { FieldRow } from '../lib/ticketPanel';
import { Check, ChevronDown, Close, MENU_STYLE, SearchIcon } from './primitives';

/**
 * Building blocks for the Desk-style ticket panel, drawn with Spaces Design System tokens: the
 * rounded detail chips, an anchored popover, a searchable option list, a date-time editor and the
 * custom-field value editors.
 */

/** Desk's DetailChip: a 27px rounded-full chip, solid or dashed when unset. */
export const CHIP: CSSProperties = {
  all: 'unset',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  height: 27,
  padding: '0 11px',
  borderRadius: 999,
  border: '1px solid var(--bd)',
  background: 'var(--bg)',
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--t1)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
};
export const DASHED: CSSProperties = { ...CHIP, border: '1px dashed color-mix(in srgb, var(--t3) 40%, transparent)', color: 'var(--t3)' };

/** "Breached" and similar markers inside a chip. */
export function Marker({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'warn' }) {
  const c = tone === 'danger' ? { c: 'var(--redT)', bg: 'var(--redBg)', bd: 'var(--redBd)' } : { c: 'var(--amberT)', bg: 'var(--amberBg)', bd: 'var(--amberBd)' };
  return <span style={{ height: 16, display: 'inline-flex', alignItems: 'center', borderRadius: 5, border: `1px solid ${c.bd}`, background: c.bg, color: c.c, padding: '0 5px', fontSize: 10, fontWeight: 600 }}>{children}</span>;
}

/** A trigger plus a panel anchored under it; closes on outside click or Escape. */
export function Pop({
  trigger,
  children,
  width = 260,
  align = 'left',
  disabled = false,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
  align?: 'left' | 'right';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  // Take Escape before the panel does, so it closes only this popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', maxWidth: '100%' }}>
      {trigger(open, () => !disabled && setOpen(o => !o))}
      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ ...MENU_STYLE, zIndex: 41, top: 'calc(100% + 4px)', [align]: 0, width, maxWidth: 'calc(100vw - 32px)', padding: 0 }}>{children(close)}</div>
        </>
      )}
    </div>
  );
}

export interface Opt {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Right-aligned hint, e.g. "2/7" or "Open in Xyne". */
  hint?: string;
  disabled?: boolean;
}

/** A searchable single-choice list with keyboard support. */
export function OptionList({
  options,
  selected,
  onPick,
  placeholder = 'Search…',
  searchable = true,
  footer,
}: {
  options: Opt[];
  selected: string | null;
  onPick: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  footer?: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const shown = options.filter(o => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [q]);
  const pick = (o: Opt | undefined): void => {
    if (o && !o.disabled) onPick(o.value);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = shown.length;
      if (!n) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(shown[active]);
    }
  };
  return (
    <div onKeyDown={onKey}>
      {searchable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', borderBottom: '1px solid var(--bd)' }}>
          <SearchIcon size={14} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ all: 'unset', flex: 1, fontSize: 14, color: 'var(--t1)' }} />
        </div>
      )}
      <div ref={listRef} role="listbox" style={{ maxHeight: 260, overflowY: 'auto', padding: 4, display: 'flex', flexDirection: 'column' }}>
        {shown.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === selected}
            aria-disabled={o.disabled}
            autoFocus={!searchable && i === 0}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(o)}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 32,
              padding: '0 8px',
              borderRadius: 4,
              fontSize: 14,
              cursor: o.disabled ? 'not-allowed' : 'pointer',
              color: o.disabled ? 'var(--t5)' : 'var(--t1)',
              background: i === active && !o.disabled ? 'var(--bg3)' : 'transparent',
            }}
          >
            {o.icon}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
            {o.hint && <span style={{ flex: 'none', fontSize: 12, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{o.hint}</span>}
            <span style={{ display: 'flex', opacity: o.value === selected ? 1 : 0 }}>
              <Check size={14} />
            </span>
          </button>
        ))}
        {shown.length === 0 && <span style={{ padding: 8, fontSize: 13, color: 'var(--t3)' }}>No results found</span>}
      </div>
      {footer}
    </div>
  );
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** epoch ms → the value a datetime-local input wants, in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A date-time picker with Save / Cancel. Past dates are refused when `future` is set. */
export function DateTimeEditor({ value, future, onSave, onCancel }: { value: number | null; future?: boolean; onSave: (ms: number) => void; onCancel: () => void }) {
  const [v, setV] = useState(value ? toLocalInput(value) : '');
  const ms = v ? new Date(v).getTime() : NaN;
  const past = future && Number.isFinite(ms) && ms < Date.now();
  const ok = Number.isFinite(ms) && !past;
  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        type="datetime-local"
        autoFocus
        value={v}
        min={future ? toLocalInput(Date.now()) : undefined}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && ok) onSave(ms);
        }}
        className="field"
        style={{ height: 32, boxSizing: 'border-box', padding: '0 10px', border: '1px solid var(--input)', borderRadius: 6, background: 'var(--bg)', color: 'var(--t1)', fontFamily: 'inherit', fontSize: 14 }}
      />
      {past && <span style={{ fontSize: 12, color: 'var(--redT)' }}>Pick a time in the future</span>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <SmallButton onClick={onCancel}>Cancel</SmallButton>
        <SmallButton solid disabled={!ok} onClick={() => ok && onSave(ms)}>
          Save
        </SmallButton>
      </div>
    </div>
  );
}

export function SmallButton({ children, onClick, solid = false, disabled = false }: { children: ReactNode; onClick: () => void; solid?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={solid ? 'solid' : 'outline'}
      onClick={onClick}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        height: 30,
        padding: '0 12px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...(solid ? { background: 'var(--t1)', color: 'var(--bg)' } : { border: '1px solid var(--bd)', color: 'var(--t1)', background: 'var(--bg)' }),
      }}
    >
      {children}
    </button>
  );
}

/** Click-to-edit text: shows the value, turns into an input or textarea, saves on Enter/blur. */
export function InlineText({
  value,
  onSave,
  multiline = false,
  placeholder = 'Empty',
  style,
  display,
}: {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  /** How to show the value while not editing (defaults to the raw text). */
  display?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = (): void => {
    setEditing(false);
    if (v.trim() !== value.trim()) onSave(v.trim());
  };
  if (editing) {
    const common = {
      autoFocus: true,
      value: v,
      onChange: (e: { target: { value: string } }) => setV(e.target.value),
      onBlur: commit,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setV(value);
          setEditing(false);
        } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      },
      style: { ...style, width: '100%', boxSizing: 'border-box' as const, font: 'inherit', color: 'var(--t1)', background: 'var(--bg)', border: '1px solid var(--ring)', borderRadius: 8, outline: 'none', padding: '4px 7px', resize: 'vertical' as const },
    };
    return multiline ? <textarea rows={6} {...common} /> : <input {...common} />;
  }
  return (
    <div role="button" tabIndex={0} className="editable" onClick={() => setEditing(true)} onKeyDown={e => e.key === 'Enter' && setEditing(true)} style={{ ...style, cursor: 'text', borderRadius: 8, padding: '4px 7px', margin: '0 -7px' }}>
      {display ?? (value || <span style={{ color: 'var(--t5)' }}>{placeholder}</span>)}
    </div>
  );
}

const SELECT_TRIGGER: CSSProperties = {
  all: 'unset',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 28,
  maxWidth: '100%',
  padding: '2px 7px',
  // Shift left so the text lines up with the label column; relative positioning doesn't shrink it
  // the way a negative margin does inside a flex parent.
  position: 'relative',
  left: -7,
  borderRadius: 6,
  fontSize: 13.5,
  cursor: 'pointer',
};

/** A value in the Fields list that opens a single-choice list. */
export function SelectValue({ value, options, onPick, placeholder, clearable = false }: { value: string | null; options: Opt[]; onPick: (v: string | null) => void; placeholder: string; clearable?: boolean }) {
  const label = options.find(o => o.value === value)?.label ?? value;
  return (
    <Pop
      width={280}
      trigger={(open, toggle) => (
        <button type="button" className="editable" aria-expanded={open} onClick={toggle} style={{ ...SELECT_TRIGGER, color: label ? 'var(--t1)' : 'var(--t4)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || placeholder}</span>
          <ChevronDown size={14} />
        </button>
      )}
    >
      {close => (
        <OptionList
          options={options}
          selected={value}
          searchable={options.length > 8}
          onPick={v => {
            close();
            if (v !== value) onPick(v);
          }}
          footer={
            clearable && value ? (
              <button
                type="button"
                className="hov"
                onClick={() => {
                  close();
                  onPick(null);
                }}
                style={{ all: 'unset', display: 'block', padding: '8px 12px', borderTop: '1px solid var(--bd)', fontSize: 13, color: 'var(--t2)', cursor: 'pointer', textAlign: 'center' }}
              >
                Clear
              </button>
            ) : null
          }
        />
      )}
    </Pop>
  );
}

/** Multi-choice list for MULTI_SELECT fields; saves when closed via Done. */
function MultiValue({ row, onSave }: { row: FieldRow; onSave: (v: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(row.values);
  useEffect(() => setSel(row.values), [row.values]);
  return (
    <Pop
      width={280}
      trigger={(open, toggle) => (
        <button type="button" className="editable" aria-expanded={open} onClick={toggle} style={{ ...SELECT_TRIGGER, flexWrap: 'wrap', color: row.values.length ? 'var(--t1)' : 'var(--t4)' }}>
          {row.values.length ? row.values.map(v => <span key={v} style={{ padding: '1px 7px', borderRadius: 4, background: 'var(--bg3)', fontSize: 12.5 }}>{v}</span>) : 'Select…'}
          <ChevronDown size={14} />
        </button>
      )}
    >
      {close => (
        <div>
          <div style={{ maxHeight: 260, overflowY: 'auto', padding: 4 }}>
            {row.options.map(o => {
              const on = sel.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  className="hov"
                  onClick={() => setSel(s => (on ? s.filter(x => x !== o) : [...s, o]))}
                  style={{ all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, padding: '0 8px', borderRadius: 4, fontSize: 14, color: 'var(--t1)', cursor: 'pointer' }}
                >
                  <span style={{ flex: 1 }}>{o}</span>
                  <span style={{ display: 'flex', opacity: on ? 1 : 0 }}>
                    <Check size={14} />
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', padding: 8, borderTop: '1px solid var(--bd)' }}>
            <SmallButton
              onClick={() => {
                setSel(row.values);
                close();
              }}
            >
              Cancel
            </SmallButton>
            <SmallButton
              solid
              onClick={() => {
                close();
                if (sel.join('\u0000') !== row.values.join('\u0000')) onSave(sel);
              }}
            >
              Done
            </SmallButton>
          </div>
        </div>
      )}
    </Pop>
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** The right editor for a custom field's type; USER and TICKET fields are shown read-only. */
export function FieldValueEditor({ row, onSave }: { row: FieldRow; onSave: (v: string[]) => void }) {
  const v = row.values[0] ?? '';
  switch (row.type) {
    case 'SINGLE_SELECT':
      return <SelectValue value={v || null} options={row.options.map(o => ({ value: o, label: o }))} placeholder="Select…" clearable onPick={x => onSave(x ? [x] : [])} />;
    case 'MULTI_SELECT':
      return <MultiValue row={row} onSave={onSave} />;
    case 'BOOLEAN':
      return <SelectValue value={v || null} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }].map(o => ({ ...o, label: o.label }))} placeholder="Select…" clearable onPick={x => onSave(x ? [x] : [])} />;
    case 'DATE':
      return (
        <input
          type="date"
          defaultValue={DATE_RE.test(v) ? v.slice(0, 10) : ''}
          onChange={e => onSave(e.target.value ? [e.target.value] : [])}
          className="field"
          style={{ height: 28, boxSizing: 'border-box', padding: '0 8px', position: 'relative', left: -7, border: '1px solid transparent', borderRadius: 6, background: 'transparent', color: v ? 'var(--t1)' : 'var(--t4)', fontFamily: 'inherit', fontSize: 13.5 }}
        />
      );
    case 'USER':
    case 'TICKET':
      return <span style={{ fontSize: 13.5, color: v ? 'var(--t1)' : 'var(--t4)' }}>{row.values.join(', ') || 'Empty'}</span>;
    default:
      return <InlineText value={row.values.join(', ')} onSave={x => onSave(x ? [x] : [])} style={{ fontSize: 13.5, overflowWrap: 'anywhere' }} />;
  }
}

/** A remove "×" inside a chip. */
export function ChipX({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      style={{ display: 'flex', color: 'var(--t4)', cursor: 'pointer' }}
    >
      <Close size={12} />
    </span>
  );
}
