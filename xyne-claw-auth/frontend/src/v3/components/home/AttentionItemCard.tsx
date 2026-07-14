/**
 * AttentionItemCard — single row in the Needs Attention list.
 *
 * Presentational: switches layout on `item.kind`, emits action intents up.
 * Severity drives the left-border accent. Title/subtitle copy is plain-language.
 */

import {
  WarningCircleIcon,
  ShieldCheckIcon,
  TrendDownIcon,
  UserCircleIcon,
  GitBranchIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  XIcon,
} from "@phosphor-icons/react";
import type {
  AttentionItem,
  AttentionSeverity,
} from "../../hooks/useAttentionItems";
import { formatTimeAgo } from "./homeUtils";

export type AttentionActionIntent =
  | { type: "retry"; sessionId: string; itemId: string }
  | { type: "dismiss"; itemId: string }
  | { type: "view-logs"; sessionId: string }
  | { type: "approve"; approvalId: string }
  | { type: "reject"; approvalId: string }
  | { type: "edit-approve"; approvalId: string; sessionId: string }
  | { type: "open-agent-requests"; agentSlug: string }
  | { type: "investigate"; agentSlug: string }
  | { type: "open-workflow"; workflowId: string }
  | { type: "ack-view"; runId?: string; itemId: string }
  | { type: "ack-dismiss"; itemId: string };

interface AttentionItemCardProps {
  item: AttentionItem;
  busy?: boolean;
  onAction: (intent: AttentionActionIntent) => void;
  /** Compact variant for narrow containers (e.g. the right rail). */
  compact?: boolean;
}

const SEVERITY_ACCENT: Record<AttentionSeverity, string> = {
  high: "border-l-xyne-error",
  medium: "border-l-xyne-warning",
  low: "border-l-xyne-border-strong",
};

const KIND_ICON = {
  failure: WarningCircleIcon,
  approval: ShieldCheckIcon,
  agent_approval: ShieldCheckIcon,
  outlier: TrendDownIcon,
  dt_review: UserCircleIcon,
  workflow: GitBranchIcon,
  ack: CheckCircleIcon,
} as const;

const KIND_ICON_TINT: Record<AttentionItem["kind"], string> = {
  failure: "text-xyne-error",
  approval: "text-xyne-warning-fg",
  agent_approval: "text-xyne-warning-fg",
  outlier: "text-xyne-warning",
  dt_review: "text-xyne-fg-secondary",
  workflow: "text-xyne-warning",
  ack: "text-xyne-success-fg",
};

function titleFor(item: AttentionItem): string {
  switch (item.kind) {
    case "failure":
      return `${item.agentName} couldn't finish a task`;
    case "approval":
      return `${item.agentName} needs your go-ahead`;
    case "agent_approval":
      return item.requestKind === "clone"
        ? `${item.agentName} has a clone request`
        : `${item.agentName} has a delegation request`;
    case "outlier":
      return `${item.agentName} is performing below normal`;
    case "dt_review":
      return `${item.pendingCount} Digital Twin memor${item.pendingCount === 1 ? "y" : "ies"} to review`;
    case "workflow":
      return `${item.failedCount} scheduled run${item.failedCount > 1 ? "s" : ""} failed today`;
    case "ack":
      return item.taskName;
  }
}

function subtitleFor(item: AttentionItem): string {
  switch (item.kind) {
    case "failure":
      return item.errorSummary;
    case "approval":
      return `${item.action} on ${item.targetSystem}`;
    case "agent_approval":
      return item.requestKind === "clone"
        ? `${item.requesterName} wants to clone this agent`
        : `${item.requesterName} wants to delegate to this agent`;
    case "outlier":
      return `${item.value}% success this month · usually >${item.threshold}%`;
    case "dt_review":
      return "Review and approve candidates in Digital Twin";
    case "workflow":
      return "Check workflows for failing steps";
    case "ack":
      return item.resultSummary;
  }
}

function isFresh(occurredAt: string): boolean {
  return Date.now() - new Date(occurredAt).getTime() < 60 * 60 * 1000;
}

function PrimaryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[12px] px-[10px] py-[5px] rounded-[8px] bg-xyne-fg-primary text-xyne-fg-inverse hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
    >
      {label}
    </button>
  );
}

function SecondaryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[12px] px-[10px] py-[5px] rounded-[8px] border border-xyne-border text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
    >
      {label}
    </button>
  );
}

function GhostLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[12px] text-xyne-fg-tertiary hover:text-xyne-fg-secondary flex items-center gap-[3px] flex-shrink-0"
    >
      {label}
      <ArrowRightIcon size={11} />
    </button>
  );
}

