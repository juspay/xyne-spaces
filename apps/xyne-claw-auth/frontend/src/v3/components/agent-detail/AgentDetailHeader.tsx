import { useNavigate } from "react-router-dom";
import {
  CaretLeftIcon,
  ChatCircleIcon,
  TrashIcon,
  FloppyDiskIcon,
  GlobeIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CopyIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../../lib/types";
import type { AgentPermissions } from "../../lib/agentPermissions";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Switch } from "../ui/Switch";

/* ─────────────────────────────────────────────────────────────────────
 * ExpandingAction — icon-only circle at rest that morphs into a labeled
 * pill on hover or keyboard focus. Three variants match the header's
 * action vocabulary:
 *   · ghost       Chat with agent (default-state)
 *   · primary     Save changes (active state when dirty)
 *   · destructive Delete (owner-only)
 * Plus a disabled state for Save when there's nothing to save — it stays
 * visible but quiet so users can still see the affordance exists.
 * ───────────────────────────────────────────────────────────────────── */

type ExpandingVariant = "primary" | "ghost" | "destructive" | "secondary";

interface ExpandingActionProps {
  icon: React.ReactNode;
  label: string;
  variant: ExpandingVariant;
  onClick: () => void;
  disabled?: boolean;
  /** When true, the label stays expanded (used for the "Saving…" state). */
  forceExpanded?: boolean;
  ariaLabel?: string;
  title?: string;
}

const VARIANT_CLASSES: Record<ExpandingVariant, string> = {
  primary:
    "bg-xyne-fg-primary text-xyne-fg-inverse hover:shadow-[0_4px_12px_-2px_rgba(16,24,40,0.18)]",
  ghost:
    "bg-xyne-surface border border-xyne-border text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary",
  destructive:
    "bg-xyne-error text-white hover:shadow-[0_4px_12px_-2px_rgba(220,38,38,0.30)]",
  secondary:
    "bg-xyne-surface-sunken border border-xyne-border text-xyne-fg-primary hover:border-xyne-border-strong hover:bg-xyne-surface",
};

function ExpandingAction({
  icon,
  label,
  variant,
  onClick,
  disabled = false,
  forceExpanded = false,
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
      className={`group/act inline-flex items-center justify-end h-10 rounded-full transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1 shadow-[0_1px_3px_-1px_rgba(16,24,40,0.08)] ${
        disabled
          ? // Quiet idle — stays visible so the user sees the action exists
            // but it doesn't compete with active controls.
            "bg-xyne-surface-sunken border border-xyne-border-subtle text-xyne-fg-tertiary cursor-not-allowed shadow-none"
          : VARIANT_CLASSES[variant]
      }`}
    >
      <span
        className={`overflow-hidden whitespace-nowrap text-[13px] font-medium transition-[max-width,padding] duration-200 ease-out ${
          forceExpanded
            ? "max-w-[160px] pl-4 pr-1"
            : disabled
              ? "max-w-0"
              : "max-w-0 group-hover/act:max-w-[160px] group-focus-visible/act:max-w-[160px] group-hover/act:pl-4 group-hover/act:pr-1 group-focus-visible/act:pl-4 group-focus-visible/act:pr-1"
        }`}
      >
        {label}
      </span>
      <span className="w-10 h-10 flex items-center justify-center flex-shrink-0">
        {icon}
      </span>
    </button>
  );
}

interface AgentDetailHeaderProps {
  agent: Agent;
  permissions: AgentPermissions | null;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onToggleEnabled: (value: boolean) => void;
  onBack: () => void;
  /** Open the delete-confirm dialog. Only rendered for the owner. */
  onDelete: () => void;
  /** Submit a "push_to_global" request for admin approval.
   *  Mirrors the Publish action in AgentSlideOver's footer.
   *  Only rendered for the actual owner of a non-global agent
   *  (admin-derived ownership does NOT trigger this — admins get
   *  the direct Promote action below instead). */
  onPublish?: () => void;
  publishing?: boolean;
  /** Current viewer id — used to distinguish actual ownership from
   *  admin-derived "owner" role for gating Publish vs Promote/Demote. */
  userId?: string;
  /** Admin flag — gates the Promote / Demote moderation actions. */
  isAdmin?: boolean;
  /** Open the admin-promote confirm dialog. */
  onAdminPromote?: () => void;
  /** Open the admin-demote confirm dialog. */
  onAdminDemote?: () => void;
  /** Which admin action is in flight (disables both buttons + the trigger). */
  adminBusy?: "promote" | "demote" | null;
  /** Clone this agent (copies system prompt + tools + skills into a new
   *  personal agent). Owners/contributors clone instantly; other viewers
   *  raise an approval request handled server-side. Rendered for any viewer
   *  who can see the page. */
  onClone?: () => void;
  cloning?: boolean;
  /** Advisory label — server is authoritative on whether approval is needed.
   *  When true the button reads "Request clone" instead of "Clone agent". */
  cloneNeedsApproval?: boolean;
}

