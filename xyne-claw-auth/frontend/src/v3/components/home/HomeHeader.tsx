import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { XIcon } from "@phosphor-icons/react";
import { Skeleton } from "../ui/Skeleton";
import { getTimeGreeting } from "./homeUtils";
import type { Nudge } from "../../hooks/useHomeData";

interface HomeHeaderProps {
  firstName: string;
  orgName: string;
  todayRuns: number;
  todaySuccessRate: number | null;
  nudges: Nudge[];
  isLoading: boolean;
}

export function HomeHeader({
  firstName,
  orgName,
  todayRuns,
  todaySuccessRate,
  nudges,
  isLoading,
}: HomeHeaderProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visibleNudges = nudges.filter((n) => !dismissed.has(n.id));

  const handleDismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1 px-[20px] pt-[20px] pb-[10px]">
      <div className="flex justify-between items-start">
        <h1 className="text-[20px] font-semibold text-xyne-fg-primary">
          Good {getTimeGreeting()}, {firstName}
        </h1>
        {visibleNudges.length > 0 && (
          <div className="flex flex-col gap-1.5 items-end">
            {visibleNudges.map((nudge) => (
              <div
                key={nudge.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-xyne-warning-bg border border-xyne-warning-border"
              >
                <span className="text-[11px] text-xyne-warning-fg">
                  {nudge.message}
                </span>
                {nudge.action && (
                  <button
                    onClick={() => navigate(nudge.action!.href)}
                    className="text-[11px] font-medium text-xyne-warning underline underline-offset-2"
                  >
                    {nudge.action.label}
                  </button>
                )}
                <button
                  onClick={() => handleDismiss(nudge.id)}
                  className="text-xyne-warning-fg/70 hover:text-xyne-warning-fg"
                >
                  <XIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-48" />
        </div>
      ) : (
        <p className="text-[12px] text-xyne-fg-secondary">
          {orgName} workspace · {todayRuns} runs today ·{" "}
          {todaySuccessRate !== null ? `${todaySuccessRate}% success` : "—"}
        </p>
      )}
    </div>
  );
}