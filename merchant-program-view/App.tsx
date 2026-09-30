import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { MerchantPage, nudgeKey } from './components/MerchantPage';
import type { AskState } from './components/AgentText';
import { summarizeMerchant } from './lib/askAgent';
import { CleanupDialog, CleanupStrip } from './components/CleanupDialog';
import { markDone } from './lib/markDone';
import { ActiveChips, AgeBar, FilterPills, KpiCards, MerchantsTable, PortfolioHeader, SourcePills, Tabs, TicketsTable, type SyncStatus } from './components/Portfolio';
import { SearchBox } from './components/SearchBox';
import { PortfolioSkeleton } from './components/Skeleton';
import { TicketPanel } from './components/TicketPanel';
import { TipLayer, Toast } from './components/primitives';
import { Warnings } from './components/Warnings';
import { drawer, type ActivityRow } from './lib/drawer';
import { formatClock, updateBarText } from './lib/format';
import { merchantView, sameFocus, type MFocus, type Nudge, type ThreadStatus } from './lib/merchantView';
import { buildModel } from './lib/model';
import { DEFAULT_PSTATE, defaultMidSuggestions, midSuggestions, portfolio, type FTicket, type Kpi, type PState } from './lib/portfolio';
import { browserStorage, loadAnswer, loadFilters, loadMidPicks, loadOrder, loadRange, recordMidPick, saveAnswer, saveFilters, saveOrder, saveRange } from './lib/prefs';
import type { Order } from './lib/order';
import { M_FIRST, T_FIRST, nextSort, sortMerchantRows, sortTicketRows, type MKey, type Sort, type TKey } from './lib/sort';
import { THEME_CSS } from './lib/theme';
import { useMerchantData } from './lib/useMerchantData';
import { spaces } from './lib/xyne';

type View = { kind: 'portfolio' } | { kind: 'merchant'; mid: string };

