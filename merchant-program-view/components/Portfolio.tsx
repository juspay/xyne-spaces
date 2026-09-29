import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { FLAG_LABEL, HEALTH, RANK, fmtDays } from '../lib/flags';
import { BUCKETS, paginate, type FTicket, type Kpi, type MerchantRow, type PState, type Portfolio } from '../lib/portfolio';
import type { Sev } from '../lib/flags';
import type { MKey, Sort, TKey } from '../lib/sort';
import { pageWindow } from '../lib/ui';
import {
  Avatar,
  BUCKET_COLOR,
  Check,
  ChevronDown,
  Close,
  DONE_COLOR,
  HealthPill,
  MENU_STYLE,
  Menu,
  PAL,
  PriorityIcon,
  SearchIcon,
  pressable,
  useEscape,
  StatusGlyph,
  ageColor,
  toneColor,
  type MenuOption,
} from './primitives';
import { STATUS_LABEL } from '../lib/drawer';

/** The portfolio page: header, KPIs, age bar, Merchants / Tickets tabs with filters and pagination. */

export const RANGES: MenuOption<'all' | number>[] = [
  { value: 'all', label: 'All time' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last 12 months' },
];

const ago = (d: number): string => (d < 1 / 24 ? 'just now' : `${fmtDays(d)} ago`);

export interface SyncStatus {
  text: string;
  /** Green at rest, amber while loading or syncing. */
  busy: boolean;
}

export function PortfolioHeader({
  range,
  onRange,
  sync,
  onRefresh,
  onFullReload,
  search,
}: {
  /** The merchant ID search, shown before the Created menu. */
  search?: ReactNode;
  range: 'all' | number;
  onRange: (r: 'all' | number) => void;
  sync: SyncStatus;
  onRefresh: () => void;
  onFullReload: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  useEscape(moreOpen, () => setMoreOpen(false));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, fontWeight: 600 }}>Merchant watch</h1>
      {/* Filters on the left, sync status on the right, one row. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {search}
        <Menu prefix="Created" value={range} options={RANGES} onChange={onRange} width={200} radius={6} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 32, border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', overflow: 'hidden', minWidth: 0, maxWidth: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', fontSize: 13, fontWeight: 500, color: 'var(--t3)', whiteSpace: 'nowrap', maxWidth: 340, minWidth: 0, overflow: 'hidden' }}>
            <span
              style={{
                flex: 'none',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: sync.busy ? 'var(--amber)' : 'var(--green)',
                animation: sync.busy ? 'mpvPulse 1.4s ease-in-out infinite' : undefined,
              }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sync.text}</span>
          </div>
          <span style={{ width: 1, alignSelf: 'stretch', margin: '7px 0', background: 'var(--bd)' }} />
          <button
            type="button"
            className="hov"
            onClick={onRefresh}
            disabled={sync.busy}
            style={{ all: 'unset', cursor: sync.busy ? 'default' : 'pointer', height: '100%', padding: '0 12px', fontSize: 13.5, fontWeight: 500, color: sync.busy ? 'var(--t5)' : 'var(--t1)' }}
          >
            Refresh
          </button>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="hov"
            aria-label="More"
            aria-haspopup="true"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(o => !o)}
            style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, boxSizing: 'border-box', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)' }}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </button>
          {moreOpen && (
            <>
              <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 24 }} />
              <div style={{ ...MENU_STYLE, right: 0, width: 230 }}>
                <button
                  type="button"
                  className="hov"
                  onClick={() => {
                    setMoreOpen(false);
                    onFullReload();
                  }}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, padding: '8px', borderRadius: 4 }}
                >
                  <span style={{ fontSize: 14, color: 'var(--t1)' }}>Full reload</span>
                  <span style={{ fontSize: 12, color: 'var(--t4)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>Re-fetch everything from scratch</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

export function KpiCards({ kpis, isActive, onClick }: { kpis: Kpi[]; isActive: (k: Kpi) => boolean; onClick: (k: Kpi) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {kpis.map(k => {
        const active = isActive(k);
        return (
          <div
            key={k.id}
            className="kpi"
            {...(k.target ? pressable(() => onClick(k)) : {})}
            style={{
              border: `1px solid ${active ? 'var(--t1)' : 'var(--bd)'}`,
              boxShadow: active ? 'inset 0 0 0 1px var(--t1)' : 'none',
              borderRadius: 8,
              padding: '14px 16px 13px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: k.target ? 'pointer' : 'default',
              background: active ? 'var(--bg2)' : 'var(--bg)',
              transition: 'border-color .15s',
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 500 }}>{k.label}</span>
            <span style={{ fontSize: 26, lineHeight: '32px', fontWeight: 600, color: toneColor(k.tone, k.value), fontVariantNumeric: 'tabular-nums' }}>{k.value}</span>
            <span style={{ fontSize: 12, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.sub}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AgeBar({ counts, bucket, onBucket }: { counts: number[]; bucket: number | null; onBucket: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Age of open tickets</span>
      <div style={{ display: 'flex', gap: 3, height: 12 }}>
        {counts.map((n, i) =>
          n === 0 ? null : (
            <div
              key={i}
              {...pressable(() => onBucket(i))}
              aria-label={`${BUCKETS[i]}: ${n} open`}
              data-tip={`${BUCKETS[i]} · ${n} open ${n === 1 ? 'ticket' : 'tickets'}`}
              style={{ flexGrow: n, flexBasis: 0, background: BUCKET_COLOR[i], borderRadius: 3, cursor: 'pointer', opacity: bucket === null || bucket === i ? 1 : 0.35 }}
            />
          ),
        )}
        {counts.every(n => n === 0) && <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 3 }} />}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {BUCKETS.map((label, i) => counts[i] === 0 && bucket !== i ? null : (
          <button key={label} type="button" onClick={() => onBucket(i)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t3)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: BUCKET_COLOR[i] }} />
            <span style={{ fontWeight: bucket === i ? 600 : 500, color: 'var(--t2)' }}>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{counts[i]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Tabs({
  tab,
  counts,
  onTab,
  children,
}: {
  tab: PState['tab'];
  counts: Record<PState['tab'], number>;
  onTab: (t: PState['tab']) => void;
  /** Filters shown at the right of the tabs. */
  children?: ReactNode;
}) {
  const tabs: [PState['tab'], string][] = [
    ['merchants', 'Merchants'],
    ['tickets', 'Tickets'],
  ];
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 6, background: 'var(--bg)', padding: '8px 0', marginTop: -8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--bd2)' }}>
      {/* Spaces Tabs: 32px pills, the active one on muted. */}
      <div role="tablist" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={tab === id ? undefined : 'tabp'}
          style={{
            all: 'unset',
            cursor: 'pointer',
            height: 32,
            boxSizing: 'border-box',
            padding: '0 12px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            color: tab === id ? 'var(--t1)' : 'var(--t3)',
            background: tab === id ? 'var(--bg3)' : 'transparent',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {label}
          <span style={{ fontSize: 12, color: 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{counts[id]}</span>
        </button>
      ))}
      </div>
      {children && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>}
    </div>
  );
}

