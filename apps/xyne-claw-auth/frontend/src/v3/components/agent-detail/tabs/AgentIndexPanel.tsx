import { useCallback, useEffect, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CircleNotchIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  getAgentIndexDetail,
  getUsagePatternFile,
  writeUsagePatternFile,
  searchAgentIndex,
  syncAgentIndex,
  triggerUsagePatternSynthesis,
  getUsagePatternJob,
  type UsagePatternJob,
  type AgentIndexDocument,
  type AgentIndexKind,
  type AgentIndexMatch,
  type AgentIndexStatus,
  type UsagePatternFile,
  type UsagePatternSynthesis,
} from "../../../../lib/api";
import { useAdminStatus } from "../../../hooks/useAdminStatus";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { TextField } from "../../ui/TextField";

interface Props {
  agentSlug: string;
}

type Detail = { status: AgentIndexStatus; documents: AgentIndexDocument[] };
type Tone = "success" | "warning" | "error";

const ALL_KINDS: AgentIndexKind[] = ["identity", "persona", "usage"];

const TONE_CARD: Record<Tone, string> = {
  success: "border-xyne-success-border bg-xyne-success-bg",
  warning: "border-xyne-warning-border bg-xyne-warning-bg",
  error: "border-xyne-error-border bg-xyne-error-bg",
};

const TONE_TEXT: Record<Tone, string> = {
  success: "text-xyne-success-fg",
  warning: "text-xyne-warning-fg",
  error: "text-xyne-error-fg",
};

/** A synthesis pass is an LLM call; give it room but never spin forever. */
/** Server-shaped numbers, rendered safely. A missing field used to take the
 *  whole panel down with "cannot read properties of undefined". */
function count(value: number | undefined | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "0";
}

const SYNTHESIS_WAIT_MS = 180_000;
const SYNTHESIS_POLL_MS = 3_000;
const DAY_MS = 86_400_000;
const RANGE_PRESETS = [7, 30, 90];
const DEFAULT_RANGE_DAYS = 30;

const DATE_INPUT_CLASS =
  "h-9 w-full rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 text-[13px] text-xyne-fg-primary outline-none transition-[border-color] focus:border-xyne-border-focus disabled:opacity-50";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** `<input type="date">` speaks local YYYY-MM-DD, the API speaks ISO instants. */
