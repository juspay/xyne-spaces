import type { ReactElement } from 'react';
import {
  Boxes,
  FileText,
  GitMerge,
  Rocket,
  Server,
  TestTube,
  Ticket as TicketIcon,
} from 'lucide-react';
import { cn } from '../../utils/classNames';
import { formatDateNumeric } from '../../utils/dateUtils';

// Map ReleaseEventType (from shared schema) to icon + color for the timeline.
const EVENT_VISUAL: Record<string, { icon: ReactElement; bg: string; ring: string }> = {
  RELEASE: {
    icon: <Rocket size={12} />,
    bg: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    ring: 'ring-purple-200 dark:ring-purple-800',
  },
  TICKET: {
    icon: <TicketIcon size={12} />,
    bg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    ring: 'ring-blue-200 dark:ring-blue-800',
  },
  SUBTICKET: {
    icon: <Boxes size={12} />,
    bg: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400',
    ring: 'ring-cyan-200 dark:ring-cyan-800',
  },
  TESTING: {
    icon: <TestTube size={12} />,
    bg: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    ring: 'ring-amber-200 dark:ring-amber-800',
  },
  SYSTEM: {
    icon: <Server size={12} />,
    bg: 'bg-gray-200 dark:bg-gray-700/40 text-gray-700 dark:text-gray-300',
    ring: 'ring-gray-300 dark:ring-gray-700',
  },
  CANVAS: {
    icon: <FileText size={12} />,
    bg: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    ring: 'ring-green-200 dark:ring-green-800',
  },
};

const EVENT_FALLBACK = {
  icon: <GitMerge size={12} />,
  bg: 'bg-muted text-muted-foreground',
  ring: 'ring-border',
};

/** Short relative-time formatter for the timeline. Keeps the timeline scannable
 * without dragging in date-fns just for one screen. */
function formatRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 30 * 86_400) return `${Math.floor(diffSec / 86_400)}d ago`;
  return formatDateNumeric(ts);
}

// Human-readable titles for the eventName values written by the backend.
// Falls back to title-casing the raw name for any we forgot to map.
const EVENT_TITLES: Record<string, string> = {
  COMMIT_ANALYSIS_STARTED: 'Analysis started',
  COMMIT_ANALYSIS_COMPLETED: 'Analysis complete',
  SUBTICKET_PROVISIONED: 'Application prepared',
  STAGE_CHANGED: 'Stage changed',
  FORM_SAVED: 'Form values saved',
  REPORT_PUBLISHED: 'Report published',
  REPORT_UPDATED: 'Report updated',
  MAPPING_WRITE_FAILED: 'Failed to write release mappings',
};
const humanizeEventName = (raw: string): string =>
  EVENT_TITLES[raw] ??
  raw
    .toLowerCase()
    .split('_')
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');

interface ReleaseTimelineEvent {
  id: string;
  eventType: string;
  eventName: string;
  message: string;
  userName: string | null;
  userId: string | null;
  createdAt: number;
}

/** A timeline row — either a single event, or a stack of N identical-name
 * events that fired within a short window (e.g. four FORM_SAVED events from
 * one commit analysis run). Stacking collapses the visual noise without
 * hiding information. */
interface TimelineGroup {
  key: string;
  eventType: string;
  eventName: string;
  /** Most-recent timestamp from the group; what we display. */
  createdAt: number;
  /** All actor names found in the group (almost always one). */
  actors: string[];
  /** Each event's message body; rendered as a small list when count > 1. */
  messages: string[];
  count: number;
}

/**
 * Collapse consecutive events with the same eventType+eventName into one row.
 * Events further apart than `windowMs` aren't merged, so distinct release runs
 * stay visually separated even when they share an eventName.
 */
function groupTimelineEvents(
  events: ReadonlyArray<ReleaseTimelineEvent>,
  windowMs = 5 * 60 * 1000,
): TimelineGroup[] {
  const out: TimelineGroup[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    const sameKind = last && last.eventType === ev.eventType && last.eventName === ev.eventName;
    const withinWindow = last && Math.abs(last.createdAt - ev.createdAt) <= windowMs;
    if (sameKind && withinWindow) {
      last.count++;
      last.messages.push(ev.message);
      const actor = ev.userName || (ev.userId ? 'a user' : 'system');
      if (!last.actors.includes(actor)) last.actors.push(actor);
      continue;
    }
    out.push({
      key: ev.id,
      eventType: ev.eventType,
      eventName: ev.eventName,
      createdAt: ev.createdAt,
      actors: [ev.userName || (ev.userId ? 'a user' : 'system')],
      messages: [ev.message],
      count: 1,
    });
  }
  return out;
}

/** Audit log of a release: commit analyses, SubTicket creation, env/migration
 * captures, system events and canvas publishes, newest first. */
export const ReleaseTimeline = ({
  events,
}: {
  events: ReadonlyArray<ReleaseTimelineEvent> | undefined;
}): ReactElement => {
  if (!events || events.length === 0) {
    return (
      <div className='text-center py-8 bg-muted rounded-lg border border-dashed border-border'>
        <p className='text-sm text-muted-foreground'>
          No events yet. The timeline fills up as commit analysis runs and the release progresses
          through stages.
        </p>
      </div>
    );
  }
  return (
    <ol className='relative border-l border-border ml-3 space-y-3'>
      {groupTimelineEvents(events).map(g => {
        const visual = EVENT_VISUAL[g.eventType] ?? EVENT_FALLBACK;
        const absoluteTime = new Date(g.createdAt).toLocaleString();
        const actor = g.actors.join(', ');
        const uniqueMessages = Array.from(new Set(g.messages.filter(Boolean)));
        return (
          <li key={g.key} className='ml-6'>
            <span
              className={cn(
                'absolute -left-[11px] flex items-center justify-center w-[22px] h-[22px] rounded-full ring-4 ring-background',
                visual.bg,
              )}
            >
              {visual.icon}
            </span>
            <div className='flex items-baseline justify-between gap-3'>
              <div className='flex items-baseline gap-2 min-w-0'>
                <span className='text-sm font-medium text-foreground truncate'>
                  {humanizeEventName(g.eventName)}
                </span>
                {g.count > 1 && (
                  <span
                    className='text-[11px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full'
                    title={`${g.count} occurrences in a short window`}
                  >
                    ×{g.count}
                  </span>
                )}
              </div>
              <span
                className='text-xs text-muted-foreground shrink-0 whitespace-nowrap'
                title={`${absoluteTime} · by ${actor}`}
              >
                {formatRelativeTime(g.createdAt)}
              </span>
            </div>
            {uniqueMessages.length > 0 && (
              <div className='mt-0.5 text-sm text-muted-foreground space-y-0.5'>
                {uniqueMessages.map((m, i) => (
                  <p key={i} className='whitespace-pre-wrap break-words'>
                    {m}
                  </p>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
};
