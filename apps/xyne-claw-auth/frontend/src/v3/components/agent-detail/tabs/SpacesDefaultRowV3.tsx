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
 * can't be removed. Its MODEL and run params (temperature, thinking level, max
 * output tokens) are editable per agent. Persisted at
 * agent.config.modelSettings; applied per-run by the xyne-claw runtime
 * (agent-model-settings.ts). The params apply to whichever provider serves the
 * run (including quota fallbacks).
 *
 * The model is a FREE-TEXT field, deliberately not a dropdown: it's whatever
 * model id the platform LiteLLM proxy exposes, and the proxy's catalogue
 * changes without a deploy here. Leave it blank to run on the platform default
 * (LITELLM_MODEL in the claw pod's env). The model only applies when the run is
 * served by the platform LiteLLM branch — premium providers (Claude, Codex,
 * Copilot, LiteLLM-own-key) pick their model on their own credential.
 *
 * Every change is audited (AGENT_CONFIG_UPDATED, metadata.kind =
 * "modelSettings") by the PUT /agents/:slug handler in claw-auth.
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

/** Mirrors the backend clamp in claw-auth's agent-config-validation.ts. */
const MODEL_MAX_LENGTH = 200;

interface ModelSettings {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: string;
  /** Provider fast mode (Anthropic `speed: "fast"`). Edited in the "Select
   *  providers" card above, not here — this row only preserves it on save so
   *  the two editors don't clobber each other's modelSettings. */
  speed?: "standard" | "fast";
}

interface Props {
  agent: Agent;
  /** "standard" edits config.modelSettings. "fast" edits
   *  config.fastModeProfile.modelSettings — per-field OVERRIDES applied only
   *  to fast-mode runs; blank fields inherit the standard value. Mount with
   *  `key={view}` so the draft reseeds when the view switches. */
  view?: "standard" | "fast";
}

export function SpacesDefaultRowV3({ agent, view = "standard" }: Props) {
  const isFast = view === "fast";
  const readStandard = (): ModelSettings => {
    const cfg = (agent.config ?? {}) as Record<string, unknown>;
    const msRaw = cfg["modelSettings"];
    return msRaw && typeof msRaw === "object" && !Array.isArray(msRaw) ? (msRaw as ModelSettings) : {};
  };
  const readSettings = (): ModelSettings => {
    if (!isFast) return readStandard();
    const cfg = (agent.config ?? {}) as Record<string, unknown>;
    const profile = cfg["fastModeProfile"];
    const msRaw = profile && typeof profile === "object" && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)["modelSettings"]
      : undefined;
    return msRaw && typeof msRaw === "object" && !Array.isArray(msRaw) ? (msRaw as ModelSettings) : {};
  };
  const standard = readStandard();

  const initial = readSettings();
  const [savedSettings, setSavedSettings] = useState<ModelSettings>(initial);

  const [editing, setEditing] = useState(false);
  // "default" = no modelSettings.model at all, so the run uses the platform
  // model from the claw pod's env (LITELLM_MODEL). "custom" = the id typed
  // below wins. Kept as an explicit choice rather than inferring it from an
  // empty text box, so "use the platform default" is a deliberate selection.
  const [modelMode, setModelMode] = useState<"default" | "custom">(initial.model ? "custom" : "default");
  const [model, setModel] = useState(initial.model ?? "");
  const [temperature, setTemperature] = useState(initial.temperature !== undefined ? String(initial.temperature) : "");
  const [maxTokens, setMaxTokens] = useState(initial.maxTokens !== undefined ? String(initial.maxTokens) : "");
  const [thinkingLevel, setThinkingLevel] = useState(initial.thinkingLevel ?? "");
  const [saving, setSaving] = useState(false);
  const { show: showSnackbar } = useSnackbar();

  const temperatureSet = temperature.trim() !== "";
  const thinkingConflict = temperatureSet && thinkingLevel !== "" && thinkingLevel !== "off";

  const resetDraft = () => {
    const ms = readSettings();
    setModelMode(ms.model ? "custom" : "default");
    setModel(ms.model ?? "");
    setTemperature(ms.temperature !== undefined ? String(ms.temperature) : "");
    setMaxTokens(ms.maxTokens !== undefined ? String(ms.maxTokens) : "");
    setThinkingLevel(ms.thinkingLevel ?? "");
  };

  const save = async () => {
    if (saving) return;

    const settings: ModelSettings = {};
    // "default" omits modelSettings.model entirely — that absence is what makes
    // the runtime fall back to the platform model from env.
    if (modelMode === "custom") {
      const trimmedModel = model.trim();
      if (!trimmedModel) {
        showSnackbar({ variant: "error", title: 'Enter a model name, or switch to "Platform default"' });
        return;
      }
      if (trimmedModel.length > MODEL_MAX_LENGTH) {
        showSnackbar({ variant: "error", title: `Model name must be ${MODEL_MAX_LENGTH} characters or fewer` });
        return;
      }
      settings.model = trimmedModel;
    }
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
    // Fast mode is owned by the provider card above — carry it through untouched.
    // (Only the standard bag carries `speed`; the fast bag would be circular.)
    if (!isFast && readSettings().speed === "fast") settings.speed = "fast";
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
      const live = agent.config as Record<string, unknown>;
      if (isFast) {
        // Merge into the fast profile, preserving providers/providerOrder/models.
        const profile = { ...((cfg["fastModeProfile"] as Record<string, unknown> | undefined) ?? {}) };
        if (Object.keys(settings).length > 0) profile["modelSettings"] = settings as unknown as Record<string, unknown>;
        else delete profile["modelSettings"];
        if (Object.keys(profile).length > 0) cfg["fastModeProfile"] = profile;
        else delete cfg["fastModeProfile"];
        await updateAgent(agent.slug, { config: cfg });
        if (cfg["fastModeProfile"]) live["fastModeProfile"] = cfg["fastModeProfile"];
        else delete live["fastModeProfile"];
      } else {
        if (Object.keys(settings).length > 0) cfg["modelSettings"] = settings as unknown as Record<string, unknown>;
        else delete cfg["modelSettings"];
        await updateAgent(agent.slug, { config: cfg });
        // Mutate the prop-derived config (same pattern as the provider-order
        // card) so other saves in this mount merge against fresh values.
        if (cfg["modelSettings"]) live["modelSettings"] = cfg["modelSettings"];
        else delete live["modelSettings"];
      }
      setSavedSettings(settings);
      setEditing(false);
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to save model settings" });
    } finally {
      setSaving(false);
    }
  };

  // Inherit labels for the fast view — what a blank field falls back to.
  const stdModelLabel = standard.model || "platform default";
  const stdThinkingLabel = standard.thinkingLevel || "platform setting";
  const inheritOptionLabel = isFast ? `Same as standard (${stdModelLabel})` : "Platform default (from environment)";

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
            {isFast && (
              <span data-id="spaces-fast-overrides-badge" className="inline-flex items-center text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-700/60">
                Fast mode overrides
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-success-fg">
              <span className="w-1.5 h-1.5 rounded-full bg-xyne-success" />
              Always available
            </span>
          </div>
          {!editing && (
            <>
              <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                <span className="text-xyne-fg-tertiary">Model</span>
                <span className="text-xyne-fg-primary font-mono truncate">{savedSettings.model || (isFast ? `Same as standard (${stdModelLabel})` : "Platform default")}</span>
                {summaryParts.length > 0 && (
                  <>
                    <span className="text-xyne-fg-tertiary">Settings</span>
                    <span className="text-xyne-fg-primary truncate">{summaryParts.join(" · ")}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary">
                {isFast
                  ? "Overrides applied only to fast-mode runs. Blank fields use the standard settings."
                  : "No credential needed. Used when no provider above serves the run, and as the final quota fallback. To run on your own key and pick from its models, add a “LiteLLM (own key)” provider above."}
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
          <div className="mb-4">
            <label className={LABEL_CLASS} htmlFor="spaces-model-source">Model</label>
            <select
              id="spaces-model-source"
              value={modelMode}
              onChange={(e) => setModelMode(e.target.value === "custom" ? "custom" : "default")}
              className={INPUT_CLASS}
            >
              <option value="default">{inheritOptionLabel}</option>
              <option value="custom">Custom model…</option>
            </select>
            {modelMode === "custom" && (
              <input
                id="spaces-default-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. kimi-latest"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                maxLength={MODEL_MAX_LENGTH}
                className={`${INPUT_CLASS} font-mono mt-2`}
              />
            )}
            <p className="mt-1 text-[11px] text-xyne-fg-muted">
              {isFast
                ? "Model for fast-mode Spaces runs. Leave on inherit to use the standard model."
                : modelMode === "custom"
                  ? "Any model id served by the platform LiteLLM proxy. Applies to runs served by Spaces — premium providers keep the model set on their own credential."
                  : "Runs on whichever model the platform is configured with (LITELLM_MODEL). Switch to a custom model to pin this agent to a specific one."}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLASS}>Thinking level</label>
              <select
                data-id="spaces-thinking-level"
                value={thinkingLevel}
                onChange={(e) => setThinkingLevel(e.target.value)}
                className={INPUT_CLASS}
              >
                {THINKING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value === "" && isFast ? `Same as standard (${stdThinkingLabel})` : o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Temperature (0–1)</label>
              <input
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder={isFast ? `same as standard (${standard.temperature ?? "provider default"})` : "provider default"}
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
                placeholder={isFast ? `same as standard (${standard.maxTokens ?? 16384})` : "16384"}
                inputMode="numeric"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-[11px] text-xyne-fg-muted">1024–64000. Higher values raise per-run cost ceilings.</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-xyne-fg-tertiary">
            {isFast
              ? "These override the standard settings for fast-mode runs only. Thinking, temperature and max tokens apply to whichever provider serves the run."
              : "Temperature, thinking and max tokens apply to whichever provider serves the run (including quota fallbacks). The model applies only to Spaces runs; premium providers pick their model on their credential. Model changes are recorded in the admin audit log."}
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
