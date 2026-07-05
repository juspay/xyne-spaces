import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  CaretRightIcon,
  ArrowsClockwiseIcon,
  PlugsConnectedIcon,
} from "@phosphor-icons/react";
import type { McpServer, UserConnection, HealthResult, CredentialField } from "../../lib/types";
import {
  AGENT_CATEGORIES,
  groupMcpsByCategory,
  type AgentCategoryId,
} from "../lib/agentCategory";
import { CategoryChip } from "./ui/CategoryChip";
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
import { PageListHeader } from "./ui/PageListHeader";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { MCPDetailSidebar } from "./MCPDetailSidebar";
import { AddConnectionDialog } from "./dialogs/AddConnectionDialog";

// ── Helper components ─────────────────────────────────────────────────

function TransportBadge({ transport }: { transport?: string }) {
  if (transport === "stdio") {
    return (
      <span className="text-[10px] font-medium px-[6px] py-[1px] rounded-full bg-xyne-warning-bg text-xyne-warning-fg border border-xyne-warning-border">
        stdio
      </span>
    );
  }
  if (transport === "http") {
    return (
      <span className="text-[10px] font-medium px-[6px] py-[1px] rounded-full bg-xyne-success-bg text-xyne-success-fg border border-xyne-success-border">
        http
      </span>
    );
  }
  return null;
}

function ScopeBadge({ connectorMeta }: { connectorMeta?: Record<string, unknown> | null }) {
  const scope = connectorMeta?.scope as string | undefined;
  if (scope === "global") {
    return <Badge as="span" label="global" variant="info" size="sm" />;
  }
  if (scope === "personal") {
    return <Badge as="span" label="personal" variant="neutral" size="sm" />;
  }
  return null;
}

function McpServerIcon({ type, name }: { type: string; name: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <Avatar
        name={name}
        size={32}
        shape="square"
      />
    );
  }

  return (
    <img
      src={`/claw/assets/mcp/${type}.svg`}
      alt={type}
      className="w-[32px] h-[32px]"
      onError={() => setError(true)}
    />
  );
}

// ── ConnectedMcpRow ───────────────────────────────────────────────────

interface ConnectedMcpRowProps {
  server: McpServer;
  connection: UserConnection;
  category: AgentCategoryId;
  healthMap: Record<string, HealthResult | "checking" | null>;
  onSelect: (server: McpServer, connection: UserConnection) => void;
  onDisconnect: (connection: UserConnection) => void;
}

