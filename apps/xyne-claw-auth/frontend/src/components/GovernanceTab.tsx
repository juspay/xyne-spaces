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
} from "../lib/api";

const PAGE = 50;
const SCOPES = ["run", "agent", "user", "mcp_server", "tool", "org", "platform"] as const;
const MODES = ["stop", "read_only", "ask_all"] as const;
const EMPTY_FILTERS = { eventType: "tool_call", decision: "", risk: "", effect: "", tool: "", agent: "", days: "7" };
const EVENT_TYPES = ["tool_call", "critic_verdict", "tool_outcome", "run_started", "kill_switch_set", "kill_switch_enforced", "kill_switch_cleared", "content_scan", "version_status_changed", "admin_override", "config_changed"] as const;

const badge = (decision: string | null): string =>
  decision === "block" ? "bg-red-950 text-red-400" : decision === "ask" ? "bg-amber-950 text-amber-400" : decision === "allow" ? "bg-green-950 text-green-400" : "bg-zinc-800 text-zinc-400";
const riskBadge = (risk: string | null): string => (risk === "high" ? "text-red-400" : risk === "elevated" ? "text-amber-400" : "text-zinc-500");

export function GovernanceTab({ userId, orgScope }: { userId: string; orgScope: AdminOrgScope }) {
  const [section, setSection] = useState<"feed" | "stats" | "kill">("feed");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState<GovernanceEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<GovernanceStats | null>(null);
  const [switches, setSwitches] = useState<KillSwitchRow[]>([]);
  const [form, setForm] = useState({ scopeKind: "agent" as (typeof SCOPES)[number], scopeId: "", mode: "stop" as (typeof MODES)[number], reason: "", expiresInMinutes: "" });
  const [clearReason, setClearReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
    setError(null);
    try {
      const r = await getGovernanceEvents(userId, { ...query(), limit: PAGE, offset });
      setRows(r.rows);
      setTotal(r.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userId, query, offset]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await getGovernanceStats(userId, Number(filters.days || 7), orgScope));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId, filters.days, orgScope]);

  const loadSwitches = useCallback(async () => {
    try {
      setSwitches(await listKillSwitches(userId, orgScope));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId, orgScope]);

  useEffect(() => { if (section === "feed") void loadFeed(); }, [section, loadFeed]);
  useEffect(() => { if (section === "stats") void loadStats(); }, [section, loadStats]);
  useEffect(() => { if (section === "kill") void loadSwitches(); }, [section, loadSwitches]);
  // The feed is live: it refreshes itself every 10 s while open.
  useEffect(() => {
    if (section !== "feed") return;
    const t = setInterval(() => void loadFeed(), 10_000);
    return () => clearInterval(t);
  }, [section, loadFeed]);

  const submitKill = async () => {
    setError(null);
    try {
      await setKillSwitch(userId, { scopeKind: form.scopeKind, scopeId: form.scopeKind === "platform" ? "*" : form.scopeId, mode: form.mode, reason: form.reason, ...(form.expiresInMinutes ? { expiresInMinutes: Number(form.expiresInMinutes) } : {}) });
      setForm({ ...form, scopeId: "", reason: "", expiresInMinutes: "" });
      await loadSwitches();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitClear = async (id: string) => {
    setError(null);
    try {
      await clearKillSwitch(userId, id, clearReason[id] ?? "");
      await loadSwitches();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const input = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200";
  const button = "rounded border border-zinc-700 px-3 py-1 text-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40";
  const maxPerDay = Math.max(1, ...(stats?.perDay ?? []).map((d) => d.allow + d.ask + d.block));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["feed", "stats", "kill"] as const).map((s) => (
          <button key={s} onClick={() => setSection(s)} className={`${button} ${section === s ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"}`}>
            {s === "feed" ? `${filters.eventType === "tool_call" ? "Tool calls" : "Events"}${total > 0 ? ` (${total})` : ""}` : s === "stats" ? "Stats" : `Kill switches${switches.filter((k) => !k.clearedAt).length > 0 ? ` (${switches.filter((k) => !k.clearedAt).length} live)` : ""}`}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          Last
          <select className={input} value={filters.days} onChange={(e) => { setOffset(0); setFilters({ ...filters, days: e.target.value }); }}>
            {["1", "7", "30", "90"].map((d) => <option key={d} value={d}>{d} day{d === "1" ? "" : "s"}</option>)}
          </select>
        </span>
      </div>
      {error && <p className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">{error}</p>}

      {section === "feed" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} value={filters.eventType} onChange={(e) => { setOffset(0); setFilters({ ...filters, eventType: e.target.value }); }}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className={input} value={filters.decision} onChange={(e) => { setOffset(0); setFilters({ ...filters, decision: e.target.value }); }}>
              <option value="">Any decision</option>
              {["allow", "ask", "block"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className={input} value={filters.risk} onChange={(e) => { setOffset(0); setFilters({ ...filters, risk: e.target.value }); }}>
              <option value="">Any risk</option>
              {["none", "elevated", "high"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className={input} value={filters.effect} onChange={(e) => { setOffset(0); setFilters({ ...filters, effect: e.target.value }); }}>
              <option value="">Any effect</option>
              {["read", "write", "publish", "send", "delete", "execute", "persist", "admin", "unknown"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input className={input} placeholder="tool" value={filters.tool} onChange={(e) => { setOffset(0); setFilters({ ...filters, tool: e.target.value }); }} />
            <input className={input} placeholder="agent slug" value={filters.agent} onChange={(e) => { setOffset(0); setFilters({ ...filters, agent: e.target.value }); }} />
            <button className={button} onClick={() => { setOffset(0); setFilters(EMPTY_FILTERS); }}>Reset</button>
            <button className={`${button} ml-auto`} onClick={() => void downloadGovernanceCsv(userId, query())}>Export CSV</button>
          </div>
          {loading && rows.length === 0 ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No {filters.eventType === "tool_call" ? "tool calls" : "events"} in this window.</p>
          ) : (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-500">
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Tool</th>
                    <th className="px-3 py-2">Effect</th>
                    <th className="px-3 py-2">Decision</th>
                    <th className="px-3 py-2">Risk</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Run</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <>
                      <tr key={r.id} className="cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-900/50" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">{new Date(r.occurredAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-zinc-300">{r.actorId ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-300">{r.mcpServerId ? `${r.mcpServerId}/` : ""}{r.toolName ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-400">{r.toolEffect ?? "—"}{r.destinationKind && r.destinationKind !== "internal" ? ` → ${r.destinationHost ?? r.destinationKind}` : ""}</td>
                        <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${badge(r.decision)}`}>{r.decision ?? "—"}</span></td>
                        <td className={`px-3 py-2 text-xs ${riskBadge(r.riskLevelAtCall)}`}>{r.riskLevelAtCall ?? "—"}{r.carriedPrivateData ? " · private" : ""}</td>
                        <td className="px-3 py-2 text-xs text-zinc-400">{r.reasonCode ?? (r.subjectKind ? `${r.subjectKind}${r.subjectId ? ` ${r.subjectId}` : ""}` : "—")}</td>
                        <td className="px-3 py-2 text-xs">
                          {r.sessionId ? <a className="text-zinc-400 underline hover:text-zinc-200" href={`/claw/v3/runs?session=${encodeURIComponent(r.sessionId)}`} onClick={(e) => e.stopPropagation()}>trace</a> : "—"}
                        </td>
                      </tr>
                      {expanded === r.id && (
                        <tr key={`${r.id}-detail`} className="border-b border-zinc-800/50 bg-zinc-900/40">
                          <td colSpan={8} className="px-3 py-2 text-xs text-zinc-400">
                            <div>{r.reasonText}</div>
                            {r.matchedRuleIds.length > 0 && <div className="mt-1 text-zinc-500">critic: {r.matchedRuleIds.join(", ")}</div>}
                            <div className="mt-1 text-zinc-500">gate {r.gateMs ?? "—"} ms · judge {r.judgeMs ?? "—"} ms · seq {r.orgSequence ?? "unchained"} · user {r.onBehalfOfUserId ?? "—"}</div>
                            {r.argumentsRedacted && <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] text-zinc-400">{r.argumentsRedacted}</pre>}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + rows.length, total)} of {total}</span>
            <div className="flex items-center gap-2">
              <button className={button} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0 || loading}>Prev</button>
              <button className={button} onClick={() => setOffset((o) => o + PAGE)} disabled={offset + rows.length >= total || loading}>Next</button>
            </div>
          </div>
        </div>
      )}

      {section === "stats" && (
        !stats ? <p className="text-sm text-zinc-500">Loading…</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Tool calls", stats.byDecision.reduce((n, d) => n + d.count, 0)],
                ["Blocked", stats.byDecision.find((d) => d.decision === "block")?.count ?? 0],
                ["Asked", stats.byDecision.find((d) => d.decision === "ask")?.count ?? 0],
                ["Kill events", stats.killEvents],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className="text-2xl text-zinc-100">{value}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-zinc-800 p-3">
              <div className="mb-2 text-xs text-zinc-500">Calls per day{stats.sampled ? " (sampled)" : ""}: allowed, asked, blocked</div>
              <div className="flex h-32 items-end gap-1">
                {stats.perDay.map((d) => {
                  const sum = d.allow + d.ask + d.block;
                  return (
                    <div key={d.day} className="flex flex-1 flex-col justify-end" title={`${d.day}: ${d.allow} allowed, ${d.ask} asked, ${d.block} blocked`}>
                      <div className="w-full bg-red-900" style={{ height: `${(d.block / maxPerDay) * 100}%` }} />
                      <div className="w-full bg-amber-900" style={{ height: `${(d.ask / maxPerDay) * 100}%` }} />
                      <div className="w-full bg-green-900" style={{ height: `${(d.allow / maxPerDay) * 100}%` }} />
                      <div className="mt-1 truncate text-center text-[10px] text-zinc-600">{sum}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Top tools", stats.topTools.map((t) => [t.tool, t.count] as const)],
                ["High-risk calls by agent", stats.highRiskByAgent.map((a) => [a.agent, a.count] as const)],
                ["Outcomes", stats.outcomes.map((o) => [o.outcome, o.count] as const)],
              ].map(([title, items]) => (
                <div key={String(title)} className="rounded-lg border border-zinc-800 p-3">
                  <div className="mb-2 text-xs text-zinc-500">{title}</div>
                  {(items as ReadonlyArray<readonly [string, number]>).length === 0 ? <div className="text-xs text-zinc-600">none</div> : (items as ReadonlyArray<readonly [string, number]>).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm"><span className="truncate text-zinc-300">{k}</span><span className="text-zinc-500">{v}</span></div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {section === "kill" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 p-3">
            <div className="mb-2 text-xs text-zinc-500">Set a kill switch. Stop refuses new runs and aborts live ones; read-only blocks everything but reads; ask-all makes every call except a read need approval.</div>
            <div className="flex flex-wrap items-center gap-2">
              <select className={input} value={form.scopeKind} onChange={(e) => setForm({ ...form, scopeKind: e.target.value as (typeof SCOPES)[number] })}>
                {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {form.scopeKind !== "platform" && <input className={input} placeholder={form.scopeKind === "agent" ? "agent slug" : form.scopeKind === "mcp_server" ? "server type" : `${form.scopeKind} id`} value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })} />}
              <select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as (typeof MODES)[number] })}>
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className={`${input} min-w-64`} placeholder="reason (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              <input className={`${input} w-28`} placeholder="expires (min)" value={form.expiresInMinutes} onChange={(e) => setForm({ ...form, expiresInMinutes: e.target.value })} />
              <button className={`${button} border-red-900 text-red-400`} disabled={!form.reason.trim() || (form.scopeKind !== "platform" && !form.scopeId.trim())} onClick={() => void submitKill()}>Set</button>
            </div>
          </div>
          {switches.length === 0 ? <p className="text-sm text-zinc-500">No kill switches in the last 7 days.</p> : (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs text-zinc-500">
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Set</th>
                    <th className="px-3 py-2">Expires</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {switches.map((k) => (
                    <tr key={k.id} className="border-b border-zinc-800/50">
                      <td className="px-3 py-2 text-zinc-300">{k.scopeKind}{k.scopeKind === "platform" ? "" : ` = ${k.scopeId}`}</td>
                      <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${k.mode === "stop" ? "bg-red-950 text-red-400" : "bg-amber-950 text-amber-400"}`}>{k.mode}</span></td>
                      <td className="px-3 py-2 text-zinc-400">{k.reason}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">{new Date(k.createdAt).toLocaleString()} · {k.setBy}{k.setByUserId ? ` ${k.setByUserId}` : ""}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">{k.expiresAt ? new Date(k.expiresAt).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {k.clearedAt ? (
                          <span className="text-zinc-500">cleared {new Date(k.clearedAt).toLocaleString()}: {k.clearReason}</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <input className={input} placeholder="reason to clear" value={clearReason[k.id] ?? ""} onChange={(e) => setClearReason({ ...clearReason, [k.id]: e.target.value })} />
                            <button className={button} disabled={!(clearReason[k.id] ?? "").trim()} onClick={() => void submitClear(k.id)}>Clear</button>
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
