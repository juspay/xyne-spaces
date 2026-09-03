import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  CaretRightIcon,
  ArrowsClockwiseIcon,
  PlugsConnectedIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import type { McpServer, UserConnection, HealthResult, CredentialField } from "../../lib/types";
import {
  AGENT_CATEGORIES,
  groupMcpsByCategory,
  type AgentCategoryId,
} from "../lib/agentCategory";
import {
  createConnection,
  createServer,
  deleteServer,
  getCredentialFields,
  connectGoogle,
  connectMicrosoft,
  connectOAuth,
  requestServerPublish,
} from "../../lib/api";
import { useMcpConnectors } from "../hooks/useMcpConnectors";
import { useSnackbar } from "./ui/Snackbar";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { MCPDetailSidebar } from "./MCPDetailSidebar";
import { AddConnectionDialog } from "./dialogs/AddConnectionDialog";

// ── Helper components ─────────────────────────────────────────────────

/**
 * Bordered icon tile. Prefers the logo.dev PNG, falls back to a legacy SVG,
 * then to initials — so connectors without a fetched logo still render.
 */
function McpIconBox({ type, name }: { type: string; name: string }) {
  const candidates = [
    `/claw/assets/mcp/${type}.png`,
    `/claw/assets/mcp/${type}.svg`,
  ];
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];

  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          className="size-full object-contain"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <Avatar name={name} size={36} shape="square" />
      )}
    </div>
  );
}

