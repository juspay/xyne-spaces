import { useState, useCallback, useMemo } from "react";
import { PulseIcon, WarningIcon, EyeIcon, CircleNotchIcon, XIcon } from "@phosphor-icons/react";
import { updateAgent } from "../../../../lib/api";
import type { Agent } from "../../../../lib/types";
import { useSnackbar } from "../../ui/Snackbar";
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
 */
export function AwakeningTab({ agent, canEdit, onAgentUpdated }: Props) {
  const { show: showSnackbar } = useSnackbar();
  const saved = useMemo(() => readAwakening(agent.config), [agent.config]);
  const [draft, setDraft] = useState<AwakeningSettings>(saved);
  const [saving, setSaving] = useState(false);

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
    <div className="flex flex-col gap-6 pb-24">
      <Header enabled={draft.enabled} canEdit={canEdit} onToggle={(v) => set("enabled", v)} />

      {draft.enabled && (
        <>
          {!draft.shadow && draft.writePolicy === "act" && <LiveWarning />}

          <Section
            title="Safety"
            hint="What the agent is allowed to do once it is awake. Start in shadow mode."
          >
            <Toggle
              label="Shadow mode"
              hint="The agent reasons and records what it WOULD have posted, but has no write tools at all. The safest way to find out whether it is useful."
              checked={draft.shadow}
              disabled={!canEdit}
              onChange={(v) => set("shadow", v)}
            />
            <Choice<WritePolicyValue>
              label="Write policy"
              disabled={!canEdit || draft.shadow}
              disabledHint={draft.shadow ? "Shadow mode overrides this — nothing is posted." : undefined}
              value={draft.writePolicy}
              options={WRITE_POLICIES}
              labels={WRITE_POLICY_LABELS}
              onChange={(v) => set("writePolicy", v)}
            />
            <NumberField
              label="Max runs per hour"
              hint="Hard ceiling on how often this agent may actually run. Skipped checks are free and do not count."
              value={draft.limits.maxRunsPerHour}
              bound={AWAKENING_BOUNDS.maxRunsPerHour}
              disabled={!canEdit}
              onChange={(v) => setNested("limits", { maxRunsPerHour: v })}
            />
          </Section>

          <Section
            title="Run instructions"
            hint="Your own guidance for awakened runs — tone, what is worth reacting to, what to leave alone. Appended to the built-in operating contract, which always has the last word on delivery rules and safety bounds."
          >
            <TextAreaField
              label="Guidance"
              hint="Optional. Written to the agent every time it wakes. Example: “Keep it casual and short. Jump in when someone is blocked or asking for a reminder. Stay out of social chatter.”"
              value={draft.instructions}
              max={AWAKENING_BOUNDS.instructionsLength.MAX}
              disabled={!canEdit}
              onChange={(v) => set("instructions", v)}
            />
          </Section>

          <Section title="When it wakes" hint="A heartbeat wakes on the clock; a reflex wakes on volume.">
            <Choice<AwakeningKindValue>
              label="Trigger"
              value={draft.kind}
              options={AWAKENING_KINDS}
              labels={KIND_LABELS}
              disabled={!canEdit}
              onChange={(v) => set("kind", v)}
            />
            {showsHeartbeat && (
              <SelectField
                label="Heartbeat period"
                hint="How often it reviews the whole period."
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
                  hint="Wake once this many new events have piled up in the watched channels."
                  value={draft.reflex.threshold}
                  bound={AWAKENING_BOUNDS.reflexThreshold}
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { threshold: v })}
                />
                <SelectField
                  label="Reflex check interval"
                  hint="How often the event count is checked. This is a cheap count, not a full read."
                  value={draft.reflex.checkIntervalMs}
                  options={REFLEX_CHECK_OPTIONS}
                  format={formatDuration}
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { checkIntervalMs: v })}
                />
                <SelectField
                  label="Minimum gap between reflexes"
                  hint="However busy a channel gets, two reflex runs stay at least this far apart."
                  value={draft.reflex.minIntervalMs}
                  options={REFLEX_MIN_INTERVAL_OPTIONS}
                  format={formatDuration}
                  disabled={!canEdit}
                  onChange={(v) => setNested("reflex", { minIntervalMs: v })}
                />
              </>
            )}
          </Section>

          <Section
            title="Which channels"
            hint="Rules are always narrowed to channels the agent's bot is actually a member of. Leave everything empty to watch every channel it is in."
          >
            <ListField
              label="Channel IDs"
              placeholder="ch_abc123"
              values={draft.channels.include}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { include: v })}
            />
            <ListField
              label="Name patterns"
              placeholder="^eng-"
              hint="Case-insensitive regular expressions matched against the channel name."
              values={draft.channels.includePattern}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { includePattern: v })}
            />
            <ListField
              label="Excluded name patterns"
              placeholder="-archive$"
              hint="Applied after the include rules. Exclusion always wins."
              values={draft.channels.excludePattern}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { excludePattern: v })}
            />
            <NumberField
              label="Max channels"
              hint="If more match, the least recently active are dropped."
              value={draft.channels.maxChannels}
              bound={AWAKENING_BOUNDS.maxChannels}
              disabled={!canEdit}
              onChange={(v) => setNested("channels", { maxChannels: v })}
            />
          </Section>

          <Section
            title="When it bothers to act"
            hint="Most windows contain nothing that needs an agent. These decide when a wake is worth the cost."
          >
            <NumberField
              label="Minimum human events"
              hint="Below this many messages from real people, the window is skipped without running the model."
              value={draft.gate.minHumanEvents}
              bound={AWAKENING_BOUNDS.minHumanEvents}
              disabled={!canEdit}
              onChange={(v) => setNested("gate", { minHumanEvents: v })}
            />
            <NumberField
              label="Force a run after N skips"
              hint="Guarantees the agent still checks in during a quiet stretch. 0 disables it."
              value={draft.gate.forceRunEveryNSkips}
              bound={AWAKENING_BOUNDS.forceRunEveryNSkips}
              disabled={!canEdit}
              onChange={(v) => setNested("gate", { forceRunEveryNSkips: v })}
            />
            <NumberField
              label="Max events per window"
              hint="A window larger than this is truncated, and the agent is told so."
              value={draft.limits.maxEvents}
              bound={AWAKENING_BOUNDS.maxEvents}
              disabled={!canEdit}
              onChange={(v) => setNested("limits", { maxEvents: v })}
            />
          </Section>

          {showsReflex && (
            <Section
              title="Live updates"
              hint="While a reflex run is working, new events can be handed to it so it adapts mid-task instead of finishing on stale input."
            >
              <Toggle
                label="Send live updates into a running reflex"
                checked={draft.reflex.injectEnabled}
                disabled={!canEdit}
                onChange={(v) => setNested("reflex", { injectEnabled: v })}
              />
              {draft.reflex.injectEnabled && (
                <>
                  <NumberField
                    label="Events per update"
                    hint="How many new events must arrive before the running agent is interrupted with them."
                    value={draft.reflex.injectThreshold}
                    bound={AWAKENING_BOUNDS.injectThreshold}
                    disabled={!canEdit}
                    onChange={(v) => setNested("reflex", { injectThreshold: v })}
                  />
                  <NumberField
                    label="Max updates per run"
                    hint="A run still has to finish. Beyond this, new events wait for the next wake."
                    value={draft.reflex.maxInjectionsPerSession}
                    bound={AWAKENING_BOUNDS.maxInjectionsPerSession}
                    disabled={!canEdit}
                    onChange={(v) => setNested("reflex", { maxInjectionsPerSession: v })}
                  />
                  <SelectField
                    label="Minimum gap between updates"
                    value={draft.reflex.injectMinIntervalMs}
                    options={INJECT_MIN_INTERVAL_OPTIONS}
                    format={formatDuration}
                    disabled={!canEdit}
                    onChange={(v) => setNested("reflex", { injectMinIntervalMs: v })}
                  />
                  <SelectField
                    label="Replica safety margin"
                    hint="How far behind now a window closes, so a Spaces read replica that is briefly behind cannot cause events to be skipped. This is the floor on how fast anything can reach the agent: a new event becomes visible after this margin, and is picked up on the following check."
                    value={draft.cursor.replicaSafetyMs}
                    options={REPLICA_SAFETY_OPTIONS}
                    format={formatDuration}
                    disabled={!canEdit}
                    onChange={(v) => setNested("cursor", { replicaSafetyMs: v })}
                  />
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    A live update reaches a running agent roughly{" "}
                    {formatDuration(draft.cursor.replicaSafetyMs + draft.reflex.checkIntervalMs)} after the events
                    land, once {draft.reflex.injectThreshold} of them have arrived. A run that finishes faster than
                    that will never receive one — its events go to the next wake instead.
                  </p>
                </>
              )}
            </Section>
          )}
        </>
      )}

      {canEdit && dirty && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white/95 px-1 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
          <span className="text-xs text-neutral-500">Unsaved changes</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(saved)}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void persist()}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
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
    <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex gap-3">
        <PulseIcon size={20} weight="bold" className="mt-0.5 shrink-0 text-indigo-500" />
        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Awakening</h3>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Let this agent wake up on its own and act on what happened in its channels, without anybody
            triggering it. It reads a collected window of events, decides whether anything needs doing, and
            acts only within the limits set below.
          </p>
        </div>
      </div>
      <Switch checked={enabled} disabled={!canEdit} onChange={onToggle} />
    </div>
  );
}

