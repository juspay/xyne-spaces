import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Check as LCheck, ChevronDown as LChevronDown, ChevronLeft as LChevronLeft, ExternalLink, Search, X } from 'lucide-react';
import { bucketOf } from '../lib/portfolio';
import { usePeople } from '../lib/people';
import { avatarColors, avatarInitial } from '../lib/avatar';
import type { Sev } from '../lib/flags';
import type { Pri, St } from '../lib/model';

/** Shared look (Spaces Design System): palettes, glyphs, buttons, menus, tooltips and the toast. */

export const PAL: Record<Sev, { c: string; bg: string; bd: string; dot: string }> = {
  red: { c: 'var(--redT)', bg: 'var(--redBg)', bd: 'var(--redBd)', dot: 'var(--red)' },
  amber: { c: 'var(--amberT)', bg: 'var(--amberBg)', bd: 'var(--amberBd)', dot: 'var(--amber)' },
  watch: { c: 'var(--t3)', bg: 'var(--bg3)', bd: 'var(--bd)', dot: 'var(--t5)' },
  ok: { c: 'var(--greenT)', bg: 'var(--greenBg)', bd: 'var(--greenBd)', dot: 'var(--green)' },
};

/** Age-bucket colours: bar fills, and text/background for age badges. */
export const BUCKET_COLOR = ['var(--t7)', 'var(--t5)', 'var(--dec)', 'var(--act)', 'var(--red)'];
const AGEC = [
  { c: 'var(--t3)', bg: 'var(--bg3)' },
  { c: 'var(--t3)', bg: 'var(--bg3)' },
  { c: 'var(--decT)', bg: 'var(--decBg)' },
  { c: 'var(--actT)', bg: 'var(--actBg)' },
  { c: 'var(--redT)', bg: 'var(--redBg)' },
];
export const ageColor = (d: number): { c: string; bg: string } => AGEC[bucketOf(d)];
export const DONE_COLOR = { c: 'var(--greenT)', bg: 'var(--greenBg)' };

const TONE: Record<string, string> = { red: 'var(--redT)', amber: 'var(--amberT)', green: 'var(--greenT)', default: 'var(--t1)' };
/** Colour for a KPI / timing value; 'age' tones colour by the age in the value ("12d"). */
export function toneColor(tone: string, value: string): string {
  if (tone !== 'age') return TONE[tone] ?? 'var(--t1)';
  const n = /^(\d+)d$/.exec(value);
  return ageColor(n ? Number(n[1]) : 0).c;
}

export const MENU_STYLE: CSSProperties = {
  position: 'absolute',
  zIndex: 25,
  top: 36,
  background: 'var(--bg)',
  border: '1px solid var(--bd)',
  borderRadius: 8,
  boxShadow: 'var(--shadowMd)',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  animation: 'mpvUp .14s ease-out',
};

export const TRIGGER_STYLE: CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 10px 0 12px',
  boxSizing: 'border-box',
  border: '1px solid var(--input)',
  borderRadius: 6,
  background: 'var(--bg)',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--t3)',
  whiteSpace: 'nowrap',
};

/* ---------- icons ---------- */

// lucide-react, the Spaces icon system: 16px in controls, 1.5–2 stroke, currentColor by default.
const IC = { flex: 'none' } as const;
export const ChevronDown = ({ size = 14, color = 'var(--t4)' }: { size?: number; color?: string }) => <LChevronDown size={size} color={color} strokeWidth={1.75} style={IC} />;
export const ChevronLeft = ({ size = 16 }: { size?: number }) => <LChevronLeft size={size} strokeWidth={1.75} style={IC} />;
export const Check = ({ size = 16, color = 'var(--t1)' }: { size?: number; color?: string }) => <LCheck size={size} color={color} strokeWidth={2} style={IC} />;
export const Close = ({ size = 14 }: { size?: number }) => <X size={size} strokeWidth={1.75} style={IC} />;
export const SearchIcon = ({ size = 16 }: { size?: number }) => <Search size={size} color="var(--t4)" strokeWidth={1.75} style={IC} />;
export const External = ({ size = 14 }: { size?: number }) => <ExternalLink size={size} strokeWidth={1.75} style={IC} />;

/** Workflow-state ring: dashed before work starts, hollow while held, centre-filled once landed. */
export function StatusGlyph({ st, size = 14 }: { st: St; size?: number }) {
  const meta: Record<St, { c: string; dashed?: boolean; dot?: boolean }> = {
    todo: { c: 'var(--t5)' },
    started: { c: 'var(--blue)', dot: true },
    paused: { c: 'var(--amber)' },
    completed: { c: 'var(--green)', dot: true },
    cancelled: { c: 'var(--red)' },
  };
  const m = meta[st];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flex: 'none' }}>
      <circle cx="7" cy="7" r="5.4" stroke={m.c} strokeWidth="1.9" strokeDasharray={m.dashed ? '2.6 2.4' : '0'} />
      {m.dot && <circle cx="7" cy="7" r="2.7" fill={m.c} />}
    </svg>
  );
}

/** Priority: a red warning triangle for urgent, otherwise three bars that fade with priority. */
export function PriorityIcon({ pri, size = 12 }: { pri: Pri; size?: number }) {
  if (pri === 'critical') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="var(--redT)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
        <path d="M10 2.8l7 12.4H3z" />
        <path d="M10 7.6v3.2M10 13v.01" />
      </svg>
    );
  }
  const on = 'var(--t3)';
  const off = 'var(--t7)';
  const bars = { high: [on, on, on], medium: [on, on, off], low: [on, off, off], none: [off, off, off] }[pri];
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ flex: 'none' }}>
      <rect x="3" y="12" width="3.4" height="5" rx="1" fill={bars[0]} />
      <rect x="8.3" y="8.6" width="3.4" height="8.4" rx="1" fill={bars[1]} />
      <rect x="13.6" y="5" width="3.4" height="12" rx="1" fill={bars[2]} />
    </svg>
  );
}