function ConnectedMcpRow({
  server,
  connection,
  category,
  healthMap,
  onSelect,
  onDisconnect,
}: ConnectedMcpRowProps) {
  const health = healthMap[connection.id];

  return (
    <div
      data-id="connector-row"
      onClick={() => onSelect(server, connection)}
      className={`flex items-center gap-[12px] px-[14px] py-[10px] bg-xyne-surface border border-xyne-border rounded-xl cursor-pointer transition-[border-color] mb-[6px] ${
        health && health !== "checking" && health.healthy
          ? "hover:border-xyne-success/30"
          : health && health !== "checking" && !health.healthy
            ? "hover:border-xyne-error/30"
            : "hover:border-xyne-border-strong"
      }`}
    >
      {/* Icon */}
      <div className="flex shrink-0 w-[60px] items-center justify-center">
        <McpServerIcon type={server.type} name={server.name} />
      </div>

      {/* Name + badges */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[8px] min-w-0">
          <div className="truncate text-[14px] font-medium text-xyne-fg-primary">
            {server.name}
          </div>
          <div className="flex gap-[6px] flex-shrink-0">
            <TransportBadge transport={server.transport} />
            <ScopeBadge connectorMeta={server.connectorMeta} />
            <CategoryChip
              categoryId={category}
              dataIdPrefix="connected-mcp-row-category"
            />
          </div>
        </div>
      </div>

      {/* Health status */}
      <div className="flex shrink-0 items-center">
        {health === "checking" && (
          <span className="text-[11px] text-xyne-fg-tertiary flex items-center gap-[4px]">
            <ArrowsClockwiseIcon size={12} className="animate-spin" />
            Checking...
          </span>
        )}
        {health && health !== "checking" && health.healthy && (
          <span className="text-[11px] text-xyne-success-fg flex items-center gap-[4px]">
            <span className="w-[6px] h-[6px] rounded-full bg-xyne-success-fg" />
            {health.latencyMs ? `${health.latencyMs}ms` : "Healthy"}
          </span>
        )}
        {health && health !== "checking" && !health.healthy && (
          <span className="text-[11px] text-xyne-error-fg flex items-center gap-[4px]">
            <span className="w-[6px] h-[6px] rounded-full bg-xyne-error-fg" />
            Unhealthy
          </span>
        )}
        {(health === null || health === undefined) && (
          <span className="text-[11px] text-xyne-fg-tertiary">- not checked</span>
        )}
      </div>

      {/* Disconnect */}
      <button
        data-id="connector-disconnect-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDisconnect(connection);
        }}
        className="shrink-0 text-[12px] text-xyne-fg-secondary hover:text-xyne-fg-primary px-[8px] py-[4px] rounded-full border border-xyne-border hover:border-xyne-border-strong transition-colors"
      >
        Disconnect
      </button>

      {/* Caret */}
      <CaretRightIcon size={14} className="shrink-0 text-xyne-fg-tertiary" />
    </div>
  );
}

// ── AvailableMcpRow ───────────────────────────────────────────────────

interface AvailableMcpRowProps {
  server: McpServer;
  category: AgentCategoryId;
  connecting: boolean;
  onSelect: (server: McpServer) => void;
  onConnect: (server: McpServer) => void;
}

