import { useNavigate } from "react-router-dom";
import { WarningCircleIcon, ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import type { OutlierAgent } from "../../hooks/useHomeData";

interface HomeOutlierAlertProps {
  outlierAgent: OutlierAgent | null;
}

export function HomeOutlierAlert({ outlierAgent }: HomeOutlierAlertProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-[14px] py-[10px] border-b border-xyne-border-subtle">
        <span className="text-[12px] font-medium text-xyne-fg-primary">
          Needs attention
        </span>
        <button
          onClick={() => navigate("/v3/dashboard")}
          className="flex items-center gap-1 text-[11px] text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors"
        >
          View Dashboard <ArrowRightIcon size={12} />
        </button>
      </div>
      <div className="px-[14px] py-[10px] flex flex-col gap-2">
        {outlierAgent ? (
          <>
            <div
              onClick={() => navigate("/v3/dashboard")}
              className="flex items-center gap-3 p-3 rounded-lg bg-xyne-warning-bg/50 cursor-pointer hover:bg-xyne-warning-bg transition-colors"
            >
              <WarningCircleIcon size={20} className="text-xyne-warning shrink-0" />
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-[12px] font-medium text-xyne-fg-primary">
                  {outlierAgent.name}
                </span>
                <span className="text-[11px] text-xyne-warning">
                  {Math.round(outlierAgent.successRate * 100)}% success rate this month · below 80% threshold
                </span>
              </div>
              <ArrowRightIcon size={14} className="text-xyne-fg-tertiary shrink-0" />
            </div>
            <p className="text-[11px] text-xyne-fg-tertiary px-1">
              All other agents performing above threshold.
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-xyne-success-bg/40">
            <CheckCircleIcon size={20} className="text-xyne-success shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-[12px] font-medium text-xyne-fg-primary">
                All agents healthy
              </span>
              <span className="text-[11px] text-xyne-fg-secondary">
                Every agent is performing above the 80% success threshold.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
