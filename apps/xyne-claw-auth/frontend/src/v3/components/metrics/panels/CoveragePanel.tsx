/**
 * Coverage tab: tools an agent is granted but never calls.
 * Open-palette and no-config agents allow every tool, and scoped agents whose grants the matcher cannot read
 * are labelled and left unscored.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { CircleDashed, PackageX, Users } from "lucide-react";
import type { AgentPaletteRow, UnusedGrant } from "../../../../lib/api";
import { useSummary, useToolStatsBackfill, useUnusedGrants } from "../../../hooks/useDeepMetrics";
import {
  BackfillAction,
  CoverageBanner,
  DataTable,
  DrillCount,
  InlineBar,
  KpiStrip,
  KpiStripSkeleton,
  MetricsCard,
  PanelError,
  PanelMessage,
  RowsSkeleton,
  StatusValue,
  TableSkeleton,
  Unknown,
  VIZ,
  ZeroCell,
  fmtInt,
  fmtPct,
  plural,
  ratio,
  splitToolName,
  statusFor,
  type Column,
  type Kpi,
  type PanelProps,
  type Status,
} from "../MetricsPrimitives";
import { cn } from "../../../../lib/utils";

const KPI_COLS = "grid-cols-2";
const GRANTS_SHOWN = 8;

const GRANT_KIND: Record<string, string> = {
  subagents: "subagent",
  direct: "direct",
  custom: "custom tool",
  gateway: "gateway",
};

const KIND_GROUP: Record<string, string> = {
  subagents: "Subagents",
  custom: "Custom tools",
  gateway: "Gateways",
};

export function CoveragePanel({ scope }: PanelProps): ReactElement {
  const grants = useUnusedGrants(scope);
  const summary = useSummary(scope);
  const backfill = useToolStatsBackfill(scope.userId);
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  const g = grants.data;
  const agents = useMemo(() => g?.agents ?? [], [g]);
  const ambiguous = useMemo(() => duplicateSlugs(agents), [agents]);
  const grantsByAgent = useMemo(() => groupGrants(g?.unusedGrants ?? []), [g]);

  if (grants.error && !g) return <PanelError error={grants.error} onRetry={grants.refetch} />;

  const current = summary.data?.current;
  const banner =
    current && current.runs > 0 ? (
      <CoverageBanner
        coverage={ratio(current.tools.runsSummarised, current.runs)}
        covered={current.tools.runsSummarised}
        total={current.runs}
        verb="have tool stats"
        detail="Unused grants only see runs with tool stats."
        action={<BackfillAction isAdmin={scope.isAdmin} state={backfill} onRun={backfill.run} />}
      />
    ) : null;

  if (g && agents.length === 0) {
    return (
      <PanelMessage
        title="No agents ran in this window"
        detail="Coverage compares each agent's granted tools with the tools its runs called, so it needs runs in the window. Widen the range or clear the agent filter."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {banner}
      {g ? (
        <KpiStrip items={coverageKpis(agents, g.unusedGrants.length)} cols={KPI_COLS} busy={grants.isPlaceholder} />
      ) : (
        <KpiStripSkeleton count={2} cols={KPI_COLS} />
      )}

      <MetricsCard
        title="Agents and their tool palettes"
        subtitle="Every agent that ran in this window, loosest palette first. Click an Unused count to list those tools."
        loading={!g}
        busy={grants.loading && !!g}
        skeleton={<TableSkeleton rows={6} cols={5} />}
      >
        <DataTable
          rows={agents}
          columns={agentColumns(ambiguous, (key) => setOpenAgent((cur) => (cur === key ? null : key)))}
          rowKey={agentKey}
          initialSort={{ key: "unused", dir: "desc" }}
          selectedKey={openAgent}
          maxRows={15}
          maxHeight={600}
          minWidth={540}
          emptyMessage="No agents ran in this window."
          rowStatus={(r) => grantStatus(r)}
          mergeCells={(r) => {
            const content = paletteNote(r);
            return content ? { from: "granted", span: 3, content } : null;
          }}
        />
      </MetricsCard>

      <MetricsCard
        title="Unused grants by agent"
        subtitle="Granted, never called in this window, grouped by server. Each is a candidate to drop from the agent's palette."
        loading={!g}
        busy={grants.loading && !!g}
        skeleton={<RowsSkeleton rows={3} />}
      >
        {grantsByAgent.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-xyne-fg-muted">
            {agents.some(isScored)
              ? "No unused grants: every scored agent called each tool it was granted."
              : "No agent in this window has a grant list to compare: open-palette and unconfigured agents allow every tool."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-xyne-border-subtle">
            {grantsByAgent.map((group) => (
              <UnusedGrantGroup
                key={group.key}
                group={group}
                granted={agents.find((r) => agentKey(r) === group.key)?.granted ?? null}
                showOrg={ambiguous.has(group.agentSlug)}
                focused={openAgent === group.key}
              />
            ))}
          </ul>
        )}
      </MetricsCard>
    </div>
  );
}


function coverageKpis(agents: AgentPaletteRow[], unusedTotal: number): Kpi[] {
  const open = agents.filter((r) => r.state === "open-palette").length;
  const unscoped = agents.filter((r) => r.state === "unscoped").length;
  const scored = agents.filter(isScored);
  const unknown = agents.filter(grantsUnknown).length;
  const worst = scored
    .filter((r) => (r.granted ?? 0) > 0)
    .sort((x, y) => (x.usedShare ?? 1) - (y.usedShare ?? 1) || (y.unused ?? 0) - (x.unused ?? 0))[0];
  const worstStatus_ = worst ? grantStatus(worst) : undefined;
  const agentLine = [
    `${fmtInt(scored.length)} scored`,
    unknown > 0 ? `${fmtInt(unknown)} grants unknown` : null,
    open > 0 ? `${fmtInt(open)} open palette` : null,
    unscoped > 0 ? `${fmtInt(unscoped)} no tools config` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    {
      key: "agents",
      label: "Agents in window",
      icon: Users,
      value: fmtInt(agents.length),
      line: agentLine,
      hint: "Agents with runs in the window. Open-palette agents and agents without a tools config allow every tool, so they are listed but never scored for unused grants.",
    },
    {
      key: "unused",
      label: "Unused grants",
      icon: PackageX,
      value: unusedTotal === 0 ? <ZeroCell /> : fmtInt(unusedTotal),
      status: scored.length === 0 ? "na" : unusedTotal === 0 || worstStatus_ === "thin" ? undefined : worstStatus_,
      naWhy: "No agent in this window has a grant list to compare against",
      line:
        scored.length === 0
          ? "no agent here has a grant list to score"
          : worst && (worst.unused ?? 0) > 0
            ? `loosest: ${worst.agentSlug} used ${fmtInt(worst.used)} of ${fmtInt(worst.granted)}`
            : "every scored agent used its grants",
      hint: "Tools an agent is granted but never called in this window. The status is the loosest agent's share of grants used (judged with 10+ grants).",
    },
  ];
}


function agentKey(r: { orgId: string; agentSlug: string }): string {
  return `${r.orgId}\u0000${r.agentSlug}`;
}

function duplicateSlugs(rows: ReadonlyArray<{ orgId: string; agentSlug: string }>): Set<string> {
  const orgsBySlug = new Map<string, Set<string>>();
  for (const r of rows) {
    const orgs = orgsBySlug.get(r.agentSlug) ?? new Set<string>();
    orgs.add(r.orgId);
    orgsBySlug.set(r.agentSlug, orgs);
  }
  return new Set([...orgsBySlug].filter(([, orgs]) => orgs.size > 1).map(([slug]) => slug));
}

/** Scoped, no readable grants, yet tools were called: "granted nothing" would be false, so it is unscored. */
function grantsUnknown(r: AgentPaletteRow): boolean {
  return r.state === "scoped" && (r.granted ?? 0) === 0 && r.observedTools > 0;
}