interface ActivityState {
  id: string;
  rows: ActivityRow[] | null;
  error: boolean;
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every(x => b.includes(x));

export default function App() {
  const data = useMerchantData();
  const { store, version, resolveParents } = data;
  const [view, setView] = useState<View>({ kind: 'portfolio' });
  const [ps, setPs] = useState<PState>(() => ({ ...DEFAULT_PSTATE, range: loadRange(browserStorage()), ...loadFilters(browserStorage()) }));
  // Remember the filter pills and tab for the next visit.
  useEffect(() => {
    saveFilters(browserStorage(), { tab: ps.tab, desks: ps.desks, boards: ps.boards, owners: ps.owners, health: ps.health });
  }, [ps.tab, ps.desks, ps.boards, ps.owners, ps.health]);
  const [threadStatus, setThreadStatus] = useState<ThreadStatus>('open');
  // How the merchant page's list is sorted; remembered between visits.
  const [order, setOrder] = useState<Order>(() => loadOrder(browserStorage()));
  const [mFocus, setMFocus] = useState<MFocus | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);
  // Agent answers by key ('tldr|<range>|<merchant>'): a live run, else the answer saved last time,
  // so nothing generated disappears.
  const [answers, setAnswers] = useState<Map<string, AskState>>(() => new Map());
  const answerFor = useCallback(
    (key: string): AskState | undefined => {
      const live = answers.get(key);
      if (live) return live;
      const saved = loadAnswer(browserStorage(), key);
      return saved ? { status: 'done', text: saved.text, at: saved.at } : undefined;
    },
    [answers],
  );
  const runAnswer = useCallback((key: string, job: () => Promise<string>) => {
    const put = (st: AskState): void => setAnswers(prev => new Map(prev).set(key, st));
    put({ status: 'running' });
    job()
      .then(text => {
        const at = Date.now();
        saveAnswer(browserStorage(), key, text, at);
        put({ status: 'done', text, at });
      })
      .catch((e: unknown) => put({ status: 'error', text: e instanceof Error ? e.message : String(e) }));
  }, []);
  // The clean-up review being shown, and tickets just closed (hidden until a sync sees them closed).
  const [cleanup, setCleanup] = useState<FTicket[] | null>(null);
  const [closedIds, setClosedIds] = useState<Set<string>>(() => new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [act, setAct] = useState<ActivityState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // One ticket at a time, so a refusal names the ticket; then refresh to show the new statuses.
  const runNudge = useCallback(
    async (n: Nudge) => {
      setNudging(nudgeKey(n));
      const failed: string[] = [];
      for (const t of n.targets) {
        const r = await markDone(t.id).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
        if (!r.ok) failed.push(`${t.key}: ${r.reason}`);
      }
      const doneCount = n.targets.length - failed.length;
      const doneText = doneCount === 0 ? '' : doneCount === 1 && n.targets.length === 1 ? `Marked ${n.targets[0].key} as done` : `Marked ${doneCount} as done`;
      showToast([doneText, failed.length ? `Couldn't finish ${failed.join('; ')} — do it in Xyne` : ''].filter(Boolean).join('. '));
      setNudging(null);
      data.refresh();
    },
    [showToast, data.refresh],
  );

  useEffect(() => {
    if (data.summary) showToast(data.summary.text);
  }, [data.summary, showToast]);

  // `version` changes whenever the mutable store does.
  const model = useMemo(() => buildModel(store, Date.now()), [store, version]);
  // Typing stays responsive: the lists catch up with the filters a frame later.
  const deferredPs = useDeferredValue(ps);
  const pf = useMemo(() => portfolio(model, deferredPs), [model, deferredPs]);
  const abandoned = useMemo(() => pf.abandoned.filter(t => !closedIds.has(t.id)), [pf.abandoned, closedIds]);
  const set = useCallback((p: Partial<PState>) => setPs(s => ({ ...s, ...p })), []);
  // One Created range for the portfolio and the merchant page, remembered between visits.
  const onRange = useCallback(
    (range: PState['range']) => {
      set({ range });
      saveRange(browserStorage(), range);
    },
    [set],
  );
  const [mSort, setMSort] = useState<Sort<MKey> | null>(null);
  const [tSort, setTSort] = useState<Sort<TKey> | null>(null);
  const merchantRows = useMemo(() => sortMerchantRows(pf.merchantRows, mSort), [pf.merchantRows, mSort]);
  const ticketRows = useMemo(() => sortTicketRows(pf.ticketRows, tSort), [pf.ticketRows, tSort]);
  const suggestions = useMemo(() => midSuggestions(model, ps.search, ps.mids, ps.range), [model, ps.search, ps.mids, ps.range]);
  // Bumped on each pick so the "Frequently searched" list refreshes.
  const [picksVersion, setPicksVersion] = useState(0);
  const defaults = useMemo(() => defaultMidSuggestions(model, loadMidPicks(browserStorage()), ps.mids, ps.range), [model, ps.mids, ps.range, picksVersion]);
  const onPicked = useCallback((mid: string) => {
    recordMidPick(browserStorage(), mid);
    setPicksVersion(v => v + 1);
  }, []);

  const openMerchant = useCallback((mid: string) => {
    setView({ kind: 'merchant', mid });
    setThreadStatus('open');
    setMFocus(null);
    setDrawerId(null);
    window.scrollTo(0, 0);
  }, []);

  // Look up the merchant's parent tickets on open, and again if a full load replaces the store.
  const merchantMid = view.kind === 'merchant' ? view.mid : null;
  useEffect(() => {
    if (merchantMid !== null) resolveParents(merchantMid);
  }, [merchantMid, store, resolveParents]);

  // Fetch the ticket's activity when the drawer opens, and again when a sync changes the ticket.
  const drawerUpdatedAt = drawerId !== null ? model.tickets.get(drawerId)?.updatedAt : undefined;
  useEffect(() => {
    if (drawerId === null) return;
    let cancelled = false;
    // Keep showing the previous rows for this ticket while a post-sync refetch runs.
    setAct(prev => (prev?.id === drawerId && !prev.error ? prev : { id: drawerId, rows: null, error: false }));
    // The feed shows the whole history, like the dashboard: page back (newest first) until a short page.
    const loadAll = async (): Promise<ActivityRow[]> => {
      const out: ActivityRow[] = [];
      let start: { timestamp: number; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await spaces.tickets.listActivitiesForTickets({ ticketIds: [drawerId], limit: 100, ...(start ? { start } : {}) });
        out.push(...rows);
        if (rows.length < 100) break;
        const last = rows[rows.length - 1];
        start = { timestamp: last.timestamp, id: last.id };
      }
      return out;
    };
    loadAll()
      .then(rows => {
        if (!cancelled) setAct({ id: drawerId, rows, error: false });
      })
      .catch(() => {
        if (!cancelled) setAct({ id: drawerId, rows: [], error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [drawerId, drawerUpdatedAt]);

  // A reload can drop the open ticket; close the drawer rather than leave it hidden but set.
  useEffect(() => {
    if (drawerId !== null && model.tickets.size > 0 && !model.tickets.has(drawerId)) setDrawerId(null);
  }, [drawerId, model]);

  const closeDrawer = useCallback(() => setDrawerId(null), []);

  const mv = useMemo(
    () => (view.kind === 'merchant' && model.byMid.has(view.mid) ? merchantView(model, pf.byId, view.mid, threadStatus, mFocus, ps.range, order) : null),
    [view, model, pf.byId, threadStatus, mFocus, ps.range, order],
  );

  // A merchant's summary is written the first time it's opened (per Created range), then kept.
  const tldrKey = mv ? `tldr|${ps.range}|${mv.mid}` : null;
  useEffect(() => {
    if (!mv || !tldrKey || mv.row.tickets.length === 0 || answerFor(tldrKey)) return;
    runAnswer(tldrKey, () => summarizeMerchant(mv.mid, mv.row.tickets));
  }, [mv, tldrKey, answerFor, runAnswer]);

  const dt = useMemo(() => {
    if (drawerId === null || !pf.byId.has(drawerId)) return null;
    const rows = act?.id !== drawerId ? null : act.error ? 'failed' : act.rows;
    return drawer(model, pf.byId, drawerId, rows, store.lookups.users, model.now);
  }, [drawerId, act, model, pf.byId, store.lookups.users]);

  const sync: SyncStatus = data.opening
    ? { text: 'Opening saved data…', busy: true }
    : data.activity
      ? { text: updateBarText(data.activity, data.progress), busy: true }
      : data.error !== null
        ? { text: 'Refresh failed · try again', busy: false, error: data.error }
        : data.syncedAt !== null
          ? { text: `Synced ${formatClock(data.syncedAt)}`, busy: false }
          : { text: 'Not loaded', busy: false };

  const kpiActive = (k: Kpi): boolean => {
    const t = k.target;
    if (!t || 'drawer' in t) return false;
    if (t.kind === 'merchants') return ps.tab === 'merchants' && sameSet(ps.health, t.health);
    return ps.tab === 'tickets' && ps.typeFilter === t.typeFilter && ps.bucket === null && (t.typeFilter !== 'open' || ps.health.length === 0);
  };
  const kpiClick = (k: Kpi): void => {
    const t = k.target;
    if (!t) return;
    if ('drawer' in t) {
      setDrawerId(t.drawer);
      return;
    }
    if (kpiActive(k)) {
      set(t.kind === 'merchants' ? { health: [] } : { typeFilter: null });
      return;
    }
    if (t.kind === 'merchants') set({ tab: 'merchants', health: t.health });
    else set({ tab: 'tickets', typeFilter: t.typeFilter, bucket: null, ...(t.typeFilter === 'open' ? { health: [] } : {}) });
  };
  const bucketClick = (i: number): void => {
    if (ps.bucket === i) set({ bucket: null });
    else set({ tab: 'tickets', bucket: i, typeFilter: null });
  };

  const resetKey = JSON.stringify([mSort, tSort, ps.range, ps.mids, ps.search, ps.desks, ps.boards, ps.owners, ps.health, ps.typeFilter, ps.bucket]);
  const empty = model.tickets.size === 0;

  return (
    <div className="mpv">
      <style>{THEME_CSS}</style>
      {view.kind === 'portfolio' ? (
        <div className="page" style={{ gap: 22 }}>
          <PortfolioHeader
            filters={<SourcePills s={ps} set={set} pf={pf} />}
            search={<SearchBox mids={ps.mids} search={ps.search} suggestions={suggestions} defaults={defaults} onPicked={onPicked} onMids={mids => set({ mids })} onSearch={search => set({ search })} />}
            range={ps.range}
            onRange={onRange}
            sync={sync}
            onRefresh={data.refresh}
            onFullReload={data.fullReload}
          />
          {data.error !== null && (
            <div style={{ border: '1px solid var(--redBd)', background: 'var(--redBg)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--t2)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>
                <b style={{ color: 'var(--redT)', fontWeight: 600 }}>Couldn't load tickets.</b> {data.error}
              </span>
              <button type="button" onClick={data.refresh} style={{ all: 'unset', cursor: 'pointer', color: 'var(--redT)', fontWeight: 500 }}>
                Retry
              </button>
            </div>
          )}
          <Warnings warnings={data.warnings} onRetry={data.refresh} />
          {empty && (data.loading || data.opening) ? (
            <PortfolioSkeleton note={data.opening ? null : 'The first load reads every Desk and board you can access and takes a few minutes. Later opens use the saved copy.'} />
          ) : empty ? (
            <div style={{ padding: '56px 24px', textAlign: 'center', border: '1px dashed var(--bd)', borderRadius: 8, background: 'var(--bg2)', color: 'var(--t3)', fontSize: 13.5 }}>
              No tickets with a Merchant ID that you can access.
            </div>
          ) : (
            <>
              <CleanupStrip count={abandoned.length} onReview={() => setCleanup(abandoned)} />
              <KpiCards kpis={pf.kpis} isActive={kpiActive} onClick={kpiClick} />
              <AgeBar counts={pf.buckets} bucket={ps.bucket} onBucket={bucketClick} />
              <Tabs tab={ps.tab} counts={{ merchants: pf.merchantRows.length, tickets: pf.ticketRows.length }} onTab={tab => set({ tab })}>
                <ActiveChips s={ps} set={set} />
                <FilterPills s={ps} set={set} pf={pf} />
              </Tabs>
              {ps.tab === 'merchants' ? (
                <MerchantsTable rows={merchantRows} onOpen={openMerchant} resetKey={resetKey} sort={mSort} onSort={k => setMSort(c => nextSort(c, k, M_FIRST))} />
              ) : (
                <TicketsTable rows={ticketRows} onOpen={setDrawerId} resetKey={resetKey} sort={tSort} onSort={k => setTSort(c => nextSort(c, k, T_FIRST))} />
              )}
            </>
          )}
        </div>
      ) : mv ? (
        <MerchantPage
          v={mv}
          status={threadStatus}
          onStatus={st => {
            setThreadStatus(st);
            setMFocus(null);
          }}
          onFocus={f => setMFocus(cur => (sameFocus(cur, f) ? null : f))}
          onClearFocus={() => setMFocus(null)}
          abandoned={mv.abandoned.filter(t => !closedIds.has(t.id))}
          onRange={onRange}

          tldr={tldrKey ? answerFor(tldrKey) : undefined}
          onOrder={o => {
            setOrder(o);
            saveOrder(browserStorage(), o);
          }}
          onTldr={() => tldrKey && runAnswer(tldrKey, () => summarizeMerchant(mv.mid, mv.row.tickets))}
          onCleanup={setCleanup}
          nudging={nudging}
          onNudge={runNudge}
          selected={drawerId}
          resolving={data.resolvingParents}
          onBack={() => {
            setView({ kind: 'portfolio' });
            setDrawerId(null);
          }}
          onRefresh={data.refresh}
          onOpen={setDrawerId}
          sync={sync}
        />
      ) : (
        <div className="page" style={{ gap: 16 }}>
          <button type="button" onClick={() => setView({ kind: 'portfolio' })} style={{ all: 'unset', cursor: 'pointer', fontSize: 13, color: 'var(--t3)' }}>
            ‹ All merchants
          </button>
          <p style={{ margin: 0, color: 'var(--t3)' }}>No tickets for {view.mid} that you can access.</p>
        </div>
      )}
      {drawerId !== null && (
        <TicketPanel
          key={drawerId}
          ticketId={drawerId}
          url={model.tickets.get(drawerId)?.url ?? ''}
          dt={dt}
          loadingActivity={act?.id === drawerId && act.rows === null}
          activityError={act?.id === drawerId && act.error}
          activities={act?.id === drawerId && !act.error ? act.rows : null}
          boardNames={store.lookups.boards}
          deskChannels={store.lookups.deskChannels}
          onClose={closeDrawer}
          onOpen={setDrawerId}
          onMerchant={view.kind === 'portfolio' ? openMerchant : null}
          onToast={showToast}
          onChanged={data.refresh}
        />
      )}
      {cleanup && (
        <CleanupDialog
          tickets={cleanup}
          onClose={() => setCleanup(null)}
          onClosed={ids => {
            setClosedIds(prev => new Set([...prev, ...ids]));
            data.refresh();
          }}
          onRestored={ids => {
            setClosedIds(prev => new Set([...prev].filter(id => !ids.includes(id))));
            data.refresh();
          }}
        />
      )}
      {toast && <Toast text={toast} />}
      <TipLayer />
    </div>
  );
}
