import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  RobotIcon,
  MagnifyingGlassIcon,
  CaretRightIcon,
  CpuIcon,
} from "@phosphor-icons/react";
import type { AgentLight } from "../../lib/types";
import { useSnackbar } from "./ui/Snackbar";
import { PageListHeader } from "./ui/PageListHeader";
import { PageLayout } from "./ui/PageLayout";
import { useAgents } from "../hooks/useAgents";
import {
  updateAgent,
  getUserDashboard,
  getUserAgentConfig,
  setUserAgentConfig,
  listProviderCredentials,
  type ProviderCredential,
} from "../../lib/api";
import {
  AGENT_CATEGORIES,
  groupAgentsByCategory,
  type AgentCategoryId,
} from "../lib/agentCategory";
import { CategoryChip } from "./ui/CategoryChip";
import { Switch } from "./ui/Switch";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { CreateAgentModal } from "./dialogs/CreateAgentModal";
import { AgentSlideOver } from "./AgentSlideOver";
import { formatTimeAgo } from "./home/homeUtils";

const SCOPE_TAB_LABELS = ["All", "My Agents", "Global"] as const;
type ScopeTabLabel = (typeof SCOPE_TAB_LABELS)[number];

function labelToScope(label: ScopeTabLabel): string {
  switch (label) {
    case "My Agents":
      return "mine";
    case "Global":
      return "global";
    default:
      return "all";
  }
}

