import { useState, useCallback, useMemo, useEffect } from "react";
import { PulseIcon, WarningIcon, CircleNotchIcon, XIcon, CaretRightIcon } from "@phosphor-icons/react";
import { updateAgent, getAwakeningStatus, type AwakeningStatus } from "../../../../lib/api";
import type { Agent } from "../../../../lib/types";
import { useSnackbar } from "../../ui/Snackbar";
import { InfoIcon } from "../../ui/Tooltip";
import { Switch } from "../../ui/Switch";
import {
  readAwakening,
  AWAKENING_BOUNDS,
  AWAKENING_KINDS,
  WRITE_POLICIES,
  KIND_LABELS,
  WRITE_POLICY_LABELS,
  PERIOD_OPTIONS,
  REFLEX_CHECK_OPTIONS,
  REFLEX_MIN_INTERVAL_OPTIONS,
  INJECT_MIN_INTERVAL_OPTIONS,
  REPLICA_SAFETY_OPTIONS,
  formatDuration,
  clampToBound,
  type AwakeningSettings,
  type AwakeningKindValue,
  type WritePolicyValue,
} from "../../../lib/awakeningBounds";

interface Props {
  agent: Agent;
  canEdit: boolean;
  onAgentUpdated?: (agent: Agent) => void;
}

/**
 * Awakening panel — when this agent wakes up on its own, and what it may do.
 *
 * Deliberately BATCH-saved with an explicit Save button, unlike the
 * immediate-save panels (Privacy, People). These knobs are interdependent: a
 * half-applied set (a threshold saved before the interval that bounds it, or
 * shadow cleared before the channel list is narrowed) can put a live agent
 * into a configuration nobody intended. One atomic write, or none.
 *
 * agent.config is FULL-REPLACED server-side, so every write spreads the
 * existing config first — dropping that spread silently deletes every other
 * config block the agent has.
 *
 * LAYOUT: there are ~15 interdependent knobs here, and reading them as a flat
 * list is what made this panel hard to configure. Three things fix that, and
 * they are the reason for the structure below:
 *   1. A plain-English SUMMARY at the top, recomputed from the draft, so the
 *      combined effect of the knobs never has to be simulated in your head.
 *   2. NUMBERED STEPS in the order the decision is actually made.
 *   3. Per-knob explanations live in hover tooltips, not permanent paragraphs —
 *      the rows stay one line each, so the whole config is scannable.
 * Knobs whose default is almost always right sit behind an "Advanced"
 * disclosure rather than competing with the ones that matter.
 */