export function AgentDetailHeader({
  agent,
  permissions,
  dirty,
  saving,
  onSave,
  onToggleEnabled,
  onBack,
  onDelete,
  onPublish,
  publishing = false,
  userId,
  isAdmin = false,
  onAdminPromote,
  onAdminDemote,
  adminBusy = null,
  onClone,
  cloning = false,
  cloneNeedsApproval = false,
}: AgentDetailHeaderProps) {
  const navigate = useNavigate();
  // Actual ownership — getAgentPermissions promotes admins to role="owner",
  // so permissions.role is NOT a reliable check for the publish flow.
  // Publish submits a *request* (owner path); admins instead get the direct
  // Promote/Demote moderation actions below.
  const isActualOwner = !!userId && agent.ownerUserId === userId;
  const canPublish = isActualOwner && agent.scope !== "global" && !!onPublish;
  const canModerate = isAdmin && !isActualOwner;
  const canPromote = canModerate && agent.scope !== "global" && !!onAdminPromote;
  const canDemote = canModerate && agent.scope === "global" && !!onAdminDemote;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-xyne-border-subtle px-5 py-3">
      {/* Left cluster */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-secondary"
        >
          <CaretLeftIcon size={14} />
          Agents
        </button>

        <div className="h-4 w-px bg-xyne-border-subtle" />

        <Avatar
          name={agent.name}
          color={agent.color}
          size={28}
          shape="circle"
        />

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="max-w-[200px] truncate text-[14px] font-medium text-xyne-fg-primary">
              {agent.name}
            </span>
            <span className="font-mono text-[11px] text-xyne-fg-tertiary">
              {agent.slug}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <Badge
              as="span"
              label={agent.scope === "global" ? "global" : "personal"}
              variant={agent.scope === "global" ? "info" : "neutral"}
              size="sm"
            />
            <Badge
              as="span"
              label={agent.enabled ? "Active" : "Paused"}
              variant={agent.enabled ? "success" : "warning"}
              size="sm"
            />
            {agent.delegationTier === "orchestrator" && (
              <Badge
                as="span"
                label="Orchestrator tier"
                variant="neutral"
                size="sm"
              />
            )}
          </div>
        </div>
      </div>

      {/* Right cluster — every action is an icon-in-bubble that expands
          into a labeled pill on hover / keyboard focus. Save stays
          visible at all times when the user can edit; it's disabled
          (quiet) when there's nothing to save, primary (filled) when
          there is, and shows "Saving…" with a forced-expanded label
          during the API call. */}
      <div className="ml-auto flex items-center gap-2">
        {canPromote && (
          <ExpandingAction
            icon={<ArrowUpIcon size={18} weight="bold" />}
            label={adminBusy === "promote" ? "Promoting…" : "Promote to global"}
            variant="secondary"
            onClick={onAdminPromote!}
            disabled={adminBusy !== null}
            forceExpanded={adminBusy === "promote"}
            title="Promote this agent to global (admin)"
          />
        )}
        {canDemote && (
          <ExpandingAction
            icon={<ArrowDownIcon size={18} weight="bold" />}
            label={adminBusy === "demote" ? "Demoting…" : "Demote to personal"}
            variant="secondary"
            onClick={onAdminDemote!}
            disabled={adminBusy !== null}
            forceExpanded={adminBusy === "demote"}
            title="Demote this agent to personal (admin)"
          />
        )}
        {canPublish && (
          <ExpandingAction
            icon={<GlobeIcon size={18} />}
            label={publishing ? "Publishing…" : "Publish to global"}
            variant="secondary"
            onClick={onPublish!}
            disabled={publishing}
            forceExpanded={publishing}
            title="Submit this agent for admin approval to make it global."
          />
        )}

        {onClone && (
          <ExpandingAction
            icon={<CopyIcon size={18} />}
            label={
              cloning
                ? (cloneNeedsApproval ? "Requesting…" : "Cloning…")
                : (cloneNeedsApproval ? "Request clone" : "Clone agent")
            }
            variant="ghost"
            onClick={onClone}
            disabled={cloning}
            forceExpanded={cloning}
            title={
              cloneNeedsApproval
                ? "Send a clone request to this agent's owner. A clone copies its prompt, tools, skills and knowledge-base grants — not their saved credentials."
                : "Create your own copy — prompt, tools, skills and knowledge base — in a new personal agent."
            }
          />
        )}

        <ExpandingAction
          icon={<ChatCircleIcon size={18} weight="fill" />}
          label="Chat with agent"
          variant="ghost"
          onClick={() => navigate(`/v3/chat?agent=${agent.slug}`)}
        />

        {permissions?.canEdit && (
          <ExpandingAction
            icon={<FloppyDiskIcon size={18} weight={dirty ? "fill" : "regular"} />}
            label={saving ? "Saving…" : "Save changes"}
            variant="primary"
            onClick={onSave}
            disabled={!dirty || saving}
            forceExpanded={saving}
            title={
              saving
                ? "Saving…"
                : dirty
                  ? "Save changes"
                  : "Nothing to save"
            }
          />
        )}

        {permissions?.canEdit && (
          // Switch + reveal-on-hover label. The state is already legible
          // from the toggle's color (green on / gray off), so the word
          // "Enabled" / "Paused" only fades in when the user hovers or
          // keyboard-focuses the cluster — matching the icon-bubble
          // expand pattern used by every other action here.
          <div className="group/sw flex items-center gap-1.5">
            <Switch
              checked={agent.enabled}
              onChange={onToggleEnabled}
              aria-label={agent.enabled ? "Enabled" : "Paused"}
            />
            <span
              className="overflow-hidden whitespace-nowrap text-[12px] font-medium text-xyne-fg-tertiary max-w-0 group-hover/sw:max-w-[80px] group-focus-within/sw:max-w-[80px] group-hover/sw:ml-0 transition-[max-width] duration-200 ease-out"
            >
              {agent.enabled ? "Enabled" : "Paused"}
            </span>
          </div>
        )}

        {permissions?.role === "owner" && (
          <>
            <div className="h-5 w-px bg-xyne-border-subtle" />
            <ExpandingAction
              icon={<TrashIcon size={18} />}
              label="Delete agent"
              variant="destructive"
              onClick={onDelete}
            />
          </>
        )}
      </div>
    </div>
  );
}
