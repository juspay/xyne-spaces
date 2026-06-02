import { useState, useEffect } from "react";
import {
  PlusIcon,
  InfoIcon,
  CaretDownIcon,
  CheckIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  XIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  FloppyDiskIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../../../lib/types";
import { useSnackbar } from "../../ui/Snackbar";
import { Menu, MenuItem } from "../../ui/Menu";
import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import {
  updateAgent,
  listAgentProviderCredentials,
  setAgentProviderCredential,
  deleteAgentProviderCredential,
  startAgentCodexOauth,
  exchangeAgentCodexOauth,
  listAgentCodexModels,
  type AgentProviderCredentialStatus,
} from "../../../../lib/api";

/* ─────────────────────────────────────────────────────────────────────
 * Display dictionaries — translate the wire-level provider keys and
 * auth-type strings into user-friendly labels. The wire values are
 * kept untouched in state + payloads; only what the user reads changes.
 * ───────────────────────────────────────────────────────────────────── */

type ProviderKey = "codex" | "claude" | "copilot" | "openrouter" | "spaces";

const PROVIDER_DISPLAY: Record<string, string> = {
  spaces: "Spaces",
  copilot: "GitHub Copilot",
  claude: "Anthropic Claude",
  codex: "OpenAI Codex",
  openrouter: "OpenRouter",
};

const AUTH_TYPE_DISPLAY: Record<string, string> = {
  api_key: "API key",
  oauth_token: "OAuth",
};

const ALL_PROVIDERS: ProviderKey[] = ["codex", "claude", "copilot", "openrouter", "spaces"];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

interface Props {
  agent: Agent;
}

export function ProviderTabV3({ agent }: Props) {
  // Provider preference order is now the single source of truth — first entry
  // serves as the parent (formerly "default provider"), subsequent entries
  // form the quota-fallback chain. Backwards compat: if no list is set we
  // seed from the legacy `config.provider` field so existing agents look
  // sensible without a manual re-save.
  const seedOrder: string[] = (() => {
    if (Array.isArray(agent.config?.providerOrder)) {
      return (agent.config?.providerOrder as unknown[]).filter((p): p is string => typeof p === "string");
    }
    const legacy = agent.config?.provider as string | undefined;
    return legacy ? [legacy] : [];
  })();
  const [providerOrder, setProviderOrder] = useState<string[]>(seedOrder);
  /** What's actually persisted server-side. Used to compute dirty state:
      Save only enables when `providerOrder` differs from this, so an empty
      → empty "save" doesn't fire and no "Saved ✓" flashes for a no-op. */
  const [savedOrder, setSavedOrder] = useState<string[]>(seedOrder);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);
  /** Provider preference order explainer modal — the inline wall of
      text was too dense to read on first land. Now a single info button
      opens a modal with the full explanation. */
  const [infoOpen, setInfoOpen] = useState(false);

  // Dirty check — JSON.stringify is fine for short string arrays.
  const orderIsDirty = JSON.stringify(providerOrder) !== JSON.stringify(savedOrder);

  const [creds, setCreds] = useState<AgentProviderCredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    provider: "codex" as "copilot" | "claude" | "codex" | "openrouter",
    apiKey: "",
    model: "",
    baseUrl: "",
    authType: "api_key" as "api_key" | "oauth_token",
  });
  const { show: showSnackbar } = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Codex agent-scoped browser-OAuth flow. Mirrors what SettingsTab does for
  // user-level Codex creds, but targets agentProviderCredentials via the
  // /agents/:slug/provider-credentials/codex/oauth/{start,exchange} routes.
  // Only relevant when form.provider="codex" + form.authType="oauth_token".
  const [codexFlow, setCodexFlow] = useState<{ url: string; state: string } | null>(null);
  const [codexCode, setCodexCode] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexErr, setCodexErr] = useState<string | null>(null);

  // Codex model list — fetched after a codex credential exists on the agent.
  // The OAuth bundle is required to hit ChatGPT backend's /codex/models, so
  // this only loads once we have a saved codex cred. Same picker the Codex
  // CLI shows: gpt-5.5, gpt-5.4, gpt-5.3-codex, etc.
  const [codexModels, setCodexModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [codexModelsErr, setCodexModelsErr] = useState<string | null>(null);
  const hasCodexCred = creds.some((c) => c.provider === "codex" && c.configured);
  useEffect(() => {
    if (!hasCodexCred) {
      setCodexModels(null);
      setCodexModelsErr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { listAgentCodexModels } = await import("../../../../lib/api");
        const rows = await listAgentCodexModels(agent.slug);
        if (!cancelled) {
          setCodexModels(rows);
          setCodexModelsErr(null);
        }
      } catch (err) {
        if (!cancelled) {
          setCodexModels(null);
          setCodexModelsErr(err instanceof Error ? err.message : "Failed to load Codex models");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [agent.slug, hasCodexCred]);

  const reload = async () => {
    setLoading(true);
    try {
      const { listAgentProviderCredentials } = await import("../../../../lib/api");
      const rows = await listAgentProviderCredentials(agent.slug);
      setCreds(rows);
    } catch (err) {
      console.warn("[provider-tab] failed to load credentials", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.slug]);

  const saveOrder = async () => {
    if (!orderIsDirty || orderSaving) return;
    setOrderSaving(true);
    setOrderSaved(false);
    try {
      const cfg = { ...(agent.config ?? {}) };
      if (providerOrder.length > 0) cfg.providerOrder = providerOrder;
      else delete cfg.providerOrder;
      // Retire the legacy single-pick field — preference order is now
      // canonical. Avoids drift where the two disagree.
      delete cfg.provider;
      await updateAgent(agent.slug, { config: cfg });
      // Mirror the just-saved state so future edits compute against it
      // and the dirty check clears (button returns to its quiet default).
      setSavedOrder([...providerOrder]);
      setOrderSaved(true);
      // The button morphs to "Saved" briefly, then this resets to false —
      // since the dirty check now reads clean, the button drops back to
      // its default disabled state.
      setTimeout(() => setOrderSaved(false), 2000);
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to save provider order" });
    } finally {
      setOrderSaving(false);
    }
  };

  const moveOrderItem = (idx: number, dir: -1 | 1) => {
    setProviderOrder((curr) => {
      const target = idx + dir;
      if (target < 0 || target >= curr.length) return curr;
      const next = [...curr];
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return next;
    });
  };
  const removeOrderItem = (idx: number) =>
    setProviderOrder((curr) => curr.filter((_, i) => i !== idx));
  const addOrderItem = (p: string) =>
    setProviderOrder((curr) => (curr.includes(p) ? curr : [...curr, p]));

  const submitForm = async () => {
    // apiKey is only required the FIRST time. If a credential already exists
    // for the chosen provider (e.g. just-completed Codex OAuth), this same
    // Save updates only model/baseUrl/authType without re-encrypting.
    const existingForProvider = creds.find((c) => c.provider === form.provider && c.configured);
    if (!form.apiKey.trim() && !existingForProvider) {
      setError("apiKey is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { setAgentProviderCredential } = await import("../../../../lib/api");
      await setAgentProviderCredential(agent.slug, {
        provider: form.provider,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        ...(form.authType ? { authType: form.authType } : {}),
      });
      setAdding(false);
      setForm({ provider: "codex", apiKey: "", model: "", baseUrl: "", authType: "api_key" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (provider: string) => {
    if (!confirm(`Remove ${provider} credentials from this agent? Users who run the agent without their own ${provider} key will fall back to the platform default.`)) return;
    try {
      const { deleteAgentProviderCredential } = await import("../../../../lib/api");
      await deleteAgentProviderCredential(agent.slug, provider);
      await reload();
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to remove credential" });
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-[860px]">
      {/* ─── CARD: Provider preference order ─────────────────────────
          User-perspective framing: this is "pick which providers can
          run this agent, in priority order." The wall of explanation
          text moved into an info modal so the card stays scannable. */}
      <div className="relative rounded-2xl border border-xyne-border bg-xyne-surface pt-6 px-6 pb-20 shadow-[0_1px_3px_-1px_rgba(16,24,40,0.06)]">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
                Select providers
              </h3>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-xyne-surface-subtle border border-xyne-border text-[12px] font-medium text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary hover:border-xyne-border-strong transition-colors"
                title="How does this work?"
                aria-label="How does this work?"
              >
                <InfoIcon size={13} weight="fill" />
                How it works
              </button>
            </div>
            <p className="mt-1.5 text-[12px] text-xyne-fg-secondary">
              Pick the providers that run this agent. They're tried in order — top first.
            </p>
          </div>
        </div>

        {/* Selected providers (the ordered list) */}
        {providerOrder.length === 0 ? (
          <div className="rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-5 text-center text-[12px] text-xyne-fg-tertiary mb-4">
            No providers selected yet — pick one or more below to start.
          </div>
        ) : (
          <ol className="space-y-2 mb-4">
            {providerOrder.map((p, idx) => (
              <li
                key={p}
                className="flex items-center gap-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2.5"
              >
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-xyne-fg-primary text-xyne-fg-inverse text-[12px] font-semibold tabular-nums">
                  {idx + 1}
                </span>
                <span className="flex-1 text-[13px] font-medium text-xyne-fg-primary">
                  {PROVIDER_DISPLAY[p] ?? p}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveOrderItem(idx, -1)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-fg-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="Move up"
                    aria-label="Move up"
                  >
                    <ArrowUpIcon size={13} weight="bold" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === providerOrder.length - 1}
                    onClick={() => moveOrderItem(idx, 1)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-fg-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ArrowDownIcon size={13} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOrderItem(idx)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xyne-fg-tertiary hover:bg-xyne-error-bg hover:text-xyne-error-fg transition-colors"
                    title="Remove from order"
                    aria-label="Remove from order"
                  >
                    <XIcon size={13} weight="bold" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Available providers — checkbox-style toggle so the chips
            actually feel like "select these". Selected ones grey out
            (they're already in the list above); unselected ones invite
            the click. */}
        <div>
          <div className="text-[12px] font-medium text-xyne-fg-tertiary mb-2">
            Available providers
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_PROVIDERS.map((p) => {
              const selected = providerOrder.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => (selected ? removeOrderItem(providerOrder.indexOf(p)) : addOrderItem(p))}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    selected
                      ? "border-xyne-fg-primary bg-xyne-fg-primary text-xyne-fg-inverse"
                      : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary"
                  }`}
                >
                  {selected ? (
                    <CheckIcon size={12} weight="bold" />
                  ) : (
                    <PlusIcon size={12} weight="bold" />
                  )}
                  {PROVIDER_DISPLAY[p] ?? p}
                </button>
              );
            })}
          </div>
        </div>

        {/* Floating Save FAB — bottom-right of the card, icon-only at rest,
            expands into a labeled pill on hover/focus. Three visual states:
              · idle + clean → low-contrast, disabled, just an icon
              · idle + dirty → filled dark, hover-expands "Save order"
              · saving       → label visible, slight pulse
              · just saved   → green fill + "Saved", auto-reverts via the
                                 timeout in saveOrder; once orderSaved
                                 returns to false, orderIsDirty is also
                                 false (savedOrder mirrors providerOrder),
                                 so the button settles back to disabled. */}
        <button
          type="button"
          onClick={() => void saveOrder()}
          disabled={!orderIsDirty || orderSaving}
          aria-label={
            orderSaved
              ? "Saved"
              : orderSaving
                ? "Saving order"
                : "Save order"
          }
          title={
            orderSaved
              ? "Saved"
              : orderIsDirty
                ? "Save order"
                : "No changes to save"
          }
          className={`group/save absolute bottom-5 right-5 inline-flex items-center justify-end h-11 rounded-full transition-all duration-200 ease-out ${
            orderSaved
              ? // Saved — green fill + label expanded by default (so the
                // morph reads as "just confirmed")
                "bg-xyne-success text-white shadow-[0_4px_12px_-2px_rgba(22,163,74,0.30)]"
              : !orderIsDirty
                ? // Idle / clean — quiet, low-contrast, no hover-expand
                  "bg-xyne-surface-sunken border border-xyne-border-subtle text-xyne-fg-tertiary cursor-not-allowed"
                : // Dirty — primary filled, ready for hover-expand
                  "bg-xyne-fg-primary text-xyne-fg-inverse shadow-[0_4px_12px_-2px_rgba(16,24,40,0.18)] hover:shadow-[0_6px_16px_-2px_rgba(16,24,40,0.24)]"
          } ${orderSaving ? "opacity-90" : ""}`}
        >
          <span
            className={`overflow-hidden whitespace-nowrap text-[12px] font-medium transition-[max-width,padding] duration-200 ease-out ${
              orderSaved || orderSaving
                ? // Always-visible label during the save / saved animation
                  "max-w-[160px] pl-4 pr-1"
                : orderIsDirty
                  ? // Hover-expand only when dirty
                    "max-w-0 group-hover/save:max-w-[160px] group-focus-visible/save:max-w-[160px] group-hover/save:pl-4 group-hover/save:pr-1 group-focus-visible/save:pl-4 group-focus-visible/save:pr-1"
                  : // Clean state — never expands
                    "max-w-0"
            }`}
          >
            {orderSaved ? "Saved" : orderSaving ? "Saving…" : "Save order"}
          </span>
          <span className="w-11 h-11 flex items-center justify-center flex-shrink-0">
            {orderSaved ? (
              <CheckIcon size={18} weight="bold" />
            ) : (
              <FloppyDiskIcon size={18} weight={orderIsDirty ? "fill" : "regular"} />
            )}
          </span>
        </button>
      </div>

      {/* ─── CARD: Configure Credentials ────────────────────────────
          Title + "Add credential" as a single-line header. The add
          button is an icon-only filled circle at rest; on hover it
          expands into a labeled pill (icon-in-bubble-expand pattern). */}
      <div className="rounded-2xl border border-xyne-border bg-xyne-surface p-6 shadow-[0_1px_3px_-1px_rgba(16,24,40,0.06)]">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-xyne-fg-primary">
                Configure Credentials
              </h3>
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-success-fg bg-xyne-success-bg border border-xyne-success-border rounded-full px-2 py-0.5"
                title="Credentials are encrypted at rest and never returned by the API."
              >
                <ShieldCheckIcon size={11} weight="fill" />
                Encrypted
              </span>
            </div>
            <p className="mt-1 text-[12px] text-xyne-fg-secondary">
              API keys for the providers above. Stored encrypted; the platform never returns plaintext.
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => { setError(null); setAdding(true); }}
              className="group/add inline-flex items-center justify-end h-10 rounded-full bg-xyne-fg-primary text-xyne-fg-inverse transition-all duration-200 ease-out hover:shadow-[0_4px_12px_-2px_rgba(16,24,40,0.18)]"
              aria-label="Add credential"
              title="Add credential"
            >
              <span className="overflow-hidden whitespace-nowrap text-[12px] font-medium max-w-0 group-hover/add:max-w-[140px] group-focus-visible/add:max-w-[140px] group-hover/add:pl-4 group-hover/add:pr-1 transition-[max-width,padding] duration-200 ease-out">
                Add credential
              </span>
              <span className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                <PlusIcon size={16} weight="bold" />
              </span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-5 text-center text-[12px] text-xyne-fg-tertiary">
            Loading credentials…
          </div>
        ) : creds.length === 0 && !adding ? (
          <div className="rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-5 text-center text-[12px] text-xyne-fg-tertiary">
            No agent-level credentials yet. Users will fall through to their personal provider or the platform default.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {creds.map((c) => (
              <li
                key={c.provider}
                className="flex items-start justify-between gap-3 rounded-lg border border-xyne-border bg-xyne-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  {/* Provider name + status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-xyne-fg-primary">
                      {PROVIDER_DISPLAY[c.provider] ?? c.provider}
                    </span>
                    {c.authType && (
                      <span className="inline-flex items-center text-[11px] font-medium text-xyne-fg-tertiary bg-xyne-surface-sunken border border-xyne-border rounded-full px-2 py-0.5">
                        {AUTH_TYPE_DISPLAY[c.authType] ?? c.authType}
                      </span>
                    )}
                    {c.configured ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-success-fg">
                        <span className="w-1.5 h-1.5 rounded-full bg-xyne-success" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-warning-fg">
                        <WarningCircleIcon size={11} weight="fill" />
                        Missing key
                      </span>
                    )}
                  </div>
                  {/* Model + base URL — labeled rows, not concatenated. */}
                  <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                    <span className="text-xyne-fg-tertiary">Model</span>
                    <span className="text-xyne-fg-primary font-mono truncate">{c.model ?? "Default"}</span>
                    {c.baseUrl && (
                      <>
                        <span className="text-xyne-fg-tertiary">Base URL</span>
                        <span className="text-xyne-fg-primary font-mono truncate">{c.baseUrl}</span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-xyne-fg-tertiary">
                    Updated {formatRelativeTime(c.updatedAt)}
                    {c.createdByUserId ? ` · added by ${c.createdByUserId}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(c.provider)}
                  title={`Remove ${PROVIDER_DISPLAY[c.provider] ?? c.provider} credentials`}
                  className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-xyne-fg-tertiary hover:bg-xyne-error-bg hover:text-xyne-error-fg transition-colors"
                  aria-label="Remove credential"
                >
                  <XIcon size={14} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="mt-4 rounded-xl border border-xyne-border bg-xyne-surface-subtle p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                  Provider
                </label>
                <Menu
                  align="start"
                  trigger={(triggerProps) => (
                    <button
                      {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong"
                    >
                      <span>{PROVIDER_DISPLAY[form.provider] ?? form.provider}</span>
                      <CaretDownIcon size={12} className="text-xyne-fg-tertiary" />
                    </button>
                  )}
                >
                  {(["codex", "claude", "copilot", "openrouter"] as const).map((key) => (
                    <MenuItem
                      key={key}
                      selected={form.provider === key}
                      onSelect={() => setForm((p) => ({ ...p, provider: key }))}
                      trailing={form.provider === key ? <CheckIcon size={12} weight="bold" /> : undefined}
                    >
                      {PROVIDER_DISPLAY[key]}
                    </MenuItem>
                  ))}
                </Menu>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                  Auth type
                </label>
                <Menu
                  align="start"
                  trigger={(triggerProps) => (
                    <button
                      {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong"
                    >
                      <span>{AUTH_TYPE_DISPLAY[form.authType] ?? form.authType}</span>
                      <CaretDownIcon size={12} className="text-xyne-fg-tertiary" />
                    </button>
                  )}
                >
                  {(["api_key", "oauth_token"] as const).map((key) => (
                    <MenuItem
                      key={key}
                      selected={form.authType === key}
                      onSelect={() => setForm((p) => ({ ...p, authType: key }))}
                      trailing={form.authType === key ? <CheckIcon size={12} weight="bold" /> : undefined}
                    >
                      {AUTH_TYPE_DISPLAY[key]}
                    </MenuItem>
                  ))}
                </Menu>
              </div>
              {/* Codex ChatGPT browser-OAuth flow — replaces the raw paste-bundle path
                  with a "Sign in with ChatGPT" button that mirrors what the user-level
                  Settings UI uses. Stores the OAuth bundle (access + refresh + expiry)
                  into agentProviderCredentials via the backend's /codex/oauth/exchange.
                  Falls back to the manual-paste field if the user isn't on Codex + OAuth. */}
              {form.provider === "codex" && form.authType === "oauth_token" ? (
                <div className="sm:col-span-2 space-y-2 rounded border border-xyne-brand/50 bg-xyne-brand-ghost px-3 py-2.5 text-xs text-xyne-brand">
                  <p>
                    Sign in with the team's ChatGPT account in the browser. After authorizing, OpenAI's page will show a code — copy it (or the full callback URL) and paste it below to finish. The team's Codex sub will be used for every user who runs this agent without a personal Codex key.
                  </p>
                  {!codexFlow ? (
                    <button
                      type="button"
                      disabled={codexBusy}
                      onClick={async () => {
                        setCodexBusy(true);
                        setCodexErr(null);
                        try {
                          const { startAgentCodexOauth } = await import("../../../../lib/api");
                          const flow = await startAgentCodexOauth(agent.slug);
                          setCodexFlow({ url: flow.url, state: flow.state });
                          window.open(flow.url, "_blank", "noopener,noreferrer");
                        } catch (e) {
                          setCodexErr(e instanceof Error ? e.message : "Failed to start sign-in");
                        } finally {
                          setCodexBusy(false);
                        }
                      }}
                      className="rounded-md bg-xyne-brand px-3 py-1.5 text-xs font-medium text-xyne-fg-inverse hover:opacity-90 disabled:opacity-50"
                    >
                      {codexBusy ? "Opening…" : "Sign in with ChatGPT"}
                    </button>
                  ) : (
                    <>
                      <p>
                        If the new tab didn't open,{" "}
                        <a href={codexFlow.url} target="_blank" rel="noopener noreferrer" className="underline text-xyne-brand hover:text-white">click here</a>.
                      </p>
                      <textarea
                        value={codexCode}
                        onChange={(e) => setCodexCode(e.target.value)}
                        placeholder="Paste the code or the full http://localhost:1455/auth/callback?code=…&state=… URL"
                        rows={3}
                        className="w-full rounded-md border border-xyne-brand bg-xyne-surface px-2 py-1.5 text-xs text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-brand focus:ring-1 focus:ring-xyne-brand"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={codexBusy || !codexCode.trim()}
                          onClick={async () => {
                            setCodexBusy(true);
                            setCodexErr(null);
                            try {
                              const { exchangeAgentCodexOauth } = await import("../../../../lib/api");
                              await exchangeAgentCodexOauth(agent.slug, { code: codexCode.trim(), state: codexFlow.state });
                              setCodexFlow(null);
                              setCodexCode("");
                              // Keep the form open so the user can pick a model
                              // from the dropdown (now fetchable since the
                              // credential is saved). Reload triggers the
                              // codex-models effect.
                              await reload();
                            } catch (e) {
                              setCodexErr(e instanceof Error ? e.message : "Sign-in failed");
                            } finally {
                              setCodexBusy(false);
                            }
                          }}
                          className="rounded-md bg-xyne-brand px-3 py-1.5 text-xs font-medium text-xyne-fg-inverse hover:opacity-90 disabled:opacity-50"
                        >
                          {codexBusy ? "Verifying…" : "Complete sign-in"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCodexFlow(null); setCodexCode(""); setCodexErr(null); }}
                          className="rounded-md px-2 py-1.5 text-xs text-xyne-brand hover:text-xyne-brand"
                        >
                          Cancel sign-in
                        </button>
                      </div>
                    </>
                  )}
                  {codexErr && <p className="text-xyne-error">{codexErr}</p>}
                  <p className="text-[10px] text-xyne-brand/70">
                    No keys are typed or stored in your browser — only the OAuth code-exchange round-trip ever sees the token.
                  </p>
                </div>
              ) : (
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                    API key
                  </label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                    placeholder="sk-…  or  {access_token: ...}"
                    className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 font-mono text-[13px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)]"
                  />
                  <p className="text-[12px] text-xyne-fg-tertiary">
                    Encrypted the moment you save. Never returned by the API after upload.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                  Model
                  <span className="ml-1 text-[12px] font-normal text-xyne-fg-tertiary">
                    {form.provider === "codex" && codexModels && codexModels.length > 0 ? "" : "(optional)"}
                  </span>
                </label>
                {form.provider === "codex" && codexModels && codexModels.length > 0 ? (
                  <Menu
                    align="start"
                    trigger={(triggerProps) => (
                      <button
                        {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong"
                      >
                        <span>{form.model ? (codexModels.find((m) => m.id === form.model)?.name ?? form.model) : "Use default"}</span>
                        <CaretDownIcon size={12} className="text-xyne-fg-tertiary" />
                      </button>
                    )}
                  >
                    <MenuItem
                      selected={!form.model}
                      onSelect={() => setForm((p) => ({ ...p, model: "" }))}
                      trailing={!form.model ? <CheckIcon size={12} weight="bold" /> : undefined}
                    >
                      Use default
                    </MenuItem>
                    {codexModels.map((m) => (
                      <MenuItem
                        key={m.id}
                        selected={form.model === m.id}
                        onSelect={() => setForm((p) => ({ ...p, model: m.id }))}
                        trailing={form.model === m.id ? <CheckIcon size={12} weight="bold" /> : undefined}
                      >
                        {m.name}
                      </MenuItem>
                    ))}
                  </Menu>
                ) : (
                  <input
                    value={form.model}
                    onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                    placeholder="gpt-5.5 · claude-sonnet-4-5 · …"
                    className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)]"
                  />
                )}
                {form.provider === "codex" && codexModelsErr && (
                  <p className="text-[12px] text-xyne-warning-fg">
                    Couldn't load Codex models — free-text is fine.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                  Base URL
                  <span className="ml-1 text-[12px] font-normal text-xyne-fg-tertiary">
                    (optional)
                  </span>
                </label>
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))}
                  placeholder="https://openrouter.ai/api/v1"
                  className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)]"
                />
              </div>
            </div>
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">
                <WarningCircleIcon size={14} weight="fill" className="shrink-0 mt-[1px]" />
                <span>{error}</span>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void submitForm()}
                disabled={busy}
              >
                {busy ? "Saving…" : "Save credential"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setAdding(false); setError(null); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Info Modal — explains the selection / preference order ─── */}
      <Dialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        title="How provider selection works"
        description="How the platform picks which AI runs each request."
        maxWidth={520}
      >
        <div className="flex flex-col gap-3 text-[13px] text-xyne-fg-secondary leading-relaxed">
          <p>
            When this agent runs, the platform walks the order from top to bottom and uses the first provider that can serve the request.
          </p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>The first provider runs the request.</li>
            <li>If it hits a rate limit or quota error, the next one takes over.</li>
            <li>If every entry fails, the platform falls back to its default (Kimi).</li>
          </ol>
          <div className="mt-1 rounded-lg border border-xyne-info-border bg-xyne-info-bg px-3 py-2.5 text-[12px] text-xyne-info-fg">
            <strong className="font-semibold">Personal keys still win.</strong> If a user has their own provider configured in Settings → Providers, that's used regardless of this order. This list only matters for users without a personal provider.
          </div>
          <p className="text-[12px] text-xyne-fg-tertiary">
            Leave it empty to fall straight through to the platform default.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

