import { memo, type ReactElement } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { cn } from '../../../utils/classNames';

/** One trend row: a group's label plus its daily-volume sparkline. */
export interface TopicsTrendRow {
  key: string;
  label: string;
  colour: string;
  points: { day: string; count: number }[];
  /** False when clicking would do nothing, matching the paired tile. */
  canSelect: boolean;
}

/**
 * Hoisted: an inline `content={...}` is a fresh component type each render,
 * making recharts throw away and rebuild every tooltip.
 */
const TrendTooltipContent = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: unknown }[];
}): ReactElement | null => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as { day: string; count: number } | undefined;
  if (!p) return null;
  return (
    <div className='rounded-[8px] border border-border bg-background px-3 py-2 text-xs shadow-md'>
      <div className='font-medium'>{p.count.toLocaleString()} tickets</div>
      <div className='text-muted-foreground'>{p.day}</div>
    </div>
  );
};

export interface TopicsTrendPanelProps {
  rows: TopicsTrendRow[];
  /** Shared Y domain maximum across every group at this level. */
  max: number;
  hovered: string | null;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}

/**
 * One row, memoized individually so a hover re-renders the two rows whose
 * `isHovered` changed rather than every chart in the list.
 */
const TrendRowBase = ({
  row,
  max,
  isHovered,
  onHover,
  onSelect,
}: {
  row: TopicsTrendRow;
  max: number;
  isHovered: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}): ReactElement => (
  <button
    type='button'
    onClick={row.canSelect ? (): void => onSelect(row.key) : undefined}
    aria-disabled={!row.canSelect}
    onMouseEnter={() => onHover(row.key)}
    onMouseLeave={() => onHover(null)}
    // Focus mirrors hover, so tabbing through the rows highlights the paired
    // tile the same way pointing at one does.
    onFocus={() => onHover(row.key)}
    onBlur={() => onHover(null)}
    className={cn(
      'grid w-full grid-cols-[minmax(96px,150px)_1fr] items-center gap-3 border-b border-border/60 px-4 py-2 text-left transition-colors last:border-b-0',
      isHovered ? 'bg-accent/50' : 'hover:bg-accent/30',
      row.canSelect ? 'cursor-pointer' : 'cursor-default',
    )}
    data-track-category='TOPICS_EXPLORER'
    data-track-name='SELECT_GROUP_ROW'
  >
    <span className='flex min-w-0 items-center gap-2'>
      <span className='h-2.5 w-2.5 shrink-0 rounded-full' style={{ background: row.colour }} />
      <span className='truncate text-sm' title={row.label}>
        {row.label}
      </span>
    </span>

    <span className='block h-11'>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart data={row.points} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
          {/* Shared domain: per-row scaling makes 12 look like 1,500. */}
          <YAxis hide domain={[0, max]} />
          <Tooltip cursor={false} content={<TrendTooltipContent />} />
          <Area
            dataKey='count'
            type='monotone'
            stroke={row.colour}
            fill={row.colour}
            fillOpacity={0.25}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </span>
  </button>
);

const TrendRow = memo(TrendRowBase);

/** The right-hand trend list. */
export const TopicsTrendPanel = ({
  rows,
  max,
  hovered,
  onHover,
  onSelect,
}: TopicsTrendPanelProps): ReactElement => (
  <div className='min-h-0 flex-1 overflow-y-auto'>
    {rows.map(row => (
      <TrendRow
        key={row.key}
        row={row}
        max={max}
        isHovered={hovered === row.key}
        onHover={onHover}
        onSelect={onSelect}
      />
    ))}
  </div>
);
