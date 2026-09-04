/**
 * SessionDetailPanel — right-side slide-over that renders when a dot is clicked
 * on the SessionActivityChart.
 *
 * Shows: agent + status header, session metadata, conversation turns (task → result),
 * "Open thread" deep-link button, Export button, and a close control.
 */

import { useEffect, useRef } from "react";
import { spacesThreadUrl } from "../../../lib/spacesLink";
import {
  XIcon,
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  ChatCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
// Accepts the lightweight projection (used by the home chart's hover panel).
// Heavy fields (task/result/toolsUsed/tokens*) are rendered behind `&&` guards
// below, so they hide automatically when absent. Power users who want the
// full detail can open the Control Center for the same session.
import type { AgentRunLight as AgentRun } from "../../../lib/api";
import { exportSessionUrl } from "../../../lib/api";
import { formatTimeAgo } from "./homeUtils";


const AGENT_COLORS = [
  "#00E5FF","#00FF7F","#FFD700","#FF6B35",
  "#4D7CFF","#FF6B9D","#A78BFA","#FF4D4D",
];
function colorForAgent(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]!;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs % 60}s`;
}

export interface SessionPanelData {
  key: string;
  agentSlug: string;
  runs: AgentRun[];
  latest: AgentRun;
  first: AgentRun;
}

interface SessionDetailPanelProps {
  session: SessionPanelData;
  onClose: () => void;
}

const STATUS_CHIP: Record<string, string> = {
  completed: "bg-xyne-success/15 text-xyne-success-fg",
  failed:    "bg-xyne-error/15 text-xyne-error",
  running:   "bg-xyne-warning/15 text-xyne-warning-fg",
  cancelled: "bg-xyne-surface-sunken text-xyne-fg-tertiary",
};

export function SessionDetailPanel({ session, onClose }: SessionDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const color = colorForAgent(session.agentSlug);
  const status = session.latest.status;
  const turns = session.runs
    .slice()
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const totalDurationMs = turns.reduce((acc, r) => {
    const s = new Date(r.startedAt).getTime();
    const e = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
    return acc + Math.max(0, e - s);
  }, 0);
  const totalDurationStr = formatDuration(
    new Date(Date.now() - totalDurationMs).toISOString(),
    new Date().toISOString(),
  );
  const totalToolsUsed = turns.reduce((acc, r) => acc + (r.toolsUsed?.length ?? 0), 0);

  const openThread = () => {
    const run = session.first;
    if (run.channelId && run.conversationId) {
      window.open(
        spacesThreadUrl(run.channelId, run.conversationId),
        "_blank",
      );
    }
  };

  const canOpenThread = !!(session.first.channelId && session.first.conversationId);

  const handleExport = () => {
    const run = session.first;
    if (!run.conversationId) return;
    const url = exportSessionUrl(run.conversationId, session.agentSlug, "markdown");
    window.open(url, "_blank");
  };

  const canExport = !!session.first.conversationId;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
        style={{ animation: "fadeIn 0.2s ease-out" }}
        onClick={onClose}
      />

      {/* Panel — floating card with inset margins + rounded corners */}
      <div
        ref={panelRef}
        className="fixed right-[12px] top-[12px] bottom-[12px] z-50 w-[600px] bg-xyne-surface border border-xyne-border rounded-[20px] overflow-hidden flex flex-col"
        style={{
          boxShadow: "0 8px 48px rgba(0,0,0,0.18), 0 2px 12px rgba(0,0,0,0.10)",
          animation: "glideIn 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-[18px] py-[14px] border-b border-xyne-border shrink-0">
          {/* Left: dot + name + thread id — all inline */}
          <div className="flex items-center gap-[10px] min-w-0">
            <span
              className="w-[10px] h-[10px] rounded-full flex-shrink-0"
              style={{ background: color }}
            />
            <span className="text-[14px] font-semibold text-xyne-fg-primary flex-shrink-0">
              {session.agentSlug}
            </span>
            {session.first.conversationId && (
              <span className="text-[11px] text-xyne-fg-muted truncate opacity-50">
                <span className="not-italic">thread</span>
                <span className="font-mono"> · {session.first.conversationId}</span>
              </span>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-[5px] flex-shrink-0 ml-[12px]">
            {canOpenThread && (
              <button
                onClick={openThread}
                title="Open thread"
                className="w-[30px] h-[30px] flex items-center justify-center rounded-full border border-xyne-border text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary hover:border-xyne-border-strong transition-colors"
                aria-label="Open thread"
              >
                <ArrowSquareOutIcon size={13} />
              </button>
            )}
            {canExport && (
              <button
                onClick={handleExport}
                title="Export as markdown"
                className="w-[30px] h-[30px] flex items-center justify-center rounded-full border border-xyne-border text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary hover:border-xyne-border-strong transition-colors"
                aria-label="Export as markdown"
              >
                <DownloadSimpleIcon size={13} />
              </button>
            )}
            <button
              onClick={onClose}
              title="Close"
              className="w-[30px] h-[30px] flex items-center justify-center rounded-full border border-transparent text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary hover:border-xyne-border transition-colors"
              aria-label="Close"
            >
              <XIcon size={13} />
            </button>
          </div>
        </div>

        {/* ── Session metadata ───────────────────────────────── */}
        <div className="px-[18px] py-[10px] border-b border-xyne-border-subtle shrink-0">
          <div className="grid grid-cols-5 gap-[6px]">
            {(
              [
                {
                  label: "Started",
                  value: new Date(session.first.startedAt).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  }),
                },
                { label: "Last active", value: formatTimeAgo(session.latest.startedAt) },
                { label: "Duration",    value: totalDurationStr },
                { label: "Messages",    value: `${turns.length}` },
                { label: "Tools used",  value: totalToolsUsed > 0 ? `${totalToolsUsed}` : "—" },
              ] as { label: string; value: string }[]
            ).map(({ label, value }) => (
              <div
                key={label}
                className="flex flex-col gap-[3px] border border-xyne-border rounded-[8px] bg-xyne-surface-subtle px-[8px] py-[7px]"
              >
                <span className="text-[8px] font-medium uppercase tracking-[0.08em] text-xyne-fg-muted">
                  {label}
                </span>
                <span className="text-[11px] font-medium text-xyne-fg-primary leading-tight">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Conversation turns ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-[18px] py-[18px] flex flex-col gap-[20px]">
          {turns.map((run, i) => (
            <div key={run.id} className="flex flex-col gap-[8px]">
              {/* Turn index label */}
              {turns.length > 1 && (
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-muted">
                  Turn {i + 1}
                </span>
              )}

              {/* User message */}
              {run.task && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-xyne-brand text-xyne-fg-inverse rounded-[14px] rounded-tr-[4px] px-[12px] py-[8px] text-[13px] leading-[1.5]">
                    {run.task}
                  </div>
                </div>
              )}

              {/* Agent response */}
              {run.result && (
                <div className="flex justify-start">
                  <div className="max-w-[88%] bg-xyne-surface-sunken border border-xyne-border rounded-[14px] rounded-tl-[4px] px-[12px] py-[8px] text-[13px] leading-[1.5] text-xyne-fg-primary whitespace-pre-wrap">
                    {run.result}
                  </div>
                </div>
              )}

              {/* Turn metadata */}
              <div className="flex items-center gap-[8px] text-[10px] text-xyne-fg-muted px-[2px]">
                {run.toolsUsed && run.toolsUsed.length > 0 && (
                  <>
                    <WrenchIcon size={10} className="flex-shrink-0" />
                    <span>{run.toolsUsed.length} tool{run.toolsUsed.length !== 1 ? "s" : ""}</span>
                    <span>·</span>
                  </>
                )}
                {(run.tokensIn != null || run.tokensOut != null) && (
                  <>
                    <span>
                      {((run.tokensIn ?? 0) + (run.tokensOut ?? 0)).toLocaleString()} tok
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>{formatDuration(run.startedAt, run.completedAt)}</span>
                <span>·</span>
                <span className={
                  run.status === "failed" ? "text-xyne-error" :
                  run.status === "running" ? "text-xyne-warning-fg" :
                  "text-xyne-fg-muted"
                }>
                  {run.status}
                </span>
              </div>
            </div>
          ))}

          {turns.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 gap-[8px] text-xyne-fg-tertiary py-[40px]">
              <ChatCircleIcon size={24} />
              <span className="text-[13px]">No turns recorded</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes glideIn {
          from { transform: translateX(calc(100% + 16px)) scale(0.97); opacity: 0; }
          to   { transform: translateX(0) scale(1); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}
