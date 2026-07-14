import { useState } from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import type { Agent } from "../../../../lib/types";
import { useSnackbar } from "../../ui/Snackbar";
import { Button } from "../../ui/Button";
import { updateAgent } from "../../../../lib/api";

/* ─────────────────────────────────────────────────────────────────────
 * Pinned "Spaces — platform default" row for the credentials card.
 *
 * Spaces (the platform LiteLLM proxy) is always available as the terminal
 * fallback and needs no credential, so it's rendered as a permanent row that
 * can't be removed. Its MODEL is the fixed platform default and is NOT
 * editable — only the run params (temperature, thinking level, max output
 * tokens) can be tuned. Persisted at agent.config.modelSettings; applied
 * per-run by the xyne-claw runtime (agent-model-settings.ts). The params apply
 * to whichever provider serves the run (including quota fallbacks).
 *
 * Structured output (config.outputFormat) lives in the Behavior tab, not here —
 * it's an agent-behavior choice, not a model knob.
 * ───────────────────────────────────────────────────────────────────── */

const THINKING_OPTIONS = [
  { value: "", label: "Default (platform setting)" },
  { value: "off", label: "Off — no extended thinking" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

const INPUT_CLASS =
  "w-full rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)]";

const LABEL_CLASS = "block text-[12px] font-medium text-xyne-fg-secondary mb-1.5";

interface ModelSettings {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: string;
}

interface Props {
  agent: Agent;
}

export function SpacesDefaultRowV3({ agent }: Props) {
  const readSettings = (): ModelSettings => {
    const cfg = (agent.config ?? {}) as Record<string, unknown>;
    const msRaw = cfg["modelSettings"];
    return msRaw && typeof msRaw === "object" && !Array.isArray(msRaw) ? (msRaw as ModelSettings) : {};
  };

  const initial = readSettings();
  const [savedSettings, setSavedSettings] = useState<ModelSettings>(initial);

  const [editing, setEditing] = useState(false);
  const [temperature, setTemperature] = useState(initial.temperature !== undefined ? String(initial.temperature) : "");
  const [maxTokens, setMaxTokens] = useState(initial.maxTokens !== undefined ? String(initial.maxTokens) : "");
  const [thinkingLevel, setThinkingLevel] = useState(initial.thinkingLevel ?? "");
  const [saving, setSaving] = useState(false);
  const { show: showSnackbar } = useSnackbar();

  const temperatureSet = temperature.trim() !== "";
  const thinkingConflict = temperatureSet && thinkingLevel !== "" && thinkingLevel !== "off";

  const resetDraft = () => {
    const ms = readSettings();
    setTemperature(ms.temperature !== undefined ? String(ms.temperature) : "");
    setMaxTokens(ms.maxTokens !== undefined ? String(ms.maxTokens) : "");
    setThinkingLevel(ms.thinkingLevel ?? "");
  };

  const save = async () => {
    if (saving) return;

    const settings: ModelSettings = {};
    // The Spaces model is fixed (platform default) and not editable here.
    // Preserve any model value set out-of-band (e.g. via API) rather than
    // wiping it when params are saved.
    const existing = readSettings();
    if (existing.model) settings.model = existing.model;
    if (temperatureSet) {
      const t = Number(temperature);
      if (!Number.isFinite(t) || t < 0 || t > 1) {
        showSnackbar({ variant: "error", title: "Temperature must be between 0 and 1" });
        return;
      }
      settings.temperature = t;
    }
    if (maxTokens.trim() !== "") {
      const m = Number(maxTokens);
      if (!Number.isInteger(m) || m < 1024 || m > 64000) {
        showSnackbar({ variant: "error", title: "Max output tokens must be an integer between 1024 and 64000" });
        return;
      }
      settings.maxTokens = m;
    }
    if (thinkingLevel) settings.thinkingLevel = thinkingLevel;
    if (thinkingConflict) {
      showSnackbar({ variant: "error", title: 'Temperature requires thinking "Off" — thinking models ignore temperature' });
      return;
    }
    // Temperature with no explicit thinking choice: persist the "off" the
    // backend requires so the saved config is self-consistent.
    if (temperatureSet && !settings.thinkingLevel) settings.thinkingLevel = "off";

    setSaving(true);
    try {
      const cfg = { ...((agent.config ?? {}) as Record<string, unknown>) };
      if (Object.keys(settings).length > 0) cfg["modelSettings"] = settings as unknown as Record<string, unknown>;
      else delete cfg["modelSettings"];
      await updateAgent(agent.slug, { config: cfg });
      // Mutate the prop-derived config (same pattern as the provider-order
      // card) so other saves in this mount merge against fresh values.
      const live = agent.config as Record<string, unknown>;
      if (cfg["modelSettings"]) live["modelSettings"] = cfg["modelSettings"];
      else delete live["modelSettings"];
      setSavedSettings(settings);
      setEditing(false);
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to save model settings" });
    } finally {
      setSaving(false);
    }
  };

  // Compact summary of the saved non-default settings for the collapsed row.
  const summaryParts: string[] = [];
  if (savedSettings.temperature !== undefined) summaryParts.push(`temp ${savedSettings.temperature}`);
  if (savedSettings.thinkingLevel) summaryParts.push(`thinking ${savedSettings.thinkingLevel}`);
  if (savedSettings.maxTokens !== undefined) summaryParts.push(`max ${savedSettings.maxTokens} tok`);

  return (
    <li className="rounded-lg border border-xyne-border bg-xyne-surface-subtle px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-xyne-fg-primary">Spaces</span>
            <span className="inline-flex items-center text-[11px] font-medium text-xyne-fg-tertiary bg-xyne-surface-sunken border border-xyne-border rounded-full px-2 py-0.5">
              Platform default
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-success-fg">
              <span className="w-1.5 h-1.5 rounded-full bg-xyne-success" />
              Always available
            </span>
          </div>
          {!editing && (
            <>
              <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                <span className="text-xyne-fg-tertiary">Model</span>
                <span className="text-xyne-fg-primary font-mono truncate">{savedSettings.model || "Platform default"}</span>
                {summaryParts.length > 0 && (
                  <>
                    <span className="text-xyne-fg-tertiary">Settings</span>
                    <span className="text-xyne-fg-primary truncate">{summaryParts.join(" · ")}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary">
                No credential needed. Used when no provider above serves the run, and as the final quota fallback.
                To run on your own key and pick from its models, add a “LiteLLM (own key)” provider above.
              </div>
            </>
          )}
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => { resetDraft(); setEditing(true); }}
            title="Edit model settings"
            aria-label="Edit model settings"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors"
          >
            <PencilSimpleIcon size={14} weight="bold" />
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 rounded-xl border border-xyne-border bg-xyne-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-[12px]">
            <span className="text-xyne-fg-tertiary">Model</span>
            <span className="font-mono text-xyne-fg-secondary">{savedSettings.model || "Platform default"}</span>
            <span className="text-[11px] text-xyne-fg-muted">· fixed, not editable</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLASS}>Thinking level</label>
              <select
                value={thinkingLevel}
                onChange={(e) => setThinkingLevel(e.target.value)}
                className={INPUT_CLASS}
              >
                {THINKING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Temperature (0–1)</label>
              <input
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="provider default"
                inputMode="decimal"
                className={INPUT_CLASS}
              />
              {thinkingConflict ? (
                <p className="mt-1 text-[11px] text-red-500">
                  Temperature requires thinking &quot;Off&quot; — thinking models ignore temperature.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-xyne-fg-muted">
                  Setting a temperature turns extended thinking off. 0 = most deterministic.
                </p>
              )}
            </div>
            <div>
              <label className={LABEL_CLASS}>Max output tokens</label>
              <input
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="16384"
                inputMode="numeric"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-[11px] text-xyne-fg-muted">1024–64000. Higher values raise per-run cost ceilings.</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-xyne-fg-tertiary">
            Temperature, thinking and max tokens apply to whichever provider serves the run
            (including quota fallbacks). The Spaces model is the fixed platform default; premium
            providers pick their model on their credential.
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving || thinkingConflict}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { resetDraft(); setEditing(false); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
