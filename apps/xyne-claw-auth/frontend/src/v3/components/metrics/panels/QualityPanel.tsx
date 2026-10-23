/**
 * Quality tab: blind repeats and citation. Citation is a diagnostic, never a score: the denominator is
 * citeable results (a tool that cannot be cited shows "—"), the rate takes no status colour, and the
 * per-agent flags that inflate it sit beside it.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Copy, CircleDashed, Quote } from "lucide-react";
import {
  type CitationFlagRow,
  type CitationReflectionOutcome,
  type ExactCitationRow,
  type ToolRow,
  type ToolSignal,
  type ToolSortKey,
} from "../../../../lib/api";
import { loadTools, useCitations, useToolStatsBackfill, useTools } from "../../../hooks/useDeepMetrics";
import {
  BackfillAction,
  Chip,
  CoverageBanner,
  DataTable,
  DrillCount,
  EmptyCardRow,
  InlineBar,
  KpiStrip,
  KpiStripSkeleton,
  MetricsCard,
  PanelError,
  PanelMessage,
  PanelToolbar,
  RowsSkeleton,
  SAMPLE_FLOORS,
  StackedBar,
  TableSkeleton,
  ToggleField,
  ToolName,
  Unknown,
  VIZ,
  fmtInt,
  fmtPct,
  plural,
  ratio,
  statusFor,
  useMetricsParam,
  useMetricsParams,
  type Column,
  type Kpi,
  type PanelProps,
  type Segment,
} from "../MetricsPrimitives";
import { ToolDrawer, noteToolSortEcho, useNewToolSorts, useOpenTool, useSameWindow, useToolTableParams } from "./ToolsPanel";

const KPI_COLS = "grid-cols-1 @min-[480px]:grid-cols-2";
/** Most duplicate calls first (rate ranks 2-call tools above heavy repeaters); LEGACY_* is for backends without the `duplicates` / `uncited` keys. */
const DEFAULT_SORT: ToolSortKey = "duplicates";
const QUALITY_SORTS: ReadonlySet<string> = new Set<ToolSortKey>(["tool", "calls", "duplicates", "duplicateRate", "emptyRate", "citeRate", "uncited"]);
const LEGACY_DEFAULT_SORT: ToolSortKey = "duplicateRate";
const LEGACY_QUALITY_SORTS: ReadonlySet<string> = new Set<ToolSortKey>(["tool", "calls", "duplicateRate", "emptyRate", "citeRate"]);

function useQualityTable() {
  const newSorts = useNewToolSorts();
  const table = useToolTableParams(newSorts ? QUALITY_SORTS : LEGACY_QUALITY_SORTS, newSorts ? DEFAULT_SORT : LEGACY_DEFAULT_SORT);
  return { ...table, newSorts };
}

/** Reflection outcomes, best → worst, so the bar reads as a gradient. */
const OUTCOMES: ReadonlyArray<{ id: string; label: string; color: string; hint: string }> = [
  { id: "already_cited", label: "Cited unprompted", color: VIZ.accent, hint: "The answer already cited its sources." },
  { id: "fixed_after_nudge", label: "Cited after a nudge", color: VIZ.warning, hint: "Cited only once the reflection pass re-prompted the model." },
  { id: "still_uncited", label: "Still uncited after nudge", color: VIZ.danger, hint: "Had citeable sources and never cited them, even when re-prompted." },
  { id: "no_citeable_sources", label: "Nothing citeable", color: VIZ.neutralSoft, hint: "No tool returned anything that could be cited." },
  { id: "aborted", label: "Aborted", color: VIZ.neutral, hint: "The run ended before the reflection pass finished." },
];
const FLAGS_PREVIEW = 6;

function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id;
}

export function QualityPanel({ scope }: PanelProps): ReactElement {
  // The drawer sits outside the content so a deep link is not remounted when data lands; same request, one cache entry.
  const table = useQualityTable();
  const rows = useTools(scope, table.request).data?.rows;
  return (
    <>
      <QualityPanelContent scope={scope} />
      <ToolDrawer scope={scope} rows={rows} />
    </>
  );
}

