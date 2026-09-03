import { useState } from "react";
import {
  CircleDashedIcon,
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
  CaretRightIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import type { AgentRunListItem } from "../../../lib/api";
import { runOwnerLabel, triggerLabel, shortSessionId } from "../../lib/runFormat";
import { formatTimeAgo, formatDuration, truncate } from "../home/homeUtils";

// Status icon size bumped from 16 → 22 and switched to filled weight so it
// reads as a real status anchor (replaces the old text "completed" badge).
export function StatusIcon({ status }: { status: AgentRunListItem["status"] }) {
  switch (status) {
    case "running":
      return <CircleDashedIcon size={22} className="animate-spin text-xyne-info" />;
    case "completed":
      return <CheckCircleIcon size={22} weight="fill" className="text-xyne-success" />;
    case "failed":
      return <XCircleIcon size={22} weight="fill" className="text-xyne-error" />;
    case "cancelled":
      return <MinusCircleIcon size={22} weight="fill" className="text-xyne-fg-muted" />;
    // The union is exhaustive today, but the DB column is a plain string and
    // the backend can add a status before the frontend union catches up. With
    // no default the component returns undefined for such a row, which is not
    // a valid element — render the muted glyph instead of breaking the list.
    default:
      return <MinusCircleIcon size={22} weight="fill" className="text-xyne-fg-muted" />;
  }
}

/**
 * The run's session id, shortened, with copy-to-clipboard.
 *
 * Copying the SHORT form is deliberate: the paged listing matches a sessionId
 * prefix of 4+ chars, so the 8 chars on screen paste straight back into the
 * search box and resolve. Clicks are stopped from bubbling — the whole row is
 * a button that navigates, and copying an id must not also open the run.
 */
function SessionIdChip({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`${sessionId} — click to copy`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(sessionId).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
      className="inline-flex items-center gap-1 rounded font-mono text-[11px] text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-primary"
    >
      {shortSessionId(sessionId)}
      {copied ? (
        <CheckIcon size={11} className="text-xyne-success" />
      ) : (
        <CopyIcon size={11} className="opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}

/**
 * One run in a list. Shared verbatim between the agent Activity tab and the
 * admin Runs page so a run looks identical wherever it is listed — the class
 * names here are load-bearing for that, do not tweak them per-surface.
 *
 * `run` is typed to the light `AgentRunListItem`, which is a structural subset
 * of `AgentRun`, so callers holding a full row can pass it straight through.
 */
export function RunRow({
  run,
  showOwner,
  agentLabel,
  onOpen,
}: {
  run: AgentRunListItem;
  showOwner?: boolean;
  /** Display name of the agent. Pass it on CROSS-AGENT listings only — on the
   *  agent Activity tab every row is the same agent and the chip is noise. */
  agentLabel?: string;
  onOpen?: () => void;
}) {
  const duration =
    run.completedAt
      ? formatDuration(run.startedAt, run.completedAt)
      : run.status === "running"
        ? "Running…"
        : null;

  const tokens =
    run.tokensIn != null || run.tokensOut != null
      ? `${run.tokensIn ?? 0} → ${run.tokensOut ?? 0} tok`
      : null;

  // Collected meta facts rendered on the second line with `·` separators
  // — e.g. "Chat · 1d ago · 7s · 27994 → 336 tok".
  const metaParts = [
    // In admin "All Runs" mode, lead with the owning user so runs are
    // attributable — real name/email when the scope=all listing hydrated it,
    // falling back to a short id.
    showOwner ? runOwnerLabel(run) : null,
    triggerLabel(run.triggerSource),
    formatTimeAgo(run.startedAt),
    duration,
    tokens,
  ].filter((p): p is string => !!p);

  const clickable = !!onOpen;
  return (
    <div
      onClick={onOpen}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      className={`group flex items-center gap-3 rounded-lg border border-xyne-border-subtle px-4 py-3 transition-colors hover:bg-xyne-surface-subtle hover:border-xyne-border ${
        clickable ? "cursor-pointer" : ""
      }`}
    >
      <StatusIcon status={run.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {/* The agent reads as a label ON the run, not as a separate column
              beside it — a fixed-width badge outside the card left long names
              truncated against a hard edge and detached the name from the row
              it described. `shrink-0` up to a cap so a long agent name yields
              to the task text rather than squeezing it out. */}
          {agentLabel && (
            <span
              title={run.agentSlug}
              className="max-w-[9rem] shrink-0 truncate rounded bg-xyne-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-xyne-fg-secondary"
            >
              {agentLabel}
            </span>
          )}
          <span className="truncate text-[13px] font-medium text-xyne-fg-primary">
            {truncate(run.task, 80)}
          </span>
        </div>
        <div className="flex items-center flex-wrap gap-x-1.5 text-[11px] text-xyne-fg-tertiary">
          <SessionIdChip sessionId={run.sessionId} />
          {metaParts.map((part, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="text-xyne-fg-muted">·</span>
              {part}
            </span>
          ))}
        </div>
      </div>
      {clickable && (
        <CaretRightIcon
          size={16}
          className="shrink-0 text-xyne-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
    </div>
  );
}
