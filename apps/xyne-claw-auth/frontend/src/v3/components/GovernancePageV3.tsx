/**
 * GovernancePageV3 — Admin ▸ Governance: every tool call an agent made, what the policy decided and
 * why, the kill switches, and the modes each service runs in. Every filter lives in the URL, so a view
 * can be shared or returned to, like a Grafana dashboard.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import {
  clearKillSwitch,
  downloadGovernanceCsv,
  getGovernanceConfig,
  getGovernanceEvents,
  getGovernanceFacets,
  getGovernanceStats,
  listKillSwitches,
  setKillSwitch,
  type AdminOrgScope,
  type GovernanceConfig,
  type GovernanceEvent,
  type GovernanceNames,
  type GovernanceServiceConfig,
  type GovernanceStats,
  type KillSwitchRow,
} from "../../lib/api";
import { runReplayPath } from "../../lib/runReplay";
import { useAdminStatus } from "../hooks/useAdminStatus";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { SelectField } from "./ui/SelectField";
import { useSnackbar } from "./ui/Snackbar";
import { Tabs, type TabItem } from "./ui/Tabs";
import { TextField } from "./ui/TextField";
import { InfoIcon } from "./ui/Tooltip";
import { SegmentedControl, ToggleField } from "./metrics/MetricsPrimitives";

/* ── URL state ─────────────────────────────────────────────────────── */

type Tab = "calls" | "events" | "stats" | "kill";
const TABS: TabItem<Tab>[] = [
  { id: "calls", label: "Tool calls" },
  { id: "events", label: "Events" },
  { id: "stats", label: "Stats" },
  { id: "kill", label: "Kill switches" },
];
const RANGES = [{ id: "1", label: "24h" }, { id: "7", label: "7d" }, { id: "30", label: "30d" }, { id: "90", label: "90d" }] as const;
type Range = (typeof RANGES)[number]["id"];
const PAGE = 50;
const EVENT_TYPES = ["run_started", "critic_verdict", "tool_outcome", "kill_switch_set", "kill_switch_enforced", "kill_switch_cleared", "content_scan", "version_status_changed", "admin_override", "config_changed"];
const DECISIONS = ["allow", "ask", "block"];
const RISKS = ["none", "elevated", "high"];
const EFFECTS = ["read", "write", "publish", "send", "delete", "execute", "persist", "admin", "unknown"];
const SCOPES = ["agent", "user", "mcp_server", "tool", "run", "org", "platform"];
const MODES = ["stop", "read_only", "ask_all"];
const COMPONENTS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: "A", label: "A · context", hint: "Scans everything the model is about to read" },
  { id: "B", label: "B · results", hint: "Scans every tool result as it arrives" },
  { id: "C1", label: "C1 · claw gate", hint: "Decides each tool call before it runs, in claw" },
  { id: "C2", label: "C2 · auth gate", hint: "Decides each MCP call in claw-auth, where the credentials are" },
  { id: "D", label: "D · output", hint: "Checks the final answer" },
  { id: "registry", label: "registry", hint: "Skill versions: pending content serves its last approved version" },
  { id: "kill", label: "kill", hint: "Kill switches" },
];

const opts = (values: readonly string[], any?: string) => [...(any ? [{ value: "", label: any }] : []), ...values.map((v) => ({ value: v, label: v.replace(/_/g, " ") }))];
const decisionVariant = (d: string | null): "success" | "warning" | "error" | "neutral" => (d === "allow" ? "success" : d === "ask" ? "warning" : d === "block" ? "error" : "neutral");
const modeVariant = (m: string | undefined): "success" | "warning" | "neutral" => (m === "enforce" ? "success" : m === "shadow" ? "warning" : "neutral");
const riskClass = (r: string | null): string => (r === "high" ? "text-xyne-error-fg" : r === "elevated" ? "text-xyne-warning-fg" : "text-xyne-fg-muted");
const criticClass = (level: string): string => (level === "critical" || level === "high" ? "text-xyne-error-fg" : level === "medium" ? "text-xyne-warning-fg" : "text-xyne-fg-muted");
/** Rows that record a fact rather than a decision. */
const INFO_BADGE: Record<string, string> = { run_started: "started", config_changed: "changed", version_status_changed: "changed", admin_override: "override" };
const CRITIC_TAG = /^critic\.(xor|rule|c1|fallback)\.(\w+)$/;
/** The critic's level and categories: on the row itself in enforce, or from the verdict recorded after the call in shadow. */
function criticOf(r: GovernanceEvent): { level: string; categories: string[]; afterTheCall: boolean } | null {
  const own = r.matchedRuleIds.some((t) => CRITIC_TAG.test(t));
  const tags = own ? r.matchedRuleIds : r.critic?.matchedRuleIds ?? [];
  const level = tags.map((t) => CRITIC_TAG.exec(t)?.[2]).find((l): l is string => !!l);
  if (!level) return null;
  return { level, categories: tags.filter((t) => t.startsWith("critic.") && !CRITIC_TAG.test(t)).map((t) => t.slice(7).replace(/_/g, " ")), afterTheCall: !own };
}
const loadedSkills = (r: GovernanceEvent): string[] => (r.reasonText ?? "").split(", ").filter(Boolean).map((s) => s.split("@")[0] ?? s);
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const when = (iso: string): string => new Date(iso).toLocaleString();
const TH = "px-3 py-2 font-medium";
const TD_TIME = "whitespace-nowrap px-3 py-2 text-[11px] text-xyne-fg-muted";
const CARD = "rounded-xl border border-xyne-border-subtle bg-xyne-surface p-4 shadow-sm";