function QualityPanelContent({ scope }: PanelProps): ReactElement {
  const [exactRaw, setExact] = useMetricsParam("exact");
  const exactWanted = exactRaw === "1";
  // Mirrors the server gate: an agent filter or <= 7 days.
  const exactAllowed = scope.agentSlugs.length > 0 || scope.days <= 7;

  const table = useQualityTable();
  const tools = useTools(scope, table.request);
  // An older backend ignores unknown sort keys; the echo flips the table to the rate-based keys.
  const echoed = tools.isPlaceholder ? undefined : tools.data;
  useEffect(() => {
    noteToolSortEcho(table.request.sort, echoed);
  }, [echoed, table.request.sort]);
  const patch = useMetricsParams();
  const tableRef = useRef<HTMLDivElement>(null);
  const exact = useCitations(scope, { exact: true }, { enabled: exactWanted && exactAllowed });
  // The exact answer also carries funnel, reflection and flags, so the plain request is only a fallback.
  const exactUsable = exactWanted && exactAllowed && exact.error === null;
  const plain = useCitations(scope, {}, { enabled: !exactUsable });
  const cites = exactUsable ? exact : plain;
  const backfill = useToolStatsBackfill(scope.userId);
  const sameWindow = useSameWindow(scope, tools);
  const openTool = useOpenTool();
  const [selectedTool] = useMetricsParam("tool");

  const exactByTool = useMemo(() => {
    const map = new Map<string, ExactCitationRow>();
    for (const row of exact.data?.exact ?? []) map.set(row.tool, row);
    return map;
  }, [exact.data]);
  const conversationScope = exactUsable && exact.data?.scope === "conversation" && exact.data.exact != null;

  const exactNote: ReactNode = !exactWanted ? null : !exactAllowed ? (
    <ScopeNote>
      Exact scope needs one agent selected or a range of 7 days or less — it joins every tool result to its whole
      conversation, which a 30-day workspace window cannot finish. Showing same-turn citations; pick an agent or switch to 7 days.
    </ScopeNote>
  ) : exact.error ? (
    <ScopeNote>
      {exact.errorStatus === 400 ? `The server refused exact scope: ${exact.error}.` : `Exact scope failed to load: ${exact.error}.`}{" "}
      Showing same-turn citations.
    </ScopeNote>
  ) : null;

  const toolbar = (
    <PanelToolbar
      controls={
        <ToggleField
          label="Exact citation scope (slower)"
          checked={exactWanted}
          onChange={(next) => setExact(next ? "1" : null, { replace: true })}
          hint="Off: a citation counts only if it lands in the same turn as the tool call. On: a later turn citing an earlier result counts too. Needs one agent or 7 days or less."
        />
      }
    >
      {exactUsable && !exact.data ? (
        <span>Computing conversation-scoped citations — the same-turn figures stay until they arrive.</span>
      ) : (
        <span>
          Citations counted in the{" "}
          <span className="font-medium text-xyne-fg-secondary">{conversationScope ? "whole conversation" : "same turn"}</span>
          {conversationScope ? "." : " — a later turn citing an earlier result is missed."}
        </span>
      )}
    </PanelToolbar>
  );

  const data = tools.data;

  if (tools.error && !data) return <PanelError error={tools.error} onRetry={tools.refetch} />;
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        {toolbar}
        <KpiStripSkeleton count={2} cols={KPI_COLS} />
        <div className="grid gap-5 min-[1100px]:grid-cols-2">
          <MetricsCard title="Citation funnel" loading skeleton={<RowsSkeleton rows={2} />} />
          <MetricsCard title="Citation flags" loading skeleton={<RowsSkeleton rows={2} />} />
        </div>
        <MetricsCard title="Per-tool quality" loading skeleton={<TableSkeleton rows={8} cols={6} />} />
      </div>
    );
  }

  const stale = tools.isPlaceholder && !sameWindow;
  const cov = data.coverage;
  const banner = (
    <CoverageBanner
      coverage={cov.coverage}
      covered={cov.runsSummarised}
      total={cov.runsInWindow}
      verb="have tool stats"
      action={<BackfillAction isAdmin={scope.isAdmin} state={backfill} onRun={backfill.run} />}
    />
  );

  const t = data.totals;
  if (t.calls === 0) {
    return (
      <div className="flex flex-col gap-5">
        {banner}
        {toolbar}
        {exactNote}
        <PanelMessage
          title="No tool calls in this window"
          detail="Quality signals come from tool calls summarised when a run completes. Widen the range or clear the agent filter."
        />
      </div>
    );
  }

  const exactRows = conversationScope ? (exact.data?.exact ?? []) : null;
  const funnel = exactRows
    ? exactRows.reduce((acc, r) => ({ citeable: acc.citeable + r.citeableCalls, cited: acc.cited + r.citedCalls }), { citeable: 0, cited: 0 })
    : (cites.data?.funnel ?? { citeable: t.citeable, cited: t.cited });
  const citeRate = ratio(funnel.cited, funnel.citeable);
  const duplicateRate = ratio(t.duplicates, t.calls);
  const scopeLabel = conversationScope ? "conversation" : "same turn";

  // Window-wide numbers have no single tool: open the tool with the most duplicates (the table's own row 1
  // when it shows exactly that, else a limit=1 request; older backends scan 200 rows by rate).
  const drillDuplicates = (): void => {
    const pick = (rows: ToolRow[]): void => {
      const top = rows.reduce<ToolRow | null>((best, r) => (r.duplicates > (best?.duplicates ?? 0) ? r : best), null);
      if (top) openTool(top.tool, "duplicates");
    };
    const req = table.request;
    if (table.newSorts && req.sort === "duplicates" && req.dir === "desc" && req.offset === 0 && !req.search && !tools.isPlaceholder) {
      pick(data.rows.slice(0, 1));
      return;
    }
    const legacy = (): Promise<void> =>
      loadTools(scope, { sort: "duplicateRate", dir: "desc", limit: 200 }).then((res) => pick(res.rows));
    const run = table.newSorts
      ? loadTools(scope, { sort: "duplicates", dir: "desc", limit: 1 }).then((res) =>
          noteToolSortEcho("duplicates", res) ? pick(res.rows) : legacy(),
        )
      : legacy();
    run.catch(() => undefined);
  };

  // Uncited: sort the table by it and scroll there; older backends open the tool with the most uncited results.
  const drillUncited = (): void => {
    if (table.newSorts) {
      patch({ sort: "uncited", dir: "desc", page: null }, { replace: true });
      requestAnimationFrame(() => tableRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
      return;
    }
    loadTools(scope, { sort: "citeRate", dir: "asc", limit: 200 })
      .then((res) => {
        const top = res.rows.reduce<ToolRow | null>((best, r) => (r.citeable - r.cited > (best ? best.citeable - best.cited : 0) ? r : best), null);
        if (top) openTool(top.tool, "calls");
      })
      .catch(() => undefined);
  };

  const kpis: Kpi[] = [
    {
      key: "duplicates",
      label: "Duplicate-call rate",
      icon: Copy,
      hint: "Repeat calls with identical arguments inside one run — the model retrying without changing anything.",
      value: t.duplicates === 0 ? "0" : fmtPct(duplicateRate),
      status: statusFor("toolDuplicate", duplicateRate, t.calls),
      n: t.calls,
      nLabel: "tool calls",
      floor: SAMPLE_FLOORS.rate,
      line:
        t.duplicates > 0 ? (
          <>
            <DrillCount
              variant="inline"
              value={t.duplicates}
              onClick={drillDuplicates}
              title="Open the tool with the most duplicate calls, at its duplicate sessions"
            />{" "}
            of {fmtInt(t.calls)} calls repeated identical arguments in the same run
          </>
        ) : (
          `No identical repeats in ${fmtInt(t.calls)} calls`
        ),
    },
    {
      key: "cite",
      label: "Cite rate",
      icon: Quote,
      hint: "Cited ÷ citeable tool results. A diagnostic, not a quality score — compare agents only when their citation flags match.",
      badge: <Chip className="ml-1 h-[18px] px-1.5 text-[10px] normal-case tracking-normal">{scopeLabel}</Chip>,
      value: fmtPct(citeRate),
      status: citeRate == null ? "na" : statusFor("citeRate", citeRate, funnel.citeable),
      n: funnel.citeable,
      nLabel: "citeable results",
      floor: SAMPLE_FLOORS.rate,
      naWhy: "Nothing citeable in this window — there is no denominator",
      line:
        citeRate == null
          ? "No tool returned anything citeable"
          : `${fmtInt(funnel.cited)} of ${fmtInt(funnel.citeable)} citeable results were cited`,
    },
  ];

  const reflection = cites.data?.reflection ?? [];
  const reflectionTotal = reflection.reduce((a, r) => a + r.runs, 0);
  const citesLoading = cites.data === undefined && cites.loading;

  return (
    <div className="flex flex-col gap-5">
      {banner}
      {toolbar}
      {exactNote}
      <KpiStrip items={kpis} cols={KPI_COLS} busy={stale} />

      <div className="@container">
        <div className="grid items-start gap-5 @min-[880px]:grid-cols-2">
          <MetricsCard
            title="Citation funnel"
            subtitle="Of the tool results that could be cited, how many the answer cited."
            action={<Chip>{scopeLabel}</Chip>}
            loading={citesLoading}
            skeleton={<RowsSkeleton rows={2} />}
            busy={stale || cites.isPlaceholder}
          >
            <CitationFunnel
              calls={t.calls}
              citeable={funnel.citeable}
              cited={funnel.cited}
              onUncited={drillUncited}
              uncitedTitle={
                table.newSorts
                  ? "Rank the per-tool table by uncited results"
                  : "Open the tool with the most uncited results, at the sessions that called it"
              }
            />
          </MetricsCard>
          <MetricsCard
            title="Citation flags"
            subtitle="Cite rate is only comparable between agents with the same flags — reflection inflates it."
            loading={citesLoading}
            skeleton={<RowsSkeleton rows={2} />}
            busy={cites.isPlaceholder}
          >
            {cites.error && !cites.data ? (
              <PanelError error={cites.error} onRetry={cites.refetch} />
            ) : (
              <CitationFlags rows={cites.data?.flags ?? []} />
            )}
          </MetricsCard>
        </div>
      </div>

      {cites.data &&
        (reflectionTotal === 0 ? (
          <EmptyCardRow title="Citation reflection" message="no runs went through the reflection pass in this window." />
        ) : (
          <MetricsCard
            title="Citation reflection"
            subtitle="Runs that went through the reflection pass. A large “after a nudge” share means the nudge, not the agent, is producing the cite rate."
            busy={cites.isPlaceholder}
          >
            <ReflectionOutcomes rows={reflection} total={reflectionTotal} />
          </MetricsCard>
        ))}

      <div ref={tableRef} style={{ scrollMarginTop: "calc(var(--metrics-sticky-offset, 0px) + 12px)" }}>
        <MetricsCard
          title="Per-tool quality"
          subtitle={`${table.request.sort === "uncited" ? "Most uncited citeable results first" : "Most repeated calls first"}. Click a number for the sessions behind it, or a row for the tool.`}
          busy={stale}
        >
          <DataTable
            rows={data.rows}
            columns={qualityColumns({ exact: conversationScope ? exactByTool : null, totals: t, open: openTool, newSorts: table.newSorts })}
            rowKey={(r) => r.tool}
            rowTitle={(r) => `Open ${r.tool}`}
            onRowClick={(r) => openTool(r.tool)}
            rowStatus={(r) => statusFor("toolDuplicate", r.duplicateRate, r.calls, { row: true })}
            selectedKey={selectedTool}
            busy={(tools.isPlaceholder || tools.loading) && !stale}
            minWidth={720}
            maxHeight={640}
            emptyMessage={table.controls.search ? `No tools match "${table.controls.search}".` : "No tools in this window."}
            server={{ ...table.controls, total: data.page.total, searchPlaceholder: "Filter tools by name…", unit: "tools" }}
            footnote={
              conversationScope
                ? "Cite rate shows the exact conversation-scoped figure; sorting by it still orders by the same-turn rate the server ranks on."
                : "“—” in Cite rate means nothing the tool returned was citeable — not that it failed."
            }
          />
        </MetricsCard>
      </div>
    </div>
  );
}

