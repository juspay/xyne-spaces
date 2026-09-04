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
  PencilSimpleIcon,
  ShareNetworkIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import type { Agent, AgentLight } from "../../../../lib/types";
import { useSnackbar } from "../../ui/Snackbar";
import { Menu, MenuItem } from "../../ui/Menu";
import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { Switch } from "../../ui/Switch";
import {
  updateAgent,
  listAgentProviderCredentials,
  setAgentProviderCredential,
  deleteAgentProviderCredential,
  shareAgentProviderCredential,
  listAgents,
  listAgentCodexModels,
  listClaudeModels,
  type AgentProviderCredentialStatus,
} from "../../../../lib/api";
import { SpacesDefaultRowV3 } from "./SpacesDefaultRowV3";

/* ─────────────────────────────────────────────────────────────────────
 * Display dictionaries — translate the wire-level provider keys and
 * auth-type strings into user-friendly labels. The wire values are
 * kept untouched in state + payloads; only what the user reads changes.
 * ───────────────────────────────────────────────────────────────────── */

type ProviderKey = "codex" | "claude" | "copilot" | "openrouter" | "litellm" | "spaces";

const PROVIDER_DISPLAY: Record<string, string> = {
  spaces: "Spaces",
  copilot: "GitHub Copilot",
  claude: "Anthropic Claude",
  codex: "OpenAI Codex",
  openrouter: "OpenRouter",
  litellm: "LiteLLM (own key)",
};

const AUTH_TYPE_DISPLAY: Record<string, string> = {
  api_key: "API key",
  oauth_token: "OAuth",
};

const ALL_PROVIDERS: ProviderKey[] = ["codex", "claude", "copilot", "openrouter", "litellm", "spaces"];

/* ─────────────────────────────────────────────────────────────────────
 * Ordered provider list + "Available providers" chips. Used twice: for the
 * standard provider order and for the fast-mode profile's own order (which
 * is "same as standard, different order" — credentials and models come from
 * the shared credential rows plus the fast-mode override card below).
 * ───────────────────────────────────────────────────────────────────── */
