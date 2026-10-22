import { useCallback, useEffect, useState } from "react";
import {
  clearKillSwitch,
  downloadGovernanceCsv,
  getGovernanceEvents,
  getGovernanceStats,
  listKillSwitches,
  setKillSwitch,
  type AdminOrgScope,
  type GovernanceEvent,
  type GovernanceStats,
  type KillSwitchRow,
} from "../../lib/api";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { SelectField } from "./ui/SelectField";
import { useSnackbar } from "./ui/Snackbar";
import { Switch } from "./ui/Switch";
import { Tabs } from "./ui/Tabs";
import { TextField } from "./ui/TextField";

/* The governance dashboard: the tool-call feed with filters, its stats, and the kill switches. */

const PAGE = 50;
const EVENT_TYPES = ["tool_call", "critic_verdict", "tool_outcome", "run_started", "kill_switch_set", "kill_switch_enforced", "kill_switch_cleared", "content_scan", "version_status_changed", "admin_override", "config_changed"];
const SCOPES = ["run", "agent", "user", "mcp_server", "tool", "org", "platform"];
const MODES = ["stop", "read_only", "ask_all"];
const EMPTY_FILTERS = { eventType: "tool_call", decision: "", risk: "", effect: "", tool: "", agent: "", days: "7" };
type Section = "feed" | "stats" | "kill";

const opts = (values: readonly string[], any?: string) => [...(any ? [{ value: "", label: any }] : []), ...values.map((v) => ({ value: v, label: v }))];
const decisionVariant = (d: string | null): "success" | "warning" | "error" | "neutral" => (d === "allow" ? "success" : d === "ask" ? "warning" : d === "block" ? "error" : "neutral");
const riskClass = (r: string | null): string => (r === "high" ? "text-xyne-error-fg" : r === "elevated" ? "text-xyne-warning-fg" : "text-xyne-fg-muted");
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const TH = "px-3 py-2 font-medium";
const TD_TIME = "whitespace-nowrap px-3 py-2 text-[11px] text-xyne-fg-muted";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</p>
      <p className="mt-1 font-mono text-[20px] text-xyne-fg-primary">{value}</p>
    </div>
  );
}

