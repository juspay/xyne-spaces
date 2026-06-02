import { useState, useEffect, useRef } from "react";
import {
  PencilSimpleIcon,
  ArrowsClockwiseIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  PaperPlaneTiltIcon,
  PlugIcon,
  PlugsConnectedIcon,
  CodeIcon,
  LinkSimpleIcon,
  CalendarBlankIcon,
  WrenchIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import type { McpServer, UserConnection, HealthResult } from "../../lib/types";
import { SidePanel } from "./ui/SidePanel";
import { ServerIcon } from "./ui/ServerIcon";
import { Badge } from "./ui/Badge";

/* ─────────────────────────────────────────────────────────────────────
 * ExpandingAction — icon-only circle at rest, morphs into a labeled
 * pill on hover or keyboard focus. Same pattern as AgentSlideOver and
 * AgentDetailHeader; duplicated here intentionally (small, isolated).
 * ───────────────────────────────────────────────────────────────────── */

type MCPActionVariant = "primary" | "secondary" | "destructive" | "ghost";

interface MCPActionProps {
  icon: React.ReactNode;
  label: string;
  variant: MCPActionVariant;
  onClick: () => void;
  disabled?: boolean;
  /** When true, label stays expanded (e.g. for "Connecting…" busy state). */
  forceExpanded?: boolean;
  title?: string;
}

const ACTION_VARIANTS: Record<MCPActionVariant, string> = {
  primary:
    "bg-xyne-fg-primary text-xyne-fg-inverse hover:shadow-[0_4px_12px_-2px_rgba(16,24,40,0.18)]",
  secondary:
    "bg-xyne-surface border border-xyne-border text-xyne-fg-primary hover:border-xyne-border-strong hover:bg-xyne-surface-subtle/40",
  destructive:
    "bg-xyne-error text-white hover:shadow-[0_4px_12px_-2px_rgba(220,38,38,0.30)]",
  ghost:
    "bg-transparent border border-transparent text-xyne-fg-secondary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary",
};

function ExpandingAction({
  icon,
  label,
  variant,
  onClick,
  disabled = false,
  forceExpanded = false,
  title,
}: MCPActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={`group/act inline-flex items-center justify-end h-9 rounded-full transition-all duration-200 ease-out shadow-[0_1px_3px_-1px_rgba(16,24,40,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1 ${
        disabled
          ? "bg-xyne-surface-sunken border border-xyne-border-subtle text-xyne-fg-tertiary cursor-not-allowed shadow-none"
          : ACTION_VARIANTS[variant]
      }`}
    >
      <span
        className={`overflow-hidden whitespace-nowrap text-[12px] font-medium transition-[max-width,padding] duration-200 ease-out ${
          forceExpanded
            ? "max-w-[180px] pl-3.5 pr-1"
            : disabled
              ? "max-w-0"
              : "max-w-0 group-hover/act:max-w-[180px] group-focus-visible/act:max-w-[180px] group-hover/act:pl-3.5 group-hover/act:pr-1 group-focus-visible/act:pl-3.5 group-focus-visible/act:pr-1"
        }`}
      >
        {label}
      </span>
      <span className="w-9 h-9 flex items-center justify-center flex-shrink-0">
        {icon}
      </span>
    </button>
  );
}

const SERVER_AUTHOR_MAP: Record<string, string> = {
  github:         "GitHub",
  gitlab:         "GitLab",
  google:         "Google",
  gmail:          "Google",
  "google-drive": "Google",
  microsoft:      "Microsoft",
  slack:          "Slack",
  figma:          "Figma",
  notion:         "Notion",
  salesforce:     "Salesforce",
  stripe:         "Stripe",
  bitbucket:      "Atlassian",
  "xyne-spaces":  "Xyne",
};

interface MCPDetailSidebarProps {
  open: boolean;
  server: McpServer;
  connection: UserConnection | null;
  loading: boolean;
  healthMap: Record<string, HealthResult | "checking" | null>;
  healthCheckedAt?: Record<string, number>;
  userId: string;
  onConnect: (server: McpServer) => void;
  onDisconnect: (conn: UserConnection) => void;
  onCheckHealth: (conn: UserConnection, opts?: { force?: boolean }) => void;
  onEdit?: () => void;
  onEditDefinition?: () => void;
  onDeleteRequest: (server: McpServer) => void;
  /**
   * Triggers a publish request for a personal MCP (admin approval to go global).
   * The parent owns the API call + snackbar + reload — same pattern as the
   * other action props.
   */
  onPublishRequest?: (server: McpServer) => void | Promise<void>;
  onClose: () => void;
}

