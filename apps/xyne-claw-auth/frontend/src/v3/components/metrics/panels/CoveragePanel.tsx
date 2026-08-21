/**
 * Palette and schema hygiene: granted tools never called, and declared tool
 * parameters the model never supplies.
 *
 * Both are surface bloat that degrades tool selection without ever appearing in
 * a latency chart — an agent with 40 granted tools it never uses is choosing
 * from a worse menu on every turn.
 *
 * ── Reading order ─────────────────────────────────────────────────────────
 * Agents first, tools second. "Which agent has the loosest palette" is the
 * question this panel answers, and it is answerable only from a listing of
 * EVERY analysed agent — a list of unused grants alone cannot distinguish an
 * agent with a tight palette from one that never ran.
 *
 * Unscoped agents (no `tools` config) are listed but never scored: everything
 * is allowed for them, so "unused" is undefined rather than zero.
 *
 * The argument section renders each tool as indented JSON rather than a table,
 * because it IS the tool's inputSchema — see ToolSchemaView.
 */

import { useMemo, useState, type ReactElement } from "react";
import type {
  AgentToolCoverageRow,
  ToolCoverageMetrics,
  UnusedGrantRow,
} from "../../../../lib/api";
import {
  MetricsCard,
  PanelError,
  PanelMessage,
  ShareBar,
  SortableTable,
  StatTile,
  type Column,
} from "../MetricsPrimitives";
import { STATUS, rateTone } from "../metricsPalette";
import { ToolSchemaView } from "../ToolSchemaView";
import { formatCount, formatOptionalPct } from "../metricsFormat";

const GRANT_LABEL: Record<string, string> = {
  subagents: "Subagent",
  direct: "Direct pick",
  custom: "Custom tool",
  gateway: "Gateway",
};

const MAX_SCHEMAS = 12;