function isScored(r: AgentPaletteRow): boolean {
  return r.state === "scoped" && !grantsUnknown(r);
}

function grantStatus(r: AgentPaletteRow): Status {
  if (!isScored(r) || !r.granted) return "na";
  return statusFor("grantUse", r.usedShare, r.granted);
}

/** Merged Granted..Used share cell for unscorable rows; null for a normal row. */
function paletteNote(r: AgentPaletteRow): ReactNode | null {
  if (r.state === "open-palette") {
    const mode = r.openPalette ?? "all";
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-xyne-fg-secondary" title="tools.openPalette is set: the agent may call any tool, so there is no grant list to compare against.">
        <span className="font-medium">Open palette ({mode})</span>
        <span className="text-xyne-fg-muted">— every {mode === "read" ? "read-only " : ""}tool allowed, nothing to score</span>
      </span>
    );
  }
  if (r.state === "unscoped") {
    return (
      <span className="text-[12px] text-xyne-fg-muted" title="The agent has no tools config at all, which allows every tool.">
        No tools config — every tool allowed, nothing to score
      </span>
    );
  }
  if (grantsUnknown(r)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-xyne-fg-muted" title="The config lists no grants the matcher can read, yet the runs called tools. Not scored until the grants are readable.">
        <CircleDashed size={12} className="shrink-0" aria-hidden />
        Grants unknown — called {fmtInt(r.observedTools)} {plural(r.observedTools, "tool")} not in its config
      </span>
    );
  }
  if ((r.granted ?? 0) === 0) {
    return <span className="text-[12px] text-xyne-fg-muted">Granted nothing, called nothing</span>;
  }
  return null;
}

