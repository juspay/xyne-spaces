import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatFullTimestamp,
  formatTimeAmPm,
  formatFileBrowserDate,
} from '../../../utils/dateUtils';
import { bucketOccurrences, pickBucketSizeMs, DAY_MS } from './LogIssueTimeline.utils';

export function LogIssueTimeline({ timestamps }: { timestamps: number[] }): React.ReactElement {
  const { chartData, bucketSizeMs } = useMemo(() => {
    if (timestamps.length === 0) return { chartData: [], bucketSizeMs: 0 };
    let min = timestamps[0]!;
    let max = timestamps[0]!;
    for (const ts of timestamps) {
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
    const size = pickBucketSizeMs(max - min);
    const buckets = bucketOccurrences(timestamps, size, min, max);
    return {
      chartData: buckets.map(b => ({ time: b.bucketStart, count: b.count })),
      bucketSizeMs: size,
    };
  }, [timestamps]);

  const tickFormatter = (time: number): string =>
    bucketSizeMs >= DAY_MS ? formatFileBrowserDate(time) : formatTimeAmPm(time);

  return (
    <div className='bg-background rounded-lg border border-border p-6'>
      <h2 className='text-lg font-semibold text-foreground mb-3'>Events</h2>
      {chartData.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No occurrences to chart yet.</p>
      ) : (
        <div className='h-[220px]'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={chartData} margin={{ left: -8, right: 16 }}>
              <CartesianGrid strokeDasharray='3 3' vertical={false} />
              <XAxis dataKey='time' tick={{ fontSize: 11 }} tickFormatter={tickFormatter} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <RechartsTooltip
                cursor={false}
                labelFormatter={(time: number) => formatFullTimestamp(time)}
              />
              <Bar dataKey='count' name='Events' fill='#6366f1' radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
