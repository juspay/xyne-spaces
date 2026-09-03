/**
 * RunsPageV3 — Observe ▸ Runs: every session, across every agent.
 *
 * This is the cross-agent listing the product did not have: the agent detail
 * Activity tab can only ever answer "what did THIS agent do", so answering
 * "what have I run today" meant opening agents one at a time.
 *
 * Two audiences, one page:
 *   - everyone   → their own runs across all agents (scope=own)
 *   - CLAW_ADMIN → the "All users" switch flips to scope=all, org-scoped, plus
 *                  a user filter. The switch is hidden for non-admins here and
 *                  independently re-checked server-side, so hiding it is a UI
 *                  affordance, not the access control.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ClockCounterClockwiseIcon, ClockIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useAdminStatus } from "../hooks/useAdminStatus";
import { PageLayout } from "./ui/PageLayout";
import { PageHeader } from "./ui/PageHeader";
import { SelectField } from "./ui/SelectField";
import { Search } from "./ui/Search";
import { Switch } from "./ui/Switch";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { Tooltip } from "./ui/Tooltip";
import { useSnackbar } from "./ui/Snackbar";
import { RunRow } from "./runs/RunRow";
import { RunDateRangeFilter } from "./runs/RunDateRangeFilter";
import { RunListFooter } from "./runs/RunListFooter";
import { looksLikeSessionId, runOwnerLabel, rangeToIso, type RunRangePreset } from "../lib/runFormat";
import {
  listAgents,
  listRunsPaged,
  type AgentRunListItem,
  type AgentRunListPage,
  type RunAgentFacet,
  type RunUserFacet,
} from "../../lib/api";

type RunPageSize = 25 | 50 | 100;

const EMPTY_PAGE: AgentRunListPage = { rows: [], total: 0, limit: 50, offset: 0 };

export function RunsPageV3({ userId }: { userId: string }) {
  const { isAdmin } = useAdminStatus();
  const { show: showSnackbar } = useSnackbar();
  const navigate = useNavigate();

  const [page, setPage] = useState<AgentRunListPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState<RunPageSize>(50);
  const [preset, setPreset] = useState<RunRangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [status, setStatus] = useState("");
  const [allUsers, setAllUsers] = useState(false);
  const [userFilter, setUserFilter] = useState("");

  // Facet option lists. They are merged stickily (see `load`) rather than
  // replaced per request, because facets are only asked for on page 1 — paging
  // forward must not empty the dropdowns the user is filtering with.
  const [agentOptions, setAgentOptions] = useState<RunAgentFacet[]>([]);
  const [userOptions, setUserOptions] = useState<RunUserFacet[]>([]);
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());

  const [query, setQuery] = useState("");

  // A role flip (or an admin check that resolves to false after first paint)
  // must not leave an elevated request in flight: without this reset, `allUsers`
  // would still be true and every load would ask for scope=all and 403.
  useEffect(() => {
    if (!isAdmin) {
      setAllUsers(false);
      setUserFilter("");
      setUserOptions([]);
    }
  }, [isAdmin]);

  // Slug → display name for the agent column/filter. The facets only carry
  // slugs; the roster is fetched once so rows can read "Support triage" instead
  // of "support-triage-v2". Failure is non-fatal — labels fall back to the slug.
  useEffect(() => {
    let cancelled = false;
    listAgents(userId, isAdmin)
      .then((rows) => {
        if (cancelled) return;
        setAgentNames(new Map(rows.map((a) => [a.slug, a.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, isAdmin]);

  const agentLabel = useCallback(
    (slug: string) => agentNames.get(slug) ?? slug,
    [agentNames],
  );

  // Debounced, id-shaped slice of the search box. Text queries stay entirely
  // client-side (the product decision was UI-only search for now); only a
  // session id round-trips, because that is the one query the loaded page
  // genuinely cannot answer.
  const [idSearch, setIdSearch] = useState("");
  useEffect(() => {
    const next = looksLikeSessionId(query) ? query.trim() : "";
    if (next === idSearch) return;
    const t = window.setTimeout(() => setIdSearch(next), 250);
    return () => window.clearTimeout(t);
  }, [query, idSearch]);

  // A new id search restarts paging: staying on offset=120 while the result set
  // collapses to one row shows an empty page with a non-zero total.
  useEffect(() => {
    setOffset(0);
  }, [idSearch]);

  const load = useCallback(
    async (opts?: { quiet?: boolean; cancelled?: () => boolean }) => {
      opts?.quiet ? setRefreshing(true) : setLoading(true);
      try {
        const { from, to } = rangeToIso(preset, customFrom, customTo);
        // A session-id-shaped query is answered by the SERVER, not by filtering
        // the page we happen to hold: the run being hunted is usually on some
        // other page (or outside the date window), which is exactly why the
        // client-only version read as "session id search is broken".
        const idQuery = idSearch || undefined;
        const res = await listRunsPaged(userId, {
          // `scope` and `agentSlug` are independent on /runs/paged: scope=all
          // with no slug is the cross-agent admin listing. (The older `listRuns`
          // couples them and silently downgrades to own-runs without a slug —
          // do not "simplify" this back onto that call.)
          scope: isAdmin && allUsers ? "all" : "own",
          ...(agentFilter ? { agentSlug: agentFilter } : {}),
          ...(status ? { status } : {}),
          ...(isAdmin && allUsers && userFilter ? { userId: userFilter } : {}),
          ...(idQuery ? { sessionId: idQuery } : {}),
          from,
          to,
          limit: pageSize,
          offset,
          // Facets are a second aggregate query over the same window; asking for
          // them on every page-forward would double the cost for a list that
          // cannot change while paging.
          ...(offset === 0 ? { facets: true } : {}),
        });
        // Filter changes fire in bursts (a click on a preset pill re-runs this
        // immediately); without the guard a slow earlier response can land after
        // a faster later one and repaint stale rows.
        if (opts?.cancelled?.()) return;
        setPage(res);
        setError("");
        if (res.facets) {
          setAgentOptions(res.facets.agents);
          // `users` is [] under scope=own — keeping the previous list means
          // toggling "All users" off and on again doesn't blank the dropdown.
          if (res.facets.users.length) setUserOptions(res.facets.users);
        }
      } catch (err) {
        if (opts?.cancelled?.()) return;
        const message = err instanceof Error ? err.message : "Failed to load runs";
        setError(message);
        setPage(EMPTY_PAGE);
        showSnackbar({ variant: "error", title: message });
      } finally {
        if (opts?.cancelled?.()) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      userId,
      isAdmin,
      allUsers,
      agentFilter,
      status,
      userFilter,
      preset,
      customFrom,
      customTo,
      pageSize,
      offset,
      // Only the DEBOUNCED id query is a dep. Depending on `query` itself would
      // refetch on every keystroke; depending on neither would leave a pasted
      // session id filtering only the page already on screen — the original bug.
      idSearch,
      showSnackbar,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void load({ cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Two different searches share one box:
  //   * session id  → answered by the server (see `idSearch`), so the rows we
  //                   were handed ARE the result. Filtering them again here
  //                   would be a no-op at best and, on a partial prefix, would
  //                   re-hide rows the server correctly matched.
  //   * free text   → UI-only by design, so it can only see this page. The
  //                   banner under the filter bar says so rather than letting a
  //                   match count imply the whole history was searched.
  const visibleRuns = useMemo(() => {
    if (idSearch) return page.rows;
    const q = query.trim().toLowerCase();
    if (!q) return page.rows;
    return page.rows.filter((run) => {
      if (run.sessionId.toLowerCase().includes(q)) return true;
      if (run.task.toLowerCase().includes(q)) return true;
      return allUsers ? runOwnerLabel(run).toLowerCase().includes(q) : false;
    });
  }, [page.rows, query, allUsers, idSearch]);

  const agentSelectOptions = useMemo(
    () => [
      { value: "", label: `All agents (${agentOptions.length})` },
      ...agentOptions.map((a) => ({
        value: a.agentSlug,
        label: `${agentLabel(a.agentSlug)} (${a.count})`,
      })),
    ],
    [agentOptions, agentLabel],
  );

  const userSelectOptions = useMemo(
    () => [
      { value: "", label: `All users (${userOptions.length})` },
      ...userOptions.map((u) => ({
        value: u.userId,
        label: `${u.name || u.email || `user ${u.userId.slice(0, 8)}`} (${u.count})`,
      })),
    ],
    [userOptions],
  );

  const filterBar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <RunDateRangeFilter
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          onChange={(next) => {
            setOffset(0);
            setPreset(next.preset);
            setCustomFrom(next.customFrom);
            setCustomTo(next.customTo);
          }}
        />

        <SelectField
          className="w-[220px]"
          value={agentFilter}
          options={agentSelectOptions}
          onValueChange={(v) => {
            setOffset(0);
            setAgentFilter(v ?? "");
          }}
        />

        <SelectField
          className="w-[150px]"
          value={status}
          options={[
            { value: "", label: "All statuses" },
            { value: "running", label: "Running" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          onValueChange={(v) => {
            setOffset(0);
            setStatus(v ?? "");
          }}
        />

        {isAdmin && (
          <Tooltip content="Show every user's runs in your organization. Runs that used a user's private token are hidden.">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-xyne-fg-secondary">
              <Switch
                checked={allUsers}
                ariaLabel="All users"
                onChange={(v) => {
                  setOffset(0);
                  setAllUsers(v);
                  // The user filter belongs to the elevated listing only —
                  // leaving it set would send `userId` with scope=own, a 400.
                  if (!v) setUserFilter("");
                }}
              />
              All users
            </label>
          </Tooltip>
        )}

        {isAdmin && allUsers && (
          <SelectField
            className="w-[220px]"
            value={userFilter}
            options={userSelectOptions}
            onValueChange={(v) => {
              setOffset(0);
              setUserFilter(v ?? "");
            }}
          />
        )}

        <Search
          className="min-w-[240px] flex-1"
          value={query}
          onChange={setQuery}
          placeholder="Filter this page (session id or task)…"
          data-id="runs-search"
        />

        <SelectField
          className="w-[100px]"
          value={String(pageSize)}
          options={[25, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
          onValueChange={(v) => {
            setOffset(0);
            setPageSize(Number(v ?? 50) as RunPageSize);
          }}
        />
      </div>

      {idSearch !== "" ? (
        <p className="text-[11px] text-xyne-fg-tertiary">
          Searching every run you can see for session id <span className="font-mono">{idSearch}</span> —
          the date filter does not apply to an id lookup.
        </p>
      ) : query.trim() !== "" ? (
        <p className="text-[11px] text-xyne-fg-tertiary">
          Filtering the {page.rows.length} runs on this page — {visibleRuns.length} match. This does not
          search the other {Math.max(0, page.total - page.rows.length)} runs in range; narrow the date,
          agent or user filter instead. Paste a session id to search all runs.
        </p>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (error) {
    body = (
      <div className="p-6">
        <div className="rounded-xl bg-red-500/10 text-red-500 p-4 text-[13px]">{error}</div>
      </div>
    );
  } else if (loading) {
    // Skeleton mirrors the real RunRow layout so the transition doesn't jitter.
    body = (
      <div className="flex flex-col gap-2 p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-xyne-border-subtle px-4 py-3"
          >
            <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-[60%] rounded" />
              <Skeleton className="h-2.5 w-[40%] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (page.rows.length === 0) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No runs in this range</p>
        <p className="max-w-[320px] text-[13px] text-xyne-fg-tertiary">
          {allUsers
            ? "No user in your organization ran an agent inside the selected window."
            : "You haven't run an agent inside the selected window."}
        </p>
        {preset !== "365d" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOffset(0);
              setPreset("365d");
            }}
          >
            Widen to 1 year
          </Button>
        )}
      </div>
    );
  } else if (visibleRuns.length === 0) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">
          {idSearch ? "No run with that session id" : "No runs match on this page"}
        </p>
        <p className="max-w-[320px] text-[13px] text-xyne-fg-tertiary">
          {idSearch
            ? "That id was searched across every run you can see, ignoring the date filter — nothing matched it."
            : `Text search only looks at the ${page.rows.length} runs currently loaded. Clear it, narrow the date/agent/user filter, or paste a session id to search all runs.`}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2 p-6">
        {visibleRuns.map((run) => (
          <div key={run.sessionId}>
            <div className="min-w-0 flex-1">
              <RunRow
                run={run}
                showOwner={allUsers}
                // Cross-agent listing, so each row names its own agent. RunRow
                // renders it inside the card; the Activity tab omits the prop
                // because every row there is the same agent.
                agentLabel={agentLabel(run.agentSlug)}
                // Opens the in-app conversation replay. Needs a conversationId —
                // API/scheduled runs without one stay non-clickable. Another
                // user's run carries &allRuns=1 so the chat view opts into the
                // cross-user read path (the backend gates that on admin + flag).
                onOpen={
                  run.conversationId
                    ? () =>
                        navigate(
                          `/v3/chat?agent=${encodeURIComponent(run.agentSlug)}&conversation=${encodeURIComponent(run.conversationId!)}${
                            run.userId !== userId ? "&allRuns=1" : ""
                          }`,
                        )
                    : undefined
                }
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Runs"
          description={
            isAdmin && allUsers
              ? "Every run in your organization, newest first."
              : "Every session you've run, newest first."
          }
          icon={<ClockCounterClockwiseIcon size={22} weight="duotone" className="text-xyne-fg-muted" />}
          actions={
            <Button
              size="sm"
              variant="secondary"
              disabled={refreshing || loading}
              leadingIcon={<ArrowClockwiseIcon size={14} className={refreshing ? "animate-spin" : ""} />}
              onClick={() => void load({ quiet: true })}
            >
              Refresh
            </Button>
          }
        />
      }
      filterTab={filterBar}
      body={body}
      footer={
        <div className="px-6 py-3">
          <RunListFooter
            total={page.total}
            limit={pageSize}
            offset={offset}
            loading={loading || refreshing}
            onOffsetChange={setOffset}
          />
        </div>
      }
    />
  );
}
