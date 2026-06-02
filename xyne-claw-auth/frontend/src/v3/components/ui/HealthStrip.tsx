import { useState, useEffect, useRef } from "react";
import {
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { SystemHealthStatus } from "../../hooks/useSystemHealth";

interface HealthStripProps {
  status: SystemHealthStatus;
  message: string;
}

const STATUS_CONFIG: Record<
  SystemHealthStatus,
  {
    icon: typeof CheckCircleIcon;
    bgClass: string;
    textClass: string;
    borderClass: string;
  }
> = {
  ok: {
    icon: CheckCircleIcon,
    bgClass: "bg-xyne-success-bg",
    textClass: "text-xyne-success-fg",
    borderClass: "border-xyne-success-border",
  },
  degraded: {
    icon: WarningIcon,
    bgClass: "bg-xyne-warning-bg",
    textClass: "text-xyne-warning-fg",
    borderClass: "border-xyne-warning-border",
  },
  critical: {
    icon: XCircleIcon,
    bgClass: "bg-xyne-error-bg",
    textClass: "text-xyne-error-fg",
    borderClass: "border-xyne-error-border",
  },
};

export function HealthStrip({ status, message }: HealthStripProps) {
  const [dismissedAtStatus, setDismissedAtStatus] =
    useState<SystemHealthStatus | null>(null);
  const prevStatusRef = useRef<SystemHealthStatus | null>(null);

  // Reset dismissal when status changes so the user sees state transitions
  useEffect(() => {
    if (
      prevStatusRef.current !== null &&
      prevStatusRef.current !== status
    ) {
      setDismissedAtStatus(null);
    }
    prevStatusRef.current = status;
  }, [status]);

  if (dismissedAtStatus === status) return null;

  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      data-id="health-strip"
      className={`flex shrink-0 items-center justify-between gap-4 border-b px-xyne-page-x py-xyne-2 ${config.bgClass} ${config.borderClass}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          data-id="health-strip-icon"
          size={16}
          weight="fill"
          className={config.textClass}
        />
        <span
          data-id="health-strip-message"
          className={`truncate text-sm font-medium ${config.textClass}`}
        >
          {message}
        </span>
      </div>

      <button
        data-id="health-strip-dismiss"
        onClick={() => setDismissedAtStatus(status)}
        className={`shrink-0 rounded p-1 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1 ${config.textClass}`}
        aria-label="Dismiss health status"
        title="Dismiss"
      >
        <XIcon size={14} weight="bold" />
      </button>
    </div>
  );
}