export function AwakeningTab({ agent, canEdit, onAgentUpdated }: Props) {
  const { show: showSnackbar } = useSnackbar();
  const saved = useMemo(() => readAwakening(agent.config), [agent.config]);
  const [draft, setDraft] = useState<AwakeningSettings>(saved);
  const [saving, setSaving] = useState(false);
  // The worker-owned state row. `config.awakening.enabled` (what the toggle
  // edits) and `state.enabled` (what the workers read) are different flags, and
  // a worker that hits an unrecoverable error clears the latter. Fetch it so a
  // switched-off agent cannot keep rendering as enabled.
  const [status, setStatus] = useState<AwakeningStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAwakeningStatus(agent.id)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { /* status is diagnostic only — never block the editor */ });
    return () => { cancelled = true; };
  }, [agent.id, saved]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const showsHeartbeat = draft.kind !== "reflex";
  const showsReflex = draft.kind !== "heartbeat";

  const set = <K extends keyof AwakeningSettings>(key: K, value: AwakeningSettings[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setNested = <S extends "channels" | "gate" | "limits" | "reflex" | "cursor">(
    section: S,
    patch: Partial<AwakeningSettings[S]>,
  ): void => setDraft((d) => ({ ...d, [section]: { ...d[section], ...patch } }));

  const persist = useCallback(async () => {
    setSaving(true);
    // Spread first: the server replaces `config` wholesale.
    // Merge over the STORED awakening block rather than replacing it. The
    // editor models a subset of AwakeningConfig (workspaceId, maxActiveThreads,
    // cursor.overlapMs and cursor.maxCatchupWindows have no control), and
    // replacing the block wholesale silently deleted every key the form does
    // not know about — so opening this tab and pressing Save reset settings the
    // admin never touched.
    const storedAwakening = (agent.config?.["awakening"] ?? {}) as Record<string, unknown>;
    const storedCursor = (storedAwakening["cursor"] ?? {}) as Record<string, unknown>;
    const storedLimits = (storedAwakening["limits"] ?? {}) as Record<string, unknown>;
    const nextConfig: Record<string, unknown> = {
      ...agent.config,
      awakening: {
        ...storedAwakening,
        ...draft,
        cursor: { ...storedCursor, ...draft.cursor },
        limits: { ...storedLimits, ...draft.limits },
        channels: { ...(storedAwakening["channels"] as object ?? {}), ...draft.channels },
        gate: { ...(storedAwakening["gate"] as object ?? {}), ...draft.gate },
        reflex: { ...(storedAwakening["reflex"] as object ?? {}), ...draft.reflex },
      },
    };
    try {
      const updated = await updateAgent(agent.slug, { config: nextConfig });
      onAgentUpdated?.(updated);
      showSnackbar({ variant: "success", title: draft.enabled ? "Awakening saved" : "Awakening disabled" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to save",
        // Surface the server's reason — it is the validator explaining which
        // knob was rejected and why, which is exactly what the admin needs.
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [agent.config, agent.slug, draft, onAgentUpdated, showSnackbar]);

  return (
    <div className="flex flex-col gap-5 p-4 pb-24">
      <Header enabled={draft.enabled} canEdit={canEdit} onToggle={(v) => set("enabled", v)} />

      {draft.enabled && status?.state && !status.state.enabled && (
        <SystemDisabledNotice lastError={status.state.lastError} />
      )}

      {draft.enabled && (
        <>
          {!draft.shadow && draft.writePolicy === "act" && <LiveWarning />}

          <Summary draft={draft} />

          <Step
            n={1}
            title="What it may do"
            hint="Start in shadow mode and read a few windows before letting it post."
          >
            <Row
              label="Shadow mode"
              info="The agent reasons and records what it WOULD have posted, but is given no write tools at all. The safest way to find out whether it is useful before it can say anything."
            >
              <Switch checked={draft.shadow} disabled={!canEdit} onChange={(v) => set("shadow", v)} />
            </Row>
            <Choice<WritePolicyValue>
              label="Write policy"
              info="What the agent is allowed to post once it is out of shadow mode. Observe posts nothing; Reply only joins conversations that already exist; Act may also open new threads nobody asked for."
              disabled={!canEdit || draft.shadow}
              disabledHint={draft.shadow ? "Shadow mode overrides this — nothing is posted." : undefined}
              value={draft.writePolicy}
              options={WRITE_POLICIES}
              labels={WRITE_POLICY_LABELS}
              onChange={(v) => set("writePolicy", v)}
            />
            <NumberField
              label="Max runs per hour"
              info="Hard ceiling on how often this agent may actually run, whatever the triggers below ask for. Checks that decide to skip are free and do not count against it."
              value={draft.limits.maxRunsPerHour}
              bound={AWAKENING_BOUNDS.maxRunsPerHour}
              unit="runs/h"
              disabled={!canEdit}
              onChange={(v) => setNested("limits", { maxRunsPerHour: v })}
            />
          </Step>

          <Step n={2} title="When it wakes" hint="A heartbeat wakes on the clock; a reflex wakes on volume.">
            <Choice<AwakeningKindValue>
              label="Trigger"
              info="Heartbeat reviews everything that happened since the last wake, on a fixed timer. Reflex reacts as soon as enough activity piles up, and sees only that burst. Choosing both gives you a fast reaction plus a periodic sweep."
              value={draft.kind}
              options={AWAKENING_KINDS}
              labels={KIND_LABELS}
              disabled={!canEdit}
              onChange={(v) => set("kind", v)}
            />
            {showsHeartbeat && (
              <SelectField
                label="Heartbeat period"
                info="How often it wakes and reviews the whole period. Every event since the previous heartbeat is in that window, so a longer period means fewer, larger runs."
                value={draft.periodMs}
                options={PERIOD_OPTIONS}
                format={formatDuration}
                disabled={!canEdit}
                onChange={(v) => set("periodMs", v)}
              />
            )}
            {showsReflex && (
              <>
                <NumberField
                  label="Reflex threshold"
                  info="Wake once this many new events have piled up across the watched channels. Lower means twitchier and more runs; higher means it waits for a real burst."
                  value={draft.reflex.threshold}
                  bound={AWAKENING_BOUNDS.reflexThreshold}
                  unit="events"
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { threshold: v })}
                />
                <SelectField
                  label="Reflex check interval"
                  info="How often the pending-event count is checked. This is a cheap count, not a full read, so a short interval is inexpensive — it sets how quickly a burst can be noticed."
                  value={draft.reflex.checkIntervalMs}
                  options={REFLEX_CHECK_OPTIONS}
                  format={formatDuration}
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { checkIntervalMs: v })}
                />
                <SelectField
                  label="Minimum gap between reflexes"
                  info="However busy a channel gets, two reflex runs stay at least this far apart. This is your protection against a flood turning into a run per minute."
                  value={draft.reflex.minIntervalMs}
                  options={REFLEX_MIN_INTERVAL_OPTIONS}
                  format={formatDuration}
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { minIntervalMs: v })}
                />
              </>
            )}
          </Step>

          <Step
            n={3}
            title="Where it looks"
            hint="Leave everything empty to watch every channel the agent's bot is already in."
          >
            <ListField
              label="Channel IDs"
              info="Exact channel IDs to watch. Combined with the name patterns below — a channel matching either one is included."
              placeholder="ch_abc123"
              values={draft.channels.include}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { include: v })}
            />
            <ListField
              label="Name patterns"
              info="Case-insensitive regular expressions matched against the channel name. Example: ^eng- watches every channel whose name starts with eng-."
              placeholder="^eng-"
              values={draft.channels.includePattern}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { includePattern: v })}
            />
            <ListField
              label="Excluded name patterns"
              info="Applied after the include rules. Exclusion always wins, so this is the reliable way to keep the agent out of a channel."
              placeholder="-archive$"
              values={draft.channels.excludePattern}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { excludePattern: v })}
            />
            <Advanced>
              <NumberField
                label="Max channels"
                info="Safety ceiling on how many channels one wake may cover. If more match the rules above, the least recently active are dropped."
                value={draft.channels.maxChannels}
                bound={AWAKENING_BOUNDS.maxChannels}
                unit="channels"
                disabled={!canEdit}
                onChange={(v) => setNested("channels", { maxChannels: v })}
              />
            </Advanced>
          </Step>

          <Step
            n={4}
            title="When it bothers to act"
            hint="Most windows contain nothing worth waking a model for. These decide which ones are."
          >
            <NumberField
              label="Minimum human events"
              info="Below this many messages from real people, the window is skipped without ever running the model — so it costs nothing. Bot and agent chatter does not count towards it."
              value={draft.gate.minHumanEvents}
              bound={AWAKENING_BOUNDS.minHumanEvents}
              unit="events"
              disabled={!canEdit}
              onChange={(v) => setNested("gate", { minHumanEvents: v })}
            />
            <Advanced>
              <NumberField
                label="Force a run after N skips"
                info="Guarantees the agent still checks in during a quiet stretch, even when the gate above keeps skipping. Set 0 to disable and let quiet periods stay quiet."
                value={draft.gate.forceRunEveryNSkips}
                bound={AWAKENING_BOUNDS.forceRunEveryNSkips}
                unit="skips"
                disabled={!canEdit}
                onChange={(v) => setNested("gate", { forceRunEveryNSkips: v })}
              />
              <NumberField
                label="Max events per window"
                info="A window bigger than this is truncated before the agent sees it, and the agent is told that it was. Guards the context window on a very busy period."
                value={draft.limits.maxEvents}
                bound={AWAKENING_BOUNDS.maxEvents}
                unit="events"
                disabled={!canEdit}
                onChange={(v) => setNested("limits", { maxEvents: v })}
              />
            </Advanced>
          </Step>

          {showsReflex && (
            <Step
              n={5}
              title="Live updates"
              hint="Hand new events to a reflex run that is already working, so it adapts mid-task instead of finishing on stale input."
            >
              <Row
                label="Send live updates into a running reflex"
                info="Without this, events that land while the agent is working wait for the next wake. With it, they are handed to the run in progress."
              >
                <Switch
                  checked={draft.reflex.injectEnabled}
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { injectEnabled: v })}
                />
              </Row>
              {draft.reflex.injectEnabled && (
                <>
                  <NumberField
                    label="Events per update"
                    info="How many new events must arrive before the running agent is interrupted with them. Too low and you interrupt it constantly; too high and it never hears anything mid-run."
                    value={draft.reflex.injectThreshold}
                    bound={AWAKENING_BOUNDS.injectThreshold}
                    unit="events"
                    disabled={!canEdit}
                    onChange={(v) => setNested("reflex", { injectThreshold: v })}
                  />
                  <NumberField
                    label="Max updates per run"
                    info="A run still has to finish. Once it has taken this many updates, later events wait for the next wake instead."
                    value={draft.reflex.maxInjectionsPerSession}
                    bound={AWAKENING_BOUNDS.maxInjectionsPerSession}
                    unit="updates"
                    disabled={!canEdit}
                    onChange={(v) => setNested("reflex", { maxInjectionsPerSession: v })}
                  />
                  <LatencyNote draft={draft} />
                  <Advanced>
                    <SelectField
                      label="Minimum gap between updates"
                      info="Two live updates into the same run stay at least this far apart, so a burst cannot interrupt the agent repeatedly in a few seconds."
                      value={draft.reflex.injectMinIntervalMs}
                      options={INJECT_MIN_INTERVAL_OPTIONS}
                      format={formatDuration}
                      disabled={!canEdit}
                      onChange={(v) => setNested("reflex", { injectMinIntervalMs: v })}
                    />
                    <SelectField
                      label="Replica safety margin"
                      info="How far behind 'now' a window closes, so a Spaces read replica that is briefly behind cannot cause events to be skipped. This is the floor on how fast anything can reach the agent: an event becomes visible after this margin and is picked up on the following check. Only set it to 0 on a deployment with no read replica."
                      value={draft.cursor.replicaSafetyMs}
                      options={REPLICA_SAFETY_OPTIONS}
                      format={formatDuration}
                      disabled={!canEdit}
                      onChange={(v) => setNested("cursor", { replicaSafetyMs: v })}
                    />
                  </Advanced>
                </>
              )}
            </Step>
          )}

          <Step
            n={showsReflex ? 6 : 5}
            title="Guidance"
            hint="Your own instructions for awakened runs. Appended to the built-in operating contract, which always has the last word on delivery rules and safety bounds."
          >
            <TextAreaField
              label="Run instructions"
              info="Optional. Written to the agent every time it wakes — tone, what is worth reacting to, what to leave alone."
              value={draft.instructions}
              max={AWAKENING_BOUNDS.instructionsLength.MAX}
              disabled={!canEdit}
              onChange={(v) => set("instructions", v)}
            />
          </Step>
        </>
      )}

      {canEdit && dirty && (
        // -mx-4 px-4 cancels the page padding so the bar spans the panel edge
        // to edge, the way a docked footer should.
        <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-xyne-border bg-xyne-surface/95 px-4 py-3 backdrop-blur">
          <span className="text-[12px] text-xyne-fg-tertiary">Unsaved changes</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(saved)}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-[13px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void persist()}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-xyne-brand px-4 py-1.5 text-[13px] font-medium text-xyne-fg-inverse hover:bg-xyne-brand-hover disabled:opacity-50"
            >
              {saving && <CircleNotchIcon size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── summary ─────────────────────────────────────────────────────────────────

/**
 * Plain-English restatement of the whole draft. The knobs are interdependent
 * (a reflex threshold means nothing without its check interval; the gate can
 * silence a heartbeat entirely), and reading them as isolated numbers is what
 * made this panel hard to reason about. Recomputed live so it also doubles as
 * a preview of unsaved edits.
 */
function Summary({ draft }: { draft: AwakeningSettings }) {
  const lines: string[] = [];

  if (draft.kind !== "reflex") lines.push(`Wakes every ${formatDuration(draft.periodMs)} and reviews the whole period.`);
  if (draft.kind !== "heartbeat") {
    lines.push(
      `Wakes when ${draft.reflex.threshold} events pile up, checked every ${formatDuration(draft.reflex.checkIntervalMs)}` +
        (draft.reflex.minIntervalMs > 0 ? `, never closer than ${formatDuration(draft.reflex.minIntervalMs)} apart.` : "."),
    );
  }

  const ch = draft.channels;
  const scoped = ch.include.length + ch.includePattern.length;
  lines.push(
    scoped === 0
      ? `Watches every channel its bot is in, up to ${ch.maxChannels}.`
      : `Watches ${scoped} channel rule${scoped === 1 ? "" : "s"}, up to ${ch.maxChannels} channels.` +
        (ch.excludePattern.length ? ` ${ch.excludePattern.length} exclusion${ch.excludePattern.length === 1 ? "" : "s"} applied last.` : ""),
  );

  lines.push(
    draft.gate.minHumanEvents > 0
      ? `Skips any window with fewer than ${draft.gate.minHumanEvents} human message${draft.gate.minHumanEvents === 1 ? "" : "s"}.`
      : "Runs on every wake, even an empty window.",
  );
  lines.push(`At most ${draft.limits.maxRunsPerHour} run${draft.limits.maxRunsPerHour === 1 ? "" : "s"} per hour.`);

  const live = !draft.shadow;
  const outcome = draft.shadow
    ? "Posts nothing — shadow mode records what it would have said."
    : `${WRITE_POLICY_LABELS[draft.writePolicy].label}: ${WRITE_POLICY_LABELS[draft.writePolicy].hint.toLowerCase()}`;

  return (
    <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
        What this configuration does
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l} className="text-[12px] leading-relaxed text-xyne-fg-secondary">
            {l}
          </li>
        ))}
        <li
          className={`mt-1 text-[12px] font-medium leading-relaxed ${
            live ? "text-xyne-warning-fg" : "text-xyne-success-fg"
          }`}
        >
          {outcome}
        </li>
      </ul>
    </div>
  );
}