function AvailableMcpRow({
  server,
  category,
  connecting,
  onSelect,
  onConnect,
}: AvailableMcpRowProps) {
  const isDisabled = server.enabled === false;

  return (
    <div
      data-id="connector-row"
      onClick={isDisabled ? undefined : () => onSelect(server)}
      className={[
        "flex items-center gap-[12px] px-[14px] py-[10px] bg-xyne-surface border border-xyne-border rounded-xl mb-[6px]",
        isDisabled
          ? "opacity-60"
          : "cursor-pointer transition-[border-color] hover:border-xyne-border-strong",
      ].join(" ")}
    >
      {/* Icon */}
      <div className="flex shrink-0 w-[60px] items-center justify-center">
        <McpServerIcon type={server.type} name={server.name} />
      </div>

      {/* Name + badges + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[8px] min-w-0">
          <div className="truncate text-[14px] font-medium text-xyne-fg-primary">
            {server.name}
          </div>
          <div className="flex gap-[6px] flex-shrink-0">
            <TransportBadge transport={server.transport} />
            <ScopeBadge connectorMeta={server.connectorMeta} />
            <CategoryChip
              categoryId={category}
              dataIdPrefix="available-mcp-row-category"
            />
          </div>
        </div>
        {server.description && (
          <p className="text-[11px] text-xyne-fg-secondary truncate mt-[2px]">
            {server.description}
          </p>
        )}
      </div>

      {/* Connect / Disabled */}
      <div className="flex shrink-0 items-center gap-[8px]">
        {isDisabled ? (
          <span className="text-[11px] text-xyne-fg-tertiary px-[8px]">
            Disabled
          </span>
        ) : (
          <>
            <Button
              data-id="connector-connect-btn"
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onConnect(server);
              }}
              disabled={connecting}
            >
              {connecting ? "Connecting..." : "Connect"}
            </Button>
            <CaretRightIcon size={14} className="text-xyne-fg-tertiary" />
          </>
        )}
      </div>
    </div>
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
      const created = await createServer(payload, userId);
      reload();
      return created;
    },
    [userId, reload]
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

  const handleConnect = useCallback(
    (server: McpServer) => {
      const isOAuth = server.type === "google" || server.type === "microsoft" || server.oauth === true;
      const isAutoConnect = server.type === "xyne-spaces";
      const hasCredentialFields =
        (credentialFields[server.type]?.length ?? 0) > 0 ||
        (server.credentialForm?.fields?.length ?? 0) > 0;

      if (isOAuth || isAutoConnect || !hasCredentialFields) {
        connect(server)
          .then(() => {
            if (!isOAuth) showSnackbar({ variant: "success", title: `${server.name} connected` });
          })
          .catch((err: unknown) => {
            showSnackbar({
              variant: "error",
              title: `Failed to connect ${server.name}`,
              description: err instanceof Error ? err.message : undefined,
            });
          });
      } else {
        setConnectServerId(server.id);
        setEditServerId(undefined);
        setEditDefinitionServerId(undefined);
        setShowAddDialog(true);
      }
    },
    [connect, credentialFields, showSnackbar]
  );

  const handleDisconnectRequest = useCallback((conn: UserConnection) => {
    setPendingDisconnect(conn);
  }, []);

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
      {/* Main list panel */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
        <PageListHeader
          title="MCPs"
          subtitle="Connect external apps (Slack, GitHub, BigQuery…) so your agents can read from them and act on them."
          icon={<PlugsConnectedIcon size={18} />}
          stats={[
            { value: loading ? undefined : dedupedServers.length, label: "Total" },
            { value: loading ? undefined : connectedCount, label: "Connected", highlight: "success" as const },
            { value: loading ? undefined : availableCount, label: "Available" },
          ]}
          createLabel="Add MCP"
          onCreateClick={() => setShowAddDialog(true)}
          searchValue={inputValue}
          onSearchChange={setInputValue}
          searchPlaceholder="Search integrations…"
          trailingFilters={
            visibleCategories.length > 1 ? (
              <>
                {/* "All" chip — explicit reset, styled like a primary tab so
                    it reads as the default state when nothing is filtered. */}
                <button
                  type="button"
                  data-id="mcp-category-chip-all"
                  title="Show all integrations"
                  onClick={() => handleCategoryFilter(null)}
                  className={`inline-flex items-center gap-[5px] px-[10px] py-[5px] rounded-[20px] text-[12px] cursor-pointer border transition-colors font-medium font-sans whitespace-nowrap ${
                    !activeCategoryId
                      ? "bg-xyne-fg-primary text-xyne-fg-inverse border-xyne-fg-primary"
                      : "bg-transparent text-xyne-fg-secondary border-xyne-border hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  }`}
                >
                  <span>All</span>
                  <span
                    className={`text-[11px] tabular-nums ${
                      !activeCategoryId ? "opacity-70" : "opacity-60"
                    }`}
                  >
                    {searchFilteredServers.length}
                  </span>
                </button>
                {visibleCategories.map((cat) => {
                  const count =
                    groupedByCategory.get(cat.id)?.length ?? 0;
                  const isActive = activeCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      data-id={`mcp-category-chip-${cat.id}`}
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
                  <div className="flex flex-col">
                    {connectedServers.map((server) => {
                      const conn = getConnection(server.id)!;
                      return (
                        <ConnectedMcpRow
                          key={server.id}
                          server={server}
                          connection={conn}
                          category={serverIdToCategory.get(server.id) ?? "other"}
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
                  <div className="flex flex-col">
                    {availableServers.map((server) => (
                      <AvailableMcpRow
                        key={server.id}
                        server={server}
                        category={serverIdToCategory.get(server.id) ?? "other"}
                        connecting={connectingId === server.id}
                        onSelect={(s) => {
                          setSelectedServer(s);
                          setSelectedConnection(null);
                        }}
                        onConnect={handleConnect}
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
              onConnect={connect}
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