function agentColumns(ambiguous: Set<string>, onUnused: (key: string) => void): Array<Column<AgentPaletteRow>> {
  return [
    {
      key: "agent",
      header: "Agent",
      sortValue: (r) => r.agentSlug,
      render: (r) => (
        <span className="flex min-w-0 flex-col" title={`${r.agentSlug} · org ${r.orgId}`}>
          <span className="block max-w-[240px] truncate font-mono text-[12px] font-medium">{r.agentSlug}</span>
          {ambiguous.has(r.agentSlug) && <span className="truncate text-[11px] text-xyne-fg-muted">org {r.orgId}</span>}
        </span>
      ),
    },
    {
      key: "observed",
      header: "Called",
      numeric: true,
      sortValue: (r) => r.observedTools,
      hint: "Distinct tools this agent's runs called in the window",
      render: (r) => (r.observedTools === 0 ? <ZeroCell /> : fmtInt(r.observedTools)),
    },
    {
      key: "granted",
      header: "Granted",
      numeric: true,
      sortValue: (r) => (isScored(r) ? r.granted : null),
      hint: "Tools this agent's config grants",
      render: (r) => (r.granted == null ? <Unknown why="No grant list" /> : fmtInt(r.granted)),
    },
    {
      key: "unused",
      header: "Unused",
      numeric: true,
      sortValue: (r) => (isScored(r) ? r.unused : null),
      defaultDir: "desc",
      hint: "Granted and never called — the menu the model reads past every turn. Click to list them.",
      render: (r) =>
        r.unused == null ? (
          <Unknown why="No grant list" />
        ) : (
          <DrillCount
            value={r.unused}
            status={grantStatus(r) === "thin" ? "ok" : grantStatus(r)}
            onClick={() => onUnused(agentKey(r))}
            title={`List the ${fmtInt(r.unused)} unused ${plural(r.unused, "grant")} of ${r.agentSlug}`}
          />
        ),
    },
    {
      key: "share",
      header: "Used share",
      numeric: true,
      sortValue: (r) => (isScored(r) ? r.usedShare : null),
      hint: "Granted tools called at least once ÷ granted tools. Judged once an agent has 10+ grants.",
      render: (r) => {
        if (r.usedShare == null) return <Unknown why="Nothing granted" />;
        const status = grantStatus(r);
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            <InlineBar value={r.usedShare} color={status === "bad" ? VIZ.danger : status === "warn" ? VIZ.warning : VIZ.neutralSoft} width={40} />
            <StatusValue status={status === "na" ? "ok" : status} n={r.granted ?? 0} noun="granted tools" floor={10} className="w-[52px] justify-end">
              {fmtPct(r.usedShare)}
            </StatusValue>
          </span>
        );
      },
    },
  ];
}


interface GrantServerGroup {
  label: string;
  grants: UnusedGrant[];
}

