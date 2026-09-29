import { useEffect, useState } from 'react';
import { CLEANUP } from '../lib/cleanup';
import { fmtDays } from '../lib/flags';
import { markTerminal, restoreTicket, type Prev } from '../lib/markDone';
import type { FTicket } from '../lib/portfolio';
import { ArrowRight, BrushCleaning } from 'lucide-react';
import { Close } from './primitives';

/** Bulk-close tickets that look abandoned: review the list, confirm, then undo if needed. */

type Result = { ok: true; prev: Prev | null; to: string } | { ok: false; reason: string };

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The nudge that opens the review, shown on the portfolio and on a merchant's page; built to be noticed. */
export function CleanupStrip({ count, onReview }: { count: number; onReview: () => void }) {
  if (count === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        border: '1px solid var(--amberBd)',
        borderRadius: 10,
        background: 'var(--amberBg)',
        animation: 'mpvUp .35s ease-out',
      }}
    >
      <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--amberT)', border: '1px solid var(--amberBd)' }}>
        <BrushCleaning size={18} strokeWidth={1.9} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>
          {plural(count, 'ticket')} {count === 1 ? 'looks' : 'look'} abandoned
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>
          Open over {CLEANUP.age} days with no update in {CLEANUP.idle}. Review them and close the lot in one go.
        </span>
      </span>
      <button
        type="button"
        className="solid"
        onClick={onReview}
        style={{ all: 'unset', flex: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, boxSizing: 'border-box', padding: '0 14px', borderRadius: 8, background: 'var(--inv)', color: 'var(--invT)', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        Review and close
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

export function CleanupDialog({
  tickets,
  onClose,
  onClosed,
  onRestored,
}: {
  tickets: FTicket[];
  onClose: () => void;
  /** Tickets closed (to hide at once, before a sync catches up); then refresh. */
  onClosed: (ids: string[]) => void;
  onRestored: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tickets.map(t => t.id)));
  const [phase, setPhase] = useState<'review' | 'running' | 'done' | 'undoing'>('review');
  const [results, setResults] = useState<Map<string, Result>>(new Map());
  const [undone, setUndone] = useState(false);
  const busy = phase === 'running' || phase === 'undoing';

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // One at a time, so a refusal names its ticket and the board's rules apply to each.
  const run = async (): Promise<void> => {
    setPhase('running');
    const out = new Map<string, Result>();
    for (const t of tickets.filter(x => picked.has(x.id))) {
      const r: Result = await markTerminal(t.id, 'close').catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
      out.set(t.id, r);
      setResults(new Map(out));
    }
    setPhase('done');
    onClosed([...out].filter(([, r]) => r.ok).map(([id]) => id));
  };

  const undo = async (): Promise<void> => {
    setPhase('undoing');
    const back: string[] = [];
    for (const [id, r] of results) {
      if (!r.ok || !r.prev) continue;
      try {
        await restoreTicket(id, r.prev);
        back.push(id);
      } catch {
        // Left closed; the summary still lists it.
      }
    }
    setUndone(true);
    setPhase('done');
    onRestored(back);
  };

  const closed = [...results.values()].filter(r => r.ok).length;
  const failed = [...results].filter(([, r]) => !r.ok);
  const allPicked = picked.size === tickets.length;

  return (
    <div role="dialog" aria-modal="true" aria-label="Close abandoned tickets" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,.28)' }}>
      <div style={{ width: 760, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderRadius: 12, boxShadow: 'var(--shadowXl)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px 12px', borderBottom: '1px solid var(--bd2)' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Close abandoned tickets</span>
            <span style={{ fontSize: 12.5, color: 'var(--t3)', lineHeight: 1.45 }}>
              Open over {CLEANUP.age} days with no update in {CLEANUP.idle}. Each moves to its board's Cancelled stage, or Completed if the board has none. Nothing is sent to merchants.
            </span>
          </div>
          <button type="button" className="hov" aria-label="Close" disabled={busy} onClick={onClose} style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)' }}>
            <Close />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {phase === 'review' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', fontSize: 12, color: 'var(--t3)', borderBottom: '1px solid var(--bd2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(tickets.map(t => t.id)))} />
              {picked.size} of {plural(tickets.length, 'ticket')} selected
            </label>
          )}
          {tickets.map(t => {
            const r = results.get(t.id);
            return (
              <label key={t.id} style={{ display: 'grid', gridTemplateColumns: '16px 44px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--bd2)', fontSize: 13, cursor: phase === 'review' ? 'pointer' : 'default', opacity: phase !== 'review' && !picked.has(t.id) ? 0.4 : 1 }}>
                <input
                  type="checkbox"
                  disabled={phase !== 'review'}
                  checked={picked.has(t.id)}
                  onChange={() =>
                    setPicked(p => {
                      const n = new Set(p);
                      if (n.has(t.id)) n.delete(t.id);
                      else n.add(t.id);
                      return n;
                    })
                  }
                />
                <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--redT)', fontVariantNumeric: 'tabular-nums' }}>{fmtDays(t.d)}</span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)' }}>{t.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span className="mono">{t.key}</span> · {t.midR.join(', ') || 'no merchant ID'} · {t.stage} · no update in {fmtDays(t.u)}
                  </span>
                </span>
                <span style={{ fontSize: 12, whiteSpace: 'nowrap', color: r ? (r.ok ? 'var(--greenT, var(--green))' : 'var(--redT)') : 'var(--t4)' }}>
                  {r ? (r.ok ? (undone && r.prev ? `back in ${r.prev.stageName}` : `→ ${r.to}`) : r.reason) : ''}
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--bd2)' }}>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t3)' }}>
            {phase === 'running' && `Closing ${results.size + 1} of ${picked.size}…`}
            {phase === 'undoing' && 'Putting them back…'}
            {phase === 'done' && !undone && `Closed ${plural(closed, 'ticket')}.${failed.length ? ` ${failed.length} couldn't be closed here; finish ${failed.length === 1 ? 'it' : 'them'} in Xyne.` : ''}`}
            {phase === 'done' && undone && 'Undone: the tickets are back where they were.'}
          </span>
          {phase === 'review' && (
            <>
              <button type="button" className="outline" onClick={onClose} style={BTN}>
                Cancel
              </button>
              <button type="button" className="solid" disabled={picked.size === 0} onClick={() => void run()} style={{ ...BTN, border: 'none', background: 'var(--primary)', color: 'var(--primaryT)', opacity: picked.size ? 1 : 0.5 }}>
                Close {plural(picked.size, 'ticket')}
              </button>
            </>
          )}
          {phase === 'done' && (
            <>
              {!undone && closed > 0 && (
                <button type="button" className="outline" onClick={() => void undo()} style={BTN}>
                  Undo
                </button>
              )}
              <button type="button" className="outline" onClick={onClose} style={BTN}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const BTN = { all: 'unset', cursor: 'pointer', height: 32, boxSizing: 'border-box', padding: '0 14px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--bg)', fontSize: 13.5, fontWeight: 500, color: 'var(--t1)' } as const;
