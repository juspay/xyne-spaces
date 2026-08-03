import { ReactElement, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { DIGITAL_TWIN_KIND_META, type DigitalTwinDeviceKind } from './digitalTwinData';
import {
  STATUS_META,
  groupPointsByDevice,
  type ChartTimeseriesPoint,
  type DeviceLane,
} from './TelepresenceAnalyticsScreen.utils';

// A single line graph of device health over time: one stepped line per
// device, y-axis is the health level (Active/Unknown/Degraded/Unavailable),
// x-axis is time. Hovering a point shows the exact status and
// connected/detected counts for every device reporting at that moment.

const MINUTE = 60 * 1000;
const TICK_COUNT = 6;

// Categorical series colors in fixed assignment order (dataviz palette),
// chosen so they never collide with the reserved green/amber/red status
// colors used for badges elsewhere on the page.
const SERIES_COLORS = [
  '#2a78d6',
  '#1baf7a',
  '#4a3aa7',
  '#e87ba4',
  '#eb6834',
  '#eda100',
  '#199e70',
  '#9085e9',
];

const CHART_LEVELS = [0, 1, 2, 3];
const LEVEL_TO_LABEL = new Map<number, string>(
  Object.values(STATUS_META).map(meta => [meta.chartLevel, meta.label]),
);

interface ChartRow {
  t: number;
  meta: Record<string, ChartTimeseriesPoint>;
  [laneKey: string]: number | null | Record<string, ChartTimeseriesPoint>;
}

const buildRows = (lanes: DeviceLane[]): ChartRow[] => {
  const rowsByTime = new Map<number, ChartRow>();
  for (const lane of lanes) {
    for (const point of lane.points) {
      const t = new Date(point.reportedAt).getTime();
      let row = rowsByTime.get(t);
      if (!row) {
        row = { t, meta: {} };
        rowsByTime.set(t, row);
      }
      row[lane.key] = STATUS_META[point.status].chartLevel;
      row.meta[lane.key] = point;
    }
  }
  return [...rowsByTime.values()].sort((a, b) => a.t - b.t);
};

const formatTime = (t: number, rangeMs: number): string => {
  const date = new Date(t);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (rangeMs <= 26 * 60 * MINUTE) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

const laneDisplayName = (lane: DeviceLane): string =>
  `${lane.name} · ${DIGITAL_TWIN_KIND_META[lane.deviceType as DigitalTwinDeviceKind]?.label ?? lane.deviceType}`;

interface TooltipEntry {
  dataKey?: string | number;
  color?: string;
  payload?: ChartRow;
}

const ChartTooltip = ({
  active,
  payload,
  laneByKey,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  laneByKey: Map<string, DeviceLane>;
}): ReactElement | null => {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const entries = (payload ?? []).filter(
    entry => typeof entry.dataKey === 'string' && row.meta[entry.dataKey],
  );
  if (entries.length === 0) return null;
  return (
    <div className='rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md'>
      <p className='mb-1 font-medium tabular-nums'>
        {new Date(row.t).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </p>
      {entries.map(entry => {
        const key = entry.dataKey as string;
        const point = row.meta[key];
        const lane = laneByKey.get(key);
        if (!point || !lane) return null;
        const meta = STATUS_META[point.status];
        const StatusIcon = meta.icon;
        return (
          <p key={key} className='flex items-center gap-1.5 py-0.5'>
            <span
              className='inline-block h-2 w-2 shrink-0 rounded-full'
              style={{ backgroundColor: entry.color }}
            />
            <span className='font-medium'>{laneDisplayName(lane)}</span>
            <span className='text-muted-foreground'>({lane.userId})</span>
            <StatusIcon size={12} style={{ color: meta.color }} aria-hidden='true' />
            {meta.label}
            <span className='text-muted-foreground'>
              · {point.detected}/{point.connected} detected
            </span>
          </p>
        );
      })}
    </div>
  );
};

const TimeseriesChart = ({
  points,
  from,
  to,
}: {
  points: ChartTimeseriesPoint[];
  from: Date;
  to: Date;
}): ReactElement => {
  const lanes = useMemo(() => groupPointsByDevice(points), [points]);
  const laneByKey = useMemo(() => new Map(lanes.map(lane => [lane.key, lane])), [lanes]);
  const rows = useMemo(() => buildRows(lanes), [lanes]);

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const rangeMs = toMs - fromMs;
  const ticks = useMemo(
    () => Array.from({ length: TICK_COUNT }, (_, i) => fromMs + (rangeMs * i) / (TICK_COUNT - 1)),
    [fromMs, rangeMs],
  );

  if (lanes.length === 0) {
    return (
      <div className='rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground'>
        No health reports in the selected range.
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='h-80 text-muted-foreground'>
        <ResponsiveContainer width='100%' height='100%'>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke='rgba(128,128,128,0.15)' vertical={false} />
            <XAxis
              dataKey='t'
              type='number'
              domain={[fromMs, toMs]}
              ticks={ticks}
              tickFormatter={t => formatTime(t as number, rangeMs)}
              tick={{ fill: 'currentColor', fontSize: 11 }}
              stroke='rgba(128,128,128,0.35)'
              tickLine={false}
            />
            <YAxis
              domain={[-0.3, 3.3]}
              ticks={CHART_LEVELS}
              tickFormatter={level => LEVEL_TO_LABEL.get(level as number) ?? ''}
              tick={{ fill: 'currentColor', fontSize: 11 }}
              stroke='rgba(128,128,128,0.35)'
              tickLine={false}
              width={82}
            />
            <Tooltip
              content={<ChartTooltip laneByKey={laneByKey} />}
              cursor={{ stroke: 'rgba(128,128,128,0.35)', strokeDasharray: '3 3' }}
            />
            {lanes.map((lane, index) => (
              <Line
                key={lane.key}
                dataKey={lane.key}
                name={lane.key}
                type='stepAfter'
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* A custom legend in normal document flow — recharts' built-in Legend
          renders inside the chart's fixed-height box and silently overflows
          (and visually collides with page content above it) once there are
          more than a handful of lanes. This one just wraps and stays put. */}
      <div className='flex max-h-24 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto text-xs'>
        {lanes.map((lane, index) => (
          <span key={lane.key} className='flex items-center gap-1.5 text-muted-foreground'>
            <span
              className='inline-block size-2 shrink-0 rounded-full'
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              aria-hidden='true'
            />
            {laneDisplayName(lane)}
          </span>
        ))}
      </div>
    </div>
  );
};

export default TimeseriesChart;