/** A person's Xyne profile picture, else their first letter on the colour the Xyne dashboard gives them. */
export function Avatar({ name, size = 18, src }: { name: string; size?: number; src?: string | null }) {
  const people = usePeople();
  const [broken, setBroken] = useState(false);
  const person = people.byName.get(name);
  const picture = src === undefined ? (person?.picture ?? null) : src;
  // By user id, like the dashboard; a name we can't match to a person still gets a steady colour.
  const { bg, fg } = avatarColors(person?.id ?? name);
  const box: CSSProperties = { width: size, height: size, borderRadius: '50%', flex: 'none' };
  if (picture && !broken) {
    return <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ ...box, objectFit: 'cover', background: 'var(--bg3)' }} />;
  }
  return (
    <span aria-hidden="true" style={{ ...box, background: bg, color: fg, fontSize: size * 0.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {avatarInitial(name) || '?'}
    </span>
  );
}

export function HealthPill({ sev, label, big = false }: { sev: Sev; label: string; big?: boolean }) {
  const p = PAL[sev];
  return (
    <span
      style={{
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 500,
        padding: big ? '3px 10px' : '2px 8px',
        borderRadius: 999,
        color: p.c,
        background: p.bg,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />
      {label}
    </span>
  );
}

export function Button({ children, onClick, solid = false, href }: { children: ReactNode; onClick?: () => void; solid?: boolean; href?: string }) {
  const style: CSSProperties = {
    all: 'unset',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 12px',
    boxSizing: 'border-box',
    borderRadius: 6,
    fontSize: 13.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    // Spaces Button: `default` is the coral primary (one per view); `outline` for the rest.
    ...(solid ? { background: 'var(--primary)', color: 'var(--primaryT)' } : { background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--bd)' }),
  };
  const cls = solid ? 'solid' : 'outline';
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

export interface MenuOption<T> {
  value: T;
  label: string;
  dot?: string;
  count?: number;
}

/** A "Label  value ⌄" trigger with a single-choice dropdown. */
export function Menu<T extends string | number>({
  prefix,
  value,
  options,
  onChange,
  align = 'left',
  width = 190,
  height = 32,
  radius = 8,
  active = false,
}: {
  prefix: string;
  value: T;
  options: MenuOption<T>[];
  onChange: (v: T) => void;
  align?: 'left' | 'right';
  width?: number;
  height?: number;
  radius?: number;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  const current = options.find(o => o.value === value);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="hov"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{ ...TRIGGER_STYLE, height, borderRadius: radius, borderColor: active ? 'var(--t5)' : 'var(--input)' }}
      >
        {prefix}
        <span style={{ color: 'var(--t1)' }}>{current?.label ?? String(value)}</span>
        <span style={{ display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <ChevronDown />
        </span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 24 }} />
          <div style={{ ...MENU_STYLE, top: height + 4, width, [align]: 0 }}>
            {options.map(o => (
              <button
                key={String(o.value)}
                type="button"
                className="hov"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', borderRadius: 4, fontSize: 14, color: 'var(--t1)', fontWeight: 400 }}
              >
                {o.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.dot }} />}
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.count !== undefined && <span style={{ fontSize: 11.5, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{o.count}</span>}
                <span style={{ opacity: o.value === value ? 1 : 0, display: 'flex' }}>
                  <Check size={14} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One tooltip for the whole app: any element with `data-tip` shows it on hover. */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    const over = (e: MouseEvent): void => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      const text = el?.dataset.tip;
      if (!el || !text) {
        setTip(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const below = r.top < 60;
      setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 138), window.innerWidth - 138), y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const hide = (): void => setTip(null);
    document.addEventListener('mouseover', over);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseover', over);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  // Balanced lines leave the box at its max width; shrink it to the widest line so there's no gap on the right.
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !line.current) return;
    el.style.width = 'max-content';
    const widest = Math.max(0, ...[...line.current.getClientRects()].map(r => r.width));
    if (widest > 0) el.style.width = `${Math.ceil(widest) + 1}px`;
  }, [tip]);
  if (!tip) return null;
  return (
    <div
      ref={box}
      style={{
        position: 'fixed',
        zIndex: 100,
        left: tip.x,
        top: tip.y,
        transform: tip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
        background: 'var(--tip)',
        color: 'var(--invT)',
        fontSize: 12,
        lineHeight: 1.35,
        padding: '6px 12px',
        borderRadius: 6,
        maxWidth: 236,
        width: 'max-content',
        boxSizing: 'content-box',
        textWrap: 'balance',
        pointerEvents: 'none',
      }}
    >
      <span ref={line}>{tip.text}</span>
      {/* Spaces Tooltip: inverted colours with a rotated-square arrow. */}
      <span style={{ position: 'absolute', left: '50%', [tip.below ? 'top' : 'bottom']: -4, width: 8, height: 8, background: 'var(--tip)', transform: 'translateX(-50%) rotate(45deg)', borderRadius: 1 }} />
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 30,
        left: '50%',
        bottom: 22,
        transform: 'translateX(-50%)',
        background: 'var(--tip)',
        color: 'var(--invT)',
        fontSize: 14,
        padding: '10px 16px',
        borderRadius: 8,
        boxShadow: 'var(--shadowXl)',
        animation: 'mpvUp .2s ease-out',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}

/** Close a popover on Escape while it's open. */
export function useEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
}

/** Props that make a non-button element (a table row, a card) focusable and openable with Enter or Space. */
export function pressable(onPress: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPress();
      }
    },
  };
}

export const SECTION_LABEL: CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--t3)' };
