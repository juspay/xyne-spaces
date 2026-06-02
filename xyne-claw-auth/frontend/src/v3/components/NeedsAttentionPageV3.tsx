/**
 * NeedsAttentionPageV3 — full-page operator queue.
 *
 * Unbounded list of attention items with filter chips by kind, severity grouping,
 * and bulk dismiss. Reuses AttentionItemCard from the home panel so the visual
 * row is identical across surfaces.
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useHomeData } from "../hooks/useHomeData";
import { useAttentionItems } from "../hooks/useAttentionItems";
import type {
  AttentionItem,
  AttentionSeverity,
} from "../hooks/useAttentionItems";
import {
  AttentionItemCard,
  type AttentionActionIntent,
} from "./home/AttentionItemCard";
import { useSnackbar } from "./ui/Snackbar";
import { Skeleton } from "./ui/Skeleton";
import {
  CheckCircleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import {
  approveControlCenterAction,
  rejectControlCenterAction,
  retryControlCenterRun,
} from "../../lib/api";

type KindFilter = "all" | AttentionItem["kind"];

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failure", label: "Failures" },
  { value: "approval", label: "Approvals" },
  { value: "outlier", label: "Outliers" },
  { value: "dt_review", label: "Digital Twin" },
  { value: "workflow", label: "Workflows" },
  { value: "ack", label: "Completed" },
];

const SEVERITY_LABEL: Record<AttentionSeverity, string> = {
  high: "Urgent",
  medium: "Watch",
  low: "Informational",
};

interface NeedsAttentionPageV3Props {
  userId: string;
}

export function NeedsAttentionPageV3(_props: NeedsAttentionPageV3Props) {
  const auth = useAuth();
  const data = useHomeData();
  const attention = useAttentionItems(data);
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();

  const [filter, setFilter] = useState<KindFilter>("all");
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
            const res = await retryControlCenterRun(intent.sessionId);
            showSnackbar({
              variant: "success",
              title: `Retrying ${res.agentSlug}`,
            });
            data.reload();
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
            data.reload();
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
            data.reload();
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
        case "ack-dismiss":
          setDismissedIds((prev) => new Set(prev).add(intent.itemId));
          return;
        case "view-logs":
          navigate("/v3/control-center");
          return;
        case "edit-approve":
          navigate("/v3/control-center?tab=approvals");
          return;
        case "investigate":
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
    [data, navigate, setBusy, showSnackbar],
  );

  const visibleItems = useMemo(() => {
    let list = attention.items.filter((it) => !dismissedIds.has(it.id));
    if (filter !== "all") {
      list = list.filter((it) => it.kind === filter);
    }
    return list;
  }, [attention.items, dismissedIds, filter]);

  const grouped = useMemo(() => {
    const groups: Record<AttentionSeverity, AttentionItem[]> = {
      high: [],
      medium: [],
      low: [],
    };
    visibleItems.forEach((it) => groups[it.severity].push(it));
    return groups;
  }, [visibleItems]);

  if (auth.status !== "authenticated") {
    return null;
  }

  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto">
      <div className="max-w-[900px] mx-auto px-[40px] py-[32px] w-full flex flex-col gap-[20px]">
        {/* Header */}
        <div className="flex flex-col gap-[6px]">
          <h1 className="text-[24px] font-medium text-xyne-fg-primary tracking-[-0.3px]">
            Needs attention
          </h1>
          <p className="text-[13px] text-xyne-fg-secondary">
            Failures, approvals, and anomalies across your workspace.
          </p>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-[6px] flex-wrap">
          {FILTERS.map((f) => {
            const isActive = filter === f.value;
            const count =
              f.value === "all"
                ? attention.items.filter((it) => !dismissedIds.has(it.id)).length
                : attention.items.filter(
                    (it) => it.kind === f.value && !dismissedIds.has(it.id),
                  ).length;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`text-[12px] px-[10px] py-[5px] rounded-full border transition-colors ${
                  isActive
                    ? "bg-xyne-fg-primary text-xyne-fg-inverse border-xyne-fg-primary"
                    : "bg-xyne-surface text-xyne-fg-secondary border-xyne-border hover:border-xyne-border-strong hover:text-xyne-fg-primary"
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span
                    className={`ml-[6px] ${
                      isActive
                        ? "text-xyne-fg-inverse/70"
                        : "text-xyne-fg-tertiary"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        {data.isLoading ? (
          <div className="flex flex-col gap-[8px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-[12px] p-[12px] rounded-[10px] bg-xyne-surface border border-xyne-border-subtle border-l-[3px] border-l-xyne-border"
              >
                <Skeleton className="h-[28px] w-[28px] rounded-full" />
                <div className="flex-1 flex flex-col gap-[6px]">
                  <Skeleton className="h-[13px] w-[50%]" />
                  <Skeleton className="h-[11px] w-[30%]" />
                </div>
                <Skeleton className="h-[24px] w-[64px] rounded-[8px]" />
              </div>
            ))}
          </div>
        ) : data.error ? (
          <div className="flex items-center gap-[10px] p-[14px] rounded-[10px] bg-xyne-error-bg/40 border border-xyne-error-border">
            <WarningOctagonIcon
              size={18}
              className="text-xyne-error-fg flex-shrink-0"
            />
            <div className="flex-1 text-[12px] text-xyne-error-fg">
              Couldn't load attention items
            </div>
            <button
              onClick={data.reload}
              className="text-[12px] px-[10px] py-[5px] rounded-[8px] border border-xyne-error-border text-xyne-error-fg hover:bg-xyne-error-bg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex items-center gap-[12px] p-[18px] rounded-[12px] bg-xyne-success-bg/40 border border-xyne-success-border">
            <CheckCircleIcon
              size={22}
              className="text-xyne-success-fg flex-shrink-0"
            />
            <div className="flex flex-col gap-[2px] min-w-0 flex-1">
              <span className="text-[14px] font-medium text-xyne-fg-primary">
                All clear
              </span>
              <span className="text-[12px] text-xyne-fg-secondary">
                {filter === "all"
                  ? "Nothing needs your attention right now."
                  : `No items in this filter.`}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[20px]">
            {(["high", "medium", "low"] as AttentionSeverity[]).map((sev) => {
              const list = grouped[sev];
              if (list.length === 0) return null;
              return (
                <div key={sev} className="flex flex-col gap-[8px]">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
                    {SEVERITY_LABEL[sev]} · {list.length}
                  </span>
                  {list.map((item) => (
                    <AttentionItemCard
                      key={item.id}
                      item={item}
                      busy={
                        busyIds.has(item.id) ||
                        busyIds.has(
                          item.kind === "approval"
                            ? item.approvalId
                            : item.id,
                        )
                      }
                      onAction={handleAction}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
