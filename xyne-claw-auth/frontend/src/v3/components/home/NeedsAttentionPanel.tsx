/**
 * NeedsAttentionPanel — primary surface on Home.
 *
 * Shows top-N attention items mixed across kinds, sorted by severity bucket then
 * freshness. Inline actions wire through to control-center / DT handlers via
 * AttentionActionIntent. Deep-link intents navigate; mutating intents call the API.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  WarningOctagonIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import { Skeleton } from "../ui/Skeleton";
import { useSnackbar } from "../ui/Snackbar";
import {
  approveControlCenterAction,
  rejectControlCenterAction,
  retryControlCenterRun,
} from "../../../lib/api";
import type { AttentionItem } from "../../hooks/useAttentionItems";
import {
  AttentionItemCard,
  type AttentionActionIntent,
} from "./AttentionItemCard";

const HOME_LIMIT = 3;

interface NeedsAttentionPanelProps {
  items: AttentionItem[];
  total: number;
  isLoading: boolean;
  error: string | null;
  onReload: () => void;
  /** Render rows in compact mode for narrow containers (right rail). */
  compact?: boolean;
}

export function NeedsAttentionPanel({
  items,
  total,
  isLoading,
  error,
  onReload,
  compact,
}: NeedsAttentionPanelProps) {
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleAction = useCallback(
    async (intent: AttentionActionIntent) => {
      switch (intent.type) {
        case "retry": {
          setBusy(intent.itemId, true);
          try {
            const data = await retryControlCenterRun(intent.sessionId);
            showSnackbar({
              variant: "success",
              title: `Retrying ${data.agentSlug}`,
            });
            onReload();
          } catch (err) {
            showSnackbar({
              variant: "error",
              title: err instanceof Error ? err.message : "Retry failed",
            });
          } finally {
            setBusy(intent.itemId, false);
          }
          return;
        }
        case "approve": {
          setBusy(intent.approvalId, true);
          try {
            await approveControlCenterAction(intent.approvalId);
            showSnackbar({ variant: "success", title: "Approved" });
            onReload();
          } catch (err) {
            showSnackbar({
              variant: "error",
              title: err instanceof Error ? err.message : "Approval failed",
            });
          } finally {
            setBusy(intent.approvalId, false);
          }
          return;
        }
        case "reject": {
          setBusy(intent.approvalId, true);
          try {
            await rejectControlCenterAction(intent.approvalId);
            showSnackbar({ variant: "success", title: "Rejected" });
            onReload();
          } catch (err) {
            showSnackbar({
              variant: "error",
              title: err instanceof Error ? err.message : "Rejection failed",
            });
          } finally {
            setBusy(intent.approvalId, false);
          }
          return;
        }
        case "dismiss":
        case "ack-dismiss": {
          setDismissedIds((prev) => new Set(prev).add(intent.itemId));
          return;
        }
        case "view-logs":
          navigate("/v3/control-center");
          return;
        case "edit-approve":
          navigate("/v3/control-center?tab=approvals");
          return;
        case "investigate":
          // DT review uses agentSlug "dt" as a sentinel; route accordingly.
          if (intent.agentSlug === "dt") {
            navigate("/v3/digital-twin");
          } else {
            navigate("/v3/dashboard");
          }
          return;
        case "open-workflow":
          navigate("/v3/workflows");
          return;
        case "ack-view":
          navigate("/v3/control-center");
          return;
      }
    },
    [navigate, onReload, setBusy, showSnackbar],
  );

  const visible = items
    .filter((it) => !dismissedIds.has(it.id))
    .slice(0, HOME_LIMIT);
  const visibleTotal = total - dismissedIds.size;

  const hasItems = !isLoading && visibleTotal > 0;
  const allClear = !isLoading && !error && visibleTotal === 0;

  return (
    <div
      className={`bg-xyne-surface rounded-[16px] overflow-hidden border ${
        hasItems ? "border-xyne-warning-border"
        : allClear ? "border-xyne-success-border"
        : "border-xyne-border"
      }`}
    >
      <div
        className={`flex items-center justify-between px-[16px] py-[12px] border-b ${
          hasItems ? "bg-xyne-warning-bg/60 border-xyne-warning-border"
          : allClear ? "bg-xyne-success-bg/50 border-xyne-success-border"
          : "border-xyne-border-subtle"
        }`}
      >
        <div className="flex items-center gap-[8px]">
          {allClear && <CheckCircleIcon size={13} className="text-xyne-success-fg" weight="fill" />}
          <span
            className={`text-[11px] font-medium uppercase tracking-[0.08em] ${
              hasItems ? "text-xyne-warning-fg"
              : allClear ? "text-xyne-success-fg"
              : "text-xyne-fg-tertiary"
            }`}
          >
            Needs attention
          </span>
          {hasItems && (
            <span className="text-[11px] font-semibold text-xyne-warning-fg bg-xyne-surface border border-xyne-warning-border rounded-full px-[8px] py-[1px]">
              {visibleTotal}
            </span>
          )}
        </div>
      </div>

      <div className="p-[12px] flex flex-col gap-[8px]">
        {isLoading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-[12px] p-[12px] rounded-[10px] bg-xyne-surface border border-xyne-border-subtle border-l-[3px] border-l-xyne-border"
              >
                <Skeleton className="h-[28px] w-[28px] rounded-full flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-[6px]">
                  <Skeleton className="h-[13px] w-[60%]" />
                  <Skeleton className="h-[11px] w-[40%]" />
                </div>
                <Skeleton className="h-[24px] w-[64px] rounded-[8px]" />
              </div>
            ))}
          </>
        ) : visible.length > 0 ? (
          <>
            {visible.map((item) => (
              <AttentionItemCard
                key={item.id}
                item={item}
                busy={busyIds.has(item.id) || busyIds.has(
                  item.kind === "approval" ? item.approvalId : item.id,
                )}
                onAction={handleAction}
                compact={compact}
              />
            ))}
          </>
        ) : error ? (
          <div className="flex items-center gap-[10px] p-[12px] rounded-[10px] bg-xyne-error-bg/40 border border-xyne-error-border">
            <WarningOctagonIcon
              size={18}
              className="text-xyne-error-fg flex-shrink-0"
            />
            <div className="flex-1 text-[12px] text-xyne-error-fg">
              Couldn't load attention items
            </div>
            <button
              onClick={onReload}
              className="text-[12px] px-[10px] py-[5px] rounded-[8px] border border-xyne-error-border text-xyne-error-fg hover:bg-xyne-error-bg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-[8px] py-[10px] px-[4px] text-[12px] font-medium text-xyne-success-fg">
            <CheckCircleIcon size={14} weight="fill" className="flex-shrink-0 opacity-80" />
            All clear — nothing needs attention right now.
          </div>
        )}
      </div>
    </div>
  );
}