function ActionsFor({
  item,
  busy,
  onAction,
}: {
  item: AttentionItem;
  busy?: boolean;
  onAction: (intent: AttentionActionIntent) => void;
}) {
  switch (item.kind) {
    case "failure":
      return (
        <div className="flex items-center gap-[6px]">
          <PrimaryButton
            label="Retry"
            disabled={busy}
            onClick={() =>
              onAction({
                type: "retry",
                sessionId: item.sessionId,
                itemId: item.id,
              })
            }
          />
          <GhostLink
            label="Logs"
            onClick={() =>
              onAction({ type: "view-logs", sessionId: item.sessionId })
            }
          />
        </div>
      );
    case "approval":
      return (
        <div className="flex items-center gap-[6px]">
          {item.canQuickApprove ? (
            <PrimaryButton
              label="Approve"
              disabled={busy}
              onClick={() =>
                onAction({ type: "approve", approvalId: item.approvalId })
              }
            />
          ) : (
            <GhostLink
              label="Edit & approve"
              onClick={() =>
                onAction({
                  type: "edit-approve",
                  approvalId: item.approvalId,
                  sessionId: item.sessionId,
                })
              }
            />
          )}
          <SecondaryButton
            label="Reject"
            disabled={busy}
            onClick={() =>
              onAction({ type: "reject", approvalId: item.approvalId })
            }
          />
        </div>
      );
    case "agent_approval":
      return (
        <GhostLink
          label="Review"
          onClick={() =>
            onAction({ type: "open-agent-requests", agentSlug: item.agentSlug })
          }
        />
      );
    case "outlier":
      return (
        <GhostLink
          label="Investigate"
          onClick={() =>
            onAction({ type: "investigate", agentSlug: item.agentSlug })
          }
        />
      );
    case "dt_review":
      return (
        <GhostLink
          label="Review"
          onClick={() => onAction({ type: "investigate", agentSlug: "dt" })}
        />
      );
    case "workflow":
      return (
        <GhostLink
          label="View workflows"
          onClick={() => onAction({ type: "open-workflow", workflowId: "" })}
        />
      );
    case "ack":
      return (
        <div className="flex items-center gap-[6px]">
          <SecondaryButton
            label="View"
            onClick={() =>
              onAction({
                type: "ack-view",
                runId: item.runId,
                itemId: item.id,
              })
            }
          />
          <button
            onClick={() =>
              onAction({ type: "ack-dismiss", itemId: item.id })
            }
            className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <XIcon size={12} />
          </button>
        </div>
      );
  }
}

export function AttentionItemCard({
  item,
  busy,
  onAction,
  compact,
}: AttentionItemCardProps) {
  const Icon = KIND_ICON[item.kind];
  const accent = SEVERITY_ACCENT[item.severity];
  const iconTint = KIND_ICON_TINT[item.kind];
  const fresh = isFresh(item.occurredAt);

  if (compact) {
    return (
      <div
        className={`flex flex-col gap-[8px] p-[10px] rounded-[10px] bg-xyne-surface border border-xyne-border-subtle border-l-[3px] ${accent} hover:bg-xyne-surface-sunken/40 transition-colors`}
        data-id={`attention-item-${item.kind}`}
      >
        <div className="flex items-start gap-[8px] min-w-0">
          <div
            className={`w-[22px] h-[22px] rounded-full bg-xyne-surface-sunken border border-xyne-border flex items-center justify-center flex-shrink-0 ${iconTint}`}
          >
            <Icon size={12} weight="regular" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
            <div className="flex items-center gap-[5px] min-w-0">
              <span className="text-[12px] font-medium text-xyne-fg-primary leading-tight line-clamp-2">
                {titleFor(item)}
              </span>
              {fresh && (
                <span
                  className="w-[5px] h-[5px] rounded-full bg-xyne-warning flex-shrink-0 mt-[1px]"
                  aria-label="Fresh"
                />
              )}
            </div>
            <div className="text-[10px] text-xyne-fg-tertiary line-clamp-1">
              {subtitleFor(item)}
              <span className="mx-[4px]">·</span>
              {formatTimeAgo(item.occurredAt)}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-[5px]">
          <ActionsFor item={item} busy={busy} onAction={onAction} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-[12px] p-[12px] rounded-[10px] bg-xyne-surface border border-xyne-border-subtle border-l-[3px] ${accent} hover:bg-xyne-surface-sunken/40 transition-colors`}
      data-id={`attention-item-${item.kind}`}
    >
      <div
        className={`w-[28px] h-[28px] rounded-full bg-xyne-surface-sunken border border-xyne-border flex items-center justify-center flex-shrink-0 ${iconTint}`}
      >
        <Icon size={14} weight="regular" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
        <div className="flex items-center gap-[6px] min-w-0">
          <span className="text-[13px] font-medium text-xyne-fg-primary truncate">
            {titleFor(item)}
          </span>
          {fresh && (
            <span
              className="w-[5px] h-[5px] rounded-full bg-xyne-warning flex-shrink-0"
              aria-label="Fresh"
            />
          )}
        </div>
        <div className="text-[11px] text-xyne-fg-tertiary truncate">
          {subtitleFor(item)}
          <span className="mx-[5px]">·</span>
          {formatTimeAgo(item.occurredAt)}
        </div>
      </div>
      <ActionsFor item={item} busy={busy} onAction={onAction} />
    </div>
  );
}
