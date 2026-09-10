/**
 * HomeInsightStrip — compact row of three contextual insight cards.
 *
 * Tiles shown:
 *   1. Top agent today (most runs in the 1-day window)
 *   2. Yesterday's run total (context for morning reference)
 *   3. Resume — last session, click to open
 */

import { useNavigate } from "react-router-dom";
import {
  RobotIcon,
  ClockCountdownIcon,
  ArrowBendUpLeftIcon,
} from "@phosphor-icons/react";
import { Skeleton } from "../ui/Skeleton";
import type { UserDashboardAgentRow } from "../../../lib/api";
// lastRun comes from the lightweight projection (chart data, not RecentRunsCard).
// We only use channelId, conversationId, agentSlug, startedAt — all present in
// AgentRunLight. See useHomeData for the source of truth.
import type { AgentRunLight as AgentRun } from "../../../lib/api";
import type { AgentLight } from "../../../lib/types";
import { formatTimeAgo, truncate } from "./homeUtils";
import { spacesThreadUrl } from "../../../lib/spacesLink";


interface HomeInsightStripProps {
  topAgentToday: UserDashboardAgentRow | null;
  yesterdayRuns: number;
  isLoading: boolean;
  lastRun?: AgentRun | null;
  lastRunAgent?: AgentLight | null;
}

type TileAccent = "success" | "info" | "primary" | "neutral";

interface InsightTileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
  accent?: TileAccent;
}

const TILE_ACCENTS: Record<
  TileAccent,
  { iconBg: string; iconFg: string; ring: string }
> = {
  success: {
    iconBg: "bg-xyne-success-bg",
    iconFg: "text-xyne-success-fg",
    ring: "hover:border-xyne-success/40",
  },
  info: {
    iconBg: "bg-xyne-info-bg",
    iconFg: "text-xyne-info-fg",
    ring: "hover:border-xyne-info/40",
  },
  primary: {
    iconBg: "bg-xyne-fg-primary",
    iconFg: "text-xyne-fg-inverse",
    ring: "hover:border-xyne-fg-primary/40",
  },
  neutral: {
    iconBg: "bg-xyne-surface-sunken border border-xyne-border",
    iconFg: "text-xyne-fg-tertiary",
    ring: "hover:border-xyne-border-strong",
  },
};

function InsightTile({
  icon,
  label,
  value,
  sub,
  onClick,
  accent = "neutral",
}: InsightTileProps) {
  const Tag = onClick ? "button" : "div";
  const a = TILE_ACCENTS[accent];
  return (
    <Tag
      onClick={onClick}
      className={`flex items-center gap-[10px] flex-1 bg-xyne-surface border border-xyne-border rounded-[12px] px-[12px] py-[10px] min-w-0 text-left ${
        onClick ? `${a.ring} transition-colors cursor-pointer` : ""
      }`}
    >
      <div
        className={`w-[28px] h-[28px] rounded-full ${a.iconBg} ${a.iconFg} flex items-center justify-center flex-shrink-0`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-[1px]">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-xyne-fg-tertiary">
          {label}
        </span>
        <span className="text-[14px] font-medium text-xyne-fg-primary truncate leading-tight">
          {value}
        </span>
        {sub && (
          <span className="text-[11px] text-xyne-fg-tertiary truncate">{sub}</span>
        )}
      </div>
    </Tag>
  );
}

export function HomeInsightStrip({
  topAgentToday,
  yesterdayRuns,
  isLoading,
  lastRun,
  lastRunAgent,
}: HomeInsightStripProps) {
  const navigate = useNavigate();

  const hasTopAgent = topAgentToday !== null && topAgentToday.totalRuns > 0;
  const hasYesterdayTile = yesterdayRuns > 0;
  const hasResumeTile = !!lastRun;
  const hasAnything = hasTopAgent || hasYesterdayTile || hasResumeTile;

  if (!hasAnything && !isLoading) return null;

  if (isLoading) {
    return (
      <div className="flex gap-[10px]">
        <Skeleton className="h-[60px] flex-1 rounded-[12px]" />
        <Skeleton className="h-[60px] flex-1 rounded-[12px]" />
        <Skeleton className="h-[60px] flex-1 rounded-[12px]" />
      </div>
    );
  }

  const openLastRun = () => {
    if (!lastRun) return;
    if (lastRun.channelId && lastRun.conversationId) {
      window.open(
        spacesThreadUrl(lastRun.channelId, lastRun.conversationId),
        "_blank",
      );
    } else {
      navigate(`/v3/chat?agent=${lastRun.agentSlug}`);
    }
  };

  return (
    <div className="flex gap-[10px]">
      {hasTopAgent && (
        <InsightTile
          icon={<RobotIcon size={13} weight="fill" />}
          label="Top agent today"
          value={topAgentToday!.agentName}
          sub={`${topAgentToday!.totalRuns} run${topAgentToday!.totalRuns !== 1 ? "s" : ""}`}
          onClick={() => navigate("/v3/dashboard")}
          accent="success"
        />
      )}
      {hasYesterdayTile && (
        <InsightTile
          icon={<ClockCountdownIcon size={13} weight="fill" />}
          label="Yesterday"
          value={`${yesterdayRuns} run${yesterdayRuns !== 1 ? "s" : ""}`}
          sub="for context"
          accent="info"
        />
      )}
      {hasResumeTile && (
        <InsightTile
          icon={<ArrowBendUpLeftIcon size={13} weight="bold" />}
          label={`Resume · ${formatTimeAgo(lastRun!.startedAt)}`}
          value={lastRunAgent?.name ?? lastRun!.agentSlug}
          sub={truncate(lastRun!.task ?? "", 40)}
          onClick={openLastRun}
          accent="primary"
        />
      )}
    </div>
  );
}
