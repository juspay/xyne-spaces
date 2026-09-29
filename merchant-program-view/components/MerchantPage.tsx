import { useState } from 'react';
import { HEALTH, RANK, fmtDays } from '../lib/flags';
import { BUCKETS, type MerchantView, type Thread, type ThreadRow, type ThreadStatus } from '../lib/merchantView';
import { STATUS_LABEL, PRI_LABEL } from '../lib/drawer';
import { threadLines } from '../lib/ui';
import { Avatar, BUCKET_COLOR, Button, ChevronDown, ChevronLeft, DONE_COLOR, HealthPill, Menu, PAL, PriorityIcon, StatusGlyph, pressable, ageColor, toneColor } from './primitives';

/** One merchant: KPIs, ticket threads as trees, age histogram, waiting-on and recently closed. */

const ago = (d: number): string => (d < 1 / 24 ? 'just now' : `${fmtDays(d)} ago`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function Connectors({ row, cy }: { row: ThreadRow; cy: number }) {
  const hasKids = row.kind === 'ticket' && row.hasKids;
  return (
    <>
      {threadLines(row.depth, row.rails, row.isLast, hasKids, cy).map((ln, i) => (
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

function ThreadCard({ th, selected, onOpen }: { th: Thread; selected: string | null; onOpen: (id: string) => void }) {
  const hl = selected !== null && th.rows.some(r => r.kind === 'ticket' && r.t.id === selected);
  const p = PAL[th.sev];
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', fontSize: 12, color: 'var(--t4)', background: 'var(--bg)', borderBottom: '1px solid var(--bd2)' }}>
        {th.sev !== 'ok' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, color: p.c, background: p.bg }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />
            {HEALTH[th.sev]}
          </span>
        )}
        <span style={{ fontWeight: 500, color: 'var(--t2)' }}>{th.origin}</span>
        <span>·</span>
        <span>
          {th.size} {th.size === 1 ? 'ticket' : 'tickets'}
        </span>
        <span style={{ marginLeft: 'auto' }}>updated {ago(th.lastU)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 6px' }}>
        {th.rows.map((r, i) => {
          const pad = `${10 + r.depth * 24}px`;
          if (r.kind === 'placeholder') {
            return (
              <div key={`ph-${i}`} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: `9px 10px 9px ${pad}`, fontSize: 12, lineHeight: '16px', color: 'var(--t4)' }}>
                <Connectors row={r} cy={17} />
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flex: 'none' }}>
                  <circle cx="7" cy="7" r="5.4" stroke="var(--t5)" strokeWidth="1.6" strokeDasharray="2 2" />
                </svg>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sub-ticket not linked yet · {r.title || 'untitled'}</span>
                <span style={{ flex: 'none', fontSize: 12 }}>{r.d}d</span>
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
              style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 10, padding: `9px 10px 9px ${pad}`, borderRadius: 8, cursor: 'pointer', background: selected === t.id ? 'var(--bg3)' : 'transparent' }}
            >
              <Connectors row={r} cy={18} />
              <span data-tip={`${t.stage} · ${STATUS_LABEL[t.st]}`} style={{ flex: 'none', marginTop: 2, display: 'flex' }}>
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
              <span data-tip={`Priority · ${PRI_LABEL[t.pri]}`} style={{ flex: 'none', display: 'flex', height: 18, alignItems: 'center' }}>
                <PriorityIcon pri={t.pri} />
              </span>
              <span style={{ flex: 'none', width: 116, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, lineHeight: '18px', color: 'var(--t3)', minWidth: 0 }}>
                {t.who ? <Avatar name={t.who} size={16} /> : <span style={{ flex: 'none', width: 16, height: 16, borderRadius: '50%', border: '1px dashed var(--t5)' }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.who ?? 'Unassigned'}</span>
              </span>
              <span
                data-tip={t.open ? `Open for ${fmtDays(t.d)} · created ${dateOf(t.createdAt)}` : `Closed ${fmtDays(t.closedD ?? 0)} ago · was open ${fmtDays(Math.max(1, t.d - (t.closedD ?? 0)))}`}
                style={{ flex: 'none', width: 36, textAlign: 'right', fontSize: 12.5, lineHeight: '18px', fontWeight: 600, color: ac.c, fontVariantNumeric: 'tabular-nums' }}
              >
                {t.open ? fmtDays(t.d) : 'done'}
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

function AgeHistogram({ hist }: { hist: number[] }) {
  const max = Math.max(1, ...hist);
  return (
    <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Age of open tickets</span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
        {hist.map((n, i) => (
          <div
            key={i}
            data-tip={`${n} open ${n === 1 ? 'ticket' : 'tickets'} · ${AGE_SPAN[i]} old`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end', cursor: 'default' }}
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

function WaitingOn({ court }: { court: MerchantView['court'] }) {
  return (
    <div style={{ ...CARD, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Waiting on</span>
      {court.map(c => (
        <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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
}: {
  v: MerchantView;
  status: ThreadStatus;
  onStatus: (s: ThreadStatus) => void;
  selected: string | null;
  resolving: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
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
          <Button onClick={onRefresh}>Refresh</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {v.kpis.map(k => (
          <div key={k.id} style={{ ...CARD, padding: '13px 15px 12px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500 }}>{k.label}</span>
            <span style={{ fontSize: 24, lineHeight: '30px', fontWeight: 600, color: toneColor(k.tone, k.value), fontVariantNumeric: 'tabular-nums' }}>{k.value}</span>
            <span style={{ fontSize: 12, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="mv-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Tickets</span>
            <div style={{ marginLeft: 'auto' }}>
              <Menu prefix="Show" value={status} options={statusOpts} onChange={onStatus} align="right" width={190} height={30} />
            </div>
          </div>
          {v.threads.map(th => (
            <ThreadCard key={th.rootId} th={th} selected={selected} onOpen={onOpen} />
          ))}
          {v.threads.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--t4)', border: '1px dashed var(--bd)', borderRadius: 8 }}>No tickets in this view.</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <AgeHistogram hist={v.hist} />
          <WaitingOn court={v.court} />
          <RecentlyClosed closed={v.closed} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}
