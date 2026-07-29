/**
 * HomeRightRail — compact right-column cards.
 *
 * Currently exports:
 *   - WorkspaceSnapshot: configuration counts (agents, skills, MCPs, gateways)
 */

import { useNavigate } from "react-router-dom";
import { Skeleton } from "../ui/Skeleton";
import type { NewSinceLastVisit } from "../../hooks/useHomeData";

interface WorkspaceSnapshotProps {
  agents: number;
  personalAgents: number;
  sharedAgents: number;
  skills: number;
  personalSkills: number;
  inBuiltSkills: number;
  /** Total MCP servers visible to this user (catalog). */
  mcps: number;
  /** MCPs the user has actually connected (UserConnection rows). */
  connectedMcps: number;
  gateways: number;
  enabledGateways: number;
  newSinceLastVisit: NewSinceLastVisit;
  isLoading: boolean;
}

function NewBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-[9px] font-semibold bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20 rounded-full px-[6px] py-[1px] flex-shrink-0">
      +{count} new
    </span>
  );
}

const STAT_TONES: Record<
  "ok" | "warn" | "bad" | "neutral",
  { rail: string; subFg: string }
> = {
  ok:      { rail: "bg-xyne-success",        subFg: "text-xyne-success-fg" },
  warn:    { rail: "bg-xyne-warning",         subFg: "text-xyne-warning-fg" },
  bad:     { rail: "bg-xyne-error",           subFg: "text-xyne-error" },
  neutral: { rail: "bg-xyne-border-strong",   subFg: "text-xyne-fg-tertiary" },
};

function StatRow({
  label,
  value,
  sub,
  subTone,
  newCount,
  onClick,
}: {
  label: string;
  value: number;
  sub: string;
  subTone: "ok" | "warn" | "bad" | "neutral";
  newCount?: number;
  onClick: () => void;
}) {
  const t = STAT_TONES[subTone];
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between w-full py-[6px] hover:bg-xyne-surface-sunken/40 rounded-[6px] px-[4px] -mx-[4px] transition-colors text-left relative"
    >
      <span
        className={`absolute left-[-4px] top-[10px] bottom-[10px] w-[2px] rounded-r-full ${t.rail} opacity-60 group-hover:opacity-100 transition-opacity`}
        aria-hidden
      />
      <div className="flex items-center gap-[10px] pl-[4px]">
        <span className="text-[20px] font-medium text-xyne-fg-primary leading-none tabular-nums w-[26px] text-right">
          {value}
        </span>
        <span className="text-[12px] text-xyne-fg-secondary">{label}</span>
        {newCount !== undefined && <NewBadge count={newCount} />}
      </div>
      <span className={`text-[11px] ${t.subFg}`}>
        {sub}
      </span>
    </button>
  );
}

export function WorkspaceSnapshot({
  agents,
  personalAgents,
  sharedAgents,
  skills,
  personalSkills,
  inBuiltSkills,
  mcps,
  connectedMcps,
  gateways,
  enabledGateways,
  newSinceLastVisit,
  isLoading,
}: WorkspaceSnapshotProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="bg-xyne-surface border border-xyne-border rounded-[14px] p-[14px] flex flex-col gap-[8px]">
        <Skeleton className="h-[11px] w-[80px]" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[22px] w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-[14px] p-[14px] flex flex-col gap-[6px]">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary mb-[2px]">
        Workspace
      </span>
      <StatRow
        label="Agents"
        value={agents}
        sub={`${personalAgents} yours · ${sharedAgents} shared`}
        subTone="neutral"
        newCount={newSinceLastVisit.agents}
        onClick={() => navigate("/v3/agents")}
      />
      <StatRow
        label="Skills"
        value={skills}
        sub={`${personalSkills} yours · ${inBuiltSkills} in-built`}
        subTone="neutral"
        newCount={newSinceLastVisit.skills}
        onClick={() => navigate("/v3/skills")}
      />
      <StatRow
        label={connectedMcps === 1 ? "Integration connected" : "Integrations connected"}
        value={connectedMcps}
        sub={mcps > 0 ? `of ${mcps} available` : "none configured"}
        subTone={connectedMcps > 0 ? "ok" : mcps > 0 ? "warn" : "neutral"}
        newCount={newSinceLastVisit.mcps}
        onClick={() => navigate("/v3/mcp")}
      />
      <StatRow
        label={enabledGateways === 1 ? "Channel enabled" : "Channels enabled"}
        value={enabledGateways}
        sub={gateways > 0 ? `of ${gateways} configured` : "none configured"}
        subTone={
          enabledGateways > 0 ? "ok" : gateways > 0 ? "bad" : "neutral"
        }
        onClick={() => navigate("/v3/gateways")}
      />
    </div>
  );
}