/** Small colored status dot mirroring a connection's health check. */
function ConnectionHealthDot({
  health,
}: {
  health: HealthResult | "checking" | null | undefined;
}) {
  if (health === "checking") {
    return (
      <ArrowsClockwiseIcon size={12} className="animate-spin text-xyne-fg-tertiary" />
    );
  }
  if (health) {
    const label = health.healthy
      ? health.latencyMs
        ? `Healthy · ${health.latencyMs}ms`
        : "Healthy"
      : "Unhealthy";
    return (
      <span
        title={label}
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${
          health.healthy ? "bg-xyne-success-fg" : "bg-xyne-error-fg"
        }`}
      />
    );
  }
  return (
    <span
      title="Not checked"
      className="h-[7px] w-[7px] shrink-0 rounded-full bg-xyne-border-strong"
    />
  );
}

/**
 * Marketplace-style connector card. Mirrors the shadcn `Item` structure
 * (media / content / actions slots): a rounded, muted, clickable surface
 * with a bordered icon tile, a title + one-line description, and a trailing
 * chevron. `actions` renders inside the actions slot, before the chevron.
 */
function McpItemCard({
  server,
  onClick,
  disabled = false,
  actions,
  dataId = "connector-row",
}: {
  server: McpServer;
  onClick?: () => void;
  disabled?: boolean;
  actions?: ReactNode;
  dataId?: string;
}) {
  const hasDescription = !!server.description;

  return (
    <div
      data-slot="item"
      data-id={dataId}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
      }
      className={[
        "group/item flex w-full flex-wrap items-center gap-3.5 rounded-2xl border border-transparent",
        "bg-xyne-surface-sunken/60 px-4 py-3.5 text-sm outline-none transition-colors duration-100",
        disabled
          ? "cursor-default opacity-60"
          : "cursor-pointer hover:bg-xyne-surface-sunken focus-visible:border-xyne-border-focus focus-visible:ring-[3px] focus-visible:ring-xyne-border-focus/15",
      ].join(" ")}
    >
      <div
        data-slot="item-media"
        className={`flex shrink-0 items-center justify-center gap-2 ${
          hasDescription ? "translate-y-0.5 self-start" : ""
        }`}
      >
        <McpIconBox type={server.type} name={server.name} />
      </div>

      <div data-slot="item-content" className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          data-slot="item-title"
          className="line-clamp-1 flex w-fit items-center gap-2 text-sm font-medium leading-snug text-xyne-fg-primary"
        >
          {server.name}
          {server.oauth && (
            <span className="shrink-0 rounded bg-xyne-surface px-1.5 py-0.5 text-[10px] font-semibold text-xyne-fg-tertiary shadow-sm">
              OAuth
            </span>
          )}
        </div>
        {hasDescription && (
          <p
            data-slot="item-description"
            className="line-clamp-1 text-left text-sm font-normal text-xyne-fg-tertiary"
          >
            {server.description}
          </p>
        )}
      </div>

      <div data-slot="item-actions" className="flex items-center gap-2">
        {actions}
        <CaretRightIcon size={16} className="shrink-0 text-xyne-fg-tertiary" />
      </div>
    </div>
  );
}

// ── ConnectedMcpRow ───────────────────────────────────────────────────

interface ConnectedMcpRowProps {
  server: McpServer;
  connection: UserConnection;
  healthMap: Record<string, HealthResult | "checking" | null>;
  onSelect: (server: McpServer, connection: UserConnection) => void;
  onDisconnect: (connection: UserConnection) => void;
}

function ConnectedMcpRow({
  server,
  connection,
  healthMap,
  onSelect,
  onDisconnect,
}: ConnectedMcpRowProps) {
  const health = healthMap[connection.id];

  return (
    <McpItemCard
      server={server}
      onClick={() => onSelect(server, connection)}
      actions={
        <>
          <ConnectionHealthDot health={health} />
          <button
            data-id="connector-disconnect-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDisconnect(connection);
            }}
            className="shrink-0 rounded-full border border-xyne-border px-[10px] py-[4px] text-[12px] text-xyne-fg-secondary transition-colors hover:border-xyne-border-strong hover:text-xyne-fg-primary"
          >
            Disconnect
          </button>
        </>
      }
    />
  );
}

// ── AvailableMcpRow ───────────────────────────────────────────────────

interface AvailableMcpRowProps {
  server: McpServer;
  onSelect: (server: McpServer) => void;
}

function AvailableMcpRow({ server, onSelect }: AvailableMcpRowProps) {
  const isDisabled = server.enabled === false;

  return (
    <McpItemCard
      server={server}
      disabled={isDisabled}
      onClick={() => onSelect(server)}
      actions={
        isDisabled ? (
          <span className="px-[2px] text-[11px] text-xyne-fg-tertiary">Disabled</span>
        ) : undefined
      }
    />
  );
}

// ── Search helper ─────────────────────────────────────────────────────

function serverMatchesSearch(server: McpServer, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return (
    server.name.toLowerCase().includes(q) ||
    (server.description ?? "").toLowerCase().includes(q)
  );
}

// ── MCPPageV3 ─────────────────────────────────────────────────────────

/** One row in the left category filter rail. */
function CategoryRailItem({
  label,
  count,
  active,
  onClick,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 px-[10px] py-[6px] text-left text-[14px] transition-colors ${
        active
          ? "font-semibold text-xyne-fg-primary"
          : "text-xyne-fg-tertiary hover:text-xyne-fg-primary"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-xyne-fg-tertiary/60">
        {count}
      </span>
    </button>
  );
}

interface Props {
  userId: string;
}

export function MCPPageV3({ userId }: Props) {
  const {
    connections,
    servers,
    loading,
    connectingId,
    healthMap,
    healthCheckedAt,
    reload,
    connect,
    disconnect,
    checkHealth,
  } = useMcpConnectors(userId);

  // Deduplicate servers
  const dedupedServers = useMemo(
    () => servers.filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i),
    [servers]
  );

  // Dialog / selection state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editServerId, setEditServerId] = useState<string | undefined>(undefined);
  const [editDefinitionServerId, setEditDefinitionServerId] = useState<string | undefined>(undefined);
  const [connectServerId, setConnectServerId] = useState<string | undefined>(undefined);
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<UserConnection | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<UserConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
  const [credentialFields, setCredentialFields] = useState<Record<string, CredentialField[]>>({});

  // Search with debounce
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(inputValue), 150);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Category filter — same URL-param shape as the agents page.
  // `rawCategoryId` is what the URL claims; `activeCategoryId` is what we
  // actually honor (only set when that bucket has matches in the current
  // search context). Prevents stuck empty states on scope/search changes.
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get("category");
  const rawCategoryId: AgentCategoryId | null = AGENT_CATEGORIES.some(
    (c) => c.id === categoryParam,
  )
    ? (categoryParam as AgentCategoryId)
    : null;

  const handleCategoryFilter = useCallback(
    (catId: AgentCategoryId | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!catId) next.delete("category");
          else next.set("category", catId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const { show: showSnackbar } = useSnackbar();

  useEffect(() => {
    getCredentialFields().then(setCredentialFields).catch(() => {});
  }, []);

  // Build maps
  const connectedServerIds = useMemo(
    () => new Set(connections.map((c) => c.mcpServerId)),
    [connections]
  );

  const getConnection = useCallback(
    (serverId: string) => connections.find((c) => c.mcpServerId === serverId),
    [connections]
  );

  // Search-filtered base set (pre-category-filter). All chip counts +
  // visibility derive from this so the chip strip reflects "what's relevant
  // in the current search context", not "all MCPs ever".
  const searchFilteredServers = useMemo(
    () => dedupedServers.filter((s) => serverMatchesSearch(s, searchQuery)),
    [dedupedServers, searchQuery],
  );

  // Category bucketing (over the search-filtered set, BEFORE the category
  // filter is applied). Used for chip counts AND per-row chip rendering.
  const groupedByCategory = useMemo(
    () => groupMcpsByCategory(searchFilteredServers),
    [searchFilteredServers],
  );

  const serverIdToCategory = useMemo(() => {
    const map = new Map<string, AgentCategoryId>();
    for (const [catId, items] of groupedByCategory) {
      for (const s of items) map.set(s.id, catId);
    }
    return map;
  }, [groupedByCategory]);

  // Effective category — null if the URL's choice has no matches right now.
  const activeCategoryId: AgentCategoryId | null =
    rawCategoryId &&
    (groupedByCategory.get(rawCategoryId)?.length ?? 0) > 0
      ? rawCategoryId
      : null;

  // Clean stale URL state so refresh/share matches what's actually showing.
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

  // Categories with at least one matching MCP — drives the chip strip.
  const visibleCategories = useMemo(
    () =>
      AGENT_CATEGORIES.filter(
        (cat) => (groupedByCategory.get(cat.id)?.length ?? 0) > 0,
      ),
    [groupedByCategory],
  );

  // Filtered sections — apply both connection state AND category filter.
  const connectedServers = useMemo(
    () =>
      searchFilteredServers.filter(
        (s) =>
          connectedServerIds.has(s.id) &&
          (!activeCategoryId ||
            serverIdToCategory.get(s.id) === activeCategoryId),
      ),
    [searchFilteredServers, connectedServerIds, activeCategoryId, serverIdToCategory],
  );

  const availableServers = useMemo(
    () =>
      searchFilteredServers.filter(
        (s) =>
          !connectedServerIds.has(s.id) &&
          (!activeCategoryId ||
            serverIdToCategory.get(s.id) === activeCategoryId),
      ),
    [searchFilteredServers, connectedServerIds, activeCategoryId, serverIdToCategory],
  );

  // Handlers
  const handleAddConnection = useCallback(
    async (mcpServerId: string, credentials: Record<string, string>) => {
      const server = dedupedServers.find((s) => s.id === mcpServerId);
      if (server?.type === "google") {
        setShowAddDialog(false);
        window.location.href = await connectGoogle(userId);
        return;
      }
      if (server?.type === "microsoft") {
        setShowAddDialog(false);
        window.location.href = await connectMicrosoft(userId);
        return;
      }
      if (server?.oauth) {
        // Generic OAuth connector (attio, honeycomb, …): redirect to consent
        // instead of creating a credential-less (Unhealthy) connection.
        setShowAddDialog(false);
        window.location.href = await connectOAuth(userId, server.type);
        return;
      }
      try {
        await createConnection(userId, { mcpServerId, credentials });
        setShowAddDialog(false);
        reload();
        showSnackbar({ variant: "success", title: `${server?.name ?? "Connector"} connected` });
      } catch (err) {
        showSnackbar({ variant: "error", title: "Connection failed", description: err instanceof Error ? err.message : undefined });
      }
    },
    [dedupedServers, userId, reload, showSnackbar]
  );

  const handleCreateServer = useCallback(
    async (payload: Parameters<typeof createServer>[0]) => {
      const result = await createServer(payload, userId);
      // Shared (scope=global) connector: the edit was queued for admin approval,
      // the live definition is unchanged. Tell the user explicitly instead of
      // letting the form silently revert to the old content.
      if (result.kind === "editRequest") {
        showSnackbar({
          variant: "success",
          title: "Sent to admin for approval",
          description:
            result.message ||
            "This is a shared connector, so your changes were submitted for admin review.",
        });
        reload();
        return result;
      }
      const created = result.server;
      // Make a newly-created connector's form immediately available to the
      // reconnect dialog instead of waiting for the page-level credential map
      // (which is fetched only on mount).
      setCredentialFields((current) => ({
        ...current,
        [created.type]: created.credentialForm?.fields ?? payload.credentialForm?.fields ?? [],
      }));
      reload();
      return result;
    },
    [userId, reload, showSnackbar]
  );

  const handleRequestPublish = useCallback(
    async (server: McpServer) => {
      try {
        await requestServerPublish(server.id, userId);
        showSnackbar({
          variant: "success",
          title: "Publish request submitted",
          description: `${server.name} is now pending admin review.`,
        });
        reload();
      } catch (err) {
        showSnackbar({
          variant: "error",
          title: "Publish request failed",
          description:
            err instanceof Error ? err.message : "Please try again later.",
        });
      }
    },
    [userId, reload, showSnackbar],
  );

  const handleDisconnectRequest = useCallback((conn: UserConnection) => {
    setPendingDisconnect(conn);
  }, []);

  // Connectors that need credentials but aren't OAuth (e.g. Amplitude) must
  // collect their credential fields via the AddConnectionDialog first. The raw
  // connect() would post empty credentials, which the backend rejects — and the
  // sidebar swallows the error, so the button appears to "do nothing".
  const requiresCredentials = useCallback((s: McpServer) => {
    if (s.oauth) return false;
    if (s.type === "google" || s.type === "microsoft" || s.type === "xyne-spaces") return false;
    const hasFormFields = (s.credentialForm?.fields?.length ?? 0) > 0;
    const hasSchema = !!s.credentialSchema && Object.keys(s.credentialSchema).length > 0;
    return hasFormFields || hasSchema;
  }, []);

  const handleConnect = useCallback(async (server: McpServer) => {
    if (requiresCredentials(server)) {
      setConnectServerId(server.id);
      setShowAddDialog(true);
      return;
    }
    try {
      await connect(server);
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Connection failed",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [requiresCredentials, connect, showSnackbar]);

  // OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clean = () => window.history.replaceState({}, "", window.location.pathname);

    if (params.get("google_connected") === "true") {
      showSnackbar({ variant: "success", title: "Google connected successfully!" });
      reload();
      clean();
    }
    if (params.get("google_error")) {
      showSnackbar({ variant: "error", title: "Google connection failed", description: params.get("google_error") ?? undefined });
      clean();
    }
    if (params.get("microsoft_connected") === "true") {
      showSnackbar({ variant: "success", title: "Microsoft connected successfully!" });
      reload();
      clean();
    }
    if (params.get("microsoft_error")) {
      showSnackbar({ variant: "error", title: "Microsoft connection failed", description: params.get("microsoft_error") ?? undefined });
      clean();
    }
  }, [reload, showSnackbar]);

  const connectedCount = connectedServers.length;
  const availableCount = availableServers.length;

  // Skeleton rows
  const skeletonRows = (
    <div className="flex flex-col gap-[6px]">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-[12px] px-[14px] py-[10px]">
          <Skeleton className="h-[32px] w-[32px] rounded-md" />
          <Skeleton className="h-[16px] w-[180px]" />
          <div className="ml-auto">
            <Skeleton className="h-[24px] w-[80px] rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Main list panel: [filter rail] [header + grid] */}
      <div className="flex flex-1 overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
        {/* Left filter rail — category filters, moved off the top bar */}
        <aside
          data-id="mcp-filter-rail"
          className="flex w-[210px] shrink-0 flex-col gap-[1px] overflow-y-auto bg-xyne-surface px-[16px] py-[20px]"
        >
          <CategoryRailItem
            label="All"
            count={searchFilteredServers.length}
            active={!activeCategoryId}
            onClick={() => handleCategoryFilter(null)}
          />
          {visibleCategories.map((cat) => (
            <CategoryRailItem
              key={cat.id}
              label={cat.shortLabel}
              title={cat.description}
              count={groupedByCategory.get(cat.id)?.length ?? 0}
              active={activeCategoryId === cat.id}
              onClick={() =>
                handleCategoryFilter(activeCategoryId === cat.id ? null : cat.id)
              }
            />
          ))}

          {/* Connected count — kept in the fixed-width rail so it never
              crowds the header at narrow widths */}
          <div className="mt-[16px] flex items-center gap-[8px] px-[10px] text-[13px] text-xyne-fg-tertiary">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-xyne-success-fg" />
            {loading ? "…" : `${connectedServerIds.size} connected`}
          </div>
        </aside>

        {/* Main column — header + scrollable grid */}
        <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header — title + search + create, aligned to the cards container */}
        <div className="flex-shrink-0 bg-xyne-surface py-[20px]">
          <div className="mx-auto flex w-full max-w-[1024px] items-center gap-4 px-[20px]">
            <h1 className="min-w-0 text-[30px] font-bold leading-none tracking-tight text-xyne-fg-primary">
              MCPs
            </h1>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex w-[320px] items-center gap-2 rounded-full border border-xyne-border bg-xyne-surface-sunken px-[16px] py-[10px] transition-colors focus-within:border-xyne-border-strong">
                <MagnifyingGlassIcon size={16} className="shrink-0 text-xyne-fg-tertiary" />
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Search marketplace"
                  className="w-full min-w-0 border-0 bg-transparent text-[14px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none focus:ring-0"
                />
              </div>
              <button
                onClick={() => setShowAddDialog(true)}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-[20px] py-[10px] text-[14px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <PlusIcon size={16} weight="bold" />
                Create MCP
              </button>
            </div>
          </div>
        </div>

        {/* C) Main content */}
        <div data-id="mcp-page-body" className="flex-1 overflow-y-auto py-[16px]">
          <div className="max-w-[1024px] mx-auto w-full px-[20px]">
          {loading ? (
            skeletonRows
          ) : (
            <div className="flex flex-col gap-[20px]">
              {/* Connected section */}
              {connectedServers.length > 0 && (
                <section data-id="mcp-connected-section">
                  <div className="flex items-center gap-[8px] mb-[8px]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">
                      Connected
                    </span>
                    <Badge as="span" label={String(connectedServers.length)} variant="success" size="sm" />
                  </div>
                  <div className="grid grid-cols-1 gap-[10px] md:grid-cols-2">
                    {connectedServers.map((server) => {
                      const conn = getConnection(server.id)!;
                      return (
                        <ConnectedMcpRow
                          key={server.id}
                          server={server}
                          connection={conn}
                          healthMap={healthMap}
                          onSelect={(s, c) => {
                            setSelectedServer(s);
                            setSelectedConnection(c);
                          }}
                          onDisconnect={handleDisconnectRequest}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Available section */}
              {availableServers.length > 0 && (
                <section data-id="mcp-available-section">
                  <div className="flex items-center gap-[8px] mb-[8px]">
                    <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">
                      Available
                    </span>
                    <Badge as="span" label={String(availableServers.length)} variant="neutral" size="sm" />
                  </div>
                  <div className="grid grid-cols-1 gap-[10px] md:grid-cols-2">
                    {availableServers.map((server) => (
                      <AvailableMcpRow
                        key={server.id}
                        server={server}
                        onSelect={(s) => {
                          setSelectedServer(s);
                          setSelectedConnection(null);
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Empty state: no search */}
              {connectedCount === 0 && availableCount === 0 && !searchQuery && (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                  <PlugsConnectedIcon size={40} weight="thin" className="text-xyne-fg-muted" />
                  <p className="text-[14px] font-medium text-xyne-fg-secondary">
                    No integrations registered yet
                  </p>
                  <p className="text-[13px] text-xyne-fg-tertiary text-center max-w-[320px]">
                    Add your first MCP to give agents access to external tools
                  </p>
                  <Button variant="primary" size="sm" onClick={() => setShowAddDialog(true)}>
                    <PlusIcon size={14} />
                    Add MCP
                  </Button>
                </div>
              )}

              {/* Empty state: search no results */}
              {connectedCount === 0 && availableCount === 0 && searchQuery && (
                <div className="flex flex-col items-center justify-center gap-2 py-20">
                  <p className="text-[14px] text-xyne-fg-secondary">
                    No integrations match &ldquo;{searchQuery}&rdquo;
                  </p>
                  <button
                    onClick={() => {
                      setInputValue("");
                      setSearchQuery("");
                    }}
                    className="text-[13px] text-xyne-brand hover:underline"
                  >
                    Clear search
                  </button>
                </div>
              )}

              {/* All connected message */}
              {connectedServers.length > 0 && availableServers.length === 0 && !searchQuery && (
                <p className="text-[12px] text-xyne-fg-tertiary text-center py-4">
                  All available integrations are connected.
                </p>
              )}
            </div>
          )}
          </div>
        </div>
        </div>
      </div>

      {/* Detail sidebar */}
      <div
        data-id="mcp-sidebar-wrapper"
        className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-in ${selectedServer ? "w-[560px]" : "w-0"}`}
      >
        {selectedServer && (
          // Tinted tray — same pattern as the agent slide-over. The white
          // floating panel (SidePanel `floating`) sits on this gray strip so
          // the slide-over reads as a lifted card instead of bleeding into
          // the MCP list to its left.
          <div className="h-full w-[560px] overflow-hidden bg-xyne-surface-sunken border-l border-xyne-border-subtle">
            <MCPDetailSidebar
              open={selectedServer !== null}
              server={selectedServer}
              connection={selectedConnection}
              loading={connectingId === selectedServer.id}
              healthMap={healthMap}
              healthCheckedAt={healthCheckedAt}
              userId={userId}
              onConnect={handleConnect}
              onDisconnect={disconnect}
              onCheckHealth={checkHealth}
              onEdit={() => {
                const conn = getConnection(selectedServer.id);
                if (conn) {
                  setEditServerId(selectedServer.id);
                  setShowAddDialog(true);
                }
              }}
              onEditDefinition={() => {
                setEditDefinitionServerId(selectedServer.id);
                setShowAddDialog(true);
              }}
              onDeleteRequest={setDeleteTarget}
              onPublishRequest={handleRequestPublish}
              onClose={() => {
                setSelectedServer(null);
                setSelectedConnection(null);
              }}
            />
          </div>
        )}
      </div>

      {/* Add Connection Dialog */}
      <AddConnectionDialog
        open={showAddDialog}
        onOpenChange={(v) => {
          setShowAddDialog(v);
          if (!v) {
            setEditServerId(undefined);
            setEditDefinitionServerId(undefined);
            setConnectServerId(undefined);
          }
        }}
        onSubmit={handleAddConnection}
        onCreateServer={handleCreateServer}
        servers={dedupedServers}
        credentialFields={credentialFields}
        connectedServerIds={connectedServerIds}
        editServerId={editServerId}
        editDefinitionServerId={editDefinitionServerId}
        connectServerId={connectServerId}
      />

      {/* Disconnect ConfirmDialog */}
      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => { if (!open) setPendingDisconnect(null); }}
        title={pendingDisconnect ? `Disconnect ${pendingDisconnect.mcpServer.name}?` : ""}
        description="This will remove the connector and revoke its access tokens. Agents using this connector will no longer be able to call its tools."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (pendingDisconnect) {
            disconnect(pendingDisconnect)
              .then(() => {
                showSnackbar({ variant: "success", title: `${pendingDisconnect.mcpServer.name} disconnected` });
                setPendingDisconnect(null);
              })
              .catch((err: unknown) => {
                showSnackbar({ variant: "error", title: "Disconnect failed", description: err instanceof Error ? err.message : undefined });
              });
          }
        }}
      />

      {/* Delete ConfirmDialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete MCP server"
        description={`Are you sure you want to delete "${deleteTarget?.name ?? ""}"? This cannot be undone and will disconnect all users from this MCP.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteServer(deleteTarget.id);
            setDeleteTarget(null);
            setSelectedServer(null);
            setSelectedConnection(null);
            reload();
            showSnackbar({ variant: "success", title: `${deleteTarget.name} deleted` });
          } catch (err) {
            showSnackbar({ variant: "error", title: "Delete failed", description: err instanceof Error ? err.message : undefined });
          }
        }}
      />
    </>
  );
}