export function GovernanceTab({ userId }: { userId: string }) {
  const { show } = useSnackbar();
  const [section, setSection] = useState<Section>("feed");
  const [allOrgs, setAllOrgs] = useState(false);
  const orgScope: AdminOrgScope = allOrgs ? "all" : "org";
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState<GovernanceEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [stats, setStats] = useState<GovernanceStats | null>(null);
  const [switches, setSwitches] = useState<KillSwitchRow[]>([]);
  const [form, setForm] = useState({ scopeKind: "agent", scopeId: "", mode: "stop", reason: "", expiresInMinutes: "" });
  const [clearReason, setClearReason] = useState<Record<string, string>>({});

  const setFilter = (patch: Partial<typeof EMPTY_FILTERS>) => {
    setOffset(0);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const query = useCallback(() => ({
    since: new Date(Date.now() - Number(filters.days || 7) * 24 * 60 * 60_000).toISOString(),
    eventType: filters.eventType,
    ...(filters.decision ? { decision: filters.decision } : {}),
    ...(filters.risk ? { risk: filters.risk } : {}),
    ...(filters.effect ? { effect: filters.effect } : {}),
    ...(filters.tool ? { tool: filters.tool } : {}),
    ...(filters.agent ? { agent: filters.agent } : {}),
    orgScope,
  }), [filters, orgScope]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getGovernanceEvents(userId, { ...query(), limit: PAGE, offset });
      setRows(r.rows);
      setTotal(r.total);
    } catch (err) {
      show({ variant: "error", title: "Failed to load the governance feed", description: errorText(err) });
    } finally {
      setLoading(false);
    }
  }, [userId, query, offset, show]);
  const loadStats = useCallback(async () => {
    try {
      setStats(await getGovernanceStats(userId, Number(filters.days || 7), orgScope));
    } catch (err) {
      show({ variant: "error", title: "Failed to load governance stats", description: errorText(err) });
    }
  }, [userId, filters.days, orgScope, show]);
  const loadSwitches = useCallback(async () => {
    try {
      setSwitches(await listKillSwitches(userId, orgScope));
    } catch (err) {
      show({ variant: "error", title: "Failed to load kill switches", description: errorText(err) });
    }
  }, [userId, orgScope, show]);

  useEffect(() => { if (section === "feed") void loadFeed(); }, [section, loadFeed]);
  useEffect(() => { if (section === "stats") void loadStats(); }, [section, loadStats]);
  useEffect(() => { if (section === "kill") void loadSwitches(); }, [section, loadSwitches]);
  // The feed is live: it refreshes every 10 s while open.
  useEffect(() => {
    if (section !== "feed") return;
    const t = setInterval(() => void loadFeed(), 10_000);
    return () => clearInterval(t);
  }, [section, loadFeed]);

  const submitKill = async () => {
    try {
      await setKillSwitch(userId, { scopeKind: form.scopeKind, scopeId: form.scopeKind === "platform" ? "*" : form.scopeId.trim(), mode: form.mode, reason: form.reason.trim(), ...(form.expiresInMinutes ? { expiresInMinutes: Number(form.expiresInMinutes) } : {}) });
      show({ variant: "success", title: `Kill switch set: ${form.mode} on ${form.scopeKind}` });
      setForm({ ...form, scopeId: "", reason: "", expiresInMinutes: "" });
      await loadSwitches();
    } catch (err) {
      show({ variant: "error", title: "Kill switch not set", description: errorText(err) });
    }
  };
  const submitClear = async (id: string) => {
    try {
      await clearKillSwitch(userId, id, (clearReason[id] ?? "").trim());
      show({ variant: "success", title: "Kill switch cleared" });
      await loadSwitches();
    } catch (err) {
      show({ variant: "error", title: "Kill switch not cleared", description: errorText(err) });
    }
  };

  const live = switches.filter((k) => !k.clearedAt).length;
  const maxPerDay = Math.max(1, ...(stats?.perDay ?? []).map((d) => d.allow + d.ask + d.block));

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs<Section>
          className="flex-1"
          selected={section}
          onSelect={setSection}
          items={[
            { id: "feed", label: filters.eventType === "tool_call" ? `Tool calls${total ? ` (${total})` : ""}` : `Events${total ? ` (${total})` : ""}` },
            { id: "stats", label: "Stats" },
            { id: "kill", label: `Kill switches${live ? ` (${live} live)` : ""}` },
          ]}
        />
        <div className="flex items-center gap-2 text-[12px] text-xyne-fg-muted">
          <SelectField className="w-32" value={filters.days} options={[{ value: "1", label: "Last day" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }]} onValueChange={(v) => setFilter({ days: v ?? "7" })} />
          <span>All orgs</span>
          <Switch checked={allOrgs} onChange={setAllOrgs} ariaLabel="All orgs" />
        </div>
      </div>

      {section === "feed" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField className="w-44" value={filters.eventType} options={opts(EVENT_TYPES)} onValueChange={(v) => setFilter({ eventType: v ?? "tool_call" })} />
            <SelectField className="w-36" value={filters.decision} options={opts(["allow", "ask", "block"], "Any decision")} onValueChange={(v) => setFilter({ decision: v ?? "" })} />
            <SelectField className="w-32" value={filters.risk} options={opts(["none", "elevated", "high"], "Any risk")} onValueChange={(v) => setFilter({ risk: v ?? "" })} />
            <SelectField className="w-36" value={filters.effect} options={opts(["read", "write", "publish", "send", "delete", "execute", "persist", "admin", "unknown"], "Any effect")} onValueChange={(v) => setFilter({ effect: v ?? "" })} />
            <TextField className="w-40" placeholder="tool" value={filters.tool} onChange={(e) => setFilter({ tool: e.target.value })} />
            <TextField className="w-40" placeholder="agent slug" value={filters.agent} onChange={(e) => setFilter({ agent: e.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => { setOffset(0); setFilters(EMPTY_FILTERS); }}>Reset</Button>
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void downloadGovernanceCsv(userId, query()).catch((err) => show({ variant: "error", title: "Export failed", description: errorText(err) }))}>Export CSV</Button>
          </div>
          {loading && rows.length === 0 ? (
            <p className="py-12 text-[13px] text-xyne-fg-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-xyne-fg-muted">No {filters.eventType === "tool_call" ? "tool calls" : "events"} in this window.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-xyne-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                    <th className={TH}>Time</th><th className={TH}>Agent</th><th className={TH}>Tool</th><th className={TH}>Effect</th><th className={TH}>Decision</th><th className={TH}>Risk</th><th className={TH}>Reason</th><th className={TH}>Run</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <>
                      <tr key={r.id} className="cursor-pointer border-b border-xyne-border-subtle hover:bg-xyne-surface-subtle/40" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        <td className={TD_TIME}>{new Date(r.occurredAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-xyne-fg-secondary">{r.actorId ?? "—"}</td>
                        <td className="px-3 py-2 text-xyne-fg-primary">{r.mcpServerId ? `${r.mcpServerId}/` : ""}{r.toolName ?? "—"}</td>
                        <td className="px-3 py-2 text-xyne-fg-secondary">{r.toolEffect ?? "—"}{r.destinationKind && r.destinationKind !== "internal" ? ` → ${r.destinationHost ?? r.destinationKind}` : ""}</td>
                        <td className="px-3 py-2">{r.decision ? <Badge as="span" size="sm" variant={decisionVariant(r.decision)} label={r.decision} /> : "—"}</td>
                        <td className={`px-3 py-2 text-[12px] ${riskClass(r.riskLevelAtCall)}`}>{r.riskLevelAtCall ?? "—"}{r.carriedPrivateData ? " · private" : ""}</td>
                        <td className="px-3 py-2 text-[12px] text-xyne-fg-secondary">{r.reasonCode ?? (r.subjectKind ? `${r.subjectKind}${r.subjectId ? ` ${r.subjectId}` : ""}` : "—")}</td>
                        <td className="px-3 py-2 text-[12px]">
                          {r.sessionId ? <a className="text-xyne-fg-secondary underline hover:text-xyne-fg-primary" href={`/claw/v3/runs?session=${encodeURIComponent(r.sessionId)}`} onClick={(e) => e.stopPropagation()}>trace</a> : "—"}
                        </td>
                      </tr>
                      {expanded === r.id && (
                        <tr key={`${r.id}-detail`} className="border-b border-xyne-border-subtle bg-xyne-surface-subtle/40">
                          <td colSpan={8} className="px-3 py-2 text-[12px] text-xyne-fg-secondary">
                            <div>{r.reasonText}</div>
                            {r.matchedRuleIds.length > 0 && <div className="mt-1 text-xyne-fg-muted">critic: {r.matchedRuleIds.join(", ")}</div>}
                            <div className="mt-1 text-xyne-fg-muted">gate {r.gateMs ?? "—"} ms · judge {r.judgeMs ?? "—"} ms · seq {r.orgSequence ?? "unchained"} · user {r.onBehalfOfUserId ?? "—"}{allOrgs ? ` · org ${r.orgId}` : ""}</div>
                            {r.argumentsRedacted && <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-xyne-border bg-xyne-surface p-2 font-mono text-[11px] text-xyne-fg-secondary">{r.argumentsRedacted}</pre>}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-xyne-fg-muted">
            <span>Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + rows.length, total)} of {total}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0 || loading}>Prev</Button>
              <Button size="sm" variant="secondary" onClick={() => setOffset((o) => o + PAGE)} disabled={offset + rows.length >= total || loading}>Next</Button>
            </div>
          </div>
        </div>
      )}

      {section === "stats" && (!stats ? <p className="py-12 text-[13px] text-xyne-fg-muted">Loading…</p> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Tool calls" value={stats.byDecision.reduce((n, d) => n + d.count, 0)} />
            <StatCard label="Blocked" value={stats.byDecision.find((d) => d.decision === "block")?.count ?? 0} />
            <StatCard label="Asked" value={stats.byDecision.find((d) => d.decision === "ask")?.count ?? 0} />
            <StatCard label="Kill events" value={stats.killEvents} />
          </div>
          <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Calls per day{stats.sampled ? " (sampled)" : ""}: allowed, asked, blocked</p>
            <div className="flex h-32 items-end gap-1">
              {stats.perDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col justify-end" title={`${d.day}: ${d.allow} allowed, ${d.ask} asked, ${d.block} blocked`}>
                  <div className="w-full bg-xyne-error" style={{ height: `${(d.block / maxPerDay) * 100}%` }} />
                  <div className="w-full bg-xyne-warning-fg" style={{ height: `${(d.ask / maxPerDay) * 100}%` }} />
                  <div className="w-full bg-xyne-success-fg" style={{ height: `${(d.allow / maxPerDay) * 100}%` }} />
                  <div className="mt-1 truncate text-center text-[10px] text-xyne-fg-tertiary">{d.allow + d.ask + d.block}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {([["Top tools", stats.topTools.map((t) => [t.tool, t.count] as const)], ["High-risk calls by agent", stats.highRiskByAgent.map((a) => [a.agent, a.count] as const)], ["Outcomes", stats.outcomes.map((o) => [o.outcome, o.count] as const)]] as const).map(([title, items]) => (
              <div key={title} className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{title}</p>
                {items.length === 0 ? <p className="text-[12px] text-xyne-fg-muted">none</p> : items.map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[13px]"><span className="truncate text-xyne-fg-secondary">{k}</span><span className="font-mono text-xyne-fg-muted">{v}</span></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {section === "kill" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
            <p className="mb-3 text-[12px] text-xyne-fg-muted">Stop refuses new runs and aborts live ones. Read-only blocks everything but reads. Ask-all makes every call except a read need approval. A reason is required.</p>
            <div className="flex flex-wrap items-end gap-2">
              <SelectField className="w-36" label="Scope" value={form.scopeKind} options={opts(SCOPES)} onValueChange={(v) => setForm({ ...form, scopeKind: v ?? "agent" })} />
              {form.scopeKind !== "platform" && <TextField className="w-48" label={form.scopeKind === "agent" ? "Agent slug" : form.scopeKind === "mcp_server" ? "Server type" : `${form.scopeKind} id`} value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })} />}
              <SelectField className="w-36" label="Mode" value={form.mode} options={opts(MODES)} onValueChange={(v) => setForm({ ...form, mode: v ?? "stop" })} />
              <TextField className="min-w-64 flex-1" label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              <TextField className="w-32" label="Expires (min)" value={form.expiresInMinutes} onChange={(e) => setForm({ ...form, expiresInMinutes: e.target.value })} />
              <Button variant="destructive" disabled={!form.reason.trim() || (form.scopeKind !== "platform" && !form.scopeId.trim())} onClick={() => void submitKill()}>Set</Button>
            </div>
          </div>
          {switches.length === 0 ? <p className="py-12 text-center text-[13px] text-xyne-fg-muted">No kill switches in the last 7 days.</p> : (
            <div className="overflow-hidden rounded-xl border border-xyne-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                    <th className={TH}>Scope</th><th className={TH}>Mode</th><th className={TH}>Reason</th><th className={TH}>Set</th><th className={TH}>Expires</th><th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {switches.map((k) => (
                    <tr key={k.id} className="border-b border-xyne-border-subtle">
                      <td className="px-3 py-2 text-xyne-fg-primary">{k.scopeKind}{k.scopeKind === "platform" ? "" : ` = ${k.scopeId}`}</td>
                      <td className="px-3 py-2"><Badge as="span" size="sm" variant={k.mode === "stop" ? "error" : "warning"} label={k.mode} /></td>
                      <td className="px-3 py-2 text-xyne-fg-secondary">{k.reason}</td>
                      <td className={TD_TIME}>{new Date(k.createdAt).toLocaleString()} · {k.setBy}{k.setByUserId ? ` ${k.setByUserId}` : ""}</td>
                      <td className={TD_TIME}>{k.expiresAt ? new Date(k.expiresAt).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-[12px]">
                        {k.clearedAt ? (
                          <span className="text-xyne-fg-muted">cleared {new Date(k.clearedAt).toLocaleString()}: {k.clearReason}</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <TextField className="w-48" placeholder="reason to clear" value={clearReason[k.id] ?? ""} onChange={(e) => setClearReason({ ...clearReason, [k.id]: e.target.value })} />
                            <Button size="sm" variant="secondary" disabled={!(clearReason[k.id] ?? "").trim()} onClick={() => void submitClear(k.id)}>Clear</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