function ProviderOrderEditor({
  order,
  onChange,
  readOnly,
  idPrefix,
}: {
  order: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  idPrefix: string;
}) {
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    onChange(next);
  };
  const remove = (idx: number) => onChange(order.filter((_, i) => i !== idx));
  const add = (p: string) => onChange(order.includes(p) ? order : [...order, p]);

  return (
    <>
      {order.length === 0 ? (
        <div className="rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-5 text-center text-[12px] text-xyne-fg-tertiary mb-4">
          No providers selected yet — pick one or more below to start.
        </div>
      ) : (
        <ol data-id={`${idPrefix}-order`} className={`space-y-2 mb-4 ${readOnly ? "opacity-60" : ""}`}>
          {order.map((p, idx) => (
            <li
              key={p}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2.5"
            >
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-xyne-fg-primary text-xyne-fg-inverse text-[12px] font-semibold tabular-nums">
                {idx + 1}
              </span>
              <span className="flex-1 text-[13px] font-medium text-xyne-fg-primary">
                {PROVIDER_DISPLAY[p] ?? p}
              </span>
              {!readOnly && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-fg-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="Move up"
                    aria-label="Move up"
                  >
                    <ArrowUpIcon size={13} weight="bold" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === order.length - 1}
                    onClick={() => move(idx, 1)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-fg-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ArrowDownIcon size={13} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xyne-fg-tertiary hover:bg-xyne-error-bg hover:text-xyne-error-fg transition-colors"
                    title="Remove from order"
                    aria-label="Remove from order"
                  >
                    <XIcon size={13} weight="bold" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <div>
          <div className="text-[12px] font-medium text-xyne-fg-tertiary mb-2">
            Available providers
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_PROVIDERS.map((p) => {
              const selected = order.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  data-id={`${idPrefix}-pill-${p}`}
                  onClick={() => (selected ? remove(order.indexOf(p)) : add(p))}
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
      )}
    </>
  );
}

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
  userId: string;
}

export function ProviderTabV3({ agent, userId }: Props) {
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
  /**
   * Two policy modes for how the agent's premium provider is used:
   *   `true`  (Always On) — agent's provider is the default for every run.
   *                         Old behavior; backfill default so existing agents
   *                         keep working without any opt-in.
   *   `false` (Platform default) — runs use the user's personal provider
   *                                (if configured), otherwise the platform model.
   *                                The agent's premium provider is never selected
   *                                automatically.
   *
   * Stored at agent.config.providerAlwaysOn. Undefined = treated as true on
   * the backend (see webhook.ts), so existing agents keep their behavior
   * until an owner toggles this off.
   */
  const seedAlwaysOn = (agent.config as Record<string, unknown> | undefined)?.["providerAlwaysOn"] !== false;
  const [alwaysOn, setAlwaysOn] = useState<boolean>(seedAlwaysOn);
  const [savedAlwaysOn, setSavedAlwaysOn] = useState<boolean>(seedAlwaysOn);

  /** Whether a failed configured provider may fall through to the keyless
   * Spaces/platform provider. Defaults on to preserve existing agents. */
  const seedFallbackToSpaces = (agent.config as Record<string, unknown> | undefined)?.["providerFallbackToSpaces"] !== false;
  const [fallbackToSpaces, setFallbackToSpaces] = useState<boolean>(seedFallbackToSpaces);
  const [savedFallbackToSpaces, setSavedFallbackToSpaces] = useState<boolean>(seedFallbackToSpaces);

  /**
   * Which provider the agent's SUBAGENTS run on, when they have no explicit
   * per-subagent override:
   *   "spaces" — subagents run on the Spaces platform default (LiteLLM). DEFAULT.
   *   "parent" — subagents inherit this agent's resolved provider (uses more
   *              tokens/credits on paid plans).
   * Stored at agent.config.subagentProviderMode; undefined ⇒ "spaces".
   */
  const seedSubagentMode: "parent" | "spaces" =
    (agent.config as Record<string, unknown> | undefined)?.["subagentProviderMode"] === "parent"
      ? "parent"
      : "spaces";
  const [subagentMode, setSubagentMode] = useState<"parent" | "spaces">(seedSubagentMode);
  const [savedSubagentMode, setSavedSubagentMode] = useState<"parent" | "spaces">(seedSubagentMode);

  /**
   * Which provider AUTOMATION / SCHEDULED / error-pipeline runs use.
   * These headless bulk paths fire on every PR, feedback message, and cron
   * tick — they can burn ~90% of an agent's premium quota. "platform"
   * downgrades ONLY those runs to the platform default model; human chat and
   * mentions keep the full provider order.
   * Stored at agent.config.automationProvider; undefined ⇒ same as chat.
   */
  const rawAutomationProvider = (agent.config as Record<string, unknown> | undefined)?.["automationProvider"];
  // "default" (unset) | "platform" | a concrete provider key. The backend has
  // always accepted any known provider here (resolveAgentProviderConfigs);
  // only this control was limited to platform, so an agent could not send its
  // automations to a cheap provider it already had credentials for.
  const seedAutomationMode: string =
    typeof rawAutomationProvider === "string" && rawAutomationProvider ? rawAutomationProvider : "default";
  const [automationMode, setAutomationMode] = useState<string>(seedAutomationMode);
  const [savedAutomationMode, setSavedAutomationMode] = useState<string>(seedAutomationMode);

  /**
   * Provider FAST MODE — Anthropic `speed: "fast"`. Same credential, same
   * model, served from the provider's faster (premium-priced) tier. Honored
   * by the runtime only when the run is served by a direct Claude credential
   * on Claude Opus 5 / Opus 4.8; every other provider ignores it (logged, never
   * a failed run). Can also be toggled per chat in the chat sidebar.
   * Stored at agent.config.modelSettings.speed; undefined ⇒ standard.
   */
  const seedFastMode =
    ((agent.config as Record<string, unknown> | undefined)?.["modelSettings"] as Record<string, unknown> | undefined)?.["speed"] === "fast";
  const [fastMode, setFastMode] = useState<boolean>(seedFastMode);
  const [savedFastMode, setSavedFastMode] = useState<boolean>(seedFastMode);

  /**
   * Fast-mode provider PROFILE — which providers (and on which model) run
   * when fast mode is on. "inherit" (default) = the same providers +
   * credentials as standard mode; "custom" = its own order below, with an
   * optional per-provider model pin. Credential keys are per provider and
   * shared by both modes. Stored at agent.config.fastModeProfile; mirrors
   * claw-auth lib/agent-provider-config.ts → parseFastModeProfile.
   */
  const seedFastProfile = (() => {
    const raw = (agent.config as Record<string, unknown> | undefined)?.["fastModeProfile"] as Record<string, unknown> | undefined;
    const custom = raw?.["providers"] === "custom";
    const order = custom && Array.isArray(raw?.["providerOrder"])
      ? (raw!["providerOrder"] as unknown[]).filter((p): p is string => typeof p === "string" && (ALL_PROVIDERS as string[]).includes(p))
      : [];
    return { mode: (custom ? "custom" : "inherit") as "custom" | "inherit", order };
  })();
  const [fastProfileMode, setFastProfileMode] = useState<"inherit" | "custom">(seedFastProfile.mode);
  const [savedFastProfileMode, setSavedFastProfileMode] = useState<"inherit" | "custom">(seedFastProfile.mode);
  const [fastOrder, setFastOrder] = useState<string[]>(seedFastProfile.order);
  const [savedFastOrder, setSavedFastOrder] = useState<string[]>(seedFastProfile.order);
  /** Which provider setup the card is showing: standard or fast mode. */
  const [providerView, setProviderView] = useState<"standard" | "fast">("standard");

  const [orderSaving, setOrderSaving] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);
  /** Provider preference order explainer modal — the inline wall of
      text was too dense to read on first land. Now a single info button
      opens a modal with the full explanation. */
  const [infoOpen, setInfoOpen] = useState(false);

  // Dirty check — JSON.stringify is fine for short string arrays. Also true
  // when the "Always On" toggle differs from what's persisted.
  const orderIsDirty =
    JSON.stringify(providerOrder) !== JSON.stringify(savedOrder) ||
    alwaysOn !== savedAlwaysOn ||
    fallbackToSpaces !== savedFallbackToSpaces ||
    subagentMode !== savedSubagentMode ||
    automationMode !== savedAutomationMode ||
    fastMode !== savedFastMode ||
    fastProfileMode !== savedFastProfileMode ||
    JSON.stringify(fastOrder) !== JSON.stringify(savedFastOrder);

  const [creds, setCreds] = useState<AgentProviderCredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    provider: "codex" as "copilot" | "claude" | "codex" | "openrouter" | "litellm",
    apiKey: "",
    model: "",
    baseUrl: "",
    authType: "api_key" as "api_key" | "oauth_token",
    // "" = provider default ("medium"). Stored on the credential row and
    // applied by the runtime to reasoning-capable models (gpt-5.x/o*; for
    // claude it maps to the thinking level). Agent-level
    // config.modelSettings.thinkingLevel, when set, takes precedence.
    reasoningEffort: "" as "" | "low" | "medium" | "high",
  });
  const { show: showSnackbar } = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Share-to-agents dialog. Promotes this agent's credential into an
  // org-level shared credential (one OAuth session) and binds selected
  // agents to it — the fix for per-agent token copies of one ChatGPT
  // account invalidating each other on every re-auth.
  const [shareProvider, setShareProvider] = useState<string | null>(null);
  const [shareName, setShareName] = useState("");
  const [shareAgents, setShareAgents] = useState<AgentLight[] | null>(null);
  const [shareSelected, setShareSelected] = useState<Set<string>>(new Set());
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);

  const openShare = (c: AgentProviderCredentialStatus) => {
    setShareProvider(c.provider);
    setShareName(c.sharedCredentialName ?? `${PROVIDER_DISPLAY[c.provider] ?? c.provider} (shared)`);
    setShareSelected(new Set());
    setShareErr(null);
    setShareAgents(null);
    void listAgents()
      .then((all) => setShareAgents(all.filter((a) => a.id !== agent.id && a.enabled)))
      .catch((err) => setShareErr(err instanceof Error ? err.message : "Failed to load agents"));
  };

  const submitShare = async () => {
    if (!shareProvider || shareSelected.size === 0) return;
    setShareBusy(true);
    setShareErr(null);
    try {
      const { results } = await shareAgentProviderCredential(agent.slug, shareProvider, {
        name: shareName.trim() || undefined,
        agentIds: [...shareSelected],
      });
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      showSnackbar({
        variant: failed.length === 0 ? "success" : "error",
        title:
          failed.length === 0
            ? `Shared with ${ok.length} agent(s)`
            : `Shared with ${ok.length}, failed for ${failed.map((f) => f.slug ?? f.agentId).join(", ")} (${failed[0]?.error ?? "error"})`,
      });
      setShareProvider(null);
      await reload();
    } catch (err) {
      setShareErr(err instanceof Error ? err.message : "Failed to share credential");
    } finally {
      setShareBusy(false);
    }
  };

  // Codex model list — fetched after a codex credential exists on the agent.)
  // API-key-only now (ChatGPT OAuth removed): standard /v1/models.
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

  // Claude model list — same source the user-level Settings UI uses
  // (listClaudeModels → /v1/models). Populates the model dropdown so you pick
  // a valid id (claude-opus-4-8, …) instead of free-typing it (which let
  // `claude-opus-4.8`-style typos through). Fetched with the just-typed key
  // while adding, or against the saved cred afterwards. Debounced so we don't
  // hit the API on every keystroke of the pasted token.
  const [claudeModels, setClaudeModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [claudeModelsErr, setClaudeModelsErr] = useState<string | null>(null);
  const hasClaudeCred = creds.some((c) => c.provider === "claude" && c.configured);
  useEffect(() => {
    if (form.provider !== "claude") {
      setClaudeModels(null);
      setClaudeModelsErr(null);
      return;
    }
    const typedKey = form.apiKey.trim();
    // Need *something* to authenticate the /v1/models call: either the key
    // being typed now, or an already-saved Claude cred (resolved server-side).
    if (!typedKey && !hasClaudeCred) {
      setClaudeModels(null);
      setClaudeModelsErr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          // Pass authType so the backend uses Bearer (OAuth) vs x-api-key
          // correctly when listing models with the just-typed key. Without it,
          // an OAuth token is sent as x-api-key → 401 "invalid x-api-key".
          const rows = await listClaudeModels(
            agent.slug,
            userId,
            typedKey ? { apiKey: typedKey, authType: form.authType } : undefined,
          );
          if (!cancelled) {
            setClaudeModels(rows.map((r) => ({ id: r.id, name: r.displayName ?? r.id })));
            setClaudeModelsErr(null);
          }
        } catch (err) {
          if (!cancelled) {
            setClaudeModels(null);
            setClaudeModelsErr(err instanceof Error ? err.message : "Failed to load Claude models");
          }
        }
      })();
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.provider, form.apiKey, hasClaudeCred, agent.slug, userId]);

  // LiteLLM model list — lists the models the entered key can access on the
  // proxy (POST /provider-credentials/litellm/models). Fetched with the just-
  // typed key + base URL while adding, or against the saved cred afterwards.
  // Debounced so we don't hit the proxy on every keystroke of the pasted key.
  const [litellmModels, setLitellmModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [litellmModelsErr, setLitellmModelsErr] = useState<string | null>(null);
  const hasLitellmCred = creds.some((c) => c.provider === "litellm" && c.configured);
  useEffect(() => {
    if (form.provider !== "litellm") {
      setLitellmModels(null);
      setLitellmModelsErr(null);
      return;
    }
    const typedKey = form.apiKey.trim();
    const typedBase = form.baseUrl.trim();
    // Need a key to list against: either the one being typed, or an already-
    // saved LiteLLM cred (resolved + decrypted server-side).
    if (!typedKey && !hasLitellmCred) {
      setLitellmModels(null);
      setLitellmModelsErr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { listAgentLitellmModels } = await import("../../../../lib/api");
          // Just-typed key → send it (+ base URL if typed). Otherwise fall back
          // to the saved cred server-side, optionally overriding its base URL.
          const payload = typedKey
            ? { apiKey: typedKey, ...(typedBase ? { baseUrl: typedBase } : {}) }
            : (typedBase ? { baseUrl: typedBase } : undefined);
          const rows = await listAgentLitellmModels(agent.slug, payload);
          if (!cancelled) {
            setLitellmModels(rows);
            setLitellmModelsErr(null);
          }
        } catch (err) {
          if (!cancelled) {
            setLitellmModels(null);
            setLitellmModelsErr(err instanceof Error ? err.message : "Failed to load LiteLLM models");
          }
        }
      })();
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.provider, form.apiKey, form.baseUrl, hasLitellmCred, agent.slug]);

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
      // Persist the "Always On" policy. Omit the key when it matches the
      // backfill default (true) so the JSON config stays minimal; the
      // backend treats undefined as true anyway.
      if (alwaysOn) delete cfg.providerAlwaysOn;
      else cfg.providerAlwaysOn = false;
      // Provider failure policy. Default is to fall through to Spaces; when the
      // owner turns this off, a bad/expired/out-of-quota provider fails visibly
      // instead of silently answering from the platform key.
      if (fallbackToSpaces) delete cfg.providerFallbackToSpaces;
      else cfg.providerFallbackToSpaces = false;
      // Subagent provider routing. Omit when "spaces" (the default) to keep the
      // JSON config minimal — the backend/runtime treat undefined as "spaces".
      if (subagentMode === "parent") cfg.subagentProviderMode = "parent";
      else delete cfg.subagentProviderMode;
      // Automation/scheduled downgrade. Omit when "default" so the JSON stays
      // minimal — the backend treats undefined as "same provider as chat".
      if (automationMode !== "default") cfg.automationProvider = automationMode;
      else delete cfg.automationProvider;
      // Provider fast mode rides modelSettings (shared with the Spaces row's
      // model/temperature/thinking fields) — merge, never replace, and drop the
      // key entirely when off so the JSON stays minimal.
      const ms = { ...((cfg.modelSettings as Record<string, unknown> | undefined) ?? {}) };
      if (fastMode) ms.speed = "fast";
      else delete ms.speed;
      if (Object.keys(ms).length > 0) cfg.modelSettings = ms;
      else delete cfg.modelSettings;
      // Fast-mode provider profile — "same as standard, different order".
      // Only providers/providerOrder are owned here; the run-setting overrides
      // (fastModeProfile.modelSettings, edited on the Spaces card below) are
      // preserved. Per-provider model pins are no longer offered — saving
      // drops any legacy `models` key.
      const prevProfile = (cfg.fastModeProfile as Record<string, unknown> | undefined) ?? {};
      const keptOverrides = prevProfile["modelSettings"] ? { modelSettings: prevProfile["modelSettings"] } : {};
      if (fastProfileMode === "custom") {
        cfg.fastModeProfile = { providers: "custom", providerOrder: fastOrder, ...keptOverrides };
      } else if (Object.keys(keptOverrides).length > 0) {
        cfg.fastModeProfile = keptOverrides;
      } else {
        delete cfg.fastModeProfile;
      }
      await updateAgent(agent.slug, { config: cfg });
      // Keep the prop-derived config in step (the Spaces row merges against it).
      const live = agent.config as Record<string, unknown>;
      if (cfg.providerFallbackToSpaces !== undefined) live["providerFallbackToSpaces"] = cfg.providerFallbackToSpaces;
      else delete live["providerFallbackToSpaces"];
      if (cfg.modelSettings) live["modelSettings"] = cfg.modelSettings;
      else delete live["modelSettings"];
      // Mirror the just-saved state so future edits compute against it
      // and the dirty check clears (button returns to its quiet default).
      setSavedOrder([...providerOrder]);
      setSavedAlwaysOn(alwaysOn);
      setSavedFallbackToSpaces(fallbackToSpaces);
      setSavedSubagentMode(subagentMode);
      setSavedAutomationMode(automationMode);
      setSavedFastMode(fastMode);
      setSavedFastProfileMode(fastProfileMode);
      setSavedFastOrder([...fastOrder]);
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
        // "" → null clears the override back to the provider default.
        reasoningEffort: form.reasoningEffort || null,
      });
      setAdding(false);
      setForm({ provider: "codex", apiKey: "", model: "", baseUrl: "", authType: "api_key", reasoningEffort: "" });
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
              {providerView === "standard"
                ? "Pick the providers that run this agent. They're tried in order — top first."
                : "Providers used when fast mode is on."}
            </p>
          </div>
          {/* Standard vs. fast mode — two provider setups for the one agent. */}
          <div
            role="tablist"
            aria-label="Provider setup"
            className="flex shrink-0 rounded-full border border-xyne-border bg-xyne-surface-subtle p-0.5"
          >
            {(["standard", "fast"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                data-id={`provider-view-${v}`}
                aria-selected={providerView === v}
                onClick={() => setProviderView(v)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  providerView === v
                    ? v === "fast"
                      ? "bg-amber-500 text-white"
                      : "bg-xyne-fg-primary text-xyne-fg-inverse"
                    : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                }`}
              >
                {v === "fast" && <LightningIcon size={11} weight="fill" />}
                {v === "standard" ? "Standard" : "Fast mode"}
              </button>
            ))}
          </div>
        </div>

        {providerView === "standard" ? (
          <>
            {/* Always On vs. Platform default — policy switch for when the agent's
                premium provider is actually consumed. Defaults to Always On for
                backfill (matches every existing agent's pre-feature behavior). */}
            <div className="mb-4 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-xyne-fg-primary">When to use these providers</div>
                  <p className="mt-1 text-[12px] text-xyne-fg-secondary leading-relaxed">
                    {alwaysOn
                      ? "Always on — every run uses the first provider above."
                      : "Platform default — runs use the user's personal provider if configured, otherwise the Spaces model (Kimi). The agent's own providers are used only in Always On mode."}
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label="When to use the agent's premium provider"
                  className="flex shrink-0 rounded-full border border-xyne-border bg-xyne-surface p-0.5"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={alwaysOn}
                    onClick={() => setAlwaysOn(true)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      alwaysOn
                        ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                        : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                    }`}
                  >
                    Always on
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!alwaysOn}
                    onClick={() => setAlwaysOn(false)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      !alwaysOn
                        ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                        : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                    }`}
                  >
                    Platform default
                  </button>
                </div>
              </div>
            </div>

            {/* Provider failure policy — controls only the implicit terminal
                fallback to the Spaces/platform provider. Explicit provider-order
                entries above still behave as configured. */}
            <div className="mb-4 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-xyne-fg-primary">Fallback to Spaces provider</div>
                  <p className="mt-1 text-[12px] text-xyne-fg-secondary leading-relaxed">
                    {fallbackToSpaces
                      ? "On — if the selected provider is invalid, out of quota, or unavailable, the run can continue on the Spaces platform provider."
                      : "Off — provider credential failures fail visibly instead of silently answering from the Spaces platform provider."}
                  </p>
                </div>
                <Switch checked={fallbackToSpaces} onChange={setFallbackToSpaces} ariaLabel="Fallback to Spaces provider" />
              </div>
            </div>

            {/* Subagent provider — which provider the agent's subagents run on when
                they have no explicit per-subagent override. "Spaces default" (the
                default) runs subagents on the cheaper platform model; "Follow parent"
                inherits this agent's provider and uses more tokens on paid plans. */}
            <div className="mb-4 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-xyne-fg-primary">Subagents</div>
                  <p className="mt-1 text-[12px] text-xyne-fg-secondary leading-relaxed">
                    {subagentMode === "spaces"
                      ? "Spaces default — subagents run on the Spaces platform model (cheaper/faster), even when this agent is on a premium provider."
                      : "Follow parent — subagents run on the same provider as this agent."}
                    {" "}A per-subagent override, when set, always wins.
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Which provider subagents run on"
                  className="flex shrink-0 rounded-full border border-xyne-border bg-xyne-surface p-0.5"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={subagentMode === "spaces"}
                    onClick={() => setSubagentMode("spaces")}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      subagentMode === "spaces"
                        ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                        : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                    }`}
                  >
                    Spaces default
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={subagentMode === "parent"}
                    onClick={() => setSubagentMode("parent")}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      subagentMode === "parent"
                        ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                        : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                    }`}
                  >
                    Follow parent
                  </button>
                </div>
              </div>

              {/* Cost warning — only when moving off the cheaper Spaces default. */}
              {subagentMode === "parent" && (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-md border border-xyne-warning-border bg-xyne-warning-bg px-2.5 py-1.5 text-[11.5px] leading-relaxed text-xyne-warning-fg">
                  <WarningCircleIcon size={14} weight="fill" className="mt-px shrink-0" />
                  <span>
                    Subagents will run on this agent&apos;s provider. On paid / premium plans
                    this consumes noticeably more tokens and credits than the Spaces default.
                  </span>
                </p>
              )}
            </div>

            {/* Automation/scheduled model — headless bulk runs (automations, error
                pipeline, scheduled jobs) fire on every PR / message / cron tick and
                can dominate premium-provider usage. This downgrades ONLY those runs
                to the platform default model; chat and mentions are unaffected. */}
            <div className="mb-4 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-xyne-fg-primary">Automations &amp; scheduled runs</div>
                  <p className="mt-1 text-[12px] text-xyne-fg-secondary leading-relaxed">
                    {automationMode === "default"
                      ? "Same as chat — automation, scheduled, and error-pipeline runs use this agent's full provider order."
                      : automationMode === "platform"
                        ? "Platform default — automation, scheduled, and error-pipeline runs use the platform model; chat and mentions keep the premium provider."
                        : `${PROVIDER_DISPLAY[automationMode] ?? automationMode} — automation, scheduled, and error-pipeline runs go to this provider only; chat and mentions keep the premium provider.`}
                  </p>
                </div>
                <select
                  aria-label="Which provider automation and scheduled runs use"
                  value={automationMode}
                  onChange={(e) => setAutomationMode(e.target.value)}
                  className="shrink-0 rounded-full border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[11px] font-medium text-xyne-fg-primary"
                >
                  <option value="default">Same as chat</option>
                  <option value="platform">Platform default</option>
                  {/* Only providers this agent actually has selected — routing
                      automations at a provider with no credentials would fail every
                      headless run, and the failure is silent (falls through). */}
                  {providerOrder.map((key) => (
                    <option key={key} value={key}>
                      {PROVIDER_DISPLAY[key] ?? key}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <ProviderOrderEditor order={providerOrder} onChange={setProviderOrder} idPrefix="standard" />
          </>
        ) : (
          <>
            {/* Fast mode — the agent's DEFAULT speed. The composer toggle in
                chat overrides it per conversation. Runtime: Anthropic
                `speed: "fast"` on Claude Opus 5 / 4.8; other providers simply
                run on whichever fast-mode providers are picked below. */}
            <div
              data-id="provider-fast-mode-row"
              data-enabled={fastMode ? "1" : "0"}
              className={`mb-4 rounded-lg border p-3 transition-colors ${
                fastMode
                  ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
                  : "border-xyne-border bg-xyne-surface-subtle"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-xyne-fg-primary">
                  <LightningIcon size={14} weight={fastMode ? "fill" : "bold"} className={fastMode ? "text-amber-500" : "text-xyne-fg-muted"} />
                  Turn on fast mode by default
                </div>
                <Switch checked={fastMode} onChange={setFastMode} ariaLabel="Turn on fast mode by default" />
              </div>
            </div>

            {/* Which providers serve fast-mode runs. Inherit (default) = the
                standard setup; custom = its own order + optional model pins. */}
            <div className="mb-4 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-medium text-xyne-fg-primary">Providers in fast mode</div>
                <div
                  role="radiogroup"
                  aria-label="Which providers fast mode runs on"
                  className="flex shrink-0 rounded-full border border-xyne-border bg-xyne-surface p-0.5"
                >
                  {(["inherit", "custom"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      data-id={`fast-profile-${m}`}
                      aria-checked={fastProfileMode === m}
                      onClick={() => {
                        setFastProfileMode(m);
                        // Seed a fresh custom order from the standard one so the
                        // user edits a copy instead of starting from nothing.
                        if (m === "custom" && fastOrder.length === 0) setFastOrder([...providerOrder]);
                      }}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                        fastProfileMode === m
                          ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                          : "text-xyne-fg-secondary hover:text-xyne-fg-primary"
                      }`}
                    >
                      {m === "inherit" ? "Same as standard" : "Custom"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {fastProfileMode === "inherit" ? (
              <ProviderOrderEditor order={providerOrder} onChange={() => {}} readOnly idPrefix="fast-inherit" />
            ) : (
              <ProviderOrderEditor order={fastOrder} onChange={setFastOrder} idPrefix="fast" />
            )}
          </>
        )}

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
              {providerView === "fast"
                ? "Shared with standard mode by default — override any setting below for fast mode only."
                : "API keys for the providers above. Stored encrypted; the platform never returns plaintext."}
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

        {/* Spaces is always present — the credential-less platform default
            and terminal fallback. Pinned above the credential rows; the
            pencil expands the full model-settings editor (model, temperature,
            thinking, max tokens, JSON output). */}
        <ul className="space-y-2.5">
          <SpacesDefaultRowV3 key={providerView} agent={agent} view={providerView} />
        </ul>

        {loading ? (
          <div className="mt-2.5 rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-5 text-center text-[12px] text-xyne-fg-tertiary">
            Loading credentials…
          </div>
        ) : creds.length === 0 && !adding ? (
          <div className="mt-2.5 rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle px-4 py-5 text-center text-[12px] text-xyne-fg-tertiary">
            No agent-level credentials yet. Users will fall through to their personal provider or the Spaces default above.
          </div>
        ) : (
          <ul className="mt-2.5 space-y-2.5">
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
                    {c.sharedCredentialId && (
                      <span
                        title="This agent uses an org-level shared credential — one login session shared by every bound agent. Re-authenticating it on any bound agent fixes all of them at once."
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-xyne-info-fg bg-xyne-info-bg border border-xyne-info-border rounded-full px-2 py-0.5"
                      >
                        <ShareNetworkIcon size={11} weight="bold" />
                        Shared{c.sharedCredentialName ? ` · ${c.sharedCredentialName}` : ""}
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
                    {c.reasoningEffort && (
                      <>
                        <span className="text-xyne-fg-tertiary">Reasoning</span>
                        <span className="text-xyne-fg-primary capitalize">{c.reasoningEffort}</span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-xyne-fg-tertiary">
                    Updated {formatRelativeTime(c.updatedAt)}
                    {c.createdByUserId ? ` · added by ${c.createdByUserId}` : ""}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {c.configured && (
                    <button
                      type="button"
                      onClick={() => openShare(c)}
                      title={
                        c.sharedCredentialId
                          ? "Bind more agents to this shared credential"
                          : `Share this ${PROVIDER_DISPLAY[c.provider] ?? c.provider} credential with other agents (one login for all of them)`
                      }
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors"
                      aria-label="Share credential with agents"
                    >
                      <ShareNetworkIcon size={14} weight="bold" />
                    </button>
                  )}
                  {/* Edit opens the same form prefilled — apiKey stays blank,
                      which setAgentProviderCredential treats as "keep the
                      stored key", so model/baseUrl/authType are editable
                      without re-pasting the secret. */}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setForm({
                        provider: c.provider as "copilot" | "claude" | "codex" | "openrouter",
                        apiKey: "",
                        model: c.model ?? "",
                        baseUrl: c.baseUrl ?? "",
                        authType: (c.authType as "api_key" | "oauth_token" | undefined) ?? "api_key",
                        reasoningEffort: c.reasoningEffort ?? "",
                      });
                      setAdding(true);
                    }}
                    title={`Edit ${PROVIDER_DISPLAY[c.provider] ?? c.provider} credential`}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors"
                    aria-label="Edit credential"
                  >
                    <PencilSimpleIcon size={14} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(c.provider)}
                    title={`Remove ${PROVIDER_DISPLAY[c.provider] ?? c.provider} credentials`}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xyne-fg-tertiary hover:bg-xyne-error-bg hover:text-xyne-error-fg transition-colors"
                    aria-label="Remove credential"
                  >
                    <XIcon size={14} weight="bold" />
                  </button>
                </div>
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
                  {(["codex", "claude", "copilot", "openrouter", "litellm"] as const).map((key) => (
                    <MenuItem
                      key={key}
                      selected={form.provider === key}
                      onSelect={() =>
                        setForm((p) => ({
                          ...p,
                          provider: key,
                          // Claude supports Anthropic API keys only (OAuth sign-in removed).
                          authType: key === "claude" ? "api_key" : p.authType,
                        }))
                      }
                      trailing={form.provider === key ? <CheckIcon size={12} weight="bold" /> : undefined}
                    >
                      {PROVIDER_DISPLAY[key]}
                    </MenuItem>
                  ))}
                </Menu>
              </div>
              {/* Only GitHub Copilot keeps an OAuth auth-type — Claude + Codex
                  OAuth were removed (subscription tokens must not be stored on
                  a third-party server), so those are API-key-only. */}
              {form.provider === "copilot" && (
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
                  {(["api_key", "oauth_token"] as const)
                    .map((key) => (
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
              )}

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
                    {creds.some((c) => c.provider === form.provider && c.configured)
                      ? "A key is already stored for this provider — leave blank to keep it and update only the fields below."
                      : "Encrypted the moment you save. Never returned by the API after upload."}
                  </p>
                </div>
              {(() => {
                // Model dropdown sourced from /v1/models — for codex, claude,
                // and litellm (each scoped to that credential's key). Free-text
                // only when the list is unavailable.
                const modelOptions =
                  form.provider === "codex" ? codexModels :
                  form.provider === "claude" ? claudeModels :
                  form.provider === "litellm" ? litellmModels : null;
                const modelOptionsErr =
                  form.provider === "codex" ? codexModelsErr :
                  form.provider === "claude" ? claudeModelsErr :
                  form.provider === "litellm" ? litellmModelsErr : null;
                const providerLabel = PROVIDER_DISPLAY[form.provider] ?? form.provider;
                return (
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                  Model
                  <span className="ml-1 text-[12px] font-normal text-xyne-fg-tertiary">
                    {modelOptions && modelOptions.length > 0 ? "" : "(optional)"}
                  </span>
                </label>
                {modelOptions && modelOptions.length > 0 ? (
                  <Menu
                    align="start"
                    trigger={(triggerProps) => (
                      <button
                        {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong"
                      >
                        <span>{form.model ? (modelOptions.find((m) => m.id === form.model)?.name ?? form.model) : "Use default"}</span>
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
                    {modelOptions.map((m) => (
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
                {modelOptionsErr && (
                  <p className="text-[12px] text-xyne-warning-fg">
                    Couldn't load {providerLabel} models — free-text is fine.
                    <span className="block text-[11px] text-xyne-fg-muted mt-0.5 break-words">{modelOptionsErr}</span>
                  </p>
                )}
              </div>
                );
              })()}
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
                  placeholder={form.provider === "litellm" ? "blank = platform LiteLLM proxy" : "https://openrouter.ai/api/v1"}
                  className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)]"
                />
              </div>
              {/* Reasoning effort is a premium-provider knob (gpt-5.x/o-series/
                  Claude thinking) — not meaningful for the generic LiteLLM proxy,
                  so it's hidden for litellm. */}
              {form.provider !== "litellm" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-xyne-fg-secondary">
                  Reasoning effort
                  <span className="ml-1 text-[12px] font-normal text-xyne-fg-tertiary">
                    (optional)
                  </span>
                </label>
                <Menu
                  align="start"
                  trigger={(triggerProps) => (
                    <button
                      {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong"
                    >
                      <span>{form.reasoningEffort ? form.reasoningEffort[0]!.toUpperCase() + form.reasoningEffort.slice(1) : "Default (medium)"}</span>
                      <CaretDownIcon size={12} className="text-xyne-fg-tertiary" />
                    </button>
                  )}
                >
                  {([["", "Default (medium)"], ["low", "Low — fastest"], ["medium", "Medium"], ["high", "High — slowest, deepest"]] as const).map(([value, label]) => (
                    <MenuItem
                      key={value || "default"}
                      selected={form.reasoningEffort === value}
                      onSelect={() => setForm((p) => ({ ...p, reasoningEffort: value }))}
                      trailing={form.reasoningEffort === value ? <CheckIcon size={12} weight="bold" /> : undefined}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </Menu>
                <p className="text-[12px] text-xyne-fg-tertiary">
                  How much the model thinks per step. Applies to reasoning models (gpt-5.x, o-series; thinking level for Claude). High adds 5–15s per tool call — it compounds fast in long sessions.
                </p>
              </div>
              )}
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
        open={shareProvider !== null}
        onOpenChange={(open) => { if (!open) setShareProvider(null); }}
        title={`Share ${shareProvider ? (PROVIDER_DISPLAY[shareProvider] ?? shareProvider) : ""} credential with agents`}
        description="Selected agents use this same login. One re-connect fixes all of them; separate logins of the same account would keep invalidating each other."
        maxWidth={520}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-xyne-fg-secondary">
            Shared credential name
            <input
              type="text"
              value={shareName}
              onChange={(e) => setShareName(e.target.value)}
              className="rounded-md border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[13px] text-xyne-fg-primary"
              placeholder="Team Codex"
            />
          </label>
          <div className="text-[12px] text-xyne-fg-secondary">Agents to bind</div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-xyne-border divide-y divide-xyne-border">
            {shareAgents === null ? (
              <div className="px-3 py-4 text-center text-[12px] text-xyne-fg-tertiary">Loading agents…</div>
            ) : shareAgents.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-xyne-fg-tertiary">No other agents available.</div>
            ) : (
              shareAgents.map((a) => (
                <label key={a.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-xyne-surface-sunken">
                  <input
                    type="checkbox"
                    checked={shareSelected.has(a.id)}
                    onChange={(e) => {
                      setShareSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-xyne-fg-primary truncate">{a.name}</span>
                    <span className="block text-[11px] text-xyne-fg-tertiary truncate">{a.slug}</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="text-[11px] text-xyne-fg-tertiary">
            You can bind agents you own (admins can bind any). Binding replaces the agent's own {shareProvider ? (PROVIDER_DISPLAY[shareProvider] ?? shareProvider) : ""} credential.
          </div>
          {shareErr && <div className="text-[12px] text-xyne-error-fg">{shareErr}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShareProvider(null)} disabled={shareBusy}>
              Cancel
            </Button>
            <Button onClick={() => void submitShare()} disabled={shareBusy || shareSelected.size === 0}>
              {shareBusy ? "Sharing…" : `Share with ${shareSelected.size} agent(s)`}
            </Button>
          </div>
        </div>
      </Dialog>

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