function ScopeNote({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-xyne-neutral-border bg-xyne-neutral-bg px-4 py-2.5 text-[12px] leading-relaxed text-xyne-neutral-fg"
    >
      <CircleDashed size={14} className="mt-px shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

function qualityColumns({
  exact,
  totals,
  open,
  newSorts,
}: {
  exact: Map<string, ExactCitationRow> | null;
  totals: { duplicates: number; empty: number; citeable: number };
  open: (tool: string, signal?: ToolSignal | null) => void;
  newSorts: boolean;
}): Array<Column<ToolRow>> {
  const cite = (r: ToolRow): { citeable: number; cited: number; rate: number | null } => {
    const e = exact?.get(r.tool);
    return e ? { citeable: e.citeableCalls, cited: e.citedCalls, rate: e.citeRate } : { citeable: r.citeable, cited: r.cited, rate: r.citeRate };
  };
  return [
    {
      key: "tool",
      header: "Tool",
      sortKey: "tool",
      render: (r) => <ToolName name={r.tool} className="max-w-[260px]" />,
    },
    {
      key: "calls",
      header: "Calls",
      numeric: true,
      sortKey: "calls",
      render: (r) => <DrillCount value={r.calls} onClick={() => open(r.tool, "calls")} title={`Show the sessions that called ${r.tool}`} />,
    },
    {
      key: "duplicates",
      header: "Duplicates",
      numeric: true,
      sortKey: newSorts ? "duplicates" : "duplicateRate",
      hint: `Share of calls repeating identical arguments in the same run, and the count. Sorts by ${newSorts ? "count" : "rate"}.`,
      windowTotal: totals.duplicates,
      render: (r) => {
        if (r.duplicates === 0) return <span className="font-normal text-xyne-fg-muted">0</span>;
        return (
          <span className="inline-flex items-center justify-end gap-1">
            <DrillCount
              value={r.duplicates}
              status={statusFor("toolDuplicate", r.duplicateRate, r.calls, { row: true })}
              onClick={() => open(r.tool, "duplicates")}
              title={`Show the ${fmtInt(r.sessions.duplicated)} ${plural(r.sessions.duplicated, "session")} where ${r.tool} repeated itself`}
            >
              {fmtPct(r.duplicateRate)}
            </DrillCount>
            <span className="min-w-[32px] text-right text-[12px] text-xyne-fg-muted">{fmtInt(r.duplicates)}</span>
          </span>
        );
      },
    },
    {
      key: "empty",
      header: "Empty",
      numeric: true,
      sortKey: "emptyRate",
      hint: "Calls that succeeded but returned nothing. Sorts by rate.",
      hiddenLabel: "Empty results",
      windowTotal: totals.empty,
      render: (r) => (
        <DrillCount value={r.empty} onClick={() => open(r.tool, "empty")} title={`${fmtPct(r.emptyRate)} of calls returned nothing — show the sessions`} />
      ),
    },
    {
      key: "cite",
      header: "Cite rate",
      numeric: true,
      sortKey: "citeRate",
      hint: "Cited ÷ citeable results, never judged. “—” means nothing this tool returned could be cited.",
      windowTotal: totals.citeable,
      hiddenLabel: "Cite rate",
      render: (r) => {
        const c = cite(r);
        if (c.rate == null) return <Unknown why="Nothing this tool returned was citeable — no denominator" />;
        if (c.cited === 0) {
          return (
            <span className="inline-flex items-center justify-end gap-1.5 text-xyne-fg-muted" title="Never cited — no sessions to open">
              <span>0</span>
              <span className="min-w-[44px] text-right text-[12px]">0/{fmtInt(c.citeable)}</span>
            </span>
          );
        }
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span className="text-xyne-fg-primary">{fmtPct(c.rate)}</span>
            <DrillCount value={c.cited} onClick={() => open(r.tool, "cited")} title={`Show the sessions where ${r.tool} was cited`} className="text-[12px] text-xyne-fg-muted">
              {fmtInt(c.cited)}/{fmtInt(c.citeable)}
            </DrillCount>
          </span>
        );
      },
    },
    {
      key: "uncited",
      header: "Uncited citeable",
      numeric: true,
      sortKey: newSorts ? "uncited" : undefined,
      hint: "Citeable results the answer never cited",
      windowTotal: totals.citeable,
      hiddenLabel: "Uncited citeable",
      render: (r) => {
        const c = cite(r);
        if (c.citeable === 0) return <Unknown why="Nothing citeable" />;
        const uncited = Math.max(0, c.citeable - c.cited);
        return uncited === 0 ? <span className="font-normal text-xyne-fg-muted">0</span> : fmtInt(uncited);
      },
    },
  ];
}

function CitationFunnel({
  calls,
  citeable,
  cited,
  onUncited,
  uncitedTitle,
}: {
  calls: number;
  citeable: number;
  cited: number;
  onUncited: () => void;
  uncitedTitle: string;
}): ReactElement {
  if (citeable === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-xyne-fg-muted">
        Nothing citeable in this window — tools that return documents or search results populate this.
      </p>
    );
  }
  const uncited = Math.max(0, citeable - cited);
  const steps = [
    { label: "Returned citeable output", value: citeable, share: 1, color: VIZ.neutralSoft },
    { label: "Cited in the answer", value: cited, share: cited / citeable, color: VIZ.accent },
  ];
  return (
    <div className="flex flex-col gap-3">
      {steps.map((step) => (
        <div key={step.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-xyne-fg-secondary">{step.label}</span>
            <span className="tabular-nums">
              <span className="font-semibold text-xyne-fg-primary">{fmtInt(step.value)}</span>{" "}
              <span className="text-xyne-fg-muted">{fmtPct(step.share)}</span>
            </span>
          </div>
          <InlineBar value={step.share} color={step.color} width="100%" />
        </div>
      ))}
      <p className="text-[12px] text-xyne-fg-secondary">
        <DrillCount variant="inline" value={uncited} onClick={onUncited} title={uncitedTitle} /> of {fmtInt(citeable)} citeable
        results were not cited.
      </p>
      <p className="text-[11px] leading-relaxed text-xyne-fg-muted">
        {fmtInt(citeable)} of {fmtInt(calls)} tool calls ({fmtPct(citeable / calls)}) returned something citeable.
      </p>
    </div>
  );
}

function ReflectionOutcomes({ rows, total }: { rows: CitationReflectionOutcome[]; total: number }): ReactElement {
  const byId = new Map(rows.map((r) => [r.outcome, r]));
  const known = new Set(OUTCOMES.map((o) => o.id));
  const segments: Segment[] = OUTCOMES.filter((o) => (byId.get(o.id)?.runs ?? 0) > 0).map((o) => ({
    key: o.id,
    label: o.label,
    value: byId.get(o.id)?.runs ?? 0,
    color: o.color,
    hint: o.hint,
  }));
  // Unknown outcomes are shown under their own name rather than dropped.
  const extra = [VIZ.neutral, VIZ.accentSoft, VIZ.neutralSoft];
  rows
    .filter((r) => !known.has(r.outcome) && r.runs > 0)
    .forEach((r, i) => segments.push({ key: r.outcome, label: humanize(r.outcome), value: r.runs, color: extra[i % extra.length]! }));
  return (
    <div className="max-w-[640px]">
      <StackedBar segments={segments} format={(n) => fmtInt(n)} ariaLabel={`Citation reflection outcomes across ${fmtInt(total)} ${plural(total, "run")}`} />
    </div>
  );
}

/** A sentence plus the exceptions: most agents carry neither flag. */
function CitationFlags({ rows }: { rows: CitationFlagRow[] }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return <p className="py-4 text-[13px] text-xyne-fg-muted">No agents ran in this window.</p>;
  const auto = rows.filter((r) => r.autoToolCitations);
  const reflection = rows.filter((r) => r.citationReflection);
  const flagged = [...rows]
    .filter((r) => r.autoToolCitations || r.citationReflection)
    .sort((a, b) => a.agentSlug.localeCompare(b.agentSlug) || a.orgId.localeCompare(b.orgId));
  // Slugs are unique per org only: show the org beside a repeated slug.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.agentSlug, (counts.get(r.agentSlug) ?? 0) + 1);
  const name = (r: CitationFlagRow): string => ((counts.get(r.agentSlug) ?? 0) > 1 ? `${r.agentSlug} (${r.orgId.slice(0, 6)})` : r.agentSlug);
  // A short roster with no flags is listed whole.
  const all = showAll || (flagged.length === 0 && rows.length <= FLAGS_PREVIEW);
  const list = all ? [...rows].sort((a, b) => a.agentSlug.localeCompare(b.agentSlug)) : flagged.slice(0, FLAGS_PREVIEW);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-xyne-fg-primary">
        <span className="font-semibold tabular-nums">{fmtInt(auto.length)}</span> of {fmtInt(rows.length)}{" "}
        {plural(rows.length, "agent")} {auto.length === 1 ? "auto-cites" : "auto-cite"} tool results ·{" "}
        <span className="font-semibold tabular-nums">{fmtInt(reflection.length)}</span>{" "}
        {reflection.length === 1 ? "re-prompts" : "re-prompt"} until cited
        {reflection.length > 0 && reflection.length <= 3 && (
          <span className="text-xyne-fg-muted"> ({reflection.map(name).join(", ")})</span>
        )}
        .
      </p>
      {list.length > 0 && (
        <ul className="flex flex-col">
          {list.map((r) => (
            <li key={`${r.orgId}\u0000${r.agentSlug}`} className="flex min-h-[30px] items-center gap-2 border-t border-xyne-border-subtle text-[12px]">
              <span className="min-w-0 flex-1 truncate font-mono text-xyne-fg-primary" title={r.agentSlug}>
                {name(r)}
              </span>
              {r.autoToolCitations && <Chip tone="neutral">auto-cite</Chip>}
              {r.citationReflection && <Chip tone="neutral">reflection</Chip>}
              {!r.autoToolCitations && !r.citationReflection && <span className="text-[11px] text-xyne-fg-muted">no flags</span>}
            </li>
          ))}
        </ul>
      )}
      {(rows.length > list.length || showAll) && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          {showAll ? "Show flagged agents only" : `Show all ${fmtInt(rows.length)} agents`}
        </button>
      )}
    </div>
  );
}