/** One request's result, kept while the next one loads so the table never blanks. */
function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>, enabled = true, refreshMs = 0): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null; tick: number }>({ data: undefined, loading: false, error: null, tick: 0 });
  const reload = useCallback(() => setState((s) => ({ ...s, tick: s.tick + 1 })), []);
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    load(ctrl.signal)
      .then((data) => { if (!ctrl.signal.aborted) setState((s) => ({ ...s, data, loading: false, error: null })); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, error: errorText(err) })); });
    return () => ctrl.abort();
    // `load` is rebuilt by its caller whenever the key changes; the key is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, state.tick]);
  useEffect(() => {
    if (!enabled || refreshMs <= 0) return;
    const t = setInterval(reload, refreshMs);
    return () => clearInterval(t);
  }, [enabled, refreshMs, reload]);
  return { data: state.data, loading: state.loading, error: state.error, reload };
}

/* ── Page ──────────────────────────────────────────────────────────── */

export function GovernancePageV3({ userId }: { userId: string }): ReactElement {
  const { isAdmin, isAdminLoading } = useAdminStatus();
  const { show } = useSnackbar();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "calls") as Tab;
  const range = (RANGES.some((r) => r.id === params.get("range")) ? params.get("range") : "7") as Range;
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const get = (k: string): string => params.get(k) ?? "";
  const allOrgs = !isAdminLoading && isAdmin && params.get("orgScope") === "all";
  const orgScope: AdminOrgScope = allOrgs ? "all" : "org";
  const since = useMemo(() => new Date(Date.now() - Number(range) * 24 * 60 * 60_000).toISOString(), [range]);

  const update = useCallback((mutate: (next: URLSearchParams) => void) => {
    setParams((prev) => { const next = new URLSearchParams(prev); mutate(next); return next; }, { replace: true });
  }, [setParams]);
  const setFilter = (key: string, value: string): void => update((n) => { if (value) n.set(key, value); else n.delete(key); n.delete("page"); });
  const setTab = (id: Tab): void => update((n) => { if (id === "calls") n.delete("tab"); else n.set("tab", id); n.delete("page"); });

  const feedQuery = useMemo(() => ({
    since,
    eventType: tab === "events" ? (get("type") || "run_started") : "tool_call",
    ...(get("agent") ? { agent: get("agent") } : {}),
    ...(get("user") ? { user: get("user") } : {}),
    ...(tab === "calls" && get("decision") ? { decision: get("decision") } : {}),
    ...(tab === "calls" && get("risk") ? { risk: get("risk") } : {}),
    ...(tab === "calls" && get("effect") ? { effect: get("effect") } : {}),
    ...(tab === "calls" && get("tool") ? { tool: get("tool") } : {}),
    ...(tab === "calls" && get("server") ? { server: get("server") } : {}),
    orgScope,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [since, tab, orgScope, params]);
  const feedKey = `${JSON.stringify(feedQuery)}|${page}`;
  const feed = useResource(feedKey, () => getGovernanceEvents(userId, { ...feedQuery, limit: PAGE, offset: page * PAGE }), tab === "calls" || tab === "events", 10_000);
  const facets = useResource(`facets|${since}|${orgScope}`, () => getGovernanceFacets(userId, since, orgScope));
  const config = useResource("config", () => getGovernanceConfig(userId), true, 30_000);
  const stats = useResource(`stats|${range}|${orgScope}`, () => getGovernanceStats(userId, Number(range), orgScope), tab === "stats");
  const switches = useResource(`kill|${orgScope}`, () => listKillSwitches(userId, orgScope), tab === "kill", 10_000);

  useEffect(() => { if (feed.error) show({ variant: "error", title: "Failed to load the feed", description: feed.error }); }, [feed.error, show]);
  useEffect(() => { if (switches.error) show({ variant: "error", title: "Failed to load kill switches", description: switches.error }); }, [switches.error, show]);

  const names: GovernanceNames = feed.data?.names ?? { agents: {}, users: {}, skills: {} };
  const agentLabel = (slug: string | null): string => (slug ? names.agents[slug] ?? facets.data?.agents.find((a) => a.slug === slug)?.name ?? slug : "—");
  const userLabel = (id: string | null): string => {
    if (!id) return "—";
    const u = names.users[id] ?? facets.data?.users.find((x) => x.id === id);
    return u?.email ?? u?.name ?? id;
  };
  const subjectLabel = (r: GovernanceEvent): string => {
    if (r.toolName) return `${r.mcpServerId ? `${r.mcpServerId}/` : ""}${r.toolName}`;
    if (r.eventType === "run_started") return `run · ${loadedSkills(r).length} skills`;
    if (r.subjectId?.startsWith("skill:")) return `skill · ${names.skills[r.subjectId.slice(6)]?.slug ?? r.subjectId.slice(6)}`;
    if (r.subjectKind?.startsWith("kill:")) return `${r.subjectKind.slice(5).replace("_", " ")} ${r.subjectId ?? ""}`.trim();
    return r.subjectKind ? `${r.subjectKind}${r.subjectId ? ` ${r.subjectId}` : ""}` : "—";
  };
  const openPath = (r: GovernanceEvent): string | null => {
    if (r.conversationId && r.actorKind === "agent" && r.actorId) return runReplayPath({ agentSlug: r.actorId, conversationId: r.conversationId }, { allRuns: r.onBehalfOfUserId !== userId });
    return r.sessionId ? `/v3/runs?session=${encodeURIComponent(r.sessionId)}` : null;
  };

  const agentOptions = [{ value: "", label: "All agents" }, ...(facets.data?.agents ?? []).map((a) => ({ value: a.slug, label: `${a.name ?? a.slug} · ${a.slug} (${a.count})` }))];
  const userOptions = [{ value: "", label: "All people" }, ...(facets.data?.users ?? []).map((u) => ({ value: u.id, label: `${u.name ?? u.email ?? u.id}${u.email && u.name ? ` · ${u.email}` : ""} (${u.count})` }))];
  const serverOptions = [{ value: "", label: "Any server" }, ...(facets.data?.servers ?? []).map((s) => ({ value: s.id, label: `${s.id} (${s.count})` }))];
  const updating = feed.loading || facets.loading || config.loading || stats.loading || switches.loading;

  return (
    <div className="relative flex-1 overflow-auto">
      <div className="mx-auto w-full min-w-[640px] max-w-[1180px] px-[40px] pb-[56px] pt-[32px]">
        <div className="mb-[16px]">
          <h1 className="text-[22px] font-semibold text-xyne-fg-primary">Governance</h1>
          <p className="mt-1 text-[13px] text-xyne-fg-muted">Every tool call an agent made, what the policy decided and why, the switches that stop an agent, and the mode each check runs in.</p>
        </div>

        <div className="sticky top-0 z-20 -mx-[40px] border-b border-xyne-border-subtle bg-xyne-surface/95 px-[40px] py-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl ariaLabel="Time range" options={RANGES} value={range} onChange={(id) => update((n) => { if (id === "7") n.delete("range"); else n.set("range", id); n.delete("page"); })} />
            <SelectField className="w-64" placeholder="All agents" value={get("agent")} options={agentOptions} onValueChange={(v) => setFilter("agent", v ?? "")} />
            <SelectField className="w-64" placeholder="All people" value={get("user")} options={userOptions} onValueChange={(v) => setFilter("user", v ?? "")} />
            {isAdmin && <ToggleField label="All orgs" checked={allOrgs} onChange={(next) => update((n) => { if (next) n.set("orgScope", "all"); else n.delete("orgScope"); n.delete("page"); })} hint="Show every organization" />}
            <div className="ml-auto flex items-center gap-3">
              {updating && <span className="inline-flex items-center gap-1.5 text-[12px] text-xyne-fg-muted" role="status"><RefreshCw size={12} className="animate-spin" aria-hidden />Updating…</span>}
              <button type="button" onClick={() => { feed.reload(); facets.reload(); config.reload(); stats.reload(); switches.reload(); }} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-xyne-border px-3 text-[12px] font-medium text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary">
                <RefreshCw size={12} aria-hidden />Refresh
              </button>
            </div>
          </div>
        </div>

        <ModeStrip config={config.data} />

        <div className="mb-[20px] mt-[20px]">
          <Tabs items={TABS} selected={tab} onSelect={setTab} />
        </div>

        {(tab === "calls" || tab === "events") && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {tab === "calls" ? (
                <>
                  <SelectField className="w-36" value={get("decision")} options={opts(DECISIONS, "Any decision")} onValueChange={(v) => setFilter("decision", v ?? "")} />
                  <SelectField className="w-32" value={get("risk")} options={opts(RISKS, "Any risk")} onValueChange={(v) => setFilter("risk", v ?? "")} />
                  <SelectField className="w-36" value={get("effect")} options={opts(EFFECTS, "Any effect")} onValueChange={(v) => setFilter("effect", v ?? "")} />
                  <SelectField className="w-44" value={get("server")} options={serverOptions} onValueChange={(v) => setFilter("server", v ?? "")} />
                  <TextField className="w-44" placeholder="tool name contains…" value={get("tool")} onChange={(e) => setFilter("tool", e.target.value)} />
                </>
              ) : (
                <SelectField className="w-52" value={get("type") || "run_started"} options={opts(EVENT_TYPES)} onValueChange={(v) => setFilter("type", v ?? "")} />
              )}
              <Button size="sm" variant="ghost" onClick={() => update((n) => { for (const k of ["decision", "risk", "effect", "tool", "server", "type", "agent", "user", "page"]) n.delete(k); })}>Reset</Button>
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void downloadGovernanceCsv(userId, feedQuery).catch((err) => show({ variant: "error", title: "Export failed", description: errorText(err) }))}>Export CSV</Button>
            </div>
            <Legend />
            <FeedTable rows={feed.data?.rows ?? []} loading={feed.loading} calls={tab === "calls"} agentLabel={agentLabel} userLabel={userLabel} subjectLabel={subjectLabel} openPath={openPath} onOpen={(p) => navigate(p)} showOrg={allOrgs} />
            <div className="flex items-center justify-between text-[11px] text-xyne-fg-muted">
              <span>Showing {(feed.data?.total ?? 0) === 0 ? 0 : page * PAGE + 1}–{Math.min(page * PAGE + (feed.data?.rows.length ?? 0), feed.data?.total ?? 0)} of {feed.data?.total ?? 0}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => update((n) => { if (page <= 1) n.delete("page"); else n.set("page", String(page - 1)); })}>Prev</Button>
                <Button size="sm" variant="secondary" disabled={page * PAGE + (feed.data?.rows.length ?? 0) >= (feed.data?.total ?? 0)} onClick={() => update((n) => n.set("page", String(page + 1)))}>Next</Button>
              </div>
            </div>
          </div>
        )}

        {tab === "stats" && <StatsView stats={stats.data} agentLabel={agentLabel} />}
        {tab === "kill" && <KillView userId={userId} rows={switches.data ?? []} config={config.data} userLabel={userLabel} onChanged={() => { switches.reload(); config.reload(); }} />}
      </div>
    </div>
  );
}