export function CoveragePanel({
  data,
  loading,
  error,
  toolFilter,
}: {
  data: ToolCoverageMetrics | undefined;
  loading: boolean;
  error: string | null;
  /** Empty = every tool. Applied here rather than server-side; rows are per-tool. */
  toolFilter: readonly string[];
}): ReactElement {
  // Which agent's grants are expanded. Null = the summary table only.
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [showAllSchemas, setShowAllSchemas] = useState(false);

  const agents = useMemo(() => data?.deadTools.agents ?? [], [data]);

  const grantsByAgent = useMemo(() => {
    const map = new Map<string, UnusedGrantRow[]>();
    for (const grant of data?.deadTools.unusedGrants ?? []) {
      const list = map.get(grant.agentSlug);
      if (list) list.push(grant);
      else map.set(grant.agentSlug, [grant]);
    }
    return map;
  }, [data]);

  const argRows = useMemo(() => {
    const wanted = new Set(toolFilter);
    return [...(data?.argUsage ?? [])]
      .filter((r) => wanted.size === 0 || wanted.has(r.tool))
      .sort((a, b) => b.calls - a.calls);
  }, [data, toolFilter]);

  const schemaCoverage = useMemo(
    () => ({
      covered: argRows.filter((r) => r.schemaCovered).length,
      total: argRows.length,
      deadFields: argRows.reduce((a, r) => a + r.deadFields.length, 0),
      undeclared: argRows.reduce((a, r) => a + r.undeclaredFields.length, 0),
    }),
    [argRows],
  );

  if (error) return <PanelError error={error} />;
  if (loading && !data) return <PanelMessage title="Loading coverage…" />;
  if (!data) return <PanelMessage title="No coverage data in this window" />;

  const totalUnused = data.deadTools.unusedGrants.length;
  const scopedAgents = agents.filter((a) => a.scoped);
  const cleanAgents = scopedAgents.filter((a) => (a.unused ?? 0) === 0).length;

  const columns: Array<Column<AgentToolCoverageRow>> = [
    {
      key: "agentSlug",
      header: "Agent",
      sortValue: (r) => r.agentSlug,
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-mono text-[12px] font-medium text-xyne-fg-primary">
            {r.agentSlug}
          </span>
          {!r.scoped && (
            <span className="text-[11px] text-xyne-fg-muted">
              no tools config — every tool allowed
            </span>
          )}
        </div>
      ),
    },
    {
      key: "granted",
      header: "Granted",
      numeric: true,
      sortValue: (r) => r.granted,
      hint: "Tools this agent is allowed to call",
      render: (r) =>
        r.granted === null ? <span className="text-xyne-fg-muted">n/a</span> : formatCount(r.granted),
    },
    {
      key: "used",
      header: "Used",
      numeric: true,
      sortValue: (r) => r.used,
      hint: "Granted tools it actually called in this window",
      render: (r) =>
        r.used === null ? <span className="text-xyne-fg-muted">n/a</span> : formatCount(r.used),
    },
    {
      key: "unused",
      header: "Unused",
      numeric: true,
      sortValue: (r) => r.unused,
      hint: "Granted and never called — the menu the model reads past on every turn",
      render: (r) => {
        if (r.unused === null) return <span className="text-xyne-fg-muted">n/a</span>;
        if (r.unused === 0) return <span className="text-xyne-fg-muted">—</span>;
        const tone = rateTone(1 - (r.usedShare ?? 1));
        return (
          <span style={tone ? { color: STATUS[tone] } : undefined}>{formatCount(r.unused)}</span>
        );
      },
    },
    {
      key: "usedShare",
      header: "Palette used",
      numeric: true,
      sortValue: (r) => r.usedShare,
      hint: "Share of granted tools exercised. n/a for agents with no tools config.",
      render: (r) =>
        r.usedShare === null ? (
          <span className="text-xyne-fg-muted">n/a</span>
        ) : (
          <div className="flex justify-end">
            <ShareBar
              share={r.usedShare}
              label={formatOptionalPct(r.usedShare)}
              emphasis={r.usedShare < 0.5}
            />
          </div>
        ),
    },
    {
      key: "observedTools",
      header: "Distinct tools called",
      numeric: true,
      sortValue: (r) => r.observedTools,
      render: (r) => formatCount(r.observedTools),
    },
    {
      key: "detail",
      header: "",
      render: (r) => {
        const grants = grantsByAgent.get(r.agentSlug) ?? [];
        if (grants.length === 0) return null;
        return (
          <button
            type="button"
            onClick={() => setOpenAgent((cur) => (cur === r.agentSlug ? null : r.agentSlug))}
            className="text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
          >
            {openAgent === r.agentSlug ? "Hide" : "View unused"}
          </button>
        );
      },
    },
  ];

  const openGrants = openAgent ? (grantsByAgent.get(openAgent) ?? []) : [];
  const visibleSchemas = showAllSchemas ? argRows : argRows.slice(0, MAX_SCHEMAS);

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Agents in window"
          value={formatCount(agents.length)}
          detail={
            data.deadTools.agentsUnscoped > 0
              ? `${data.deadTools.agentsUnscoped} unscoped · ${data.deadTools.agentsAnalysed} analysed`
              : `${data.deadTools.agentsAnalysed} analysed`
          }
          hint="An agent with no tools config allows everything, so it is listed but never scored."
        />
        <StatTile
          label="Unused grants"
          value={formatCount(totalUnused)}
          detail={`${cleanAgents} of ${scopedAgents.length} agents fully exercised`}
          tone={totalUnused > 0 ? "warning" : "good"}
          hint="Tools an agent is granted but never called in this window. Palette bloat degrades tool selection."
        />
        <StatTile
          label="Dead parameters"
          value={formatCount(schemaCoverage.deadFields)}
          detail="Declared but never supplied"
          tone={schemaCoverage.deadFields > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Schema coverage"
          value={`${schemaCoverage.covered}/${schemaCoverage.total}`}
          detail={
            schemaCoverage.undeclared > 0
              ? `${schemaCoverage.undeclared} undeclared field${schemaCoverage.undeclared === 1 ? "" : "s"}`
              : "Tools with a joinable declared schema"
          }
          hint="Only custom tools expose a schema that joins by name. For the rest, dead parameters are unknown rather than zero."
        />
      </div>

      <MetricsCard
        title="Agents and their tool palettes"
        description="Every agent that ran in this window. Sort by Unused or Palette used to find the loosest palette — that is the agent whose tool selection has the most noise to read past."
      >
        <SortableTable
          rows={agents}
          columns={columns}
          defaultSort="unused"
          rowKey={(r) => r.agentSlug}
          maxRows={15}
          emptyMessage="No agents ran in this window."
        />

        {openAgent && openGrants.length > 0 && (
          <div className="mt-4 rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken/50 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[12px] font-medium text-xyne-fg-primary">
                {openAgent}
              </span>
              <span className="text-[11px] tabular-nums text-xyne-fg-muted">
                {openGrants.length} granted, never called
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {openGrants.map((g) => (
                <span
                  key={`${g.kind}-${g.grant}`}
                  className="inline-flex items-center gap-1 rounded-full border border-xyne-border px-2 py-0.5 text-[11px] text-xyne-fg-muted"
                  title={`${GRANT_LABEL[g.kind] ?? g.kind} grant`}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: STATUS.warning }}
                  />
                  <span className="font-mono">{g.grant}</span>
                  <span className="opacity-60">{GRANT_LABEL[g.kind] ?? g.kind}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </MetricsCard>

      <MetricsCard
        title="Tool schemas and how the model fills them"
        description={
          data.argUsageTruncated
            ? `Each tool's inputSchema with the share of calls that supplied every field. Showing the ${data.argUsageLimit} most-called tools — narrow with the tool filter to reach the rest.`
            : "Each tool's inputSchema with the share of calls that supplied every field. A field at 0% is schema the model never uses; one it supplies but never declared is a schema gap."
        }
      >
        {argRows.length === 0 ? (
          <p className="py-6 text-[13px] text-xyne-fg-muted">
            {toolFilter.length > 0
              ? "No argument data for the selected tools in this window."
              : "No argument data in this window."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleSchemas.map((row) => (
              <ToolSchemaView key={row.tool} row={row} />
            ))}
            {argRows.length > MAX_SCHEMAS && (
              <button
                type="button"
                onClick={() => setShowAllSchemas((v) => !v)}
                className="self-start text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
              >
                {showAllSchemas
                  ? "Show less"
                  : `Show ${argRows.length - MAX_SCHEMAS} more tool${argRows.length - MAX_SCHEMAS === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        )}
      </MetricsCard>
    </div>
  );
}
