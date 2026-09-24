import { ReactElement, useCallback, useEffect, useMemo, useReducer } from 'react';
import { IDLE, useColumnActivity, type ColumnActivity } from './useColumnActivity';
import type { Column, ColumnSource } from '../components/Streams/Streams.types';

/** Every column's activity, keyed by column id. */
export type StreamActivity = Readonly<Record<string, ColumnActivity>>;

interface Report {
  columnId: string;
  activity: ColumnActivity;
}

type ActivityMap = Record<string, ColumnActivity>;

const unchanged = (previous: ColumnActivity | undefined, next: ColumnActivity): boolean =>
  previous !== undefined && previous.count === next.count && previous.hasNew === next.hasNew;

const reducer = (state: ActivityMap, report: Report): ActivityMap =>
  unchanged(state[report.columnId], report.activity)
    ? state
    : { ...state, [report.columnId]: report.activity };

/**
 * Holds one column's activity subscription and reports it upward.
 *
 * Renders nothing — it exists to own a hook. Activity is per-column and hooks
 * cannot be called in a loop, so N columns means N component instances; the same
 * shape `ChannelProbe` uses in the feed, for the same reason.
 */
const ColumnActivityProbe = ({
  columnId,
  source,
  onReport,
}: {
  columnId: string;
  source: ColumnSource;
  onReport: (report: Report) => void;
}): null => {
  const { count, hasNew } = useColumnActivity(source);

  // Depends on the two values rather than the object, which is fresh each render.
  useEffect(() => {
    onReport({ columnId, activity: { count, hasNew } });
  }, [onReport, columnId, count, hasNew]);

  return null;
};

export interface StreamActivityHandle {
  activity: StreamActivity;
  /** Mount this once, anywhere inside the screen. It renders nothing. */
  probes: ReactElement;
  /**
   * Let a surface publish its own signal.
   *
   * `useColumnActivity` speaks channel and thread; a feed's "new" is whether
   * anything has matched its topic since you last looked, which only the feed
   * can know. A report always wins over the probe for that column.
   */
  report: (columnId: string, activity: ColumnActivity) => void;
}

/**
 * One activity map for the whole stream, owned by the screen.
 *
 * Previously each column header and each overview card called
 * `useColumnActivity` for itself — three subscriptions per column, and no single
 * place that knew what was happening in a column you *cannot currently see*.
 * Off-screen notification needs exactly that, so ownership moves up and the
 * views take a value.
 */
export const useStreamActivity = (columns: readonly Column[]): StreamActivityHandle => {
  const [probed, reportProbe] = useReducer(reducer, {});
  const [published, reportSurface] = useReducer(reducer, {});

  const report = useCallback((columnId: string, activity: ColumnActivity): void => {
    reportSurface({ columnId, activity });
  }, []);

  // Built from the current columns, so entries for closed ones fall away rather
  // than lingering in a map that only ever grows.
  const activity = useMemo<StreamActivity>(() => {
    const merged: ActivityMap = {};
    for (const column of columns) {
      merged[column.id] = published[column.id] ?? probed[column.id] ?? IDLE;
    }
    return merged;
  }, [columns, probed, published]);

  // Stable identity, so React can bail out: the probes only change when the
  // column list does, and re-running one costs a lookup over every visible channel.
  const probes = useMemo(
    () => (
      <>
        {columns.map(column => (
          <ColumnActivityProbe
            key={column.id}
            columnId={column.id}
            source={column.source}
            onReport={reportProbe}
          />
        ))}
      </>
    ),
    [columns],
  );

  return { activity, probes, report };
};
