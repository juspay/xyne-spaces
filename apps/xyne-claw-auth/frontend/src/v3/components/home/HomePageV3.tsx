/**
 * HomePageV3 — monitoring-first home.
 *
 * Layout (top → bottom in main area):
 *   1. Greeting + workspace meta line
 *   2. HomeLivePulse          ← today's run signals
 *   3. HomePickupRow          ← resume + frequent agents (launch one-click-away)
 *   4. Recent runs (compact)
 *
 * Right column (hero attention surface):
 *   - NeedsAttentionPanel     ← compact variant, top 3 items, "View all" footer
 *   - WorkspaceSnapshot       ← configuration counts
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../hooks/useAuth";
import { useHomeData } from "../../hooks/useHomeData";
import { useAttentionItems } from "../../hooks/useAttentionItems";
import { SplashV3 } from "../SplashV3";
import {
  getTimeGreeting,
  getRunsWindowLabel,
  isCalendarDayMode,
} from "./homeUtils";
import { Skeleton } from "../ui/Skeleton";
import { NeedsAttentionPanel } from "./NeedsAttentionPanel";
import { HomeInsightStrip } from "./HomeInsightStrip";
import { SessionActivityChart } from "./SessionActivityChart";
import { NextScheduledPeek } from "./NextScheduledPeek";
import { WorkspaceSnapshot } from "./HomeRightRail";
import { RecentRunsCard } from "./RecentRunsCard";

interface HomePageV3Props {
  userId: string;
}

/**
 * Module-scoped guard: distinguishes a fresh page load (direct URL hit or
 * browser refresh) from a same-session navigation via react-router. The
 * variable lives for the lifetime of the JS bundle — i.e. one tab — so:
 *   - Direct URL / refresh   → bundle reloads → splashSeen = false  → splash plays
 *   - react-router back/forward / link nav → bundle stays → splashSeen = true → no splash
 */
let splashSeen = false;

export function HomePageV3({ userId }: HomePageV3Props) {
  const auth = useAuth();
  const navigate = useNavigate();
  const data = useHomeData();
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const attention = useAttentionItems(data);

  // Splash plays only on the FIRST mount of HomePageV3 within a fresh page
  // load. Subsequent mounts (back from another route, link nav, etc.) see
  // splashSeen=true and skip it. A full reload / direct URL hit rebuilds
  // the bundle → splashSeen resets to false → splash plays again.
  const [splashDone, setSplashDone] = useState(() => splashSeen);
  const handleSplashDone = () => {
    splashSeen = true;
    setSplashDone(true);
  };

  const firstName =
    auth.status === "authenticated"
      ? (auth.user.name.split(" ")[0] ?? auth.user.name)
      : "";
  const greeting = `Good ${getTimeGreeting()}`;
  const windowLabel = getRunsWindowLabel();
  const calendarMode = isCalendarDayMode();
  const headlineRuns = calendarMode ? data.todayCalendarRuns : data.todayRuns;

  const lastRunAgent = data.lastRun
    ? data.agents.find((a) => a.slug === data.lastRun!.agentSlug) ?? null
    : null;

  const pendingApprovals = data.approvals.length + data.cloneApprovals.length + data.delegationApprovals.length;

  return (
    <div className="flex-1 overflow-x-hidden overflow-y-auto">
      {!splashDone && <SplashV3 onDone={handleSplashDone} />}
      <div className="max-w-[1180px] mx-auto px-[40px] pt-[32px] pb-[56px] w-full">
        <div className="flex gap-[28px] items-start">
          {/* ═══════════════ LEFT COLUMN ═══════════════ */}
          <div className="flex flex-col gap-[24px] flex-1 min-w-0">
            {/* Greeting */}
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-center gap-[10px]">
                <h1 className="text-[28px] font-medium text-xyne-fg-primary tracking-[-0.3px]">
                  {greeting}, {firstName}
                </h1>
                {!data.isLoading && pendingApprovals > 0 && (
                  <button
                    onClick={() => navigate("/v3/control-center?tab=approvals")}
                    className="flex items-center gap-[5px] px-[10px] py-[4px] rounded-full bg-xyne-error-bg border border-xyne-error-border text-xyne-error-fg hover:brightness-[0.97] transition-all flex-shrink-0"
                    title="Pending approvals"
                  >
                    <span className="w-[6px] h-[6px] rounded-full bg-xyne-error flex-shrink-0 animate-pulse" />
                    <span className="text-[12px] font-semibold">
                      {pendingApprovals} pending
                    </span>
                  </button>
                )}
              </div>
              {data.isLoading ? (
                <Skeleton className="h-[13px] w-64" />
              ) : (
                <p className="text-[13px] text-xyne-fg-secondary">
                  {windowLabel}
                  <span className="mx-[6px] text-xyne-fg-tertiary">·</span>
                  {data.uniqueSessionsToday} session{data.uniqueSessionsToday !== 1 ? "s" : ""}
                  {data.activeWorkflows > 0 && (
                    <>
                      <span className="mx-[6px] text-xyne-fg-tertiary">·</span>
                      {data.activeWorkflows} workflow
                      {data.activeWorkflows !== 1 ? "s" : ""} active
                    </>
                  )}
                </p>
              )}
            </div>

            {/* Insight strip: top agent + yesterday context + resume */}
            <HomeInsightStrip
              topAgentToday={data.topAgentToday}
              yesterdayRuns={data.yesterdayRuns}
              isLoading={data.isLoading}
              lastRun={data.lastRun}
              lastRunAgent={lastRunAgent}
            />

            {/* Next scheduled peek */}
            <NextScheduledPeek
              job={data.nextScheduledJob}
              agents={data.agents}
              isLoading={data.isLoading}
            />

            {/* Recent runs — heavy fields (task/result/error/toolsUsed)
                come from data.recentRuns (full payload, limit 10), NOT
                data.runs (light projection used by the chart). */}
            <RecentRunsCard
              runs={data.recentRuns}
              agents={data.agents}
              userId={userId}
              isLoading={data.isLoading}
              days={days}
            />

            {/* Session activity chart */}
            <SessionActivityChart
              runs={data.runs}
              isLoading={data.isLoading}
              days={days}
              onDaysChange={setDays}
            />

          </div>

          {/* ═══════════════ RIGHT COLUMN ═══════════════ */}
          <div className="w-[320px] flex-shrink-0 flex flex-col gap-[14px] sticky top-[32px]">
            <WorkspaceSnapshot
              agents={data.agents.length}
              personalAgents={data.personalAgents}
              sharedAgents={data.sharedAgents}
              skills={data.skills.length}
              personalSkills={data.personalSkills}
              inBuiltSkills={data.inBuiltSkills}
              mcps={data.servers.length}
              connectedMcps={data.connectedMcps}
              gateways={data.gateways.length}
              enabledGateways={data.enabledGateways}
              newSinceLastVisit={data.newSinceLastVisit}
              isLoading={data.isLoading}
            />
            <NeedsAttentionPanel
              items={attention.items}
              total={attention.total}
              isLoading={data.isLoading}
              error={data.attentionLoadError ? "Failed to load runs or approvals." : null}
              onReload={data.reload}
              compact
            />
          </div>
        </div>
      </div>
    </div>
  );
}