function toDayInput(ms: number): string {
  const date = new Date(ms);
  const local = new Date(ms - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dayToIso(day: string, endOfDay: boolean): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

function describeHealth(status: AgentIndexStatus): { tone: Tone; label: string; detail: string } {
  if (status.indexed.length === 0) {
    return {
      tone: "error",
      label: "Not indexed",
      detail: "Nothing is stored for this agent — it cannot be found by need.",
    };
  }
  if (status.stale) {
    return {
      tone: "warning",
      label: "Stale",
      detail: `The agent changed at ${formatTime(status.liveUpdatedAt)}, after it was last indexed.`,
    };
  }
  if (status.missing.length > 0) {
    return {
      tone: "warning",
      label: "Partially indexed",
      detail: "Some documents were never written, so part of this agent is unsearchable.",
    };
  }
  return {
    tone: "success",
    label: "In sync",
    detail: "Every document matches the live agent.",
  };
}

export function AgentIndexPanel({ agentSlug }: Props) {
  // Re-sync is admin-gated server-side, so agent-level edit rights are not enough.
  const { isAdmin } = useAdminStatus();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [patternFile, setPatternFile] = useState<UsagePatternFile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [savingFile, setSavingFile] = useState(false);
  const [patternError, setPatternError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [outcome, setOutcome] = useState<UsagePatternSynthesis | null>(null);
  const [rangeStart, setRangeStart] = useState(() => toDayInput(Date.now() - DEFAULT_RANGE_DAYS * DAY_MS));
  const [rangeEnd, setRangeEnd] = useState(() => toDayInput(Date.now()));

  const [need, setNeed] = useState("");
  const [matches, setMatches] = useState<AgentIndexMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        const next = await getAgentIndexDetail(agentSlug);
        if (isCancelled()) return;
        setDetail(next);
        setError("");
      } catch (err) {
        if (isCancelled()) return;
        setError(errorText(err, "Failed to load the agent index."));
        setDetail(null);
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [agentSlug],
  );

  const loadPatterns = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        const file = await getUsagePatternFile(agentSlug);
        if (isCancelled()) return;
        setPatternFile(file);
        setPatternError("");
      } catch (err) {
        if (isCancelled()) return;
        setPatternFile(null);
        setPatternError(errorText(err, "Failed to load usage patterns."));
      }
    },
    [agentSlug],
  );

  async function saveFile(): Promise<void> {
    if (draft === null) return;
    setSavingFile(true);
    setPatternError("");
    try {
      setPatternFile(await writeUsagePatternFile(agentSlug, draft));
      setDraft(null);
    } catch (err) {
      setPatternError(errorText(err, "Failed to save the usage-pattern file."));
    } finally {
      setSavingFile(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setExpanded(null);
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setOutcome(null);
    setGenError("");
    void loadPatterns(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadPatterns]);

  async function resync(): Promise<void> {
    setSyncing(true);
    setSyncError("");
    try {
      await syncAgentIndex(agentSlug);
      await load(() => false);
    } catch (err) {
      setSyncError(errorText(err, "Re-sync failed."));
    } finally {
      setSyncing(false);
    }
  }

  function applyPreset(days: number): void {
    setRangeStart(toDayInput(Date.now() - days * DAY_MS));
    setRangeEnd(toDayInput(Date.now()));
  }

  /** Polls until the pass reaches a terminal state. Gives up quietly rather
   *  than spinning forever: the file below is refreshed either way, and a poll
   *  that lands on another replica correctly sees no job at all. */
  async function waitForSynthesis(slug: string): Promise<UsagePatternJob | null> {
    const deadline = Date.now() + SYNTHESIS_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SYNTHESIS_POLL_MS));
      const job = await getUsagePatternJob(slug).catch(() => null);
      if (job === null || job.status === "done" || job.status === "error") return job;
    }
    return null;
  }

  async function generatePatterns(): Promise<void> {
    if (generating) return;
    setGenerating(true);
    setGenError("");
    setOutcome(null);
    try {
      const started = await triggerUsagePatternSynthesis(
        agentSlug,
        dayToIso(rangeStart, false),
        dayToIso(rangeEnd, true),
      );
      if (started.job.status === "busy") {
        setGenError(`${started.job.running} other syntheses are running. Try again in a moment.`);
        return;
      }
      // The pass runs on the server; the response only says it began. Poll for
      // the result rather than holding the request open, which is what used to
      // time out at the gateway.
      const finished = await waitForSynthesis(agentSlug);
      if (finished?.status === "error") {
        setGenError(finished.error);
      } else if (finished?.status === "done") {
        setOutcome({ ...finished.outcome, window: started.window });
      }
      await Promise.all([loadPatterns(() => false), load(() => false)]);
    } catch (err) {
      setGenError(errorText(err, "Usage pattern synthesis failed."));
    } finally {
      setGenerating(false);
    }
  }

  async function runSearch(): Promise<void> {
    const query = need.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      setMatches(await searchAgentIndex(query, 10));
    } catch (err) {
      setSearchError(errorText(err, "Recall test failed."));
      setMatches(null);
    } finally {
      setSearching(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 px-4 py-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-xl border border-xyne-error-border bg-xyne-error-bg p-3 text-[12px] text-xyne-error-fg">
          {error || "The agent index is unavailable."}
        </div>
      </div>
    );
  }

  const { status, documents } = detail;
  const health = describeHealth(status);
  const promptDrift = status.promptVersion !== status.indexedPromptVersion;
  const thisAgentRank = matches?.findIndex((match) => match.slug === agentSlug) ?? -1;
  const humanEdited = patternFile?.humanEdited === true;
  const rangeInvalid = rangeStart !== "" && rangeEnd !== "" && rangeStart > rangeEnd;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className={`rounded-xl border p-3 ${TONE_CARD[health.tone]}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={`text-[13px] font-semibold ${TONE_TEXT[health.tone]}`}>{health.label}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-xyne-fg-secondary">{health.detail}</div>
          </div>
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              disabled={syncing}
              onClick={() => void resync()}
              leadingIcon={
                syncing ? (
                  <CircleNotchIcon size={13} className="animate-spin" />
                ) : (
                  <ArrowsClockwiseIcon size={13} />
                )
              }
            >
              {syncing ? "Re-syncing…" : "Re-sync"}
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {ALL_KINDS.map((kind) => (
            <Badge
              key={kind}
              as="span"
              size="sm"
              variant={status.indexed.includes(kind) ? "success" : "error"}
              dot
              label={status.indexed.includes(kind) ? kind : `${kind} missing`}
            />
          ))}
        </div>

        {promptDrift && (
          <div className="mt-3 rounded-lg border border-xyne-warning-border bg-xyne-surface-subtle p-2.5 text-[12px] text-xyne-fg-secondary">
            Prompt changed without a re-sync — live is{" "}
            <span className="font-mono text-xyne-fg-primary">v{status.promptVersion ?? "—"}</span>, indexed is{" "}
            <span className="font-mono text-xyne-fg-primary">v{status.indexedPromptVersion ?? "—"}</span>. Recall still
            answers with the old prompt.
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-3">
          <div>
            <dt className="text-xyne-fg-tertiary">Agent updated</dt>
            <dd className="text-xyne-fg-primary">{formatTime(status.liveUpdatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xyne-fg-tertiary">Index written</dt>
            <dd className="text-xyne-fg-primary">{formatTime(status.indexedUpdatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xyne-fg-tertiary">Indexed characters</dt>
            <dd className="font-mono text-xyne-fg-primary">{count(status.chars)}</dd>
          </div>
        </dl>

        {syncError && <div className="mt-2 text-[11px] text-xyne-error-fg">{syncError}</div>}
      </div>

      <section>
        <div className="mb-2 text-[12px] font-semibold text-xyne-fg-secondary">
          Stored documents ({documents.length})
        </div>
        {documents.length === 0 ? (
          <div className="rounded-xl border border-xyne-border bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-tertiary">
            The bank holds nothing for this agent yet.
            {isAdmin ? " Re-sync to write its documents." : ""}
          </div>
        ) : (
          <div className="divide-y divide-xyne-border overflow-hidden rounded-xl border border-xyne-border">
            {documents.map((doc) => {
              const key = `${doc.kind}:${doc.contentHash ?? doc.indexedAt ?? ""}`;
              const open = expanded === key;
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : key)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-xyne-surface-subtle"
                  >
                    <CaretRightIcon
                      size={12}
                      className={`shrink-0 text-xyne-fg-tertiary transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <Badge as="span" size="sm" label={doc.kind} />
                    <span className="font-mono text-[11px] text-xyne-fg-tertiary">
                      {count(doc.chars)} chars
                    </span>
                    {doc.chunks > 1 && (
                      <span
                        className="font-mono text-[11px] text-xyne-fg-tertiary"
                        title="Stored as several chunks because it exceeds the bank's chunk size. Searched as one document."
                      >
                        {doc.chunks} chunks
                      </span>
                    )}
                    <span className="ml-auto truncate text-[11px] text-xyne-fg-tertiary">
                      {formatTime(doc.indexedAt)}
                    </span>
                  </button>
                  {open && (
                    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words border-t border-xyne-border bg-xyne-surface-sunken px-3 py-2.5 font-mono text-[12px] leading-relaxed text-xyne-fg-primary">
                      {doc.text}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-1 text-[12px] font-semibold text-xyne-fg-secondary">Usage patterns</div>
        <div className="mb-2 text-[12px] leading-relaxed text-xyne-fg-tertiary">
          What people actually bring to this agent, distilled from its run history — including where it does not
          deliver. Stored as a shared memory file anyone can correct, and as the searchable{" "}
          <span className="font-mono text-xyne-fg-secondary">usage</span> document.
        </div>

        {patternError && (
          <div className="mb-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg p-2.5 text-[12px] text-xyne-error-fg">
            {patternError}
          </div>
        )}

        {patternFile ? (
          <div className="overflow-hidden rounded-xl border border-xyne-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-xyne-border bg-xyne-surface-subtle px-3 py-2">
              {humanEdited ? (
                <Badge as="span" size="sm" variant="info" label="edited by a human" />
              ) : (
                <Badge as="span" size="sm" label="written by the synthesizer" />
              )}
              <span className="text-[11px] text-xyne-fg-tertiary">
                {patternFile.updatedBy ?? "unknown"} · {formatTime(patternFile.updatedAt)}
              </span>
              <span className="ml-auto font-mono text-[11px] text-xyne-fg-tertiary">
                {count(patternFile.chars)} chars
              </span>
              {isAdmin && draft === null && (
                <Button size="sm" variant="secondary" onClick={() => setDraft(patternFile.content)}>
                  Edit
                </Button>
              )}
            </div>
            {humanEdited && (
              <div className="border-b border-xyne-border bg-xyne-info-bg px-3 py-2 text-[12px] leading-relaxed text-xyne-info-fg">
                A person edited this file, so the synthesizer will not overwrite it. Their wording stands until
                someone clears it.
              </div>
            )}
            {draft === null ? (
              <div className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words bg-xyne-surface px-3 py-2.5 text-[12px] leading-relaxed text-xyne-fg-primary">
                {patternFile.content}
              </div>
            ) : (
              <div className="bg-xyne-surface px-3 py-2.5">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={savingFile}
                  rows={16}
                  className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2 font-mono text-[12px] leading-relaxed text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-50"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" onClick={() => void saveFile()} disabled={savingFile}>
                    {savingFile ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={savingFile}>
                    Cancel
                  </Button>
                  <span className="text-[11px] text-xyne-fg-tertiary">
                    Saving marks this file as yours — the synthesizer will stop overwriting it.
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          !patternError && (
            <div className="rounded-xl border border-xyne-border bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-tertiary">
              Nothing has been distilled from this agent&apos;s runs yet.
              {isAdmin ? " Pick a window below and generate it." : ""}
            </div>
          )
        )}

        {isAdmin && (
          <div className="mt-2 rounded-xl border border-xyne-border bg-xyne-surface p-3">
            <div className="text-[12px] font-medium text-xyne-fg-secondary">Generate from a time window</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {RANGE_PRESETS.map((days) => (
                <Button
                  key={days}
                  variant="ghost"
                  size="sm"
                  disabled={generating}
                  onClick={() => applyPreset(days)}
                >
                  Last {days} days
                </Button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-xyne-fg-secondary">From</span>
                <input
                  type="date"
                  value={rangeStart}
                  max={rangeEnd || undefined}
                  disabled={generating}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className={DATE_INPUT_CLASS}
                />
              </label>
              <label className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                <span className="text-[12px] font-medium text-xyne-fg-secondary">To</span>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart || undefined}
                  disabled={generating}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className={DATE_INPUT_CLASS}
                />
              </label>
              <Button
                variant="primary"
                size="md"
                disabled={generating || rangeInvalid}
                onClick={() => void generatePatterns()}
                leadingIcon={
                  generating ? <CircleNotchIcon size={13} className="animate-spin" /> : <SparkleIcon size={13} />
                }
              >
                {generating ? "Analysing runs…" : "Generate"}
              </Button>
            </div>

            {rangeInvalid && (
              <div className="mt-2 text-[11px] text-xyne-error-fg">The end date must be after the start date.</div>
            )}

            {generating && (
              <div className="mt-2 text-[11px] text-xyne-fg-tertiary">
                Reading the runs in this window and writing the summary — this takes tens of seconds.
              </div>
            )}

            {genError && (
              <div className="mt-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg p-2.5 text-[12px] text-xyne-error-fg">
                {genError}
              </div>
            )}

            {outcome && !genError && (
              outcome.patternsWritten === 0 ? (
                <div className="mt-2 rounded-lg border border-xyne-info-border bg-xyne-info-bg p-2.5 text-[12px] leading-relaxed text-xyne-info-fg">
                  Nothing was written, and that is a normal outcome.{" "}
                  {outcome.skipped ?? "The window did not hold enough distinct runs from enough distinct people."} A
                  pattern has to show up repeatedly, across several users, before it is worth routing on — one run is
                  an incident. Analysed {count(outcome.runCount)} run
                  {outcome.runCount === 1 ? "" : "s"} from {count(outcome.distinctUsers)} user
                  {outcome.distinctUsers === 1 ? "" : "s"}. Widen the window and try again.
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-xyne-success-border bg-xyne-success-bg p-2.5 text-[12px] leading-relaxed text-xyne-success-fg">
                  Wrote {count(outcome.patternsWritten)} pattern
                  {outcome.patternsWritten === 1 ? "" : "s"} ({count(outcome.chars)} chars) from{" "}
                  {count(outcome.runCount)} run{outcome.runCount === 1 ? "" : "s"} across{" "}
                  {count(outcome.distinctUsers)} user{outcome.distinctUsers === 1 ? "" : "s"}.
                </div>
              )
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-1 text-[12px] font-semibold text-xyne-fg-secondary">Recall tester</div>
        <div className="mb-2 text-[12px] leading-relaxed text-xyne-fg-tertiary">
          Describe a need the way an orchestrator would, then check whether this agent comes back and where it ranks.
        </div>
        <form
          className="flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <div className="flex-1">
            <TextField
              value={need}
              onChange={(event) => setNeed(event.target.value)}
              placeholder="e.g. summarise a customer call and file follow-ups"
              disabled={searching}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={searching || need.trim().length === 0}
            leadingIcon={
              searching ? (
                <CircleNotchIcon size={13} className="animate-spin" />
              ) : (
                <MagnifyingGlassIcon size={13} />
              )
            }
          >
            {searching ? "Searching…" : "Test recall"}
          </Button>
        </form>

        {searchError && (
          <div className="mt-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg p-2.5 text-[12px] text-xyne-error-fg">
            {searchError}
          </div>
        )}

        {matches !== null && !searchError && (
          matches.length === 0 ? (
            <div className="mt-2 rounded-xl border border-xyne-border bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-tertiary">
              No agent in the bank matched this need — this agent would not be found for it. Try wording the need with
              the vocabulary its prompt actually uses, or re-sync if the status above is stale.
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              {thisAgentRank === -1 && (
                <div className="rounded-lg border border-xyne-warning-border bg-xyne-warning-bg p-2.5 text-[12px] text-xyne-warning-fg">
                  This agent is not in the top {matches.length} for that need. The winners below show which wording the
                  bank rewards.
                </div>
              )}
              {matches.map((match, index) => {
                const isThis = match.slug === agentSlug;
                return (
                  <div
                    key={`${match.slug}-${index}`}
                    className={`rounded-xl border p-2.5 ${
                      isThis
                        ? "border-xyne-border-focus bg-xyne-surface-subtle"
                        : "border-xyne-border bg-xyne-surface"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-xyne-fg-tertiary">#{index + 1}</span>
                      <span className="font-mono text-[12px] font-semibold text-xyne-fg-primary">
                        {match.score.toFixed(3)}
                      </span>
                      <span className="truncate text-[13px] text-xyne-fg-primary">{match.slug}</span>
                      {isThis && <Badge as="span" size="sm" variant="info" label="this agent" />}
                      <span className="ml-auto flex flex-wrap items-center gap-1">
                        {match.matchedKinds.map((kind) => (
                          <Badge key={kind} as="span" size="sm" label={kind} />
                        ))}
                      </span>
                    </div>
                    {match.evidence && (
                      <div className="mt-1.5 line-clamp-3 font-mono text-[11px] leading-relaxed text-xyne-fg-tertiary">
                        {match.evidence}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </section>
    </div>
  );
}