/* ── Mode strip ────────────────────────────────────────────────────── */

function ModeStrip({ config }: { config: GovernanceConfig | undefined }): ReactElement {
  const services: Array<{ name: string; cfg: GovernanceServiceConfig | null | undefined }> = [{ name: "claw-auth", cfg: config?.clawAuth }, { name: "claw", cfg: config?.claw }];
  const killOn = services.every((s) => s.cfg?.modes["kill"] === "enforce");
  return (
    <div className={`${CARD} mt-[20px]`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold text-xyne-fg-primary">Modes</span>
        <InfoIcon text="off: the check does not run. shadow: it runs and records what it would have done, and never refuses, aborts or changes anything. enforce: it acts. Set with GOVERNANCE_MODE and GOVERNANCE_COMPONENT_MODES (for example C1=enforce,kill=shadow) on each service, then restart it." />
        {config && (
          <Badge as="span" size="sm" variant={killOn ? "success" : "warning"} label={killOn ? "kill switches act on both services" : "kill switches are recorded, not applied, on at least one service"} />
        )}
        {config && !config.claw && <Badge as="span" size="sm" variant="error" label="claw unreachable from claw-auth" />}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {services.map((s) => (
          <div key={s.name} className="rounded-lg border border-xyne-border-subtle p-3">
            <div className="mb-2 flex items-center justify-between text-[12px]">
              <span className="font-medium text-xyne-fg-primary">{s.name}</span>
              {s.cfg ? (
                <span className="text-xyne-fg-muted">kill snapshot {s.cfg.kill.switches} live · {(s.cfg.kill.ageMs / 1000).toFixed(1)} s old{s.cfg.critic === false ? " · critic off (no XOR)" : ""}{s.cfg.criticBatch ? " · critic batched" : ""}</span>
              ) : (
                <span className="text-xyne-fg-muted">{config ? "not reachable" : "loading…"}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COMPONENTS.map((c) => (
                <span key={c.id} title={c.hint} className="inline-flex items-center gap-1 text-[11px] text-xyne-fg-secondary">
                  {c.label}
                  <Badge as="span" size="sm" variant={modeVariant(s.cfg?.modes[c.id])} label={s.cfg?.modes[c.id] ?? "?"} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Legend ────────────────────────────────────────────────────────── */

function Legend(): ReactElement {
  return (
    <details className="rounded-xl border border-xyne-border-subtle bg-xyne-surface px-4 py-2 text-[12px] text-xyne-fg-secondary">
      <summary className="cursor-pointer font-medium text-xyne-fg-primary">How to read a row</summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-medium text-xyne-fg-primary">Decision</p>
          <p><b>allow</b>: the call ran and was recorded. <b>ask</b>: a person must approve it; an MCP call waits on an approval card, and in shadow this is only recorded (a grant's own ask, GOV-GRANT-ASK, has always shown the card). <b>block</b>: refused in enforce; in shadow recorded as "would block". The reason code says which rule decided.</p>
          <p className="mt-2 font-medium text-xyne-fg-primary">Where a call is decided</p>
          <p><b>C1</b> runs in claw before any tool runs, for every tool, claw's own and MCP alike: it classifies the call, checks the kill switches, the conversation's risk and the critic, and the policy table answers allow, ask or block. An MCP call then reaches claw-auth, where <b>C2</b> decides again with what only claw-auth knows (the server's write policy, the agent's grant, the credentials) and records the call; an ask there is the approval card. Both services read the same kill switches; in shadow both only record.</p>
          <p className="mt-2 font-medium text-xyne-fg-primary">Conversation risk</p>
          <p><b>none</b>: the run has read only what people typed and clean results. <b>elevated</b>: a scan is still pending, or something the agent read looked unsure or suspicious; publish, send, delete, execute, persist and admin calls then need approval. <b>high</b>: an injection was found in something the agent read; every call except a read needs approval and sends outside the org are blocked. <b>private</b>: the run read private data (mail, chat, Spaces), so a send outside the org asks.</p>
        </div>
        <div>
          <p className="font-medium text-xyne-fg-primary">Effect and destination</p>
          <p>Classified in under a millisecond from the verb in the tool's name, its server's declared write policy, the verb that opens its description and its arguments: <b>read</b> (including tools whose effect stays inside the run, such as a question to the person), <b>write</b>, <b>publish</b> (to people inside the org), <b>send</b> (data leaves the org), <b>delete</b>, <b>execute</b>, <b>persist</b> (memory, skills, instructions), <b>admin</b>; <b>unknown</b> counts as a send and a write. The arrow names the outside host or server when the data leaves.</p>
          <p className="mt-2 font-medium text-xyne-fg-primary">Critic</p>
          <p>Runs only for publish, send, delete, execute, persist and unknown calls after the agent read something a person did not type: rules first (<b>critic.rule.*</b>), then the XOR judge (<b>critic.xor.*</b>) with five questions: destroys data, sends it outside, follows fetched instructions, exceeds the request, touches credentials. Its level shows under the conversation risk; high asks and critical blocks. In enforce the gate waits for it (up to 2 s); in shadow it answers after the call already ran, marked "after the call", and the expanded row says what it would have decided.</p>
        </div>
      </div>
    </details>
  );
}

/* ── Feed table ────────────────────────────────────────────────────── */

function FeedTable({ rows, loading, calls, agentLabel, userLabel, subjectLabel, openPath, onOpen, showOrg }: {
  rows: GovernanceEvent[]; loading: boolean; calls: boolean;
  agentLabel: (slug: string | null) => string; userLabel: (id: string | null) => string; subjectLabel: (r: GovernanceEvent) => string;
  openPath: (r: GovernanceEvent) => string | null; onOpen: (path: string) => void; showOrg: boolean;
}): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (loading && rows.length === 0) return <p className="py-12 text-[13px] text-xyne-fg-muted">Loading…</p>;
  if (rows.length === 0) return <p className="py-12 text-center text-[13px] text-xyne-fg-muted">Nothing in this window matches these filters.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-xyne-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
            <th className={TH}>Time</th>
            {!calls && <th className={TH}>Type</th>}
            <th className={TH}>Agent</th>
            <th className={TH}>Person</th>
            <th className={TH}>{calls ? "Tool" : "Subject"}</th>
            {calls && <th className={TH}>Effect</th>}
            <th className={TH}>Decision</th>
            {calls && <th className={TH}>Risk</th>}
            <th className={TH}>Reason</th>
            <th className={TH}>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const path = openPath(r);
            const open = expanded === r.id;
            const critic = calls ? criticOf(r) : null;
            const reason = r.eventType === "run_started" ? (loadedSkills(r).length > 0 ? `loaded ${loadedSkills(r).join(", ")}` : "no skills loaded") : r.reasonText ?? "";
            return [
              <tr key={r.id} className="cursor-pointer border-b border-xyne-border-subtle hover:bg-xyne-surface-subtle/40" onClick={() => setExpanded(open ? null : r.id)}>
                <td className={TD_TIME}>{when(r.occurredAt)}</td>
                {!calls && <td className="px-3 py-2 text-[12px] text-xyne-fg-secondary">{r.eventType.replace(/_/g, " ")}</td>}
                <td className="px-3 py-2 text-xyne-fg-secondary">{r.actorKind === "agent" ? agentLabel(r.actorId) : r.actorKind === "system" ? "system" : "—"}</td>
                <td className="px-3 py-2 text-[12px] text-xyne-fg-secondary">{userLabel(r.onBehalfOfUserId ?? (r.actorKind === "agent" || r.actorKind === "system" ? null : r.actorId))}</td>
                <td className="px-3 py-2 text-xyne-fg-primary">{subjectLabel(r)}</td>
                {calls && <td className="px-3 py-2 text-xyne-fg-secondary">{r.toolEffect ?? "—"}{r.destinationKind && r.destinationKind !== "internal" ? ` → ${r.destinationHost ?? r.destinationKind.replace(/_/g, " ")}` : ""}</td>}
                <td className="px-3 py-2">{r.decision ? <Badge as="span" size="sm" variant={decisionVariant(r.decision)} label={r.decision} /> : r.outcome ? <Badge as="span" size="sm" variant={r.outcome === "error" ? "error" : "neutral"} label={r.outcome} /> : INFO_BADGE[r.eventType] ? <Badge as="span" size="sm" variant="neutral" label={INFO_BADGE[r.eventType]!} /> : "—"}</td>
                {calls && (
                  <td className="px-3 py-2 text-[12px]">
                    <div className={riskClass(r.riskLevelAtCall)}>{r.riskLevelAtCall ?? "—"}{r.carriedPrivateData ? " · private" : ""}</div>
                    {critic && <div className={criticClass(critic.level)} title={critic.afterTheCall ? "The critic answered after the call had already run (shadow)." : undefined}>critic {critic.level}{critic.categories.length > 0 ? `: ${critic.categories.join(", ")}` : ""}{critic.afterTheCall ? " · after the call" : ""}</div>}
                  </td>
                )}
                <td className="max-w-[320px] truncate px-3 py-2 text-[12px] text-xyne-fg-secondary" title={reason}>{r.reasonCode ? <span className="font-mono text-[11px]">{r.reasonCode}</span> : null}{r.reasonCode && reason ? " · " : ""}{reason}</td>
                <td className="px-3 py-2 text-[12px]">
                  {path ? <button type="button" className="text-xyne-fg-secondary underline hover:text-xyne-fg-primary" onClick={(e) => { e.stopPropagation(); onOpen(path); }}>{path.startsWith("/v3/chat") ? "conversation" : "run"}</button> : "—"}
                </td>
              </tr>,
              open ? (
                <tr key={`${r.id}-d`} className="border-b border-xyne-border-subtle bg-xyne-surface-subtle/40">
                  <td colSpan={10} className="px-3 py-2 text-[12px] text-xyne-fg-secondary">
                    <div>{r.reasonText}</div>
                    {r.critic && <div className="mt-1">critic, {r.critic.judgeMs ?? "—"} ms after the call: {r.critic.reasonText}</div>}
                    {r.matchedRuleIds.length > 0 && <div className="mt-1 text-xyne-fg-muted">tags: {r.matchedRuleIds.join(", ")}</div>}
                    <div className="mt-1 text-xyne-fg-muted">
                      gate {r.gateMs ?? "—"} ms · judge {r.judgeMs ?? r.critic?.judgeMs ?? "—"} ms · seq {r.orgSequence ?? "unchained"} · call {r.toolCallId ?? "—"} · run {r.runId ?? "—"}{r.scannerVersion ? ` · scanner ${r.scannerVersion}` : ""}{showOrg ? ` · org ${r.orgId}` : ""}
                    </div>
                    {r.argumentsRedacted && <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-xyne-border bg-xyne-surface p-2 font-mono text-[11px] text-xyne-fg-secondary">{r.argumentsRedacted}</pre>}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Stats ─────────────────────────────────────────────────────────── */

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }): ReactElement {
  return (
    <div className={CARD} title={hint}>
      <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</p>
      <p className="mt-1 font-mono text-[20px] text-xyne-fg-primary">{value}</p>
    </div>
  );
}

function StatsView({ stats, agentLabel }: { stats: GovernanceStats | undefined; agentLabel: (slug: string | null) => string }): ReactElement {
  if (!stats) return <p className="py-12 text-[13px] text-xyne-fg-muted">Loading…</p>;
  const total = stats.byDecision.reduce((n, d) => n + d.count, 0);
  const count = (d: string): number => stats.byDecision.find((x) => x.decision === d)?.count ?? 0;
  const maxPerDay = Math.max(1, ...stats.perDay.map((d) => d.allow + d.ask + d.block));
  const lists: Array<[string, Array<readonly [string, number]>]> = [
    ["Most called tools", stats.topTools.map((t) => [t.tool, t.count] as const)],
    ["Calls at elevated or high risk, by agent", stats.highRiskByAgent.map((a) => [agentLabel(a.agent), a.count] as const)],
    ["Outcomes", stats.outcomes.map((o) => [o.outcome, o.count] as const)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Tool calls" value={total} />
        <StatCard label="Blocked" value={count("block")} hint="In shadow: would have been blocked" />
        <StatCard label="Asked" value={count("ask")} hint="In shadow: would have needed approval" />
        <StatCard label="Kill events" value={stats.killEvents} hint="Switches set, cleared and enforced" />
      </div>
      <div className={CARD}>
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
        {lists.map(([title, items]) => (
          <div key={title} className={CARD}>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{title}</p>
            {items.length === 0 ? <p className="text-[12px] text-xyne-fg-muted">none</p> : items.map(([k, v]) => (
              <div key={k} className="flex justify-between text-[13px]"><span className="truncate text-xyne-fg-secondary">{k}</span><span className="font-mono text-xyne-fg-muted">{v}</span></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Kill switches ─────────────────────────────────────────────────── */

const MODE_HELP: Record<string, { title: string; body: string }> = {
  stop: { title: "Stop", body: "New runs for the scope are refused at the door, live runs abort within about 2 seconds, and every tool call is blocked. The agent is off until the switch is cleared or expires." },
  read_only: { title: "Read-only", body: "Calls that only read run. Every other call (write, publish, send, delete, execute, persist, admin) is blocked." },
  ask_all: { title: "Ask-all", body: "Calls that only read, or stay inside the run (a question to the person, the plan), run. Every other MCP call waits for a person's approval, on the same card a write tool uses, even when its grant is allow. Calls to claw's own tools with a side effect (files, memory, skills, shell) have no approval card yet and do not run." },
};
const SCOPE_HELP: Record<string, string> = {
  agent: "one agent, by slug", user: "one person's runs, by user id", mcp_server: "one server type on every agent (e.g. slack)", tool: "one tool name on every agent", run: "one live run, by session id", org: "every agent in this organization", platform: "everything",
};

function KillView({ userId, rows, config, userLabel, onChanged }: { userId: string; rows: KillSwitchRow[]; config: GovernanceConfig | undefined; userLabel: (id: string | null) => string; onChanged: () => void }): ReactElement {
  const { show } = useSnackbar();
  const [form, setForm] = useState({ scopeKind: "agent", scopeId: "", mode: "stop", reason: "", expiresInMinutes: "" });
  const [clearReason, setClearReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const live = rows.filter((k) => !k.clearedAt && (!k.expiresAt || new Date(k.expiresAt) > new Date()));
  const services: Array<[string, GovernanceServiceConfig | null | undefined]> = [["claw-auth", config?.clawAuth], ["claw", config?.claw]];
  const shadowOn = services.filter(([, c]) => c && c.modes["kill"] !== "enforce").map(([n]) => n);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await setKillSwitch(userId, { scopeKind: form.scopeKind, scopeId: form.scopeKind === "platform" ? "*" : form.scopeId.trim(), mode: form.mode, reason: form.reason.trim(), ...(form.expiresInMinutes ? { expiresInMinutes: Number(form.expiresInMinutes) } : {}) });
      show({ variant: "success", title: `${MODE_HELP[form.mode]?.title ?? form.mode} switch set on ${form.scopeKind}${form.scopeKind === "platform" ? "" : ` ${form.scopeId.trim()}`}`, description: "Every pod picks it up within 2 seconds." });
      setForm({ ...form, scopeId: "", reason: "", expiresInMinutes: "" });
      onChanged();
    } catch (err) {
      show({ variant: "error", title: "Kill switch not set", description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  const clear = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await clearKillSwitch(userId, id, (clearReason[id] ?? "").trim());
      show({ variant: "success", title: "Kill switch cleared" });
      onChanged();
    } catch (err) {
      show({ variant: "error", title: "Kill switch not cleared", description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {config && (shadowOn.length > 0 ? (
        <div className="rounded-xl border border-xyne-warning-border bg-xyne-warning-bg px-4 py-3 text-[13px] text-xyne-warning-fg">
          <b>Switches are recorded, not applied, on {shadowOn.join(" and ")}.</b> The kill component is in shadow there: set <code>GOVERNANCE_COMPONENT_MODES=kill=enforce</code> (or remove a <code>kill=shadow</code> override) in that service's environment and restart it. The default is enforce.
        </div>
      ) : (
        <div className="rounded-xl border border-xyne-success-border bg-xyne-success-bg px-4 py-3 text-[13px] text-xyne-success-fg"><b>Switches act on both services.</b> A stop refuses new runs and aborts live ones within about 2 seconds; read-only and ask-all decide every call.</div>
      ))}

      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => (
          <div key={m} className={CARD}>
            <p className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-xyne-fg-primary"><Badge as="span" size="sm" variant={m === "stop" ? "error" : "warning"} label={m.replace("_", " ")} />{MODE_HELP[m]?.title}</p>
            <p className="text-[12px] text-xyne-fg-secondary">{MODE_HELP[m]?.body}</p>
          </div>
        ))}
      </div>

      <div className={CARD}>
        <p className="mb-3 text-[12px] text-xyne-fg-muted">A switch names a scope and a mode. Scopes: {SCOPES.map((s) => `${s.replace("_", " ")} = ${SCOPE_HELP[s]}`).join("; ")}. A reason is required and is recorded with the switch; an expiry clears it on its own.</p>
        <div className="flex flex-wrap items-end gap-2">
          <SelectField className="w-40" label="Scope" value={form.scopeKind} options={opts(SCOPES)} onValueChange={(v) => setForm({ ...form, scopeKind: v ?? "agent" })} />
          {form.scopeKind !== "platform" && <TextField className="w-56" label={form.scopeKind === "agent" ? "Agent slug" : form.scopeKind === "mcp_server" ? "Server type" : form.scopeKind === "tool" ? "Tool name" : form.scopeKind === "run" ? "Session id" : form.scopeKind === "user" ? "User id" : "Org id"} value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })} />}
          <SelectField className="w-36" label="Mode" value={form.mode} options={opts(MODES)} onValueChange={(v) => setForm({ ...form, mode: v ?? "stop" })} />
          <TextField className="min-w-64 flex-1" label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <TextField className="w-32" label="Expires (min)" value={form.expiresInMinutes} onChange={(e) => setForm({ ...form, expiresInMinutes: e.target.value })} />
          <Button variant="destructive" disabled={busy || !form.reason.trim() || (form.scopeKind !== "platform" && !form.scopeId.trim())} onClick={() => void submit()}>Set switch</Button>
        </div>
      </div>

      {rows.length === 0 ? <p className="py-12 text-center text-[13px] text-xyne-fg-muted">No kill switches in the last 7 days.</p> : (
        <div className="overflow-hidden rounded-xl border border-xyne-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                <th className={TH}>Scope</th><th className={TH}>Mode</th><th className={TH}>Reason</th><th className={TH}>Set</th><th className={TH}>Expires</th><th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => {
                const isLive = live.includes(k);
                return (
                  <tr key={k.id} className="border-b border-xyne-border-subtle">
                    <td className="px-3 py-2 text-xyne-fg-primary">{k.scopeKind.replace("_", " ")}{k.scopeKind === "platform" ? "" : ` = ${k.scopeId}`}</td>
                    <td className="px-3 py-2"><Badge as="span" size="sm" variant={k.mode === "stop" ? "error" : "warning"} label={k.mode.replace("_", " ")} /></td>
                    <td className="px-3 py-2 text-xyne-fg-secondary">{k.reason}</td>
                    <td className={TD_TIME}>{when(k.createdAt)} · {k.setByUserId ? userLabel(k.setByUserId) : k.setBy}</td>
                    <td className={TD_TIME}>{k.expiresAt ? when(k.expiresAt) : "—"}</td>
                    <td className="px-3 py-2 text-[12px]">
                      {k.clearedAt ? (
                        <span className="text-xyne-fg-muted">cleared {when(k.clearedAt)} by {userLabel(k.clearedByUserId)}: {k.clearReason}</span>
                      ) : !isLive ? (
                        <span className="text-xyne-fg-muted">expired</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Badge as="span" size="sm" variant="error" label="live" />
                          <TextField className="w-44" placeholder="reason to clear" value={clearReason[k.id] ?? ""} onChange={(e) => setClearReason({ ...clearReason, [k.id]: e.target.value })} />
                          <Button size="sm" variant="secondary" disabled={busy || !(clearReason[k.id] ?? "").trim()} onClick={() => void clear(k.id)}>Clear</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

