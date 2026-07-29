import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  WarningCircleIcon,
  ChatCircleIcon,
  PencilSimpleIcon,
  GlobeIcon,
  CheckCircleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  TrashIcon,
  ClockIcon,
  CalendarBlankIcon,
  UserIcon,
  RobotIcon,
  WrenchIcon,
  PuzzlePieceIcon,
  PlusIcon,
  CaretRightIcon,
  HammerIcon,
  SparkleIcon,
} from "@phosphor-icons/react";

/* Provider labels — mirror of the (now-removed) constant in
   AgentDetailLeftColumn. Kept locally so this surface can show the
   chosen provider(s) without re-importing the design tokens. */
const PROVIDER_LABELS_SLIDEOVER: Record<string, string> = {
  spaces:     "Spaces",
  copilot:    "GitHub Copilot",
  claude:     "Anthropic Claude",
  codex:      "OpenAI Codex",
  openrouter: "OpenRouter",
  kimi:       "Kimi",
};
import type { Agent, AgentLight } from "../../lib/types";
import { SidePanel } from "./ui/SidePanel";
import { Avatar } from "./ui/Avatar";
import { Badge } from "./ui/Badge";
import { Switch } from "./ui/Switch";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import {
  submitAgentRequest,
  updateAgent,
  promoteAgent,
  demoteAgent,
  deleteAgent,
  getAgentDetail,
} from "../../lib/api";
import { useSnackbar } from "./ui/Snackbar";

interface AgentSlideOverProps {
  agent: AgentLight | null;
  lastUsed: string | null;
  onClose: () => void;
  onEdit: (slug: string) => void;
  userId: string;
  /**
   * When true and the viewer is *not* the owner, surface inline admin
   * actions (Promote / Demote / Delete) in the panel header. Without
   * this flag, those actions are only reachable via the dedicated
   * `/v3/admin → Agents` tab.
   */
  isAdmin?: boolean;
  onAgentChanged?: () => void;
}

function ScopeBadge({ agent, userId }: { agent: AgentLight; userId: string }) {
  if (agent.shares?.some((s) => s.userId === userId)) {
    return (
      <span className="text-[12px] font-medium px-[10px] py-[2px] rounded-full bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20">
        shared
      </span>
    );
  }
  if (agent.scope === "global") {
    return (
      <Badge
        as="span"
        label="global"
        variant="info"
        size="sm"
      />
    );
  }
  return (
    <Badge
      as="span"
      label="personal"
      variant="neutral"
      size="sm"
    />
  );
}

/**
 * Icon-first action button that expands its label on hover/focus.
 *
 * Default state: circular icon-only (h-9 w-9).
 * Hover/focus:  icon stays, label slides out and the button becomes a pill.
 *
 * The label uses max-width transition rather than translate so the surrounding
 * layout reflows naturally — buttons to the left/right shift to accommodate.
 */
type ActionVariant = "primary" | "secondary" | "destructive";

interface ExpandingActionProps {
  icon: React.ReactNode;
  label: string;
  variant: ActionVariant;
  onClick: () => void;
  disabled?: boolean;
  /** Optional trailing icon (e.g. arrow for "View details →") rendered after the label. */
  trailingIcon?: React.ReactNode;
  ariaLabel?: string;
  title?: string;
}

const ACTION_VARIANT_CLASSES: Record<ActionVariant, string> = {
  primary:
    "bg-xyne-fg-primary text-xyne-fg-inverse hover:opacity-90 focus-visible:opacity-90",
  secondary:
    "bg-xyne-surface border border-xyne-border text-xyne-fg-primary hover:border-xyne-border-strong hover:bg-xyne-surface-sunken/40 focus-visible:border-xyne-border-strong",
  destructive:
    "bg-xyne-error-bg border border-xyne-error-border text-xyne-error-fg hover:bg-xyne-error/15 focus-visible:bg-xyne-error/15",
};

