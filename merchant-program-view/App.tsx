import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { MerchantPage } from './components/MerchantPage';
import { ActiveChips, AgeBar, FilterPills, KpiCards, MerchantsTable, PortfolioHeader, Tabs, TicketsTable, type SyncStatus } from './components/Portfolio';
import { SearchBox } from './components/SearchBox';
import { PortfolioSkeleton } from './components/Skeleton';
import { TicketPanel } from './components/TicketPanel';
import { TipLayer, Toast } from './components/primitives';
import { Warnings } from './components/Warnings';
import { drawer, type ActivityRow } from './lib/drawer';
import { formatClock, updateBarText } from './lib/format';
import { merchantView, type ThreadStatus } from './lib/merchantView';
import { buildModel } from './lib/model';
import { DEFAULT_PSTATE, defaultMidSuggestions, midSuggestions, portfolio, type Kpi, type PState } from './lib/portfolio';
import { browserStorage, loadMidPicks, loadRange, recordMidPick, saveRange } from './lib/prefs';
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
  const [ps, setPs] = useState<PState>(() => ({ ...DEFAULT_PSTATE, range: loadRange(browserStorage()) }));
  const [threadStatus, setThreadStatus] = useState<ThreadStatus>('open');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [act, setAct] = useState<ActivityState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    if (data.summary) showToast(data.summary.text);
  }, [data.summary, showToast]);

  // `version` changes whenever the mutable store does.
  const model = useMemo(() => buildModel(store, Date.now()), [store, version]);
  // Typing stays responsive: the lists catch up with the filters a frame later.
  const deferredPs = useDeferredValue(ps);
  const pf = useMemo(() => portfolio(model, deferredPs), [model, deferredPs]);
  const set = useCallback((p: Partial<PState>) => setPs(s => ({ ...s, ...p })), []);
  const [mSort, setMSort] = useState<Sort<MKey> | null>(null);
  const [tSort, setTSort] = useState<Sort<TKey> | null>(null);
  const merchantRows = useMemo(() => sortMerchantRows(pf.merchantRows, mSort), [pf.merchantRows, mSort]);
  const ticketRows = useMemo(() => sortTicketRows(pf.ticketRows, tSort), [pf.ticketRows, tSort]);
  const suggestions = useMemo(() => midSuggestions(model, ps.search, ps.mids), [model, ps.search, ps.mids]);
  // Bumped on each pick so the "Frequently searched" list refreshes.
  const [picksVersion, setPicksVersion] = useState(0);
  const defaults = useMemo(() => defaultMidSuggestions(model, loadMidPicks(browserStorage()), ps.mids), [model, ps.mids, picksVersion]);
  const onPicked = useCallback((mid: string) => {
    recordMidPick(browserStorage(), mid);
    setPicksVersion(v => v + 1);
  }, []);

  const openMerchant = useCallback((mid: string) => {
    setView({ kind: 'merchant', mid });
    setThreadStatus('open');
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
    spaces.tickets
      .listActivitiesForTickets({ ticketIds: [drawerId], limit: 100 })
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
    () => (view.kind === 'merchant' && model.byMid.has(view.mid) ? merchantView(model, pf.byId, view.mid, threadStatus) : null),
    [view, model, pf.byId, threadStatus],
  );

  const dt = useMemo(() => {
    if (drawerId === null || !pf.byId.has(drawerId)) return null;
    const rows = act?.id !== drawerId ? null : act.error ? 'failed' : act.rows;
    return drawer(model, pf.byId, drawerId, rows, store.lookups.users, model.now);
  }, [drawerId, act, model, pf.byId, store.lookups.users]);

  const sync: SyncStatus = data.opening
    ? { text: 'Opening saved data…', busy: true }
    : data.activity
      ? { text: updateBarText(data.activity, data.progress), busy: true }
      : data.syncedAt !== null
        ? { text: `Synced ${formatClock(data.syncedAt)}`, busy: false }
        : { text: 'Not loaded', busy: false };

  const kpiActive = (k: Kpi): boolean => {
    const t = k.target;
    if (!t || 'drawer' in t) return false;
    if (t.kind === 'merchants') return ps.tab === 'merchants' && sameSet(ps.health, t.health);
    return ps.tab === 'tickets' && ps.typeFilter === t.typeFilter && ps.bucket === null && (t.typeFilter !== null || ps.health.length === 0);
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
    else set({ tab: 'tickets', typeFilter: t.typeFilter, bucket: null, ...(t.typeFilter === null ? { health: [] } : {}) });
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
            search={<SearchBox mids={ps.mids} search={ps.search} suggestions={suggestions} defaults={defaults} onPicked={onPicked} onMids={mids => set({ mids })} onSearch={search => set({ search })} />}
            range={ps.range}
            onRange={range => {
              set({ range });
              saveRange(browserStorage(), range);
            }}
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
          onStatus={setThreadStatus}
          selected={drawerId}
          resolving={data.resolvingParents}
          onBack={() => {
            setView({ kind: 'portfolio' });
            setDrawerId(null);
          }}
          onRefresh={data.refresh}
          onOpen={setDrawerId}
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
          deskChannels={store.lookups.deskChannels}
          onClose={closeDrawer}
          onOpen={setDrawerId}
          onMerchant={view.kind === 'portfolio' ? openMerchant : null}
          onToast={showToast}
          onChanged={data.refresh}
        />
      )}
      {toast && <Toast text={toast} />}
      <TipLayer />
    </div>
  );
}
