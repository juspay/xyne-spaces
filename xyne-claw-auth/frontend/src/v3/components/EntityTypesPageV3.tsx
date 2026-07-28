/**
 * EntityTypesPageV3 — discover a channel's entity-type vocabulary.
 *
 * Pick a channel, optionally describe what it's about, and run type discovery:
 * the pipeline reads the channel's threads and tickets, asks the model what
 * kinds of things get talked about, and pauses with a proposed type set.
 *
 * You then approve explicitly — nothing is approved by default, and rules are
 * editable inline, because the rule text goes verbatim into the extraction
 * prompt and is the main lever on precision. Approving writes the channel's
 * full type set onto its Vespa document, so search can filter by it.
 *
 * A run takes minutes (one LLM call per document batch), so this polls rather
 * than blocking on the request.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  SpinnerGapIcon,
  TagIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { TextField } from "./ui/TextField";
import { PageHeader } from "./ui/PageHeader";
import { PageLayout } from "./ui/PageLayout";
import { useSnackbar } from "./ui/Snackbar";
import {
  approveEntityTypes,
  getEntityExtractionRun,
  getEntityExtractionTypes,
  listSpacesChannels,
  resyncChannelEntityTypes,
  startEntityExtractionRun,
  type EntityExtractionRun,
  type ProposedEntityType,
  type SpacesChannel,
} from "../../lib/api";

const STAGE_LABEL: Record<string, string> = {
  FETCHING_MESSAGES: "Reading channel history",
  DISCOVERING_TYPES: "Discovering types",
  DONE: "Done",
};

interface Props {
  userId: string;
}

export function EntityTypesPageV3({ userId }: Props) {
  const { show: showSnackbar } = useSnackbar();

  const [query, setQuery] = useState("");
  const [channels, setChannels] = useState<SpacesChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channel, setChannel] = useState<SpacesChannel | null>(null);
  const [context, setContext] = useState("");

  const [run, setRun] = useState<EntityExtractionRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [types, setTypes] = useState<ProposedEntityType[]>([]);
  const [dropped, setDropped] = useState<number>(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleEdits, setRuleEdits] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);

  // ── Channel picker ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setChannelsLoading(true);
    const t = setTimeout(() => {
      listSpacesChannels(query, 25)
        .then((rows) => !cancelled && setChannels(rows))
        .catch(() => !cancelled && setChannels([]))
        .finally(() => !cancelled && setChannelsLoading(false));
    }, 250); // debounce typing
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const loadTypes = useCallback(
    async (runId: string) => {
      const payload = await getEntityExtractionTypes(runId, userId);
      setTypes(payload.types ?? []);
      setDropped((payload.dropped ?? []).length);
      // Nothing is pre-selected: approving has to be a deliberate act, since an
      // approved type becomes part of the workspace vocabulary for good.
      setSelected(new Set());
    },
    [userId],
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Fetch the run's current status on demand. Discovery runs for minutes; rather
   * than poll on a timer, the user checks when they want to. Reaching
   * AWAITING_TYPE_APPROVAL pulls the proposed types in the same click.
   */
  const checkStatus = async () => {
    if (!run) return;
    setChecking(true);
    try {
      const next = await getEntityExtractionRun(run.id, userId);
      setRun(next);
      if (next.status === "AWAITING_TYPE_APPROVAL") {
        await loadTypes(next.id).catch(() => {
          /* proposedTypes not written yet — the next check will pick them up */
        });
      }
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: (err as { message?: string }).message || "Could not fetch run status",
      });
    } finally {
      setChecking(false);
    }
  };
  const start = async () => {
    if (!channel) return;
    setStarting(true);
    setTypes([]);
    setApproved(null);
    try {
      const { runId } = await startEntityExtractionRun(channel.id, userId, context);
      const fresh = await getEntityExtractionRun(runId, userId);
      setRun(fresh);
      showSnackbar({ variant: "success", title: `Discovery started for #${channel.name}` });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      showSnackbar({
        variant: "error",
        title:
          e.status === 409
            ? "A run is already in progress for this channel"
            : e.message || "Could not start discovery",
      });
    } finally {
      setStarting(false);
    }
  };

  const approve = async () => {
    if (!run || selected.size === 0) return;
    setApproving(true);
    try {
      const edit: Record<string, Partial<ProposedEntityType>> = {};
      for (const name of selected) {
        const edited = ruleEdits[name];
        const original = types.find((t) => t.name === name);
        if (edited !== undefined && original && edited.trim() && edited !== original.rule) {
          edit[name] = { rule: edited.trim() };
        }
      }
      const result = await approveEntityTypes(run.id, userId, {
        approve: [...selected],
        ...(Object.keys(edit).length ? { edit } : {}),
      });
      setApproved(result.channelEntityTypes);
      setRun(await getEntityExtractionRun(run.id, userId));
      // The Vespa write is a projection and never fails the approval, so a
      // failure here is a warning, not an error — the types ARE saved.
      showSnackbar(
        result.vespaSync === "ok"
          ? { variant: "success", title: `${result.approvedTypes.length} types approved and synced` }
          : {
              variant: "warning",
              title: "Types approved, but the Vespa sync failed",
              description: result.vespaSyncError?.slice(0, 160),
            },
      );
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: (err as { message?: string }).message || "Approval failed",
      });
    } finally {
      setApproving(false);
    }
  };

  const resync = async () => {
    if (!channel) return;
    try {
      const r = await resyncChannelEntityTypes(channel.id, userId);
      showSnackbar(
        r.vespaSync === "ok"
          ? { variant: "success", title: `Synced ${r.entityTypes.length} types to Vespa` }
          : { variant: "error", title: r.error?.slice(0, 160) || "Re-sync failed" },
      );
    } catch (err) {
      showSnackbar({ variant: "error", title: (err as { message?: string }).message || "Re-sync failed" });
    }
  };

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const busy = run?.status === "RUNNING";
  const awaiting = run?.status === "AWAITING_TYPE_APPROVAL";
  const stage = useMemo(() => (run ? STAGE_LABEL[run.stage] ?? run.stage : ""), [run]);

  return (
    <PageLayout
      header={
        <PageHeader
          icon={<TagIcon size={22} weight="duotone" className="text-xyne-fg-muted" />}
          title="Entity types"
          description="Discover the entity vocabulary a channel uses, then approve it into search."
          actions={
            channel ? (
              <Button variant="ghost" size="sm" leadingIcon={<ArrowsClockwiseIcon size={14} />} onClick={resync}>
                Re-sync to Vespa
              </Button>
            ) : undefined
          }
        />
      }
      body={
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
          {/* ── Channel selection ── */}
          <section className="flex flex-col gap-3">
            <TextField
              label="Channel"
              placeholder="Search channels…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-52 overflow-y-auto rounded-lg border border-xyne-border-subtle">
              {channelsLoading && channels.length === 0 ? (
                <div className="flex items-center gap-2 p-3 text-[13px] text-xyne-fg-muted">
                  <SpinnerGapIcon size={14} className="animate-spin" /> Loading channels…
                </div>
              ) : channels.length === 0 ? (
                <div className="flex items-center gap-2 p-3 text-[13px] text-xyne-fg-muted">
                  <MagnifyingGlassIcon size={14} /> No channels match.
                </div>
              ) : (
                channels.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChannel(c)}
                    className={`flex w-full items-center justify-between gap-3 border-b border-xyne-border-subtle px-3 py-2 text-left text-[13px] last:border-b-0 ${
                      channel?.id === c.id
                        ? "bg-xyne-surface-subtle text-xyne-fg-primary"
                        : "text-xyne-fg-secondary hover:bg-xyne-surface-subtle"
                    }`}
                  >
                    <span className="truncate">#{c.name}</span>
                    <span className="shrink-0 text-[11px] text-xyne-fg-muted">
                      {c.participantCount} members
                    </span>
                  </button>
                ))
              )}
            </div>

            <TextField
              label="What is this channel about? (optional)"
              hint="Framing sent to the model, e.g. “payment gateway incidents across merchants”. Sharpens the proposed types."
              placeholder="Describe the channel…"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />

            <div>
              <Button
                variant="primary"
                leadingIcon={busy ? <SpinnerGapIcon size={14} className="animate-spin" /> : <PlayIcon size={14} />}
                disabled={!channel || starting || busy}
                onClick={start}
              >
                {busy ? "Discovering…" : "Discover types"}
              </Button>
            </div>
          </section>

          {/* ── Run status ── */}
          {run && (
            <section className="rounded-lg border border-xyne-border-subtle p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {busy && <SpinnerGapIcon size={16} className="animate-spin text-xyne-fg-muted" />}
                  {awaiting && <CheckCircleIcon size={16} className="text-xyne-success-fg" />}
                  {run.status === "FAILED" && <XCircleIcon size={16} className="text-xyne-error-fg" />}
                  <span className="text-[13px] font-medium text-xyne-fg-primary">{stage}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    as="span"
                    variant={run.status === "FAILED" ? "error" : awaiting ? "success" : "info"}
                    label={run.status}
                  />
                  {busy && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leadingIcon={
                        checking ? (
                          <SpinnerGapIcon size={14} className="animate-spin" />
                        ) : (
                          <ArrowsClockwiseIcon size={14} />
                        )
                      }
                      disabled={checking}
                      onClick={checkStatus}
                    >
                      Check status
                    </Button>
                  )}
                </div>
              </div>
              {(run.documentCount > 0 || run.messageCount > 0) && (
                <p className="mt-2 text-[12px] text-xyne-fg-muted">
                  {run.messageCount} messages → {run.documentCount} documents
                </p>
              )}
              {busy && (
                <p className="mt-2 text-[12px] text-xyne-fg-muted">
                  Discovery runs in the background — this can take a few minutes. Use “Check
                  status” to refresh.
                </p>
              )}
              {run.errorMessage && (
                <p className="mt-2 flex items-start gap-1.5 text-[12px] text-xyne-error-fg">
                  <WarningCircleIcon size={14} className="mt-px shrink-0" />
                  {run.errorMessage}
                </p>
              )}
            </section>
          )}

          {/* ── Proposed types ── */}
          {awaiting && (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[14px] font-semibold text-xyne-fg-primary">
                  Proposed types{" "}
                  <span className="font-normal text-xyne-fg-muted">
                    ({types.length}
                    {dropped > 0 ? `, ${dropped} dropped` : ""})
                  </span>
                </h2>
                {types.length > 0 && (
                  <button
                    type="button"
                    className="text-[12px] text-xyne-fg-muted hover:text-xyne-fg-primary"
                    onClick={() =>
                      setSelected(
                        selected.size === types.length ? new Set() : new Set(types.map((t) => t.name)),
                      )
                    }
                  >
                    {selected.size === types.length ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>

              {types.length === 0 ? (
                <p className="rounded-lg border border-xyne-border-subtle p-4 text-[13px] text-xyne-fg-muted">
                  The pipeline found no entity types in this channel. That usually means too
                  little text to work with — very short messages are skipped.
                </p>
              ) : (
                types.map((t) => {
                  const isOn = selected.has(t.name);
                  return (
                    <div
                      key={t.name}
                      className={`rounded-lg border p-3 transition-colors ${
                        isOn ? "border-xyne-border-strong bg-xyne-surface-subtle" : "border-xyne-border-subtle"
                      }`}
                    >
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => toggle(t.name)}
                          className="mt-1 accent-current"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] font-medium text-xyne-fg-primary">
                              {t.name}
                            </span>
                            <Badge as="span" variant="neutral" label={t.prefix} />
                          </div>
                          {t.examples && t.examples.length > 0 && (
                            <p className="mt-1 truncate text-[12px] text-xyne-fg-muted">
                              e.g. {t.examples.slice(0, 4).join(", ")}
                            </p>
                          )}
                        </div>
                      </label>
                      {isOn && (
                        <div className="mt-2 pl-7">
                          <TextField
                            label="Rule"
                            hint="Goes verbatim into the extraction prompt — the main lever on precision."
                            multiline
                            rows={2}
                            value={ruleEdits[t.name] ?? t.rule}
                            onChange={(e) =>
                              setRuleEdits((prev) => ({ ...prev, [t.name]: e.target.value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {types.length > 0 && (
                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    disabled={selected.size === 0 || approving}
                    leadingIcon={
                      approving ? <SpinnerGapIcon size={14} className="animate-spin" /> : <CheckCircleIcon size={14} />
                    }
                    onClick={approve}
                  >
                    Approve {selected.size > 0 ? `${selected.size} ` : ""}type{selected.size === 1 ? "" : "s"}
                  </Button>
                  <span className="text-[12px] text-xyne-fg-muted">
                    Approved types join the workspace vocabulary and are written to the channel in Vespa.
                  </span>
                </div>
              )}
            </section>
          )}

          {/* ── Result ── */}
          {approved && (
            <section className="rounded-lg border border-xyne-success-border bg-xyne-success-bg p-4">
              <p className="text-[13px] font-medium text-xyne-success-fg">
                Channel type set in Vespa
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {approved.length === 0 ? (
                  <span className="text-[12px] text-xyne-fg-muted">(empty)</span>
                ) : (
                  approved.map((t) => <Badge key={t} as="span" variant="success" label={t} />)
                )}
              </div>
            </section>
          )}
        </div>
      }
    />
  );
}