interface AgentGrants {
  key: string;
  agentSlug: string;
  orgId: string;
  total: number;
  servers: GrantServerGroup[];
}

function serverGroupLabel(g: UnusedGrant): string {
  if (g.kind !== "direct") return KIND_GROUP[g.kind] ?? g.kind;
  if (!g.server) return "Server unknown";
  return splitToolName(`${g.server}__x`).serverLabel;
}

/** Slugs are only unique per org. Largest groups first. */
function groupGrants(rows: UnusedGrant[]): AgentGrants[] {
  const byAgent = new Map<string, AgentGrants>();
  for (const g of rows) {
    const key = agentKey(g);
    let agent = byAgent.get(key);
    if (!agent) {
      agent = { key, agentSlug: g.agentSlug, orgId: g.orgId, total: 0, servers: [] };
      byAgent.set(key, agent);
    }
    agent.total += 1;
    const label = serverGroupLabel(g);
    let server = agent.servers.find((s) => s.label === label);
    if (!server) {
      server = { label, grants: [] };
      agent.servers.push(server);
    }
    server.grants.push(g);
  }
  const out = [...byAgent.values()];
  for (const a of out) a.servers.sort((x, y) => y.grants.length - x.grants.length || x.label.localeCompare(y.label));
  return out.sort((x, y) => y.total - x.total || x.agentSlug.localeCompare(y.agentSlug));
}

/** The grant without its server prefix. */
function grantName(g: UnusedGrant): string {
  return g.grant.includes("__") ? splitToolName(g.grant).tool : g.grant;
}

function UnusedGrantGroup({
  group,
  granted,
  showOrg,
  focused,
}: {
  group: AgentGrants;
  granted: number | null;
  showOrg: boolean;
  focused: boolean;
}): ReactElement {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  return (
    <li
      ref={ref}
      className={cn(
        "-mx-2 rounded-lg px-2 py-3 transition-colors first:pt-2 last:pb-2",
        focused && "bg-xyne-surface-subtle ring-1 ring-xyne-border",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate" title={`${group.agentSlug} · org ${group.orgId}`}>
          <span className="font-mono text-[12px] font-semibold text-xyne-fg-primary">{group.agentSlug}</span>
          {showOrg && <span className="ml-2 text-[11px] text-xyne-fg-muted">org {group.orgId}</span>}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-xyne-fg-muted">
          {fmtInt(group.total)} unused{granted ? ` of ${fmtInt(granted)} granted` : ""}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {group.servers.map((s) => (
          <ServerGrants key={s.label} group={s} expandedInitially={focused} />
        ))}
      </div>
    </li>
  );
}

function ServerGrants({ group, expandedInitially }: { group: GrantServerGroup; expandedInitially: boolean }): ReactElement {
  const [expanded, setExpanded] = useState(expandedInitially);
  useEffect(() => {
    if (expandedInitially) setExpanded(true);
  }, [expandedInitially]);
  const visible = expanded ? group.grants : group.grants.slice(0, GRANTS_SHOWN);
  const more = group.grants.length - GRANTS_SHOWN;
  return (
    <div className="flex flex-col gap-1.5 @min-[640px]:flex-row @min-[640px]:items-start @min-[640px]:gap-3">
      <span className="w-[150px] shrink-0 pt-0.5 text-[12px]">
        <span className="font-medium text-xyne-fg-secondary">{group.label}</span>
        <span className="text-xyne-fg-muted"> · {fmtInt(group.grants.length)}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {visible.map((g) => (
          <span
            key={`${g.kind}\u0000${g.server ?? ""}\u0000${g.grant}`}
            title={`${g.grant} · ${GRANT_KIND[g.kind] ?? g.kind}${g.server ? ` · ${g.server}` : ""}`}
            className="inline-flex h-6 max-w-full items-center rounded-full border border-xyne-border px-2 font-mono text-[11px] text-xyne-fg-primary"
          >
            <span className="truncate">{grantName(g)}</span>
          </span>
        ))}
        {more > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="h-6 rounded-full px-2 text-[11px] font-medium text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
          >
            {expanded ? "Show fewer" : `+${fmtInt(more)} more`}
          </button>
        )}
      </div>
    </div>
  );
}