/** The end-to-end latency of a live update — a number nobody can derive by
 *  reading the two knobs that produce it, so state it outright. */
function LatencyNote({ draft }: { draft: AwakeningSettings }) {
  return (
    <p className="rounded-lg bg-xyne-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-xyne-fg-tertiary">
      A live update reaches a running agent roughly{" "}
      <span className="font-medium text-xyne-fg-secondary">
        {formatDuration(draft.cursor.replicaSafetyMs + draft.reflex.checkIntervalMs)}
      </span>{" "}
      after the events land, once {draft.reflex.injectThreshold} of them have arrived. A run that finishes faster
      than that will never receive one — its events go to the next wake instead.
    </p>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Header({
  enabled,
  canEdit,
  onToggle,
}: {
  enabled: boolean;
  canEdit: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-xyne-border bg-xyne-surface p-4">
      <div className="flex gap-3">
        <PulseIcon size={20} weight="bold" className="mt-0.5 shrink-0 text-xyne-brand" />
        <div>
          <h3 className="text-[13px] font-semibold text-xyne-fg-primary">Awakening</h3>
          <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-xyne-fg-tertiary">
            Let this agent wake up on its own and act on what happened in its channels, without anybody
            triggering it. It reads a collected window of events, decides whether anything needs doing, and
            acts only within the limits set below.
          </p>
        </div>
      </div>
      <Switch checked={enabled} disabled={!canEdit} onChange={onToggle} ariaLabel="Enable awakening" />
    </div>
  );
}

function LiveWarning() {
  return (
    <div className="flex gap-3 rounded-xl border border-xyne-warning-border bg-xyne-warning-bg p-4">
      <WarningIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-xyne-warning-fg" />
      <p className="text-[12px] leading-relaxed text-xyne-warning-fg">
        This agent can post to channels and start new threads with nobody reviewing it first. Turn shadow
        mode on and read a few windows before allowing this.
      </p>
    </div>
  );
}

/**
 * Shown when the agent is enabled in config but the background workers have
 * switched it off. Re-enabling is a side effect of saving, so the fix is to
 * clear the underlying cause and press Save — say that plainly.
 */
function SystemDisabledNotice({ lastError }: { lastError: string | null }) {
  return (
    <div className="rounded-xl border border-xyne-warning-border bg-xyne-warning-bg p-4">
      <div className="text-[13px] font-medium text-xyne-warning-fg">
        Awakening is switched off for this agent
      </div>
      <p className="mt-1 text-[12px] text-xyne-warning-fg">
        It is enabled here, but the background workers stopped it and it is not waking.
      </p>
      {lastError && (
        <p className="mt-2 break-words font-mono text-[11px] text-xyne-warning-fg">{lastError}</p>
      )}
      <p className="mt-2 text-[12px] text-xyne-warning-fg">
        Fix the cause above, then press Save to switch it back on.
      </p>
    </div>
  );
}

/** One numbered stage of the configuration, in the order the decision is made. */
function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-xyne-surface-sunken text-[11px] font-semibold text-xyne-fg-secondary">
          {n}
        </span>
        <div>
          <h4 className="text-[13px] font-semibold text-xyne-fg-primary">{title}</h4>
          {hint && <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-xyne-fg-tertiary">{hint}</p>}
        </div>
      </div>
      <div className="flex flex-col divide-y divide-xyne-border-subtle rounded-xl border border-xyne-border bg-xyne-surface px-4">
        {children}
      </div>
    </section>
  );
}

/**
 * A single control row: label (+ hover explainer) on the left, control on the
 * right. Every knob renders through this, so the rows line up and the panel
 * reads as a list of decisions rather than a wall of prose.
 */
function Row({
  label,
  info,
  note,
  children,
}: {
  label: string;
  info?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-xyne-fg-primary">{label}</span>
          {info && <InfoIcon text={info} />}
        </div>
        {note && <p className="mt-0.5 text-[11px] text-xyne-fg-tertiary">{note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Rarely-touched knobs, folded away by default. The defaults for everything in
 * here are right for almost every agent, and showing them next to the knobs
 * that actually need a decision is what made the panel feel unconfigurable.
 */
function Advanced({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
      >
        <CaretRightIcon size={11} weight="bold" className={`transition-transform ${open ? "rotate-90" : ""}`} />
        Advanced
      </button>
      {open && <div className="mt-1 flex flex-col divide-y divide-xyne-border-subtle">{children}</div>}
    </div>
  );
}

function Choice<T extends string>({
  label,
  info,
  value,
  options,
  labels,
  disabled,
  disabledHint,
  onChange,
}: {
  label: string;
  info?: string;
  value: T;
  options: readonly T[];
  labels: Record<T, { label: string; hint: string }>;
  disabled?: boolean;
  disabledHint?: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[13px] text-xyne-fg-primary">{label}</span>
        {info && <InfoIcon text={info} />}
        {disabledHint && <span className="text-[11px] text-xyne-fg-tertiary">— {disabledHint}</span>}
      </div>
      {/* Radio cards rather than a <select>: each option carries its own
          one-line consequence, which is the whole reason this knob is hard to
          pick blind. */}
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            aria-pressed={value === opt}
            onClick={() => onChange(opt)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
              value === opt
                ? "border-xyne-border-focus bg-xyne-surface-subtle"
                : "border-xyne-border-subtle hover:border-xyne-border-strong"
            }`}
          >
            <div className="text-[13px] text-xyne-fg-primary">{labels[opt].label}</div>
            <div className="mt-0.5 text-[11px] text-xyne-fg-tertiary">{labels[opt].hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  info,
  value,
  bound,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  info?: string;
  value: number;
  bound: { MIN: number; MAX: number; DEFAULT: number };
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  // The range and the default belong in the hover explainer, not as permanent
  // grey text under every single field — fifteen of those is the noise that
  // buried the labels that matter.
  const explain = [info, `Allowed ${bound.MIN}–${bound.MAX}. Default ${bound.DEFAULT}.`]
    .filter(Boolean)
    .join(" ");
  return (
    <Row label={label} info={explain}>
      <input
        type="number"
        min={bound.MIN}
        max={bound.MAX}
        value={value}
        disabled={disabled}
        // Clamp on blur, not on change: clamping mid-typing makes "10" become
        // the minimum the instant "1" is typed, which fights the user.
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={(e) => onChange(clampToBound(Number(e.target.value), bound))}
        className="w-20 rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-right text-[13px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none disabled:opacity-50"
      />
      {unit && <span className="w-14 text-[11px] text-xyne-fg-tertiary">{unit}</span>}
    </Row>
  );
}

function SelectField({
  label,
  info,
  value,
  options,
  format,
  disabled,
  onChange,
}: {
  label: string;
  info?: string;
  value: number;
  options: readonly number[];
  format: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  // A stored value outside the offered set (hand-edited config, or a list that
  // changed) must still be visible rather than silently snapping to another.
  const choices = options.includes(value) ? options : [value, ...options].sort((a, b) => a - b);
  return (
    <Row label={label} info={info}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[136px] rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[13px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none disabled:opacity-50"
      >
        {choices.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </Row>
  );
}

/**
 * Multi-line free text with a live character budget. Truncation happens
 * server-side too (resolveAwakeningConfig), so the counter is a courtesy, not
 * the enforcement point.
 */
function TextAreaField({
  label,
  info,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  info?: string;
  value: string;
  max: number;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const over = value.length > max;
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] text-xyne-fg-primary">{label}</span>
        {info && <InfoIcon text={info} />}
      </div>
      <textarea
        rows={6}
        value={value}
        disabled={disabled}
        maxLength={max}
        placeholder={
          "No extra guidance — the agent runs on its contract and skill alone.\n\n" +
          "Example: Keep it casual and short. Jump in when someone is blocked or asking for a reminder. Stay out of social chatter."
        }
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 text-[13px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none disabled:opacity-50"
      />
      <p className={`text-[11px] ${over ? "text-xyne-error-fg" : "text-xyne-fg-tertiary"}`}>
        {value.length}/{max}
      </p>
    </div>
  );
}

function ListField({
  label,
  info,
  placeholder,
  values,
  disabled,
  onChange,
}: {
  label: string;
  info?: string;
  placeholder: string;
  values: string[];
  disabled?: boolean;
  onChange: (v: string[]) => void;
}) {
  const [entry, setEntry] = useState("");
  const add = (): void => {
    const v = entry.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setEntry("");
  };

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] text-xyne-fg-primary">{label}</span>
        {info && <InfoIcon text={info} />}
        <span className="ml-auto text-[11px] text-xyne-fg-tertiary">
          {values.length === 0 ? "none" : `${values.length} set`}
        </span>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-1 font-mono text-[11px] text-xyne-fg-secondary"
            >
              {v}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="text-xyne-fg-tertiary hover:text-xyne-fg-primary"
                >
                  <XIcon size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input
            value={entry}
            placeholder={placeholder}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-1.5 font-mono text-[11px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={!entry.trim()}
            className="shrink-0 rounded-lg border border-xyne-border px-3 py-1.5 text-[12px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