function formatRelativeCheckedAt(ts: number | undefined): string | null {
  if (!ts) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ─────────────────────────────────────────────────────────────────────
 * Section caption + MetaCard / MetaRow primitives — mirror the agent
 * slide-over (AgentSlideOver.tsx) so the two slide-overs share a visual
 * vocabulary: small uppercase captions for section titles, white cards
 * with divide-y between rows, icon + tertiary label + primary value.
 * ───────────────────────────────────────────────────────────────────── */

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-2">
      {children}
    </div>
  );
}

function MetaCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-xyne-surface border border-xyne-border-subtle rounded-xl overflow-hidden divide-y divide-xyne-border-subtle">
      {children}
    </div>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="flex items-center gap-2.5 text-[13px] text-xyne-fg-tertiary">
        <span className="w-[16px] h-[16px] flex items-center justify-center text-xyne-fg-tertiary">
          {icon}
        </span>
        {label}
      </span>
      <span className="text-[14px] text-xyne-fg-primary text-right min-w-0 truncate">
        {children}
      </span>
    </div>
  );
}

export function MCPDetailSidebar({
  open,
  server,
  connection,
  loading,
  healthMap,
  healthCheckedAt,
  userId,
  onConnect,
  onDisconnect,
  onCheckHealth,
  onEdit,
  onEditDefinition,
  onDeleteRequest,
  onPublishRequest,
  onClose,
}: MCPDetailSidebarProps) {
  const [publishPending, setPublishPending] = useState(false);
  const author = SERVER_AUTHOR_MAP[server.type] ?? server.name;
  const tools = server.writeToolPolicy?.tools ?? [];
  const credentialFields = server.credentialForm?.fields ?? [];
  const connected = !!connection;

  const health = connection ? healthMap[connection.id] : null;
  const isChecking = health === "checking";
  const healthResult = health && health !== "checking" ? health : null;

  // Connector provenance — `connectorMeta` is only populated for
  // user-submitted connectors that flow through the publish workflow
  // (personal → pending → approved/rejected). Built-in platform
  // integrations (Xyne Spaces, the Anthropic-blessed adapters, etc.)
  // skip that flow, so both `scope` and `publishStatus` are absent.
  // Treat that absence as a signal that this is a platform connector and
  // surface "built-in" instead of the literal "unknown" string.
  const rawScope = server.connectorMeta?.scope as string | undefined;
  const rawPublishStatus = server.connectorMeta?.publishStatus as string | undefined;
  const isPlatformConnector = !rawScope && !rawPublishStatus;
  const scope = rawScope ?? (isPlatformConnector ? "built-in" : "unknown");
  const publishStatus = rawPublishStatus ?? "unknown";
  const ownerUserId = server.connectorMeta?.ownerUserId as string | undefined;
  const isOwner = ownerUserId === userId;
  const publishReviewNote = server.connectorMeta?.publishReviewNote as
    | string
    | undefined;

  // Personal MCPs the current user owns can be submitted for admin approval
  // to go global. Hide once approved; show a pending badge while under review.
  const canShowPublish =
    isOwner && scope === "personal" && publishStatus !== "approved";
  const isPublishPending = canShowPublish && publishStatus === "pending";
  const isPublishRejected = canShowPublish && publishStatus === "rejected";

  const handlePublishClick = async () => {
    if (!onPublishRequest || publishPending) return;
    setPublishPending(true);
    try {
      await onPublishRequest(server);
    } finally {
      setPublishPending(false);
    }
  };

  const [copied, setCopied] = useState(false);

  // Auto health-check when sidebar opens. The hook owns freshness (TTL):
  // if a recent result is cached this becomes a no-op, so we don't re-ping
  // the server on every open. Pass `force: true` from the refresh button to
  // bypass the cache when the user explicitly asks.
  const checkHealthRef = useRef(onCheckHealth);
  useEffect(() => { checkHealthRef.current = onCheckHealth; });
  useEffect(() => {
    if (open && connection) {
      checkHealthRef.current(connection);
    }
  }, [open, connection?.id]);

  const lastCheckedAt = connection ? healthCheckedAt?.[connection.id] : undefined;
  const lastCheckedLabel = formatRelativeCheckedAt(lastCheckedAt);

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(server.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  }

  // Header badges: a small connection dot (green = connected, red =
  // disconnected) + the scope chip. Compresses two pieces of state into
  // one glance — the scope row is dropped from the Details card below
  // since it now lives up here.
  //   - global       → info (blue) — visible to the whole workspace
  //   - personal     → neutral     — your own connector
  //   - built-in     → success     — platform-provided, blessed by Xyne
  //   - unknown      → neutral     — meta missing, fallback
  const scopeVariant: "info" | "neutral" | "success" =
    scope === "global"
      ? "info"
      : scope === "built-in"
        ? "success"
        : "neutral";
  const statusBadge = (
    <span className="inline-flex items-center gap-2">
      <span
        data-id="mcp-sidebar-connection-dot"
        className={`h-[8px] w-[8px] shrink-0 rounded-full ${
          connected ? "bg-xyne-success" : "bg-xyne-error"
        }`}
        title={connected ? "Connected" : "Disconnected"}
        aria-label={connected ? "Connected" : "Disconnected"}
      />
      <Badge
        data-id="mcp-sidebar-scope-badge"
        as="span"
        variant={scopeVariant}
        size="sm"
        label={scope}
      />
    </span>
  );

  const footer = (
    // Footer = two clusters of icon-bubble actions. Left = destructive
    // (Delete, owner-only). Right = configure + connect/disconnect. Each
    // action is icon-only at rest; hovering or keyboard-focusing morphs
    // it into a labeled pill so users can scan without tooltips.
    <div data-id="mcp-sidebar-footer" className="flex w-full items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        {isOwner && (
          <ExpandingAction
            icon={<TrashIcon size={15} />}
            label="Delete"
            variant="destructive"
            onClick={() => onDeleteRequest(server)}
          />
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {connected && onEditDefinition && (
          <ExpandingAction
            icon={<CodeIcon size={15} />}
            label="Edit definition"
            variant="ghost"
            onClick={onEditDefinition}
            title="Edit the connector definition (admin / builder)"
          />
        )}
        {connected && onEdit && (
          <ExpandingAction
            icon={<PencilSimpleIcon size={15} />}
            label="Edit credentials"
            variant="secondary"
            onClick={onEdit}
          />
        )}
        {canShowPublish && (
          isPublishPending ? (
            <span
              data-id="mcp-sidebar-publish-pending"
              title="An admin will review this connector and decide whether to make it global."
            >
              <Badge
                as="span"
                variant="warning"
                size="sm"
                label="Pending review"
              />
            </span>
          ) : onPublishRequest ? (
            <ExpandingAction
              icon={<PaperPlaneTiltIcon size={15} weight="fill" />}
              label={
                publishPending
                  ? "Submitting…"
                  : isPublishRejected
                    ? "Re-request publishing"
                    : "Request publishing"
              }
              variant="ghost"
              onClick={handlePublishClick}
              disabled={publishPending}
              forceExpanded={publishPending}
              title={
                isPublishRejected && publishReviewNote
                  ? `Rejected: ${publishReviewNote}`
                  : "Submit this connector for admin approval to make it global."
              }
            />
          ) : null
        )}
        {connected ? (
          <ExpandingAction
            icon={<PlugIcon size={15} />}
            label={loading ? "Disconnecting…" : "Disconnect"}
            variant="destructive"
            onClick={() => connection && onDisconnect(connection)}
            disabled={loading}
            forceExpanded={loading}
          />
        ) : (
          <ExpandingAction
            icon={<PlugsConnectedIcon size={15} weight="fill" />}
            label={loading ? "Connecting…" : "Connect"}
            variant="primary"
            onClick={() => onConnect(server)}
            disabled={loading}
            forceExpanded={loading}
          />
        )}
      </div>
    </div>
  );

  return (
    <SidePanel
      onClose={onClose}
      icon={<ServerIcon type={server.type} size="md" />}
      title={server.name}
      badge={statusBadge}
      footer={footer}
      floating
    >
      <div className="flex flex-col gap-5">
        {/* Description — short paragraph if present, otherwise omitted. */}
        {server.description ? (
          <p
            data-id="mcp-sidebar-description"
            className="text-[14px] text-xyne-fg-primary leading-[1.6]"
          >
            {server.description}
          </p>
        ) : null}

        {/* Health banner — promoted to the top so the most actionable
              signal ("is this thing actually working?") is the first
              thing the user sees. Carries: status text + tool count +
              last-checked + latency + a Recheck button. */}
        {isChecking ? (
          <div
            data-id="mcp-sidebar-health-checking"
            className="flex items-center gap-2.5 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-3 text-[13px] text-xyne-fg-tertiary"
          >
            <ArrowsClockwiseIcon size={15} className="animate-spin" />
            <span>Checking connection…</span>
          </div>
        ) : healthResult ? (
          <div
            data-id="mcp-sidebar-health-result"
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
              healthResult.healthy
                ? "border-xyne-success-fg/20 bg-xyne-success-bg/60"
                : "border-xyne-error-fg/20 bg-xyne-error-bg/60"
            }`}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${
                  healthResult.healthy ? "bg-xyne-success" : "bg-xyne-error"
                }`}
              />
              <div className="min-w-0">
                <div
                  className={`text-[14px] font-semibold ${
                    healthResult.healthy ? "text-xyne-success-fg" : "text-xyne-error-fg"
                  }`}
                >
                  {healthResult.healthy
                    ? tools.length > 0
                      ? `Connected · ${tools.length} ${tools.length === 1 ? "tool" : "tools"} available`
                      : "Connected"
                    : healthResult.message || "Connection error"}
                </div>
                <div
                  className={`text-[12px] ${
                    healthResult.healthy ? "text-xyne-success-fg/80" : "text-xyne-error-fg/80"
                  }`}
                >
                  {lastCheckedLabel && <span>Checked {lastCheckedLabel}</span>}
                  {lastCheckedLabel && healthResult.healthy && (
                    <span className="mx-1.5 opacity-60">·</span>
                  )}
                  {healthResult.healthy && <span>{healthResult.latencyMs}ms</span>}
                </div>
              </div>
            </div>
            {connection && (
              <button
                data-id="mcp-sidebar-health-refresh-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckHealth(connection, { force: true });
                }}
                title="Re-check now"
                aria-label="Re-check health"
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  healthResult.healthy
                    ? "border-xyne-success-fg/30 bg-xyne-surface text-xyne-success-fg hover:bg-xyne-success-fg/10"
                    : "border-xyne-error-fg/30 bg-xyne-surface text-xyne-error-fg hover:bg-xyne-error-fg/10"
                }`}
              >
                <ArrowsClockwiseIcon size={12} />
                Recheck
              </button>
            )}
          </div>
        ) : null}

        {/* Inline publish state — pill + microcopy. Renders only when
              the connector is in a state worth nudging the user about
              (Draft, Pending review, Rejected). Approved / built-in /
              public global connectors don't need this row at all. */}
        {!isPlatformConnector && scope === "personal" && publishStatus === "draft" && (
          <div
            data-id="mcp-sidebar-publish-pill-row"
            className="flex flex-wrap items-center gap-2 -mt-2"
          >
            <Badge as="span" variant="warning" size="sm" label="Draft" />
            <span className="text-[12px] text-xyne-fg-tertiary">
              Not yet published — only you can use it
            </span>
          </div>
        )}
        {!isPlatformConnector && scope === "personal" && publishStatus === "pending" && (
          <div
            data-id="mcp-sidebar-publish-pill-row"
            className="flex flex-wrap items-center gap-2 -mt-2"
          >
            <Badge as="span" variant="info" size="sm" label="Pending review" />
            <span className="text-[12px] text-xyne-fg-tertiary">
              An admin will review and decide whether to publish it.
            </span>
          </div>
        )}
        {!isPlatformConnector && scope === "personal" && publishStatus === "rejected" && (
          <div
            data-id="mcp-sidebar-publish-pill-row"
            className="flex flex-wrap items-center gap-2 -mt-2"
          >
            <Badge as="span" variant="error" size="sm" label="Rejected" />
            <span
              className="text-[12px] text-xyne-fg-tertiary"
              title={publishReviewNote}
            >
              You can adjust and re-submit for review.
            </span>
          </div>
        )}

        {/* Connection — renamed from "Details" to match the mockup; the
              section is specifically about how to reach this MCP, not a
              generic metadata dump. Order: Endpoint → Transport →
              Connected (most informative first). Publish status row is
              dropped because the inline pill above already conveys it. */}
        <div>
          <SectionCaption>Connection</SectionCaption>
          <MetaCard>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex items-center gap-2.5 text-[13px] text-xyne-fg-tertiary">
                <span className="w-[16px] h-[16px] flex items-center justify-center text-xyne-fg-tertiary">
                  <LinkSimpleIcon size={14} />
                </span>
                Endpoint
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="max-w-[220px] truncate text-right text-[14px] text-xyne-fg-primary">
                  {server.url}
                </span>
                <button
                  data-id="mcp-sidebar-copy-url-btn"
                  onClick={handleCopyUrl}
                  className="shrink-0 text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-primary"
                  title="Copy URL"
                  aria-label="Copy URL"
                >
                  {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
                </button>
              </div>
            </div>
            <MetaRow icon={<PlugIcon size={14} />} label="Transport">
              {server.transport || "stdio"}
            </MetaRow>
            {connection && (
              <MetaRow icon={<CalendarBlankIcon size={14} />} label="Connected">
                {new Date(connection.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </MetaRow>
            )}
          </MetaCard>
        </div>

        {/* Tools — chip list of tools this connector exposes. Only shown
            when the connector has declared tools in its writeToolPolicy. */}
        {tools.length > 0 && (
          <div>
            <SectionCaption>
              <span className="inline-flex items-center gap-1.5">
                <WrenchIcon size={11} weight="fill" />
                Tools · {tools.length}
              </span>
            </SectionCaption>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((tool) => (
                <span
                  key={tool}
                  data-id="mcp-sidebar-tool-badge"
                  className="rounded-full border border-xyne-border bg-xyne-surface-subtle px-2.5 py-1 text-[12px] text-xyne-fg-secondary"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Credentials — only rendered for HTTP connectors. stdio MCPs
              receive their credentials via env vars baked into the local
              launch config (no user-scoped tokens to display or edit),
              so the section is suppressed entirely for them. To change
              an stdio MCP's credentials, the user reconnects or — for
              shared connectors — the admin updates the definition via
              "Edit definition" in the footer. */}
        {connected
          && credentialFields.length > 0
          && (server.transport || "stdio") !== "stdio"
          && (
            <div>
              <SectionCaption>Credentials</SectionCaption>
              <MetaCard>
                {credentialFields.map((field) => (
                  <div
                    key={field.name}
                    data-id={`mcp-sidebar-cred-row-${field.name}`}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="text-[13px] text-xyne-fg-tertiary">
                      {field.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[14px] tracking-widest text-xyne-fg-tertiary select-none">
                        ••••••••
                      </span>
                      {onEdit && (
                        <button
                          data-id={`mcp-sidebar-cred-edit-${field.name}`}
                          onClick={onEdit}
                          title={`Edit ${field.label}`}
                          aria-label={`Edit ${field.label}`}
                          className="flex h-6 w-6 items-center justify-center rounded text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                        >
                          <PencilSimpleIcon size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </MetaCard>
            </div>
          )}

        {/* Advanced configuration — renamed from plain "Configuration"
              to set expectations ("this is for power users"). Same
              collapsible JSON viewer underneath. */}
        {(server.launchConfigTemplate || server.httpConfigTemplate) && (
          <div data-id="mcp-sidebar-config">
            <details className="group/cfg">
              <summary className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary hover:text-xyne-fg-secondary transition-colors list-none [&::-webkit-details-marker]:hidden">
                <CaretRightIcon
                  size={11}
                  weight="bold"
                  className="transition-transform group-open/cfg:rotate-90"
                />
                <CodeIcon size={11} />
                Advanced configuration
              </summary>
              <pre className="mt-2 overflow-auto rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-xyne-fg-secondary">
                {JSON.stringify(
                  server.launchConfigTemplate ?? server.httpConfigTemplate,
                  null,
                  2
                )}
              </pre>
            </details>
          </div>
        )}

        {/* Built by + trust note — wrapped in a subtle card so it reads
              as one self-contained "third-party origin" attribution
              block instead of loose text. */}
        <div
          data-id="mcp-sidebar-built-by"
          className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-3"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-1">
            Built by {author}
          </div>
          <p className="text-[12px] leading-relaxed text-xyne-fg-tertiary">
            Only connect tools you trust. Connectors are created by third-party developers and may change over time.
          </p>
        </div>
      </div>
    </SidePanel>
  );
}
