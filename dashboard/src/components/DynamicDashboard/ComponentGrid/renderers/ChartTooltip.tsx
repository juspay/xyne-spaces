import type { ReactElement } from 'react';
import { formatCellValue, formatKpiValue, type UnitPosition } from './utils';

interface TooltipItem {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
  hideLabel?: boolean;
  unit?: string | undefined;
  unitPosition?: UnitPosition | undefined;
}

function formatTooltipValue(v: unknown, unit?: string, unitPosition?: UnitPosition): string {
  const fmt = (n: number): string => formatKpiValue(n, unit, unitPosition);
  if (Array.isArray(v)) {
    const nums = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    if (nums.length === 2) return `${fmt(nums[0]!)} – ${fmt(nums[1]!)}`;
    if (nums.length > 0) return nums.map(fmt).join(', ');
    return v.map(x => formatCellValue(x)).join(', ');
  }
  if (typeof v === 'number') return Number.isFinite(v) ? fmt(v) : String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t !== '') {
      const n = Number(t);
      if (Number.isFinite(n)) return fmt(n);
    }
    return v;
  }
  return formatCellValue(v);
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  hideLabel,
  unit,
  unitPosition,
}: ChartTooltipProps): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;

  const heading =
    !hideLabel && label !== undefined && label !== ''
      ? labelFormatter
        ? labelFormatter(label)
        : String(label)
      : null;

  return (
    <div className='min-w-[120px] max-w-[280px] rounded-lg border border-border bg-popover/95 backdrop-blur-sm px-3 py-2 shadow-lg'>
      {heading !== null && (
        <div className='mb-1.5 text-[11px] font-medium text-muted-foreground'>{heading}</div>
      )}
      <div className='flex flex-col gap-1'>
        {payload.map((p, i) => {
          const key = String(p.dataKey ?? '');
          if (key === '__breach') return null;
          const isBand = key.startsWith('__band');
          const rawName = p.name !== undefined && p.name !== '' ? String(p.name) : '';
          const name = isBand ? 'Range' : rawName.startsWith('__') ? '' : rawName;
          return (
            <div
              key={String(p.dataKey ?? p.name ?? i)}
              className='flex items-center gap-2 text-[12px]'
            >
              {p.color && (
                <span
                  className='shrink-0 w-2 h-2 rounded-full'
                  style={{ backgroundColor: p.color }}
                />
              )}
              {name !== '' && <span className='truncate text-muted-foreground'>{name}</span>}
              <span className='ml-auto shrink-0 pl-3 font-mono text-[12px] font-semibold tabular-nums text-foreground'>
                {formatTooltipValue(p.value, unit, unitPosition)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