interface PillOption {
  value: string;
  label: string;
  dot?: string;
  /** Show this person's avatar before the label. */
  person?: boolean;
}

/**
 * Spaces FilterMultiSelect: a 32px filter button that shows up to two picked values as pills (or
 * "N selected") and opens a searchable checklist with checks on the right and a "Clear all" footer.
 */
function MultiPill({
  label,
  options,
  selected,
  onChange,
  searchable = true,
  placeholder = 'Search…',
  width = 250,
}: {
  label: string;
  options: PillOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
  placeholder?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  const [q, setQ] = useState('');
  const shown = searchable ? options.filter(o => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const on = selected.length > 0;
  const toggle = (v: string): void => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const labelOf = (v: string): string => options.find(o => o.value === v)?.label ?? v;
  const close = (): void => {
    setOpen(false);
    setQ('');
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="outline"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={on ? `${label}: ${selected.map(labelOf).join(', ')}` : label}
        onClick={() => (open ? close() : setOpen(true))}
        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, boxSizing: 'border-box', padding: on ? '0 8px 0 10px' : '0 8px 0 12px', border: '1px solid var(--input)', borderRadius: 6, background: 'transparent', fontSize: 13, fontWeight: 500, color: on ? 'var(--t3)' : 'var(--t1)', whiteSpace: 'nowrap', maxWidth: 360 }}
      >
        {label}
        {on &&
          (selected.length <= 2 ? (
            selected.map(v => (
              <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 4px 0 7px', borderRadius: 4, background: 'var(--bg3)', fontSize: 12, fontWeight: 500, color: 'var(--t1)', maxWidth: 160 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelOf(v).replace(/^Desk · /, '')}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${labelOf(v)}`}
                  onClick={e => {
                    e.stopPropagation();
                    toggle(v);
                  }}
                  style={{ display: 'flex', color: 'var(--t4)', cursor: 'pointer' }}
                >
                  <Close size={12} />
                </span>
              </span>
            ))
          ) : (
            <span style={{ height: 22, display: 'inline-flex', alignItems: 'center', padding: '0 7px', borderRadius: 4, background: 'var(--bg3)', fontSize: 12, fontWeight: 500, color: 'var(--t1)' }}>{selected.length} selected</span>
          ))}
        <span style={{ display: 'flex', opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <ChevronDown size={16} color="var(--t1)" />
        </span>
      </button>
      {open && (
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 24 }} />
          <div style={{ ...MENU_STYLE, top: 36, right: 0, width: Math.min(Math.max(width, 180), 280), maxWidth: 'calc(100vw - 32px)', padding: 0 }}>
            {searchable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', borderBottom: '1px solid var(--bd)' }}>
                <SearchIcon size={14} />
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ all: 'unset', flex: 1, fontSize: 14, color: 'var(--t1)' }} />
              </div>
            )}
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: 4 }}>
              {shown.map(o => {
                const checked = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className="hov"
                    onClick={() => toggle(o.value)}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, padding: '0 8px', borderRadius: 4, fontSize: 14, color: 'var(--t1)' }}
                  >
                    {o.dot && <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: o.dot }} />}
                    {o.person && <Avatar name={o.label} size={20} />}
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                    <span style={{ display: 'flex', opacity: checked ? 1 : 0 }}>
                      <Check size={14} />
                    </span>
                  </button>
                );
              })}
              {shown.length === 0 && <span style={{ padding: '8px', fontSize: 13, color: 'var(--t3)' }}>No results found</span>}
            </div>
            {on && (
              <button type="button" className="hov" onClick={() => onChange([])} style={{ all: 'unset', cursor: 'pointer', display: 'block', padding: '8px 12px', borderTop: '1px solid var(--bd)', fontSize: 13, color: 'var(--t1)', textAlign: 'center' }}>
                Clear all
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const HEALTH_OPTS: PillOption[] = [
  { value: 'red', label: 'Critical', dot: 'var(--red)' },
  { value: 'amber', label: 'At risk', dot: 'var(--amber)' },
  { value: 'watch', label: 'Watch', dot: 'var(--t5)' },
  { value: 'ok', label: 'Healthy', dot: 'var(--green)' },
];

export function typeFilterLabel(t: PState['typeFilter']): string {
  if (t === null) return '';
  return t === 'anyEta' ? 'ETA breached · ticket or stage' : FLAG_LABEL[t];
}

/** Desks, Boards, Assignee and Health pills, shown at the right of the tabs row. */
export function FilterPills({ s, set, pf }: { s: PState; set: (p: Partial<PState>) => void; pf: Pick<Portfolio, 'people' | 'deskOptions' | 'boardOptions'> }) {
  return (
    <>
      <MultiPill label="Desks" options={pf.deskOptions.map(d => ({ value: d, label: d.replace(/^Desk · /, '') }))} selected={s.desks} onChange={desks => set({ desks })} placeholder="Search desks…" />
      <MultiPill label="Boards" options={pf.boardOptions.map(b => ({ value: b, label: b }))} selected={s.boards} onChange={boards => set({ boards })} placeholder="Search boards…" width={280} />
      <MultiPill label="Assignee" options={pf.people.map(p => ({ value: p, label: p, person: true }))} selected={s.owners} onChange={owners => set({ owners })} placeholder="Search people…" width={240} />
      <MultiPill label="Health" options={HEALTH_OPTS} selected={s.health} onChange={health => set({ health: health as Sev[] })} searchable={false} width={200} />
    </>
  );
}

/** Chips for the KPI and age-bar filters on the Tickets tab, shown before the filter pills so they can be cleared. */
export function ActiveChips({ s, set }: { s: PState; set: (p: Partial<PState>) => void }) {
  if (s.tab !== 'tickets' || (s.typeFilter === null && s.bucket === null)) return null;
  const chip: CSSProperties = { all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, height: 32, boxSizing: 'border-box', padding: '0 10px 0 12px', borderRadius: 6, border: '1px solid var(--t6)', background: 'var(--bg3)', color: 'var(--t1)', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' };
  return (
    <>
      {s.typeFilter !== null && (
        <button type="button" className="hov" aria-label={`Clear filter: ${typeFilterLabel(s.typeFilter)}`} onClick={() => set({ typeFilter: null })} style={chip}>
          {typeFilterLabel(s.typeFilter)}
          <Close size={11} />
        </button>
      )}
      {s.bucket !== null && (
        <button type="button" className="hov" aria-label="Clear the age filter" onClick={() => set({ bucket: null })} style={chip}>
          Open {BUCKETS[s.bucket]}
          <Close size={11} />
        </button>
      )}
    </>
  );
}

const TABLE_BOX: CSSProperties = { border: '1px solid var(--bd)', borderRadius: 8, overflowX: 'auto' };
const HEAD: CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: '10px 16px',
  borderBottom: '1px solid var(--bd)',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--t3)',
  textTransform: 'uppercase',
  background: 'var(--bg3)',
};

function Pagination({ text, page, pages, onPage }: { text: string; page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn: CSSProperties = { all: 'unset', cursor: 'pointer', height: 32, boxSizing: 'border-box', padding: '0 12px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 13, fontWeight: 500, color: 'var(--t1)' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, color: 'var(--t3)', borderTop: '1px solid var(--bd2)' }}>
      <span style={{ marginRight: 'auto', fontVariantNumeric: 'tabular-nums' }}>{text}</span>
      <button type="button" className="outline" disabled={page === 1} onClick={() => onPage(page - 1)} style={{ ...btn, opacity: page === 1 ? 0.5 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer' }}>
        Previous
      </button>
      {pageWindow(page, pages).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} style={{ width: 16, textAlign: 'center' }}>
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={n === page ? undefined : 'hov'}
            onClick={() => onPage(n)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              minWidth: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: n === page ? 'var(--t1)' : 'var(--t3)',
              background: n === page ? 'var(--bg3)' : 'transparent',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" className="outline" disabled={page === pages} onClick={() => onPage(page + 1)} style={{ ...btn, opacity: page === pages ? 0.5 : 1, cursor: page === pages ? 'not-allowed' : 'pointer' }}>
        Next
      </button>
    </div>
  );
}

const M_COLS = '84px minmax(120px,1.25fr) 64px 136px 100px minmax(170px,2.2fr) 150px 82px';
/** Sum of the column minimums, gaps and padding: below this the table scrolls sideways instead of squeezing. */
const M_MIN = 906 + 7 * 14 + 32;

function MerchantLine({ m, onOpen }: { m: MerchantRow; onOpen: () => void }) {
  const chip = m.chips[0];
  return (
    <div
      className="row"
      {...pressable(onOpen)}
      style={{ display: 'grid', gridTemplateColumns: M_COLS, gap: 14, alignItems: 'start', padding: '12px 16px', borderBottom: '1px solid var(--bd2)', cursor: 'pointer', fontSize: 13, lineHeight: '20px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
        <HealthPill sev={m.sev} label={HEALTH[m.sev]} />
      </div>
      <span style={{ fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{m.mid}</span>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{m.openCount}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
        <div style={{ display: 'flex', gap: 2, height: 8, width: 120, background: 'var(--bg3)', borderRadius: 3 }}>
          {m.counts.map((n, i) =>
            n === 0 ? null : (
              <span key={i} data-tip={`${BUCKETS[i]} · ${n} open`} style={{ flexGrow: n, flexBasis: 0, background: BUCKET_COLOR[i], borderRadius: 2 }} />
            ),
          )}
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--t4)', lineHeight: 1.3 }}>{m.median === null ? 'nothing open' : `median ${fmtDays(m.median)}`}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: m.oldest ? ageColor(m.oldest.d).c : 'var(--t5)', fontVariantNumeric: 'tabular-nums' }}>{m.oldest ? fmtDays(m.oldest.d) : '—'}</span>
        {m.oldest && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
            {m.oldest.key}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {chip ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, color: PAL[chip.sev].c, background: PAL[chip.sev].bg, whiteSpace: 'nowrap', lineHeight: '16px' }}>
              {chip.label}
            </span>
            {m.chips.length > 1 && <span style={{ fontSize: 12, color: 'var(--t4)', alignSelf: 'center' }}>+{m.chips.length - 1} more</span>}
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--t5)' }}>Nothing to chase</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--t3)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
        <span>
          <b style={{ fontWeight: 600, color: 'var(--t1)' }}>{m.court.us}</b> with us
        </span>
        <span>
          {m.court.merchant} merchant · {m.court.external} external
        </span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--t4)', whiteSpace: 'nowrap' }}>{ago(m.lastU)}</span>
    </div>
  );
}

/** A column header that sorts on click and flips direction on the next click. */
function SortHead<K extends string>({ label, k, sort, onSort, right = false }: { label: string; k: K; sort: Sort<K> | null; onSort: (k: K) => void; right?: boolean }) {
  const on = sort?.key === k;
  return (
    <button
      type="button"
      className="sorth"
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(k)}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, justifyContent: right ? 'flex-end' : 'flex-start', color: on ? 'var(--t1)' : 'inherit', whiteSpace: 'nowrap', minWidth: 0 }}
    >
      {label}
      <span className={on ? undefined : 'sorti'} style={{ display: 'flex', transform: on && sort.dir === 'asc' ? 'rotate(180deg)' : 'none' }}>
        <ChevronDown size={11} color={on ? 'var(--t1)' : 'var(--t5)'} />
      </span>
    </button>
  );
}

export function MerchantsTable({
  rows,
  onOpen,
  resetKey,
  sort,
  onSort,
}: {
  rows: MerchantRow[];
  onOpen: (mid: string) => void;
  resetKey: string;
  sort: Sort<MKey> | null;
  onSort: (k: MKey) => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pg = paginate(rows, page);
  return (
    <div style={TABLE_BOX}>
      <div style={{ minWidth: M_MIN }}>
        <div style={{ ...HEAD, gridTemplateColumns: M_COLS }}>
          <SortHead label="Severity" k="sev" sort={sort} onSort={onSort} />
          <SortHead label="Merchant" k="mid" sort={sort} onSort={onSort} />
          <SortHead label="Open" k="open" sort={sort} onSort={onSort} />
          <SortHead label="Age of open" k="age" sort={sort} onSort={onSort} />
          <SortHead label="Oldest" k="oldest" sort={sort} onSort={onSort} />
          <SortHead label="Needs attention" k="attn" sort={sort} onSort={onSort} />
          <SortHead label="Waiting on" k="court" sort={sort} onSort={onSort} />
          <SortHead label="Activity" k="activity" sort={sort} onSort={onSort} />
        </div>
        {pg.rows.map(m => (
          <MerchantLine key={m.mid} m={m} onOpen={() => onOpen(m.mid)} />
        ))}
        {rows.length === 0 && <Empty>No merchants match these filters.</Empty>}
        <Pagination text={pg.text} page={pg.page} pages={pg.pages} onPage={setPage} />
      </div>
    </div>
  );
}

const T_COLS = '20px 150px minmax(220px,1fr) 100px 210px 110px 52px 56px';
const T_MIN = 918 + 7 * 12 + 32;

function TicketLine({ t, onOpen }: { t: FTicket; onOpen: () => void }) {
  const flags = [...t.flags].sort((a, b) => RANK[b.sev] - RANK[a.sev]);
  const top = flags[0];
  const ac = t.open ? ageColor(t.d) : DONE_COLOR;
  const staleUpd = t.flags.some(f => f.type === 'stale');
  return (
    <div
      className="row"
      {...pressable(onOpen)}
      style={{ display: 'grid', gridTemplateColumns: T_COLS, gap: 12, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bd2)', cursor: 'pointer', fontSize: 13 }}
    >
      <span data-tip={`${t.stage} · ${STATUS_LABEL[t.st]}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
        <StatusGlyph st={t.st} />
      </span>
      <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)', minWidth: 0, whiteSpace: 'nowrap' }}>
        <PriorityIcon pri={t.pri} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.key}</span>
      </span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.open ? 'var(--t1)' : 'var(--t4)' }}>{t.title}</span>
      <span data-tip={t.midR.length > 1 ? t.midR.join(', ') : undefined} style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t.midR[0] ?? '—'}
        {t.midR.length > 1 ? ` +${t.midR.length - 1}` : ''}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {top ? (
          <>
            <span style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: PAL[top.sev].dot }} />
            <span data-tip={top.reason} style={{ minWidth: 0, fontSize: 12.5, fontWeight: 500, color: PAL[top.sev].c, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {top.label}
            </span>
            {flags.length > 1 && <span style={{ flex: 'none', fontSize: 12, color: 'var(--t4)' }}>+{flags.length - 1}</span>}
          </>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--t5)' }}>—</span>
        )}
      </div>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, color: 'var(--t3)' }}>
        {t.who ? <Avatar name={t.who} size={18} /> : <span style={{ flex: 'none', width: 18, height: 18, borderRadius: '50%', border: '1px dashed var(--t5)' }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.who ?? 'Unassigned'}</span>
      </span>
      <span style={{ justifySelf: 'end', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, color: ac.c, background: ac.bg, fontVariantNumeric: 'tabular-nums' }}>
        {t.open ? fmtDays(t.d) : 'done'}
      </span>
      <span style={{ textAlign: 'right', fontSize: 12, color: staleUpd ? 'var(--amberT)' : 'var(--t4)', fontVariantNumeric: 'tabular-nums' }}>{fmtDays(t.u)}</span>
    </div>
  );
}

export function TicketsTable({
  rows,
  onOpen,
  resetKey,
  sort,
  onSort,
}: {
  rows: FTicket[];
  onOpen: (id: string) => void;
  resetKey: string;
  sort: Sort<TKey> | null;
  onSort: (k: TKey) => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pg = paginate(rows, page);
  return (
    <div style={TABLE_BOX}>
      <div style={{ minWidth: T_MIN }}>
        <div style={{ ...HEAD, gap: 12, gridTemplateColumns: T_COLS }}>
          <SortHead label="" k="status" sort={sort} onSort={onSort} />
          <SortHead label="Key" k="key" sort={sort} onSort={onSort} />
          <SortHead label="Title" k="title" sort={sort} onSort={onSort} />
          <SortHead label="Merchant" k="mid" sort={sort} onSort={onSort} />
          <SortHead label="Issue" k="issue" sort={sort} onSort={onSort} />
          <SortHead label="Assignee" k="who" sort={sort} onSort={onSort} />
          <SortHead label="Age" k="age" sort={sort} onSort={onSort} right />
          <SortHead label="Updated" k="updated" sort={sort} onSort={onSort} right />
        </div>
        {pg.rows.map(t => (
          <TicketLine key={t.id} t={t} onOpen={() => onOpen(t.id)} />
        ))}
        {rows.length === 0 && <Empty>No tickets match these filters.</Empty>}
        <Pagination text={pg.text} page={pg.page} pages={pg.pages} onPage={setPage} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--t4)' }}>{children}</div>;
}