function LiveWarning() {
  return (
    <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/30">
      <WarningIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
      <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        This agent can post to channels and start new threads with nobody reviewing it first. Turn shadow
        mode on and read a few windows before allowing this.
      </p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {title}
        </h4>
        {hint && <p className="mt-1 max-w-prose text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        {children}
      </div>
    </section>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-700"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-neutral-800 dark:text-neutral-200">{label}</div>
        {hint && <p className="mt-0.5 max-w-prose text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  labels,
  disabled,
  disabledHint,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, { label: string; hint: string }>;
  disabled?: boolean;
  disabledHint?: string;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
        {label}
        {disabledHint && (
          <span className="flex items-center gap-1 text-xs text-neutral-500">
            <EyeIcon size={12} /> {disabledHint}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
              value === opt
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"
            }`}
          >
            <div className="text-sm text-neutral-900 dark:text-neutral-100">{labels[opt].label}</div>
            <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{labels[opt].hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  bound,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  bound: { MIN: number; MAX: number; DEFAULT: number };
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-neutral-800 dark:text-neutral-200">{label}</div>
        {hint && <p className="mt-0.5 max-w-prose text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
        <p className="mt-0.5 text-[11px] text-neutral-400">
          {bound.MIN}–{bound.MAX}
        </p>
      </div>
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
        className="w-24 shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900"
      />
    </div>
  );
}

/**
 * Multi-line free text with a live character budget. Truncation happens
 * server-side too (resolveAwakeningConfig), so the counter is a courtesy, not
 * the enforcement point.
 */
function TextAreaField({
  label,
  hint,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  max: number;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const over = value.length > max;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-sm text-neutral-800 dark:text-neutral-200">{label}</div>
        {hint && <p className="mt-0.5 max-w-prose text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
      <textarea
        rows={6}
        value={value}
        disabled={disabled}
        maxLength={max}
        placeholder="No extra guidance — the agent runs on its contract and skill alone."
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm leading-relaxed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900"
      />
      <p className={`text-[11px] ${over ? "text-red-500" : "text-neutral-400"}`}>
        {value.length}/{max}
      </p>
    </div>
  );
}

function SelectField({
  label,
  hint,
  value,
  options,
  format,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
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
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-neutral-800 dark:text-neutral-200">{label}</div>
        {hint && <p className="mt-0.5 max-w-prose text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900"
      >
        {choices.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

function ListField({
  label,
  hint,
  placeholder,
  values,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
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
    <div>
      <div className="text-sm text-neutral-800 dark:text-neutral-200">{label}</div>
      {hint && <p className="mt-0.5 max-w-prose text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800"
          >
            {v}
            {!disabled && (
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                <XIcon size={11} />
              </button>
            )}
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-neutral-400">None</span>}
      </div>
      {!disabled && (
        <div className="mt-2 flex gap-2">
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
            className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={add}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
