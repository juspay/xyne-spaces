/**
 * ErrorPipelinePageV3 — standalone page for the Grafana → Claw error pipeline
 * (moved out of the Admin Panel tab; same admin-only gating via routing).
 *
 * Grafana dedupes errors → claw routes each into a lane by the DB bucket rules
 * (keywords + regex; no match → default) → durable Redis streams → one
 * doctor-agent per stream works them. This page is the whole cockpit: summary
 * tiles, editable bucket rules (keyword chips + advanced regex), per-lane item
 * inspector, and (via /fixes) what the agents did.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SpinnerGapIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog } from "./ui/Dialog";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";
import {
  getErrorPipelineBuckets,
  listErrorPipelineItems,
  listErrorPipelineRules,
  listErrorPipelineFixes,
  saveErrorPipelineRule,
  deleteErrorPipelineRule,
  type ErrorPipelineBucketStat,
  type ErrorPipelineItem,
  type ErrorPipelineRule,
  type ErrorPipelineFix,
} from "../../lib/api";

type RuleDraft = { name: string; description: string; keywords: string[]; markers: string; matchOrder: number; enabled: boolean; isNew: boolean };

const chip = (sig: string) =>
  sig === "rule" ? "bg-sky-500/15 text-sky-300"
  : sig === "default" ? "bg-amber-500/15 text-amber-300"
  : "bg-xyne-surface-subtle text-xyne-fg-tertiary";

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</p>
      <p className={`mt-1 font-mono text-[20px] ${tone ?? "text-xyne-fg-primary"}`}>{value}</p>
    </div>
  );
}

function AgentStatusChip({ status }: { status?: ErrorPipelineFix["status"] }) {
  if (!status) return <span className="text-[11px] text-xyne-fg-muted">—</span>;
  const cls =
    status === "running" ? "bg-amber-500/15 text-amber-300"
    : status === "completed" ? "bg-emerald-500/15 text-emerald-300"
    : "bg-red-500/15 text-red-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${cls}`}>
      {status === "running" && <SpinnerGapIcon size={11} className="animate-spin" />}
      {status}
    </span>
  );
}

function AgentResponse({ children }: { children: string }) {
  return (
    <div className={
      "prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] dark:prose-invert text-[12.5px] leading-relaxed " +
      "prose-strong:font-medium prose-headings:font-medium prose-pre:bg-xyne-surface-subtle prose-pre:text-[11.5px]"
    }>
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-[13px] text-xyne-fg-muted">
      <SpinnerGapIcon size={16} className="animate-spin" /> Loading…
    </div>
  );
}

export function ErrorPipelinePageV3({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  const navigate = useNavigate();

  const [buckets, setBuckets] = useState<Record<string, ErrorPipelineBucketStat>>({});
  const [rules, setRules] = useState<ErrorPipelineRule[]>([]);
  const [fixes, setFixes] = useState<ErrorPipelineFix[]>([]);
  const [detail, setDetail] = useState<{ item?: ErrorPipelineItem; fix?: ErrorPipelineFix } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<ErrorPipelineItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsTab, setItemsTab] = useState<"pending" | "retrying" | "failed" | "done">("pending");
  const [itemsShown, setItemsShown] = useState(100);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [kwInput, setKwInput] = useState("");
  const [advOpen, setAdvOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    // Settle independently: the bucket rules (config) must render even if the
    // queue-stats proxy is down.
    const [bucketsRes, rulesRes, fixesRes] = await Promise.allSettled([
      getErrorPipelineBuckets(userId),
      listErrorPipelineRules(userId),
      listErrorPipelineFixes(userId),
    ]);
    if (bucketsRes.status === "fulfilled") setBuckets(bucketsRes.value);
    else { console.error("[error-pipeline] stats failed:", bucketsRes.reason); setBuckets({}); }
    if (rulesRes.status === "fulfilled") setRules(rulesRes.value);
    else console.error("[error-pipeline] rules failed:", rulesRes.reason);
    if (fixesRes.status === "fulfilled") setFixes(fixesRes.value);
    else console.error("[error-pipeline] fixes failed:", fixesRes.reason);
    setLoading(false);
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  // Live mode: while any agent run is in flight, silently re-poll every 8s so
  // statuses flip on screen without the Refresh button. Also keeps the open
  // lane's items current.
  const anyRunning = fixes.some((f) => f.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      void load(true);
      if (selected) {
        listErrorPipelineItems(userId, selected, 500).then(setItems).catch(() => {});
      }
    }, 8000);
    return () => clearInterval(t);
  }, [anyRunning, load, selected, userId]);

  // Keep an open detail dialog in sync as fixes refresh (running → completed
  // flips live, response appears the moment the agent finishes).
  useEffect(() => {
    setDetail((d) => {
      if (!d) return d;
      const key = d.fix?.errorKey ?? d.item?.errorKey;
      if (!key) return d;
      const fresh = fixes.find((f) => f.errorKey === key);
      if (!fresh || fresh === d.fix) return d;
      return { ...(d.item ? { item: d.item } : {}), fix: fresh };
    });
  }, [fixes]);

  const openBucket = async (bucket: string) => {
    setSelected(bucket);
    setItemsTab("pending");
    setItemsShown(100);
    setItemsLoading(true);
    try { setItems(await listErrorPipelineItems(userId, bucket, 500)); }
    catch { setItems([]); }
    finally { setItemsLoading(false); }
  };
  // Reset the "Show more" window whenever the tab changes.
  useEffect(() => { setItemsShown(100); }, [itemsTab]);
  const fixByKey = useMemo(() => {
    const m = new Map<string, ErrorPipelineFix>();
    for (const f of fixes) m.set(f.errorKey, f);
    return m;
  }, [fixes]);

  const openEditor = (rule?: ErrorPipelineRule) => {
    setSaveError(null);
    setKwInput("");
    setAdvOpen(Boolean(rule?.markers));
    setDraft(rule
      ? { name: rule.name, description: rule.description, keywords: rule.keywords ?? [], markers: rule.markers, matchOrder: rule.matchOrder, enabled: rule.enabled, isNew: false }
      : { name: "", description: "", keywords: [], markers: "", matchOrder: 20, enabled: true, isNew: true });
  };
  const addKeyword = () => {
    const v = kwInput.trim();
    if (!v || !draft) { setKwInput(""); return; }
    if (!draft.keywords.includes(v)) setDraft({ ...draft, keywords: [...draft.keywords, v] });
    setKwInput("");
  };
  const removeKeyword = (k: string) => {
    if (!draft) return;
    setDraft({ ...draft, keywords: draft.keywords.filter((x) => x !== k) });
  };
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { setSaveError("Name: lowercase letters, digits and dashes only."); return; }
    const pending = kwInput.trim();
    const keywords = pending && !draft.keywords.includes(pending) ? [...draft.keywords, pending] : draft.keywords;
    if (draft.markers.trim()) {
      try { new RegExp(draft.markers); } catch (e) { setSaveError(`Invalid advanced regex: ${e instanceof Error ? e.message : "bad pattern"}`); return; }
    }
    if (keywords.length === 0 && !draft.markers.trim() && name !== "default") {
      setSaveError("Add at least one keyword (or an advanced regex) so the bucket can match something."); return;
    }
    setSaving(true); setSaveError(null);
    try {
      await saveErrorPipelineRule(userId, name, {
        description: draft.description, keywords, markers: draft.markers, matchOrder: draft.matchOrder, enabled: draft.enabled,
      });
      setKwInput("");
      showSnackbar({ variant: "success", title: `Bucket "${name}" saved` });
      setDraft(null);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteErrorPipelineRule(userId, deleteTarget);
      showSnackbar({ variant: "success", title: `Bucket "${deleteTarget}" deleted` });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Delete failed" });
      setDeleteTarget(null);
    }
  };

  const lanes = Object.entries(buckets).filter(([n]) => n !== "needs-human");
  const total = lanes.reduce((a, [, s]) => a + s.queued, 0);
  const dflt = buckets["default"]?.queued ?? 0;
  const dead = buckets["needs-human"]?.queued ?? 0;
  const active = lanes.filter(([, s]) => s.queued > 0).length;
  const maxQ = Math.max(1, ...rules.map((r) => buckets[r.name]?.queued ?? 0));
  const orderedRules = [...rules].sort((a, b) => a.matchOrder - b.matchOrder);
  const gapPct = total ? Math.round((dflt / total) * 100) : 0;
  const mix = items.reduce<Record<string, number>>((m, it) => {
    const k = it.classification.signal; m[k] = (m[k] ?? 0) + 1; return m;
  }, {});

  // Two data sources with different lifetimes:
  //   • the LIVE Redis queue (`items`) — everything currently in the stream.
  //     A completed run is ACKed OUT of the stream, so anything still here is
  //     NOT done — it's either fresh/running (→ Pending, the ≤1 running one
  //     pinned on top) or carrying a stale `failed` record from a prior attempt
  //     (→ Retrying). Together they equal the lane's "In queue" count.
  //   • the fix RECORDS (30-day TTL) — history. Shown under Done (30d) / Failed
  //     (30d), but ONLY for keys no longer in the queue, so a retrying item
  //     appears under Retrying and is never double-counted as Failed.
  type Row = { errorKey: string; message: string; timeMs: number; signal?: string; fix?: ErrorPipelineFix; item?: ErrorPipelineItem };
  const itemByKey = new Map(items.map((it) => [it.errorKey, it] as const));
  const laneFixes = fixes.filter((f) => f.bucket === selected);
  const toItemRow = (it: ErrorPipelineItem): Row => { const fix = fixByKey.get(it.errorKey); return { errorKey: it.errorKey, message: it.error.message, timeMs: it.enqueuedAt, signal: it.classification.signal, item: it, ...(fix ? { fix } : {}) }; };
  const pendingRows: Row[] = items
    .filter((it) => fixByKey.get(it.errorKey)?.status !== "failed")
    .sort((a, b) => {
      // Running pinned first, then newest.
      const ra = fixByKey.get(a.errorKey)?.status === "running" ? 0 : 1;
      const rb = fixByKey.get(b.errorKey)?.status === "running" ? 0 : 1;
      return ra !== rb ? ra - rb : b.enqueuedAt - a.enqueuedAt;
    })
    .map(toItemRow);
  const retryingRows: Row[] = items
    .filter((it) => fixByKey.get(it.errorKey)?.status === "failed")
    .sort((a, b) => b.enqueuedAt - a.enqueuedAt)
    .map(toItemRow);
  const fixToRow = (f: ErrorPipelineFix): Row => { const item = itemByKey.get(f.errorKey); return { errorKey: f.errorKey, message: f.message, timeMs: f.updatedAt, fix: f, ...(item ? { item } : {}) }; };
  const failedRows = laneFixes.filter((f) => f.status === "failed" && !itemByKey.has(f.errorKey)).sort((a, b) => b.updatedAt - a.updatedAt).map(fixToRow);
  const doneRows = laneFixes.filter((f) => f.status === "completed" && !itemByKey.has(f.errorKey)).sort((a, b) => b.updatedAt - a.updatedAt).map(fixToRow);
  const counts = { pending: pendingRows.length, retrying: retryingRows.length, done: doneRows.length, failed: failedRows.length };
  const tabRows: Row[] =
    itemsTab === "retrying" ? retryingRows :
    itemsTab === "failed" ? failedRows :
    itemsTab === "done" ? doneRows :
    pendingRows;
  const hasAnything = items.length > 0 || laneFixes.length > 0;
  // Client-side "Show more" so a deep lane doesn't dump everything at once.
  const visibleRows = tabRows.slice(0, itemsShown);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-xyne-border px-6 py-5">
        <h1 className="text-[18px] font-semibold text-xyne-fg-primary">Error Pipeline</h1>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-xyne-fg-muted">
          Grafana dedupes errors → routed into a lane by the bucket rules (keywords + regex; no match → <span className="text-xyne-fg-secondary">default</span>)
          → one fix-agent per stream works them. <span className="text-xyne-fg-secondary">needs-human</span> = dead-letter (3 failed attempts).
        </p>
      </header>

      <div className="space-y-6 px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="In queue (all lanes)" value={total} />
            <Tile label="Routing gaps (default)" value={`${dflt} · ${gapPct}%`} tone={gapPct > 15 ? "text-amber-400" : undefined} />
            <Tile label="Dead-letter" value={dead} tone={dead > 0 ? "text-red-400" : "text-xyne-fg-muted"} />
            <Tile label="Active lanes" value={`${active} / ${lanes.length}`} />
          </div>
          <div className="ml-4 flex shrink-0 gap-2">
            <button onClick={() => openEditor()}
              className="rounded-lg bg-xyne-brand px-3 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:opacity-90">+ Add bucket</button>
            <button onClick={() => void load()} disabled={loading}
              className="rounded-lg border border-xyne-border px-3 py-1.5 text-[12px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle disabled:opacity-50">
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {loading && rules.length === 0 ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-xyne-border">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                  <th className="px-3 py-2 font-medium">Bucket</th>
                  <th className="px-3 py-2 font-medium">Volume</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">In queue</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderedRules.map((r) => {
                  const isDefault = r.name === "default";
                  const q = buckets[r.name]?.queued ?? 0;
                  return (
                    <tr key={r.name} onClick={() => void openBucket(r.name)}
                      className={`cursor-pointer border-b border-xyne-border-subtle transition hover:bg-xyne-surface-subtle/50 ${selected === r.name ? "bg-xyne-surface-subtle/70" : ""} ${!r.enabled ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-medium">
                          <span className={isDefault ? "text-amber-400" : "text-xyne-fg-primary"}>{r.name}</span>
                          {!r.enabled && <span className="rounded bg-xyne-surface-subtle px-1 text-[10px] uppercase text-xyne-fg-tertiary">off</span>}
                        </div>
                        {r.description && <div className="line-clamp-1 text-[11px] text-xyne-fg-muted">{r.description}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-xyne-surface-subtle">
                          <div className={`h-full rounded-full ${isDefault ? "bg-amber-500/70" : "bg-sky-500/60"}`}
                            style={{ width: `${Math.round((q / maxQ) * 100)}%` }} />
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${q > 0 ? (isDefault ? "text-amber-400" : "text-xyne-fg-primary") : "text-xyne-fg-muted"}`}>{q}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditor(r); }}
                            title="Edit bucket"
                            className="rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary">
                            <PencilSimpleIcon size={15} />
                          </button>
                          {!isDefault && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(r.name); }}
                              title="Delete bucket"
                              className="rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-red-500/10 hover:text-red-400">
                              <TrashIcon size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {dead > 0 && (
                  <tr onClick={() => void openBucket("needs-human")}
                    className={`cursor-pointer border-t border-red-900/40 bg-red-950/20 transition hover:bg-red-950/30 ${selected === "needs-human" ? "bg-red-950/40" : ""}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-red-400">needs-human</span>
                      <div className="text-[11px] text-red-400/70">dead-letter (not editable)</div>
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-mono text-red-400">{dead}</td>
                    <td className="px-3 py-2" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                Items in {selected}{!itemsLoading && ` (${items.length})`}
              </h3>
              {!itemsLoading && items.length > 0 && (
                <div className="flex gap-1.5 text-[11px]">
                  {Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([sig, n]) => (
                    <span key={sig} className={`rounded px-1.5 py-0.5 ${chip(sig)}`}>{sig} {n}</span>
                  ))}
                </div>
              )}
              {!itemsLoading && hasAnything && (
                <div className="flex gap-1 rounded-lg border border-xyne-border p-0.5 text-[11px]">
                  {([
                    ["pending", `Pending ${counts.pending}`],
                    ["retrying", `Retrying ${counts.retrying}`],
                    ["done", `Done (30d) ${counts.done}`],
                    ["failed", `Failed (30d) ${counts.failed}`],
                  ] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setItemsTab(key)}
                      className={`rounded-md px-2 py-0.5 transition ${itemsTab === key ? "bg-xyne-surface-subtle text-xyne-fg-primary" : "text-xyne-fg-muted hover:text-xyne-fg-secondary"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setSelected(null)} title="Close"
                className="ml-auto rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary">
                ✕
              </button>
            </div>
            {itemsLoading ? (
              <Loading />
            ) : !hasAnything ? (
              <div className="rounded-xl border border-xyne-border bg-xyne-surface p-6 text-center text-[13px] text-xyne-fg-muted">Empty.</div>
            ) : tabRows.length === 0 ? (
              <div className="rounded-xl border border-xyne-border bg-xyne-surface p-6 text-center text-[13px] text-xyne-fg-muted">Nothing in {itemsTab}.</div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto overflow-x-auto rounded-xl border border-xyne-border">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                      <th className="w-24 px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Error</th>
                      <th className="w-32 px-3 py-2 font-medium">Routed by</th>
                      <th className="w-28 px-3 py-2 font-medium">Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.errorKey} onClick={() => setDetail({ ...(row.item ? { item: row.item } : {}), ...(row.fix ? { fix: row.fix } : {}) })}
                        className="cursor-pointer border-b border-xyne-border-subtle align-top transition hover:bg-xyne-surface-subtle/50">
                        <td className="whitespace-nowrap px-3 py-2 text-[11px] text-xyne-fg-muted">
                          {new Date(row.timeMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2">
                          <div className="line-clamp-2 break-words font-mono text-[11px] text-xyne-fg-secondary">{row.message}</div>
                          <div className="mt-1 font-mono text-[10px] text-xyne-fg-muted">{row.errorKey}</div>
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          {row.signal
                            ? <span className={`rounded px-1.5 py-0.5 ${chip(row.signal)}`}>{row.signal}</span>
                            : <span className="text-[11px] text-xyne-fg-muted">—</span>}
                        </td>
                        <td className="px-3 py-2"><AgentStatusChip {...(row.fix ? { status: row.fix.status } : {})} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tabRows.length > visibleRows.length && (
                  <button onClick={() => setItemsShown((n) => n + 100)}
                    className="w-full border-t border-xyne-border bg-xyne-surface-subtle/40 py-2 text-[12px] text-xyne-fg-secondary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary">
                    Show more · {visibleRows.length} of {tabRows.length}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

      </div>

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
        title={detail?.fix?.status === "running" ? "Error — agent working…" : "Error detail"}
        maxWidth={820}
      >
        {detail && (
          <div className="space-y-5">
            <section>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Error log</h4>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3 font-mono text-[11.5px] leading-relaxed text-xyne-fg-secondary">
                {detail.item?.error.message ?? detail.fix?.message ?? ""}
              </pre>
            </section>

            <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-3">
              <div><span className="text-xyne-fg-tertiary">Lane</span><div className="text-xyne-fg-primary">{detail.item?.classification.bucket ?? detail.fix?.bucket}</div></div>
              {detail.item && (
                <div><span className="text-xyne-fg-tertiary">Routed by</span><div><span className={`rounded px-1.5 py-0.5 text-[11px] ${chip(detail.item.classification.signal)}`}>{detail.item.classification.signal}</span> <span className="text-xyne-fg-muted">{detail.item.classification.reason.replace(/^(rule|default):/, "")}</span></div></div>
              )}
              {detail.item?.error.sampleRequestId && (
                <div><span className="text-xyne-fg-tertiary">Request ID</span><div className="break-all font-mono text-[11px] text-xyne-fg-secondary">{detail.item.error.sampleRequestId}</div></div>
              )}
              <div><span className="text-xyne-fg-tertiary">Error key</span><div className="font-mono text-[11px] text-xyne-fg-secondary">{detail.item?.errorKey ?? detail.fix?.errorKey}</div></div>
              {detail.item && (
                <div><span className="text-xyne-fg-tertiary">Queued</span><div className="text-xyne-fg-secondary">{new Date(detail.item.enqueuedAt).toLocaleString()}</div></div>
              )}
              {detail.fix?.sessionId && (
                <div><span className="text-xyne-fg-tertiary">Agent session</span><div className="break-all font-mono text-[11px] text-xyne-fg-secondary">{detail.fix.sessionId}</div></div>
              )}
            </section>

            <section>
              <div className="mb-1.5 flex items-center gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Agent response</h4>
                <AgentStatusChip {...(detail.fix ? { status: detail.fix.status } : {})} />
                {detail.fix && <span className="text-[10px] text-xyne-fg-muted">{new Date(detail.fix.updatedAt).toLocaleString()}</span>}
                {detail.fix?.conversationId && (
                  <button
                    onClick={() => navigate(`/v3/chat?agent=doctor-agent&conversation=${encodeURIComponent(detail.fix!.conversationId!)}`)}
                    className="ml-auto rounded-md border border-xyne-border px-2 py-0.5 text-[11px] text-sky-300 transition hover:bg-xyne-surface-subtle hover:text-sky-200">
                    Open chat ↗
                  </button>
                )}
              </div>
              {!detail.fix ? (
                <p className="rounded-lg border border-xyne-border bg-xyne-surface p-3 text-[12px] text-xyne-fg-muted">
                  No agent run for this error yet — it's waiting in the queue.
                </p>
              ) : detail.fix.status === "running" ? (
                <p className="flex items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface p-3 text-[12px] text-xyne-fg-muted">
                  <SpinnerGapIcon size={14} className="animate-spin" /> The agent is working on this error right now — check back shortly.
                </p>
              ) : detail.fix.summary ? (
                <div className="max-h-96 overflow-y-auto rounded-lg border border-xyne-border bg-xyne-surface p-4">
                  <AgentResponse>{detail.fix.summary}</AgentResponse>
                </div>
              ) : (
                <p className="rounded-lg border border-xyne-border bg-xyne-surface p-3 text-[12px] text-xyne-fg-muted">
                  The run finished but left no summary.
                </p>
              )}
            </section>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => { if (!open) setDraft(null); }}
        title={draft?.isNew ? "Add bucket" : `Edit bucket: ${draft?.name ?? ""}`}
        maxWidth={640}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)}
              className="rounded-lg border border-xyne-border px-3 py-1.5 text-[13px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle">Cancel</button>
            <button onClick={() => void saveDraft()} disabled={saving}
              className="rounded-lg bg-xyne-brand px-3 py-1.5 text-[13px] font-medium text-xyne-fg-inverse hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4">
            <p className="text-[12px] text-xyne-fg-muted">
              Buckets route errors by matching the message. First match by order wins; the classifier picks up changes within ~60s.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">
                <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Name</span>
                <input value={draft.name} disabled={!draft.isNew}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. billing"
                  className="mt-1 h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none disabled:opacity-60" />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Match order</span>
                <input type="number" value={draft.matchOrder}
                  onChange={(e) => setDraft({ ...draft, matchOrder: Number(e.target.value) })}
                  className="mt-1 h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none" />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Description</span>
              <input value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="one line: what belongs in this lane"
                className="mt-1 h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none" />
            </label>
            <div className="block">
              <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Keywords <span className="normal-case text-xyne-fg-muted">(route here if the message contains any of these — case-insensitive)</span></span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-xyne-border bg-xyne-surface p-2">
                {draft.keywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded bg-xyne-brand/15 px-1.5 py-0.5 text-[12px] text-xyne-brand">
                    {k}
                    <button onClick={() => removeKeyword(k)} className="text-xyne-brand/70 hover:text-xyne-brand">×</button>
                  </span>
                ))}
                <input
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKeyword(); }
                    else if (e.key === "Backspace" && !kwInput && draft.keywords.length) { const last = draft.keywords[draft.keywords.length - 1]; if (last) removeKeyword(last); }
                  }}
                  onBlur={addKeyword}
                  placeholder={draft.keywords.length ? "add another…" : "e.g. payment failed"}
                  className="min-w-[8rem] flex-1 bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none" />
              </div>
              <p className="mt-1 text-[10px] text-xyne-fg-muted">Type a phrase and press Enter. Matched literally — no regex needed.</p>
            </div>
            <div className="block">
              <button type="button" onClick={() => setAdvOpen((v) => !v)}
                className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary hover:text-xyne-fg-secondary">
                {advOpen ? "▾" : "▸"} Advanced: raw regex {draft.markers.trim() && !advOpen ? "(set)" : ""}
              </button>
              {advOpen && (
                <>
                  <textarea value={draft.markers} rows={4}
                    onChange={(e) => setDraft({ ...draft, markers: e.target.value })}
                    placeholder="[Ll]ite[Ll][Ll][Mm]|\\bVespa\\w*\\b"
                    className="mt-1 w-full rounded-lg border border-xyne-border bg-xyne-surface p-2 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none" />
                  <p className="mt-1 text-[10px] text-xyne-fg-muted">Case-sensitive regex, unioned with the keywords above. For power patterns (word boundaries, char classes).</p>
                </>
              )}
            </div>
            <label className="flex items-center gap-2 text-[13px] text-xyne-fg-secondary">
              <input type="checkbox" checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              Enabled <span className="text-xyne-fg-muted">(disabled lanes are skipped by the classifier but keep their rules)</span>
            </label>
            {saveError && <p className="text-[12px] text-xyne-error-fg">{saveError}</p>}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete bucket"
        description={deleteTarget ? `Delete the "${deleteTarget}" bucket and its rules? Errors that matched it will fall through to the next lane or default.` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
