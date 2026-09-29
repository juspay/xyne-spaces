import { useState } from 'react';
import { HEALTH, RANK, fmtDays } from '../lib/flags';
import { BUCKETS, sameFocus, type MFocus, type MerchantView, type Nudge, type Thread, type ThreadRow, type ThreadStatus } from '../lib/merchantView';
import { STATUS_LABEL, PRI_LABEL } from '../lib/drawer';
import { SyncPill, type SyncStatus } from './Portfolio';
import { threadLines } from '../lib/ui';
import { Avatar, BUCKET_COLOR, ChevronDown, ChevronLeft, Close, DONE_COLOR, HealthPill, Menu, PAL, PriorityIcon, StatusGlyph, pressable, ageColor, toneColor } from './primitives';

/** One merchant: KPIs, ticket threads as trees, age histogram, waiting-on and recently closed. */

const ago = (d: number): string => (d < 1 / 24 ? 'just now' : `${fmtDays(d)} ago`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

// Each row leads with fixed age and priority columns so they line up down the list; the tree starts after them.
const AGE_W = 40;
const PRI_W = 14;
const GAP = 10;
/** Left edge of a depth-0 status glyph: row padding, then the age and priority columns. */
// Rows run edge to edge so hover greys the whole card width; this is their side padding.
const ROW_X = 16;
const TREE_X = ROW_X + AGE_W + GAP + PRI_W + GAP;


function Connectors({ row, cy }: { row: ThreadRow; cy: number }) {
  const hasKids = row.kind === 'ticket' && row.hasKids;
  return (
    <>
      {threadLines(row.depth, row.rails, row.isLast, hasKids, cy, TREE_X).map((ln, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: ln.l,
            top: ln.t,
            height: ln.h,
            width: ln.w,
            borderLeft: '1.5px solid var(--t6)',
            borderBottom: ln.bb,
            borderBottomLeftRadius: ln.r,
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  );
}

export const nudgeKey = (n: Nudge): string => `${n.kind}:${n.from.id}`;

function NudgeStrip({ n, busy, onRun }: { n: Nudge; busy: boolean; onRun: (n: Nudge) => void }) {
  const count = n.targets.length;
  const text =
    n.kind === 'closeKids'
      ? `${n.from.key} is done, but ${count} sub-ticket${count === 1 ? ' is' : 's are'} still open`
      : `Every sub-ticket of ${n.from.key} is finished`;
  const action = n.kind === 'closeParent' || count === 1 ? `Mark ${n.targets[0].key} as done` : `Mark all ${count} as done`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', fontSize: 12.5, color: 'var(--t2)', background: 'var(--bg2)', borderBottom: '1px solid var(--bd2)' }}>
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      <button
        type="button"
        className="outline"
        disabled={busy}
        onClick={() => onRun(n)}
        style={{ all: 'unset', flex: 'none', cursor: busy ? 'default' : 'pointer', height: 26, boxSizing: 'border-box', padding: '0 10px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--bg)', fontSize: 12.5, fontWeight: 500, color: busy ? 'var(--t4)' : 'var(--t1)', whiteSpace: 'nowrap' }}
      >
        {busy ? 'Saving…' : action}
      </button>
    </div>
  );
}

function ThreadCard({ th, selected, onOpen, nudging, onNudge }: { th: Thread; selected: string | null; onOpen: (id: string) => void; nudging: string | null; onNudge: (n: Nudge) => void }) {
  const hl = selected !== null && th.rows.some(r => r.kind === 'ticket' && r.t.id === selected);
  return (
    <div
      style={{
        border: `1px solid ${hl ? 'var(--t5)' : 'var(--bd)'}`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: hl ? '0 5px 18px rgba(0,0,0,.06)' : 'none',
        transition: 'box-shadow .2s, border-color .2s',
      }}
    >
      {th.nudges.map(n => (
        <NudgeStrip key={nudgeKey(n)} n={n} busy={nudging === nudgeKey(n)} onRun={onNudge} />
      ))}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {th.rows.map((r, i) => {
          const indent = r.depth * 24;
          if (r.kind === 'placeholder') {
            return (
              <div key={`ph-${i}`} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: GAP, padding: `11px ${ROW_X}px`, fontSize: 12, lineHeight: '16px', color: 'var(--t4)' }}>
                <Connectors row={r} cy={19} />
                <span style={{ flex: 'none', width: AGE_W, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.d}d</span>
                <span style={{ flex: 'none', width: PRI_W }} />
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flex: 'none', marginLeft: indent }}>
                  <circle cx="7" cy="7" r="5.4" stroke="var(--t5)" strokeWidth="1.6" strokeDasharray="2 2" />
                </svg>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sub-ticket not linked yet · {r.title || 'untitled'}</span>
              </div>
            );
          }
          const t = r.t;
          const flags = [...t.flags].sort((a, b) => RANK[b.sev] - RANK[a.sev]);
          const ac = t.open ? ageColor(t.d) : DONE_COLOR;
          return (
            <div
              key={t.id}
              className="hov"
              {...pressable(() => onOpen(t.id))}
              style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: GAP, padding: `11px ${ROW_X}px`, cursor: 'pointer', background: selected === t.id ? 'var(--bg3)' : 'transparent', opacity: r.match ? 1 : 0.45 }}
            >
              <Connectors row={r} cy={20} />
              <span
                data-tip={t.open ? `Open for ${fmtDays(t.d)} · created ${dateOf(t.createdAt)}` : `Closed ${fmtDays(t.closedD ?? 0)} ago · was open ${fmtDays(Math.max(1, t.d - (t.closedD ?? 0)))}`}
                style={{ flex: 'none', width: AGE_W, textAlign: 'right', fontSize: 13, lineHeight: '18px', fontWeight: 700, color: ac.c, fontVariantNumeric: 'tabular-nums' }}
              >
                {t.open ? fmtDays(t.d) : 'done'}
              </span>
              <span data-tip={`Priority · ${PRI_LABEL[t.pri]}`} style={{ flex: 'none', width: PRI_W, height: 18, display: 'flex', alignItems: 'center' }}>
                <PriorityIcon pri={t.pri} />
              </span>
              {/* The tooltip names the ticket's own stage, not its status category. */}
              <span data-tip={t.stage} style={{ flex: 'none', marginTop: 2, marginLeft: indent, display: 'flex' }}>
                <StatusGlyph st={t.st} />
              </span>
              <span className="mono" style={{ flex: 'none', fontSize: 12, lineHeight: '18px', color: 'var(--t4)' }}>
                {t.key}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: '18px', color: t.open ? 'var(--t1)' : 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              {flags.length > 0 && (
                <span data-tip={flags[0].reason} style={{ flex: 'none', fontSize: 12, lineHeight: '18px', fontWeight: 500, color: PAL[flags[0].sev].c, whiteSpace: 'nowrap' }}>
                  {flags[0].label}
                  {flags.length > 1 ? ` +${flags.length - 1}` : ''}
                </span>
              )}
              {/* Assignee as an avatar at the row's right edge; the name is in the tooltip. */}
              <span data-tip={t.who ?? 'Unassigned'} style={{ flex: 'none', height: 18, display: 'flex', alignItems: 'center' }}>
                {t.who ? <Avatar name={t.who} size={18} /> : <span style={{ width: 18, height: 18, boxSizing: 'border-box', borderRadius: '50%', border: '1px dashed var(--t5)' }} />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CARD = { border: '1px solid var(--bd)', borderRadius: 8 } as const;

const AGE_SPAN = ['0–3 days', '4–7 days', '8–14 days', '15–30 days', 'over 30 days'];

function AgeHistogram({ hist, focus, onFocus }: { hist: number[]; focus: MFocus | null; onFocus: (f: MFocus) => void }) {
  const max = Math.max(1, ...hist);
  const on = focus?.kind === 'bucket' ? focus.i : null;
  return (
    <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Age of open tickets</span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
        {hist.map((n, i) => (
          <div
            key={i}
            data-tip={`${n} open ${n === 1 ? 'ticket' : 'tickets'} · ${AGE_SPAN[i]} old${n ? ' · click to show them' : ''}`}
            {...(n ? pressable(() => onFocus({ kind: 'bucket', i })) : {})}
            aria-pressed={n ? on === i : undefined}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end', cursor: n ? 'pointer' : 'default', opacity: on === null || on === i ? 1 : 0.35, transition: 'opacity .15s' }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
            <div style={{ width: '100%', height: Math.round((n / max) * 72), minHeight: 2, background: BUCKET_COLOR[i], borderRadius: '4px 4px 2px 2px' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: -6 }}>
        {BUCKETS.map(b => (
          <span key={b} className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: 'var(--t4)' }}>
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

const COURT_COLOR = { us: 'var(--t2)', merchant: 'var(--amber)', external: 'var(--t5)' };

function WaitingOn({ court, focus, onFocus }: { court: MerchantView['court']; focus: MFocus | null; onFocus: (f: MFocus) => void }) {
  const on = focus?.kind === 'court' ? focus.court : null;
  return (
    <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Waiting on</span>
      {court.map(c => (
        <div
          key={c.id}
          className={c.count ? 'hov' : undefined}
          {...(c.count ? pressable(() => onFocus({ kind: 'court', court: c.id })) : {})}
          aria-pressed={c.count ? on === c.id : undefined}
          style={{ display: 'flex', flexDirection: 'column', gap: 5, margin: '0 -6px', padding: '3px 6px', borderRadius: 6, cursor: c.count ? 'pointer' : 'default', opacity: on === null || on === c.id ? 1 : 0.4, transition: 'opacity .15s' }}
        >
          <div style={{ display: 'flex', fontSize: 12.5, color: 'var(--t2)' }}>
            <span>{c.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${c.pct}%`, background: COURT_COLOR[c.id], borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Collapsed by default: the list can run long and sits below the cards people check first. */
function RecentlyClosed({ closed, onOpen }: { closed: MerchantView['closed']; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...CARD, overflow: 'hidden' }}>
      <button
        type="button"
        className="hov"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', padding: '12px 16px', borderBottom: open ? '1px solid var(--bd2)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Recently closed</span>
        <span style={{ fontSize: 12, fontWeight: 500, padding: '1px 7px', borderRadius: 999, background: 'var(--bg3)', color: 'var(--t3)', fontVariantNumeric: 'tabular-nums' }}>{closed.length}</span>
        <span style={{ fontSize: 12, color: 'var(--t4)' }}>last 30 days</span>
        <span style={{ marginLeft: 'auto', display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <ChevronDown />
        </span>
      </button>
      {open && closed.map(t => (
        <div key={t.id} className="row" {...pressable(() => onOpen(t.id))} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 16px', borderBottom: '1px solid var(--bd2)', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t4)' }}>
            <span data-tip={STATUS_LABEL[t.st]} style={{ display: 'inline-flex' }}>
              <StatusGlyph st={t.st} size={12} />
            </span>
            <span className="mono" style={{ color: 'var(--t3)' }}>
              {t.key}
            </span>
            <span style={{ marginLeft: 'auto' }}>closed {ago(t.closedD ?? 0)}</span>
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.4, paddingLeft: 18 }}>{t.title}</span>
        </div>
      ))}
      {open && closed.length === 0 && <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--t4)' }}>Nothing closed in the last 30 days.</div>}
    </div>
  );
}

export function MerchantPage({
  v,
  status,
  onStatus,
  selected,
  resolving,
  onBack,
  onRefresh,
  onOpen,
  sync,
  onFocus,
  onClearFocus,
  nudging,
  onNudge,
}: {
  v: MerchantView;
  status: ThreadStatus;
  onStatus: (s: ThreadStatus) => void;
  selected: string | null;
  resolving: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  sync: SyncStatus;
  /** Toggle a clicked KPI or bar's filter on the tickets list. */
  onFocus: (f: MFocus) => void;
  onClearFocus: () => void;
  /** Key of the nudge being saved, if any. */
  nudging: string | null;
  onNudge: (n: Nudge) => void;
}) {
  const statusOpts = [
    { value: 'open' as const, label: 'Open tickets', count: v.threadCounts.open },
    { value: 'closed' as const, label: 'Closed tickets', count: v.threadCounts.closed },
    { value: 'all' as const, label: 'All tickets', count: v.threadCounts.all },
  ];
  return (
    <div className="page" style={{ paddingTop: 24, gap: 20 }}>
      <button type="button" onClick={onBack} style={{ all: 'unset', cursor: 'pointer', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--t3)' }}>
        <ChevronLeft />
        All merchants
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, fontWeight: 600, wordBreak: 'break-all' }}>{v.mid}</h1>
            <HealthPill sev={v.row.sev} label={HEALTH[v.row.sev]} big />
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--t3)' }}>
            {v.meta}
            {resolving && <span style={{ color: 'var(--t4)' }}> · looking up parent tickets…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SyncPill sync={sync} onRefresh={onRefresh} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {v.kpis.map(k => {
          const target = k.target;
          const active = target !== null && target !== 'open' && sameFocus(v.focus, target);
          const click = target === null ? null : target === 'open' ? () => onStatus('open') : () => onFocus(target);
          return (
            <div
              key={k.id}
              className={click ? 'kpi' : undefined}
              {...(click ? pressable(click) : {})}
              aria-pressed={click && target !== 'open' ? active : undefined}
              style={{
                ...CARD,
                border: `1px solid ${active ? 'var(--t1)' : 'var(--bd)'}`,
                boxShadow: active ? 'inset 0 0 0 1px var(--t1)' : 'none',
                background: active ? 'var(--bg2)' : 'var(--bg)',
                cursor: click ? 'pointer' : 'default',
                padding: '13px 15px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
                transition: 'border-color .15s',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500 }}>{k.label}</span>
              <span style={{ fontSize: 24, lineHeight: '30px', fontWeight: 600, color: toneColor(k.tone, k.value), fontVariantNumeric: 'tabular-nums' }}>{k.value}</span>
              <span style={{ fontSize: 12, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.sub}</span>
            </div>
          );
        })}
      </div>

      <div className="mv-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Tickets</span>
              <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--t4)' }}>Oldest first, then highest priority</span>
            </div>
            <div style={{ flex: 'none' }}>
              <Menu prefix="Show" value={status} options={statusOpts} onChange={onStatus} align="right" width={190} height={30} />
            </div>
          </div>
          {v.focus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--t4)' }}>
              <button
                type="button"
                className="hov"
                aria-label={`Clear filter: ${v.focusLabel}`}
                onClick={onClearFocus}
                style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, boxSizing: 'border-box', padding: '0 9px 0 11px', borderRadius: 6, border: '1px solid var(--t6)', background: 'var(--bg3)', color: 'var(--t1)', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap' }}
              >
                {v.focusLabel} · {v.focusCount} {v.focusCount === 1 ? 'ticket' : 'tickets'}
                <Close size={11} />
              </button>
              <span>Related parent and sub-tickets are shown faded</span>
            </div>
          )}
          {v.threads.map(th => (
            <ThreadCard key={th.rootId} th={th} selected={selected} onOpen={onOpen} nudging={nudging} onNudge={onNudge} />
          ))}
          {v.threads.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--t4)', border: '1px dashed var(--bd)', borderRadius: 8 }}>No tickets in this view.</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <AgeHistogram hist={v.hist} focus={v.focus} onFocus={onFocus} />
          <WaitingOn court={v.court} focus={v.focus} onFocus={onFocus} />
          <RecentlyClosed closed={v.closed} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}
