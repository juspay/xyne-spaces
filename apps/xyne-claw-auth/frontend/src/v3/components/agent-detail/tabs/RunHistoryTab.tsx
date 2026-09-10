import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ClockIcon } from "@phosphor-icons/react";
import { listRunsPaged } from "../../../../lib/api";
import type { AgentRunListPage, RunUserFacet } from "../../../../lib/api";
import { Skeleton } from "../../ui/Skeleton";
import { Button } from "../../ui/Button";
import { SelectField } from "../../ui/SelectField";
import { RunRow } from "../../runs/RunRow";
import { RunDateRangeFilter } from "../../runs/RunDateRangeFilter";
import { RunListFooter } from "../../runs/RunListFooter";
import { runOwnerLabel, rangeToIso, type RunRangePreset } from "../../../lib/runFormat";

interface Props {
  agentSlug: string;
  userId: string;
  canViewAllRuns: boolean;
}

const PAGE_SIZE = 25;

// Sentinel page so every consumer below reads `page.rows` / `page.total`
// unconditionally — a nullable page would force a null-guard at each of the
// four render branches and at the footer.
const EMPTY_RUN_PAGE: AgentRunListPage = { rows: [], total: 0, limit: PAGE_SIZE, offset: 0 };

export function RunHistoryTab({ agentSlug, userId, canViewAllRuns }: Props) {
  const navigate = useNavigate();
  const [page, setPage] = useState<AgentRunListPage>(EMPTY_RUN_PAGE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Without this the bare catch below turns every 400/403/5xx into
  // EMPTY_RUN_PAGE, and the empty-state branches then assert "This agent
  // hasn't been executed yet" about a request the server REFUSED. On an audit
  // surface a refusal and a genuinely empty result must never render alike.
  const [error, setError] = useState("");
  // Elevated view: admins, owners, and contributors can show every user's runs
  // of this agent. The server ACL-filters by usedUserToken, so other users'
  // runs that touched their private token are never returned.
  const [allUsers, setAllUsers] = useState(false);
  const [offset, setOffset] = useState(0);
  const [preset, setPreset] = useState<RunRangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // "" = every user. Server-side now: the old client-side variant could only
  // filter whatever the single fetch happened to have loaded.
  const [userFilter, setUserFilter] = useState("");
  const [userOptions, setUserOptions] = useState<RunUserFacet[]>([]);
  // Free text stays client-side and therefore only ever covers the current page
  // — A6's hint below says so out loud.
  const [query, setQuery] = useState("");

  // First load paints skeletons; every later filter-driven refetch is "quiet"
  // so the list doesn't collapse to skeletons on each keystroke of the date
  // inputs. Ref, not state, so flipping it never schedules a render of its own.
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (canViewAllRuns) return;
    setAllUsers(false);
    setUserFilter("");
    setQuery("");
    setOffset(0);
    setUserOptions([]);
  }, [canViewAllRuns]);

  // `isCancelled` is threaded in from the effect rather than read off a ref:
  // the effect's cleanup runs before the next effect, so the flag it closes
  // over is exactly "a newer request has started" — without it, toggling
  // filters quickly can land an older response on top of a newer one.
  const load = useCallback(
    async (quiet: boolean, isCancelled: () => boolean) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      const { from, to } = rangeToIso(preset, customFrom, customTo);
      try {
        const res = await listRunsPaged(userId, {
          agentSlug,
          scope: allUsers ? "all" : "own",
          ...(allUsers && userFilter ? { userId: userFilter } : {}),
          from,
          to,
          limit: PAGE_SIZE,
          offset,
          // One extra groupBy, paid only on the first page: the option list is
          // invariant across pages of the same filter set.
          ...(allUsers && offset === 0 ? { facets: true } : {}),
        });
        if (isCancelled()) return;
        setPage(res);
        // Overwrite only when the response actually carried facets, otherwise
        // paging (or selecting a user, which narrows the counts) would collapse
        // the dropdown to the single option still present in the result.
        if (res.facets) setUserOptions(res.facets.users);
        setError("");
      } catch (err) {
        if (isCancelled()) return;
        setError(err instanceof Error ? err.message : "Failed to load runs");
        setPage(EMPTY_RUN_PAGE);
      } finally {
        if (!isCancelled()) {
          loadedOnce.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [agentSlug, userId, allUsers, offset, preset, customFrom, customTo, userFilter],
  );

  useEffect(() => {
    let cancelled = false;
    void load(loadedOnce.current, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Free-text filter over THIS page only — never the full `page.total`.
  const visibleRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return page.rows;
    return page.rows.filter((r) =>
      `${r.sessionId} ${r.task} ${runOwnerLabel(r)}`.toLowerCase().includes(q),
    );
  }, [page.rows, query]);

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

  // Filters live above the body so they're reachable even when the result set
  // is empty (the common "No runs yet" case).
  const controls = (
    <div className="flex flex-col gap-2.5 border-b border-xyne-border-subtle px-6 py-2.5">
      <div className="flex items-center justify-between gap-3">
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
        {canViewAllRuns && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-[12px] text-xyne-fg-tertiary">All Runs</span>
            <label
              className="flex items-center gap-2 select-none"
              title="Show every user's runs of this agent. Runs that used a user's private token are hidden."
            >
              <input
                type="checkbox"
                checked={allUsers}
                onChange={(e) => {
                  setOffset(0);
                  setAllUsers(e.target.checked);
                  if (!e.target.checked) {
                    setUserFilter("");
                    setQuery("");
                    setUserOptions([]);
                  }
                }}
                className="h-4 w-4 cursor-pointer accent-xyne-accent"
                aria-label="Show all users' runs"
              />
              <span className="text-[12px] text-xyne-fg-primary">{allUsers ? "On" : "Off"}</span>
            </label>
          </div>
        )}
      </div>
      {allUsers && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {/* User filter — the primary "find runs by who ran them" control,
                backed by server facets so the options are every user with runs
                in the window, not just those on the current page. */}
            <SelectField
              className="w-[220px] shrink-0"
              value={userFilter}
              options={userSelectOptions}
              placeholder="All users"
              // SelectField emits null when the field is cleared, and "" is a
              // real selectable option here — coalescing keeps both paths on
              // the same "every user" value instead of sending userId=null.
              onValueChange={(v: string | null) => {
                setOffset(0);
                setUserFilter(v ?? "");
              }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter this page (session id, task, user)…"
              className="h-9 flex-1 rounded-md border border-xyne-border-subtle bg-xyne-surface px-2.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border focus:outline-none"
              aria-label="Filter runs on this page"
            />
            {(userFilter || query) && (
              <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
                {visibleRuns.length} / {page.rows.length} on this page
              </span>
            )}
          </div>
          {query && (
            <p className="text-[11px] text-xyne-fg-muted">
              Filters the {page.rows.length} runs on this page only — narrow the date range or
              user filter to search further.
            </p>
          )}
        </div>
      )}
    </div>
  );

  let body: ReactNode;
  if (error) {
    // Ahead of the two `page.total === 0` branches on purpose: EMPTY_RUN_PAGE is
    // also what the catch installs, so an error checked second would be painted
    // over by "No runs in this range". Same banner as RunsPageV3.
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
  } else if (page.total === 0 && preset !== "365d") {
    // Empty *because of the window*, which is the new default failure mode now
    // that the tab shows 30 days instead of "the last 50 runs, any age" — say
    // so and offer the widest preset rather than claiming the agent never ran.
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No runs in this range</p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          Nothing matched the selected dates{allUsers && userFilter ? " and user" : ""}. Try a wider
          window.
        </p>
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
      </div>
    );
  } else if (page.total === 0) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">
          {allUsers ? "No runs from any user yet" : "No runs yet"}
        </p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          This agent hasn&apos;t been executed yet. Runs will appear here once the agent processes a task.
        </p>
      </div>
    );
  } else if (visibleRuns.length === 0) {
    // Have runs on this page, but the free-text filter excluded them all.
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <ClockIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No matching runs</p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          No runs on this page match the current filter. Clear the search box, or change the user or
          date filter to look further.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2 p-6">
        {visibleRuns.map((run) => (
          <RunRow
            key={run.sessionId}
            run={run}
            showOwner={allUsers}
            // Open the in-app debug conversation view (chat replay + tool-call
            // groups). Needs a conversationId — API/scheduled runs without one
            // stay non-clickable. When opening ANOTHER user's run, pass
            // &allRuns=1 so the chat view opts into the cross-user read path
            // (backend gates on admin + this flag). Own runs open own-only, so a
            // shared twin thread never renders a confusing mix of other people's
            // turns unless explicitly inspected from here.
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
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {controls}
      {/* The list scrolls, the footer stays pinned — otherwise the only way to
          reach Next on a full page is to scroll past 25 rows. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      <div className="border-t border-xyne-border-subtle px-6 py-3">
        <RunListFooter
          total={page.total}
          limit={PAGE_SIZE}
          offset={offset}
          loading={loading || refreshing}
          onOffsetChange={setOffset}
        />
      </div>
    </div>
  );
}