function ExpandingAction({
  icon,
  label,
  variant,
  onClick,
  disabled = false,
  trailingIcon,
  ariaLabel,
  title,
}: ExpandingActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      title={title ?? label}
      className={`group/exp h-9 inline-flex items-center justify-center rounded-full transition-all duration-200 ease-out disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none ${ACTION_VARIANT_CLASSES[variant]}`}
      style={{ paddingLeft: 10, paddingRight: 10 }}
    >
      <span className="flex items-center justify-center w-[16px] h-[16px] flex-shrink-0">
        {icon}
      </span>
      <span
        className="overflow-hidden whitespace-nowrap text-[13px] font-medium max-w-0 group-hover/exp:max-w-[180px] group-focus-visible/exp:max-w-[180px] group-hover/exp:ml-[6px] group-focus-visible/exp:ml-[6px] transition-[max-width,margin] duration-200 ease-out"
      >
        {label}
      </span>
      {trailingIcon && (
        <span
          className="overflow-hidden whitespace-nowrap max-w-0 group-hover/exp:max-w-[16px] group-focus-visible/exp:max-w-[16px] group-hover/exp:ml-[4px] group-focus-visible/exp:ml-[4px] transition-[max-width,margin] duration-200 ease-out flex items-center"
        >
          {trailingIcon}
        </span>
      )}
    </button>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeCreated(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Body-block subcomponents
 *
 * MetaRow — single line in the metadata card (Status / Owner / Last used / Created).
 *           Icon left, label center-left muted, value right.
 * MetaCard — wraps MetaRows with divide-y inside a bordered surface card.
 * CapabilityRow — single row in the Capabilities card (Subagents / Skills / MCPs).
 *                 Icon + label + count + chevron, plus chip lane below when populated.
 * ──────────────────────────────────────────────────────────────────────────── */

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

function CapabilityRow({
  icon,
  label,
  count,
  chips,
  isOwner,
  emptyHint,
  onConfigure,
}: {
  icon: React.ReactNode;
  label: string;
  /** null means "count unknown / not loaded for this section" */
  count: number | null;
  chips?: React.ReactNode;
  isOwner: boolean;
  emptyHint: string;
  onConfigure: () => void;
}) {
  const isEmpty = count === 0 || count === null;
  return (
    <button
      type="button"
      onClick={onConfigure}
      className="group/cap w-full text-left flex items-center gap-2.5 px-4 py-3 hover:bg-xyne-surface-sunken/40 transition-colors"
    >
      <span className="w-[16px] h-[16px] flex items-center justify-center text-xyne-fg-tertiary flex-shrink-0">
        {icon}
      </span>
      {/* Left lane — label on top, hint or chips below */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="text-[13px] text-xyne-fg-secondary">{label}</span>
        {isEmpty ? (
          <span className="text-[12px] text-xyne-fg-tertiary">
            {emptyHint}
          </span>
        ) : (
          chips && <div className="flex flex-wrap gap-1.5">{chips}</div>
        )}
      </div>
      {/* Right cluster — count + chevron. items-center on the outer row
          vertically centers this against the (potentially taller) left lane. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {count !== null && (
          <span
            className={`text-[12px] tabular-nums ${
              count > 0
                ? "text-xyne-fg-primary font-medium"
                : "text-xyne-fg-tertiary"
            }`}
          >
            {count}
          </span>
        )}
        <CaretRightIcon
          size={12}
          className="text-xyne-fg-tertiary group-hover/cap:text-xyne-fg-primary transition-colors"
        />
      </div>
    </button>
  );
}

export function AgentSlideOver({
  agent: rowAgent,
  lastUsed,
  onClose,
  onEdit,
  userId,
  isAdmin = false,
  onAgentChanged,
}: AgentSlideOverProps) {
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const [publishing, setPublishing] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [fullAgent, setFullAgent] = useState<Agent | null>(null);
  const agent = fullAgent ?? rowAgent;
  const [localEnabled, setLocalEnabled] = useState<boolean>(agent?.enabled ?? true);
  const [adminBusy, setAdminBusy] = useState<"promote" | "demote" | "delete" | null>(null);
  const [confirmAction, setConfirmAction] =
    useState<"promote" | "demote" | "delete" | null>(null);

  useEffect(() => {
    if (!togglePending && agent) {
      setLocalEnabled(agent.enabled);
    }
  }, [agent, togglePending]);

  useEffect(() => {
    if (!rowAgent) {
      setFullAgent(null);
      return;
    }
    let cancelled = false;
    setFullAgent(null);
    getAgentDetail(rowAgent.slug)
      .then((detail) => {
        if (!cancelled) setFullAgent(detail);
      })
      .catch(() => {
        if (!cancelled) setFullAgent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rowAgent]);

  if (!agent) return null;

  const isOwner = agent.ownerUserId === userId;
  const isGlobal = agent.scope === "global";
  const canPublish = isOwner && !isGlobal;

  const handlePublish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    try {
      await submitAgentRequest(agent.slug, userId, "push_to_global");
      showSnackbar({
        variant: "success",
        title: "Publish request submitted",
        description: "An admin will review and approve before this agent becomes global.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const is403 = msg.includes("403") || msg.toLowerCase().includes("forbidden");
      showSnackbar({
        variant: "error",
        title: is403
          ? "You don't have permission to publish this agent"
          : "Failed to submit publish request",
        description: !is403 && msg ? msg : undefined,
      });
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Admin-only inline actions. Only shown when the viewer is an admin
   * AND not the owner — owners go through Publish (their own path) and
   * normal Edit/Pause. Each action is guarded behind a confirm dialog.
   */
  const runAdminAction = async (action: "promote" | "demote" | "delete") => {
    if (!agent) return;
    setAdminBusy(action);
    try {
      if (action === "promote") {
        await promoteAgent(agent.slug, userId);
        showSnackbar({ variant: "success", title: `${agent.name} promoted to global` });
      } else if (action === "demote") {
        await demoteAgent(agent.slug, userId);
        showSnackbar({ variant: "success", title: `${agent.name} demoted to personal` });
      } else {
        await deleteAgent(agent.slug, userId);
        showSnackbar({ variant: "success", title: `${agent.name} deleted` });
        onClose();
      }
      onAgentChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to ${action}`;
      showSnackbar({ variant: "error", title: msg });
    } finally {
      setAdminBusy(null);
      setConfirmAction(null);
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    if (!isOwner || togglePending) return;
    const prev = localEnabled;
    setLocalEnabled(next);
    setTogglePending(true);
    try {
      await updateAgent(agent.slug, { enabled: next });
      showSnackbar({
        variant: "success",
        title: `${agent.name} ${next ? "enabled" : "paused"}`,
      });
      onAgentChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const is403 = msg.includes("403") || msg.toLowerCase().includes("forbidden");
      setLocalEnabled(prev);
      showSnackbar({
        variant: "error",
        title: is403
          ? "You don't have permission to modify this agent"
          : `Failed to update ${agent.name}`,
      });
    } finally {
      setTogglePending(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      icon={
        <Avatar
          name={agent.name}
          color={agent.color}
          size={40}
          shape="circle"
        />
      }
      title={agent.name}
      badge={<ScopeBadge agent={agent} userId={userId} />}
      subtitle={agent.slug}
      actions={
        // Header keeps only the "Published" state badge — it's a status indicator,
        // not an action. All actions move to the sticky footer below.
        isOwner && isGlobal ? (
          <span
            data-id="agent-slideover-published"
            title="This agent is global — visible to everyone in the workspace."
            className="inline-flex items-center gap-1 text-[11px] font-medium px-[8px] py-[3px] rounded-full bg-xyne-success-bg text-xyne-success-fg border border-xyne-success-fg/20"
          >
            <CheckCircleIcon size={12} weight="fill" />
            Published
          </span>
        ) : undefined
      }
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          {/* Left cluster: destructive / admin moderation actions.
              Visually separated from the right cluster so destructive
              taps need intent — you can't fat-finger from "Chat" to "Delete". */}
          <div className="flex items-center gap-1.5">
            {isAdmin && !isOwner && (
              <>
                {agent.scope !== "global" ? (
                  <ExpandingAction
                    icon={<ArrowUpIcon size={14} weight="bold" />}
                    label="Promote"
                    variant="secondary"
                    onClick={() => setConfirmAction("promote")}
                    disabled={adminBusy !== null}
                    title="Promote this agent to global (admin)"
                  />
                ) : (
                  <ExpandingAction
                    icon={<ArrowDownIcon size={14} weight="bold" />}
                    label="Demote"
                    variant="secondary"
                    onClick={() => setConfirmAction("demote")}
                    disabled={adminBusy !== null}
                    title="Demote this agent to personal (admin)"
                  />
                )}
                <ExpandingAction
                  icon={<TrashIcon size={14} />}
                  label="Delete"
                  variant="destructive"
                  onClick={() => setConfirmAction("delete")}
                  disabled={adminBusy !== null}
                  title="Delete agent (admin)"
                />
              </>
            )}
          </div>
          {/* Right cluster: primary actions — Publish (owner), Chat, View/Edit. */}
          <div className="flex items-center gap-1.5">
            {canPublish && (
              <ExpandingAction
                icon={<GlobeIcon size={14} />}
                label={publishing ? "Publishing…" : "Publish"}
                variant="secondary"
                onClick={handlePublish}
                disabled={publishing}
                title="Submit this agent for admin approval to make it global."
              />
            )}
            <ExpandingAction
              icon={<ChatCircleIcon size={16} weight="fill" />}
              label="Chat"
              variant="primary"
              onClick={() => navigate(`/v3/chat?agent=${agent.slug}`)}
            />
            {isOwner ? (
              <ExpandingAction
                icon={<PencilSimpleIcon size={14} />}
                label="Configure"
                variant="secondary"
                onClick={() => onEdit(agent.slug)}
              />
            ) : (
              <ExpandingAction
                icon={<ArrowRightIcon size={14} weight="bold" />}
                label="View details"
                variant="secondary"
                onClick={() => onEdit(agent.slug)}
              />
            )}
          </div>
        </div>
      }
      width={520}
      floating
    >
      <div className="flex flex-col gap-5">
        {/* Paused banner */}
        {!agent.enabled && (
          <div className="flex items-center gap-2 p-2.5 bg-xyne-warning-bg border border-xyne-warning-fg/20 rounded-lg">
            <WarningCircleIcon
              size={16}
              className="text-xyne-warning-fg shrink-0"
            />
            <span className="text-[13px] text-xyne-warning-fg">
              This agent is paused
            </span>
          </div>
        )}

        {/* Description */}
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-2">
            Description
          </div>
          {agent.description?.trim() ? (
            <p className="text-[14px] text-xyne-fg-primary leading-[1.6]">
              {agent.description}
            </p>
          ) : isOwner ? (
            <button
              type="button"
              onClick={() => onEdit(agent.slug)}
              className="inline-flex items-center gap-1.5 text-[13px] text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors"
            >
              <PlusIcon size={12} weight="bold" />
              Add description
            </button>
          ) : (
            <span className="text-[13px] text-xyne-fg-tertiary">
              No description added
            </span>
          )}
        </div>

        {/* Metadata card — Status / Owner / Last used / Created */}
        <MetaCard>
          <MetaRow
            icon={
              <span
                className={`w-[8px] h-[8px] rounded-full ${
                  (isOwner ? localEnabled : agent.enabled)
                    ? "bg-xyne-success"
                    : "bg-xyne-warning"
                }`}
              />
            }
            label="Status"
          >
            {isOwner ? (
              <span className="inline-flex items-center gap-2">
                <span
                  className={`text-[13px] font-medium ${
                    localEnabled ? "text-xyne-success" : "text-xyne-warning-fg"
                  }`}
                >
                  {localEnabled ? "Enabled" : "Paused"}
                </span>
                <Switch
                  checked={localEnabled}
                  onChange={(v) => {
                    void handleToggleEnabled(v);
                  }}
                  disabled={togglePending}
                />
              </span>
            ) : (
              <span
                className={`text-[13px] font-medium ${
                  agent.enabled ? "text-xyne-success" : "text-xyne-warning-fg"
                }`}
              >
                {agent.enabled ? "Active" : "Paused"}
              </span>
            )}
          </MetaRow>

          <MetaRow icon={<UserIcon size={14} />} label="Owner">
            {agent.owner?.name ?? agent.owner?.email ?? "Xyne"}
          </MetaRow>

          <MetaRow icon={<ClockIcon size={14} />} label="Last used">
            {lastUsed ? (
              formatTimeAgo(lastUsed)
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xyne-warning-fg">
                <span className="w-[5px] h-[5px] rounded-full bg-xyne-warning" />
                Never used
              </span>
            )}
          </MetaRow>

          <MetaRow icon={<CalendarBlankIcon size={14} />} label="Created">
            <span title={new Date(agent.createdAt).toLocaleString()}>
              {formatRelativeCreated(agent.createdAt)}
              <span className="mx-1.5 text-xyne-fg-tertiary">·</span>
              <span className="text-xyne-fg-secondary">
                {formatCreatedAt(agent.createdAt)}
              </span>
            </span>
          </MetaRow>

          {/* Provider preference — pulled from agent.config.providerOrder
                (canonical) with a fallback to the legacy config.provider
                single-pick. Renders as a chain of chips so the operator
                can read "primary → first fallback → …" at a glance. The
                full picker lives in the Provider tab; this row is a
                read-only summary. */}
          {(() => {
            const cfg = fullAgent?.config as
              | { providerOrder?: unknown; provider?: unknown }
              | undefined;
            const orderRaw = Array.isArray(cfg?.providerOrder)
              ? (cfg.providerOrder as unknown[])
              : null;
            const order = orderRaw
              ? orderRaw.filter((p): p is string => typeof p === "string")
              : typeof cfg?.provider === "string"
                ? [cfg.provider as string]
                : [];
            if (order.length === 0) return null;
            return (
              <MetaRow
                icon={<SparkleIcon size={14} weight="fill" className="text-xyne-brand" />}
                label="Provider"
              >
                <span className="inline-flex flex-wrap items-center gap-1">
                  {order.map((key, i) => (
                    <span key={`${key}-${i}`} className="inline-flex items-center gap-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                          i === 0
                            ? "border-xyne-brand/30 bg-xyne-brand/10 text-xyne-brand"
                            : "border-xyne-border-subtle bg-xyne-surface-subtle text-xyne-fg-secondary"
                        }`}
                        title={i === 0 ? "Primary provider" : `Fallback #${i}`}
                      >
                        {PROVIDER_LABELS_SLIDEOVER[key] ?? key}
                      </span>
                      {i < order.length - 1 && (
                        <ArrowRightIcon
                          size={10}
                          className="text-xyne-fg-muted"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  ))}
                </span>
              </MetaRow>
            );
          })()}
        </MetaCard>

        {/* Capabilities — reads from System B (agent.config.tools.{...})
            to match what the detail-page picker writes. Categories:
            Subagents / Skills / Write tools / MCP tools / Git repo. */}
        {(() => {
          const cfgTools =
            (fullAgent?.config as {
              tools?: { subagents?: string[]; direct?: string[]; custom?: string[]; gateway?: string[]; callableAgents?: string[] };
            } | undefined)?.tools;
          const subagents = cfgTools?.subagents ?? [];
          const callableAgents = cfgTools?.callableAgents ?? [];
          const writeToolSlugs = cfgTools?.direct ?? [];
          const mcpToolSlugs = cfgTools?.custom ?? [];
          const skills = fullAgent?.skills ?? [];

          const subagentChips =
            subagents.length > 0 ? (
              <div data-id="agent-slideover-subagents" className="contents">
                {subagents.map((slug) => (
                  <span
                    key={slug}
                    data-id={`agent-slideover-subagent-${slug}`}
                    title={`Helper agent: ${slug}`}
                    className="text-[12px] px-2.5 py-0.5 rounded-full bg-xyne-brand/10 border border-xyne-brand/20 text-xyne-brand"
                  >
                    {slug}
                  </span>
                ))}
              </div>
            ) : null;

          const callableAgentChips =
            callableAgents.length > 0 ? (
              <div data-id="agent-slideover-callable-agents" className="contents">
                {callableAgents.map((slug) => (
                  <span
                    key={slug}
                    data-id={`agent-slideover-callable-agent-${slug}`}
                    title={`Delegated agent: ${slug}`}
                    className="inline-flex items-center gap-1 text-[12px] px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500/40 dark:text-amber-300"
                  >
                    {slug}
                    <span className="text-[10px] font-medium">Agent · heavyweight</span>
                  </span>
                ))}
              </div>
            ) : null;

          const skillChips =
            skills.length > 0 ? (
              <div className="contents">
                {skills.map((as) => (
                  <span
                    key={as.skillId}
                    className="text-[12px] px-2.5 py-0.5 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
                  >
                    {as.skill.name}
                  </span>
                ))}
              </div>
            ) : null;

          const slugChips = (slugs: string[]) =>
            slugs.length > 0 ? (
              <div className="contents">
                {slugs.slice(0, 8).map((slug) => (
                  <span
                    key={slug}
                    title={slug}
                    className="text-[12px] px-2.5 py-0.5 rounded-full bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-secondary"
                  >
                    {slug}
                  </span>
                ))}
                {slugs.length > 8 && (
                  <span className="text-[12px] px-2.5 py-0.5 rounded-full border border-xyne-border-subtle text-xyne-fg-tertiary">
                    +{slugs.length - 8}
                  </span>
                )}
              </div>
            ) : null;
          const writeToolChips = slugChips(writeToolSlugs);
          const mcpToolChips = slugChips(mcpToolSlugs);

          return (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-2">
                Capabilities
              </div>
              <MetaCard>
                <CapabilityRow
                  icon={<RobotIcon size={14} />}
                  label="Helpers"
                  count={subagents.length}
                  chips={subagentChips}
                  isOwner={isOwner}
                  emptyHint="Bring in other agents to handle parts of the work"
                  onConfigure={() => onEdit(agent.slug)}
                />
                <CapabilityRow
                  icon={<RobotIcon size={14} weight="fill" />}
                  label="Agents"
                  count={callableAgents.length}
                  chips={callableAgentChips}
                  isOwner={isOwner}
                  emptyHint="Full agent loops delegated through A2A"
                  onConfigure={() => onEdit(agent.slug)}
                />
                <CapabilityRow
                  icon={<WrenchIcon size={14} />}
                  label="Skills"
                  count={skills.length}
                  chips={skillChips}
                  isOwner={isOwner}
                  emptyHint="Give this agent reusable capabilities"
                  onConfigure={() => onEdit(agent.slug)}
                />
                <CapabilityRow
                  icon={<HammerIcon size={14} />}
                  label="Write tools"
                  count={writeToolSlugs.length}
                  chips={writeToolChips}
                  isOwner={isOwner}
                  emptyHint="Built-in actions this agent can perform"
                  onConfigure={() => onEdit(agent.slug)}
                />
                <CapabilityRow
                  icon={<PuzzlePieceIcon size={14} />}
                  label="MCP tools"
                  count={mcpToolSlugs.length}
                  chips={mcpToolChips}
                  isOwner={isOwner}
                  emptyHint="Tools provided by connected MCP servers"
                  onConfigure={() => onEdit(agent.slug)}
                />
              </MetaCard>
            </div>
          );
        })()}
      </div>
      {/* Admin confirmation for promote / demote / delete */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction === "promote"
            ? "Promote agent"
            : confirmAction === "demote"
              ? "Demote agent"
              : "Delete agent"
        }
        description={
          confirmAction === "promote"
            ? `Promote "${agent.name}" to global? It will become visible to everyone in the workspace.`
            : confirmAction === "demote"
              ? `Demote "${agent.name}" to personal? It will no longer be visible to the workspace.`
              : `Delete "${agent.name}"? This cannot be undone.`
        }
        confirmLabel={
          confirmAction === "delete"
            ? "Delete"
            : confirmAction === "promote"
              ? "Promote"
              : "Demote"
        }
        danger={confirmAction === "delete"}
        onConfirm={() => {
          if (confirmAction) void runAdminAction(confirmAction);
        }}
      />
    </SidePanel>
  );
}