function scopeToLabel(scope: string): ScopeTabLabel {
  switch (scope) {
    case "mine":
      return "My Agents";
    case "global":
      return "Global";
    default:
      return "All";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function ownerLabel(agent: AgentLight): string {
  // Prefer the real owner (matches the slide-over's Owner row). Only fall
  // back to "Spaces App" / "Xyne" when the agent genuinely has no owner.
  if (agent.owner?.name) return agent.owner.name;
  if (agent.owner?.email) return agent.owner.email;
  if (agent.spacesAppId != null) return "Spaces App";
  return "Xyne";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  if (!query.trim()) return <span className={className}>{text}</span>;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={i}
            className="rounded-sm bg-xyne-brand/15 px-0.5 text-inherit"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

type ScopeBadgeResult =
  | { type: "brand"; label: string }
  | { type: "badge"; label: string; variant: "info" | "neutral" };

function getScopeBadgeProps(agent: AgentLight, userId: string): ScopeBadgeResult {
  const userShare = agent.shares?.find((s) => s.userId === userId);
  if (userShare) {
    return { type: "brand", label: userShare.role };
  }
  if (agent.scope === "global") {
    return { type: "badge", label: "global", variant: "info" };
  }
  return { type: "badge", label: "personal", variant: "neutral" };
}

// ── ProviderPopup ──────────────────────────────────────────────────────

const PROVIDERS = [
  { id: "spaces",  label: "Spaces (Default)",  description: "Shared LLM gateway",                                         needsCreds: false },
  { id: "copilot", label: "GitHub Copilot",     description: "Use your GitHub Copilot subscription",                       needsCreds: true },
  { id: "claude",  label: "Anthropic Claude",   description: "Use your Anthropic API key",          needsCreds: true },
  { id: "codex",   label: "OpenAI (Codex)",     description: "Use your OpenAI Platform API key",                           needsCreds: true },
];

function ProviderPopup({
  agentSlug,
  userId,
  onClose,
}: {
  agentSlug: string;
  userId: string;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<string>("spaces");
  const [creds, setCreds] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      getUserAgentConfig(agentSlug, userId),
      listProviderCredentials(userId),
    ]).then(([cfg, c]) => {
      setCurrent((cfg as { provider?: string })?.provider ?? "spaces");
      setCreds(c);
      setError(null);
    }).catch(() => {
      setError("Failed to load config");
    }).finally(() => setLoading(false));
  }, [agentSlug, userId]);

  const credMap = new Map(creds.map((c) => [c.provider, c]));

  const handleSelect = async (provider: string) => {
    if (provider === current || saving !== null) return;
    setSaving(provider);
    setError(null);
    try {
      await setUserAgentConfig(agentSlug, userId, { provider });
      setCurrent(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[16px] border border-xyne-border bg-xyne-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-[16px] font-semibold text-xyne-fg-primary">Configure Provider</h3>
        <p className="mb-4 text-[12px] text-xyne-fg-tertiary">
          Pick which provider this agent should use. Credentials are managed in the Settings tab.
        </p>

        {loading ? (
          <p className="text-[13px] text-xyne-fg-tertiary">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {PROVIDERS.map((p) => {
              const hasCreds = !p.needsCreds || credMap.get(p.id)?.hasApiKey;
              const active = current === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => void handleSelect(p.id)}
                  disabled={saving !== null || (p.needsCreds && !hasCreds)}
                  className={`flex w-full items-start justify-between rounded-[10px] border p-3 text-left transition-colors disabled:opacity-50 ${
                    active
                      ? "border-xyne-brand bg-xyne-brand/10"
                      : "border-xyne-border bg-xyne-surface-subtle hover:border-xyne-border-strong hover:bg-xyne-surface-sunken"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-[6px]">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-xyne-brand" : "bg-xyne-fg-muted"}`} />
                      <span className="text-[13px] font-medium text-xyne-fg-primary">{p.label}</span>
                      {active && <span className="rounded-full bg-xyne-brand/15 px-[8px] py-[1px] text-[11px] font-medium text-xyne-brand">Current</span>}
                      {p.needsCreds && (hasCreds
                        ? <span className="rounded-full bg-xyne-success-bg px-[8px] py-[1px] text-[11px] font-medium text-xyne-success-fg">Configured</span>
                        : <span className="rounded-full bg-xyne-warning-bg px-[8px] py-[1px] text-[11px] font-medium text-xyne-warning-fg">Not configured</span>
                      )}
                    </div>
                    <p className="mt-[4px] pl-[14px] text-[11px] text-xyne-fg-tertiary">{p.description}</p>
                    {p.needsCreds && !hasCreds && (
                      <p className="mt-[2px] pl-[14px] text-[11px] text-xyne-warning-fg">Set this up in the Settings tab first.</p>
                    )}
                  </div>
                  {saving === p.id && <span className="shrink-0 text-[12px] text-xyne-fg-tertiary">Saving…</span>}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-xyne-error-fg">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-[8px] px-4 py-2 text-[13px] text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AgentRow ───────────────────────────────────────────────────────────

interface AgentRowProps {
  agent: AgentLight;
  userId: string;
  category: AgentCategoryId;
  searchQuery: string;
  lastUsed: string | null;
  onClick: () => void;
  onToggle: (enabled: boolean) => Promise<boolean>;
  onProvider: () => void;
}

function AgentRow({
  agent,
  userId,
  category,
  searchQuery,
  lastUsed,
  onClick,
  onToggle,
  onProvider,
}: AgentRowProps) {
  const [descTooltipVisible, setDescTooltipVisible] = useState(false);
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [localEnabled, setLocalEnabled] = useState(agent.enabled);
  const [togglePending, setTogglePending] = useState(false);

  useEffect(() => {
    if (!togglePending) {
      setLocalEnabled(agent.enabled);
    }
  }, [agent.enabled, togglePending]);

  const showDescTooltip = () => {
    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    descTimerRef.current = setTimeout(() => setDescTooltipVisible(true), 400);
  };
  const hideDescTooltip = () => {
    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    setDescTooltipVisible(false);
  };

  const label = ownerLabel(agent);
  const statusDotCls = localEnabled
    ? "bg-xyne-success"
    : "bg-xyne-warning";
  const dimmed = !localEnabled ? "opacity-60" : "";
  const scopeBadge = getScopeBadgeProps(agent, userId);
  const isOwner = agent.ownerUserId === userId;

  const handleToggle = async (v: boolean) => {
    if (togglePending) return;
    const prev = localEnabled;
    setLocalEnabled(v);
    setTogglePending(true);
    const ok = await onToggle(v);
    setTogglePending(false);
    if (!ok) {
      setLocalEnabled(prev);
    }
  };

  return (
    <div
      data-id="agent-row"
      onClick={onClick}
      className={[
        "flex min-w-0 w-full cursor-pointer items-center rounded-xl border bg-xyne-surface text-[14px]",
        "transition-[background-color,border-color,box-shadow] duration-[var(--comp-duration-normal)]",
        localEnabled
          ? "border-xyne-border hover:border-xyne-success/30 hover:bg-xyne-surface-subtle hover:shadow-[0_1px_6px_0_rgba(0,0,0,0.07)]"
          : "border-xyne-border hover:border-xyne-error/30",
      ].join(" ")}
    >
      {/* Logo */}
      <div
        data-id="agent-row-cell-logo"
        className={`flex w-[60px] shrink-0 items-center justify-center py-3.5 ${dimmed}`}
      >
        <Avatar
          name={agent.name}
          color={agent.color}
          size={32}
          shape="circle"
        />
      </div>

      {/* Name + status dot */}
      <div
        data-id="agent-row-cell-name"
        className={`flex w-[180px] shrink-0 items-center gap-2 px-2 py-3.5 ${dimmed}`}
      >
        <span
          data-id="agent-row-status-dot"
          className={`h-2 w-2 shrink-0 rounded-full ${statusDotCls}`}
          title={localEnabled ? "Enabled" : "Paused"}
        />
        <HighlightedText
          text={agent.name}
          query={searchQuery}
          className="w-full truncate text-[14px] font-semibold text-xyne-fg-primary"
        />
      </div>

      {/* Description + tooltip */}
      <div
        data-id="agent-row-cell-description"
        className={`relative flex min-w-0 flex-1 items-center px-3 py-3.5 ${dimmed}`}
        onMouseEnter={showDescTooltip}
        onMouseLeave={hideDescTooltip}
      >
        {!agent.description || agent.description.trim() === "" ? (
          <span className="w-full truncate text-[13px] text-xyne-fg-muted italic">
            No description added
          </span>
        ) : (
          <HighlightedText
            text={agent.description}
            query={searchQuery}
            className="w-full truncate text-[13px] text-xyne-fg-tertiary"
          />
        )}
        {descTooltipVisible && agent.description && (
          <div
            data-id="agent-row-desc-tooltip"
            className="absolute bottom-full left-0 z-50 mb-2 max-w-[320px] rounded-lg bg-xyne-fg-primary px-3 py-2 text-[12px] leading-relaxed text-xyne-fg-inverse shadow-lg"
          >
            {agent.description}
          </div>
        )}
      </div>

      {/* Scope + Category chips */}
      <div
        data-id="agent-row-cell-tags"
        className={`flex w-[200px] shrink-0 items-center gap-1.5 px-3 py-3.5 ${dimmed}`}
      >
        {scopeBadge.type === "brand" ? (
          <span className="text-[11px] font-medium px-[8px] py-[1px] rounded-full bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20">
            {scopeBadge.label}
          </span>
        ) : (
          <Badge
            as="span"
            label={scopeBadge.label}
            variant={scopeBadge.variant}
            size="sm"
          />
        )}
        <CategoryChip categoryId={category} dataIdPrefix="agent-row-category" />
      </div>

      {/* Owner */}
      <div
        data-id="agent-row-cell-owner"
        className={`flex w-[130px] shrink-0 items-center gap-2 px-3 py-3.5 ${dimmed}`}
      >
        <Avatar name={label} size={18} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-xyne-fg-secondary">
          {label}
        </span>
      </div>


      {/* Provider button — V1 parity */}
      {isOwner && (
        <div
          data-id="agent-row-cell-provider"
          className="flex shrink-0 items-center px-2 py-3.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onProvider}
            className="group flex h-[28px] w-[28px] items-center justify-center gap-0 rounded-full border border-xyne-brand/40 bg-xyne-brand/8 text-[11px] font-semibold text-xyne-brand hover:bg-xyne-brand/15 hover:border-xyne-brand/60 hover:w-auto hover:gap-[5px] hover:px-[10px] transition-all duration-150 overflow-hidden"
          >
            <CpuIcon size={13} className="shrink-0" />
            <span className="max-w-0 group-hover:max-w-[56px] overflow-hidden transition-all duration-150 whitespace-nowrap">
              Provider
            </span>
          </button>
        </div>
      )}

      {/* Toggle (owner-only) / Status (non-owners) */}
      <div
        data-id="agent-row-cell-toggle"
        className="flex w-[72px] shrink-0 flex-col items-center gap-1 px-4 py-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        {isOwner ? (
          <>
            <Switch
              checked={localEnabled}
              onChange={(v) => {
                void handleToggle(v);
              }}
              disabled={togglePending}
            />
            <span className="text-[10px] font-medium text-xyne-fg-secondary">
              {localEnabled ? "Enabled" : "Paused"}
            </span>
          </>
        ) : (
          <span
            data-id="agent-row-status-readonly"
            title={
              localEnabled
                ? "Active — only the owner can pause this agent"
                : "Paused — only the owner can resume this agent"
            }
            className={`text-[10px] font-medium ${
              localEnabled ? "text-xyne-success" : "text-xyne-warning-fg"
            }`}
          >
            {localEnabled ? "Active" : "Paused"}
          </span>
        )}
      </div>

      {/* Chevron */}
      <div
        data-id="agent-row-cell-chevron"
        className={`flex w-[28px] shrink-0 items-center justify-center py-3.5 ${dimmed}`}
      >
        <CaretRightIcon
          size={14}
          className="text-xyne-fg-tertiary shrink-0"
        />
      </div>
    </div>
  );
}

// ── AgentsPageV3 ──────────────────────────────────────────────────────

interface AgentsPageV3Props {
  userId: string;
  /**
   * When true, the AgentSlideOver shows inline admin actions
   * (Promote / Demote / Delete) on agents the user doesn't own.
   */
  isAdmin?: boolean;
}

export function AgentsPageV3({ userId, isAdmin = false }: AgentsPageV3Props) {
  const { agents, loading, reload } = useAgents(userId);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { show: showSnackbar } = useSnackbar();

  const searchQuery = searchParams.get("q") ?? "";
  const [inputValue, setInputValue] = useState(searchQuery);

  const scopeParam = searchParams.get("scope") ?? "all";
  const validScope =
    scopeParam === "mine" || scopeParam === "global" ? scopeParam : "all";
  const activeTabLabel = scopeToLabel(validScope);

  // Raw category from URL — validated against the registry but not yet
  // checked for "does this bucket actually have anything in the current
  // scope/search context". The *effective* `activeCategoryId` further down
  // requires non-zero count, so changing scope into an empty bucket falls
  // through to "no filter" rather than leaving the user stranded.
  const categoryParam = searchParams.get("category");
  const rawCategoryId: AgentCategoryId | null = AGENT_CATEGORIES.some(
    (c) => c.id === categoryParam,
  )
    ? (categoryParam as AgentCategoryId)
    : null;

  const [createOpen, setCreateOpen] = useState(false);
  const [providerSlug, setProviderSlug] = useState<string | null>(null);
  /**
   * Hold the slug — not the Agent object — so the slide-over always renders
   * against the freshest entry in the `agents` list (e.g. after the user
   * toggles Enabled/Paused and `reload` repopulates the list).
   */
  const [slideOverSlug, setSlideOverSlug] = useState<string | null>(null);
  const slideOverAgent = slideOverSlug
    ? agents.find((a) => a.slug === slideOverSlug) ?? null
    : null;

  // Last-used data from dashboard
  const [agentLastUsed, setAgentLastUsed] = useState<
    Record<string, string | null>
  >({});
  const [dashboardLoading, setDashboardLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    getUserDashboard(userId, 30)
      .then((data) => {
        const map: Record<string, string | null> = {};
        data.agentTable.forEach((row) => {
          map[row.agentSlug] = row.lastRunAt ?? null;
        });
        setAgentLastUsed(map);
      })
      .catch(() => {
        // Fail silently — last used is non-critical
      })
      .finally(() => setDashboardLoading(false));
  }, [userId]);

  const getLastUsed = (slug: string): string | null =>
    agentLastUsed[slug] ?? null;

  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (inputValue) next.set("q", inputValue);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, setSearchParams]);

  const handleScopeChange = (label: ScopeTabLabel) => {
    const scope = labelToScope(label);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (scope === "all") next.delete("scope");
        else next.set("scope", scope);
        return next;
      },
      { replace: true },
    );
  };

  const handleCategoryFilter = (catId: AgentCategoryId | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!catId) next.delete("category");
        else next.set("category", catId);
        return next;
      },
      { replace: true },
    );
  };

  const handleAgentToggle = async (
    slug: string,
    name: string,
    enabled: boolean,
  ): Promise<boolean> => {
    try {
      await updateAgent(slug, { enabled });
      showSnackbar({
        variant: "success",
        title: `${name} ${enabled ? "enabled" : "paused"}`,
      });
      reload();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      const is403 = msg.includes("403") || msg.toLowerCase().includes("forbidden");
      showSnackbar({
        variant: "error",
        title: is403
          ? "You don't have permission to modify this agent"
          : `Failed to update ${name}`,
      });
      return false;
    }
  };

  const filteredAgents = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return agents.filter((a) => {
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (validScope === "mine") return a.ownerUserId === userId;
      if (validScope === "global") return a.scope === "global";
      return true;
    });
  }, [agents, searchQuery, validScope, userId]);

  const groupedByCategory = useMemo(
    () => groupAgentsByCategory(filteredAgents),
    [filteredAgents],
  );

  // Effective category filter — null if the raw one has zero matches in the
  // current scope/search context. Prevents the user from landing on a
  // "Comms 0" empty state after switching scope.
  const activeCategoryId: AgentCategoryId | null =
    rawCategoryId &&
    (groupedByCategory.get(rawCategoryId)?.length ?? 0) > 0
      ? rawCategoryId
      : null;

  // If the URL still claims a category that's no longer applicable
  // (count fell to zero), clean the URL so back/share state is honest.
  useEffect(() => {
    if (rawCategoryId && !activeCategoryId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("category");
          return next;
        },
        { replace: true },
      );
    }
  }, [rawCategoryId, activeCategoryId, setSearchParams]);

  // Categories that actually have at least one agent in the current
  // scope/search context. Empty buckets just disappear from the chip strip
  // so it stays scannable; their count would only ever be 0.
  const visibleCategories = useMemo(
    () =>
      AGENT_CATEGORIES.filter(
        (cat) => (groupedByCategory.get(cat.id)?.length ?? 0) > 0,
      ),
    [groupedByCategory],
  );

  const slugToCategory = useMemo(() => {
    const map = new Map<string, AgentCategoryId>();
    for (const [catId, items] of groupedByCategory) {
      for (const a of items) map.set(a.slug, catId);
    }
    return map;
  }, [groupedByCategory]);

  // Final list shown in the body — respects search, scope, AND the optional
  // category chip filter. Used to derive the ownership groups below.
  const displayedAgents = useMemo(
    () =>
      activeCategoryId
        ? filteredAgents.filter(
            (a) => (slugToCategory.get(a.slug) ?? "other") === activeCategoryId,
          )
        : filteredAgents,
    [filteredAgents, activeCategoryId, slugToCategory],
  );

  const { myAgents, otherAgents } = useMemo(() => {
    const mine: AgentLight[] = [];
    const other: AgentLight[] = [];
    for (const a of displayedAgents) {
      if (a.ownerUserId === userId) mine.push(a);
      else other.push(a);
    }
    return { myAgents: mine, otherAgents: other };
  }, [displayedAgents, userId]);

  const renderAgents = (items: AgentLight[]) => (
    <div data-id="agents-row-list" className="flex flex-col gap-2">
      {items.map((agent) => (
        <AgentRow
          key={agent.slug}
          agent={agent}
          userId={userId}
          category={slugToCategory.get(agent.slug) ?? "other"}
          searchQuery={searchQuery}
          lastUsed={getLastUsed(agent.slug)}
          onClick={() => navigate(`/v3/agents/${agent.slug}`)}
          onToggle={(enabled) =>
            handleAgentToggle(agent.slug, agent.name, enabled)
          }
          onProvider={() => setProviderSlug(agent.slug)}
        />
      ))}
    </div>
  );

  return (
    <>
      {providerSlug && (
        <ProviderPopup
          agentSlug={providerSlug}
          userId={userId}
          onClose={() => setProviderSlug(null)}
        />
      )}
      <div className="flex h-full w-full overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden">
          <PageLayout
        header={
          <PageListHeader
            title="Agents"
            subtitle="AI assistants you build for specific tasks. Pick one to use, or create your own."
            icon={<RobotIcon size={18} />}
            stats={[
              { value: loading ? undefined : agents.length, label: "Total" },
              { value: loading ? undefined : agents.filter((a) => a.enabled).length, label: "Active", highlight: "success" as const },
              { value: loading ? undefined : agents.filter((a) => a.ownerUserId === userId).length, label: "Personal" },
              { value: loading ? undefined : agents.filter((a) => a.ownerUserId !== userId).length, label: "Global" },
            ]}
            createLabel="New agent"
            onCreateClick={() => setCreateOpen(true)}
            searchValue={inputValue}
            onSearchChange={setInputValue}
            searchPlaceholder="Search agents…"
            centerSearch
            tabs={[
              { key: "all", label: "All" },
              { key: "mine", label: "My agents" },
              { key: "global", label: "Global" },
            ]}
            activeTab={validScope}
            onTabChange={(key) => handleScopeChange(scopeToLabel(key))}
            trailingFilters={
              visibleCategories.length > 0 ? (
                <>
                  {visibleCategories.map((cat) => {
                    const count =
                      groupedByCategory.get(cat.id)?.length ?? 0;
                    const isActive = activeCategoryId === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        data-id={`agents-category-chip-${cat.id}`}
                        title={cat.description}
                        onClick={() =>
                          handleCategoryFilter(isActive ? null : cat.id)
                        }
                        className={`inline-flex items-center gap-[5px] px-[10px] py-[5px] rounded-[20px] text-[12px] cursor-pointer border transition-colors font-medium font-sans whitespace-nowrap ${
                          isActive
                            ? `${cat.chipClass} shadow-sm`
                            : "bg-transparent text-xyne-fg-secondary border-xyne-border hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                        }`}
                      >
                        <span>{cat.shortLabel}</span>
                        <span
                          className={`text-[11px] tabular-nums ${
                            isActive ? "opacity-70" : "opacity-60"
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : undefined
            }
            loading={loading}
          />
        }
        body={
          <div data-id="agents-page-body" className="flex flex-col gap-6 max-w-[1024px] mx-auto w-full px-[20px]">
            {loading ? (
              <div
                data-id="agents-loading"
                className="flex items-center justify-center py-16 text-sm text-xyne-fg-tertiary"
              >
                Loading…
              </div>
            ) : (
              <>
                {validScope === "all"
                  ? [
                      { key: "mine", label: "My agents", items: myAgents },
                      { key: "other", label: "Other", items: otherAgents },
                    ]
                      .filter((g) => g.items.length > 0)
                      .map((g, idx) => (
                        <section
                          key={g.key}
                          data-id={`agents-group-${g.key}`}
                        >
                          <div
                            className={`flex items-baseline gap-2 mb-2.5 ${
                              idx === 0 ? "mt-1" : "mt-4"
                            }`}
                          >
                            <span className="text-[13px] font-medium text-xyne-fg-primary">
                              {g.label}
                            </span>
                            <span className="text-[12px] text-xyne-fg-tertiary">
                              · {g.items.length}
                            </span>
                          </div>
                          {renderAgents(g.items)}
                        </section>
                      ))
                  : displayedAgents.length > 0 && (
                      <section data-id="agents-group-flat" className="mt-1">
                        {renderAgents(displayedAgents)}
                      </section>
                    )}
                {displayedAgents.length === 0 && (
                  <div
                    data-id="agents-empty"
                    className="flex flex-col items-center justify-center"
                  >
                    {searchQuery ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-12">
                        <MagnifyingGlassIcon
                          size={32}
                          weight="thin"
                          className="text-xyne-fg-muted"
                        />
                        <p className="text-[13px] text-xyne-fg-secondary">
                          No agents match &ldquo;{searchQuery}&rdquo;
                        </p>
                        <button
                          data-id="agents-clear-search"
                          onClick={() => setInputValue("")}
                          className="text-[12px] text-xyne-brand hover:underline"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : validScope !== "all" ? (
                      <div className="flex flex-col items-center justify-center gap-1.5 py-10">
                        <p className="text-[13px] text-xyne-fg-secondary">
                          No{" "}
                          {validScope === "mine" ? "personal" : "global"}{" "}
                          agents yet
                        </p>
                        <button
                          onClick={() => handleScopeChange("All")}
                          className="text-[12px] text-xyne-brand hover:underline"
                        >
                          View all agents
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-16">
                        <RobotIcon
                          size={48}
                          weight="thin"
                          className="text-xyne-fg-muted"
                        />
                        <div className="text-center">
                          <p className="text-[14px] font-medium text-xyne-fg-primary mb-1">
                            No agents yet
                          </p>
                          <p className="text-[12px] text-xyne-fg-tertiary">
                            Create your first agent to get started
                          </p>
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          leadingIcon={<PlusIcon size={14} />}
                          onClick={() => setCreateOpen(true)}
                        >
                          Create agent
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        }
      />
        </div>
      {slideOverAgent && (
        // Tray: tinted column behind the floating panel. The slide-over's
        // 12px margins expose this surface around its edges, so the white
        // panel reads as a lifted card on a soft tray.
        <div className="bg-xyne-surface-sunken h-full flex-shrink-0 border-l border-xyne-border-subtle">
          <AgentSlideOver
            agent={slideOverAgent}
            lastUsed={getLastUsed(slideOverAgent.slug)}
            onClose={() => setSlideOverSlug(null)}
            onEdit={(slug) => {
              setSlideOverSlug(null);
              navigate(`/v3/agents/${slug}`);
            }}
            userId={userId}
            isAdmin={isAdmin}
            onAgentChanged={reload}
          />
        </div>
      )}
      </div>
      {createOpen && (
        <CreateAgentModal
          userId={userId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            reload();
          }}
        />
      )}
    </>
  );
}
