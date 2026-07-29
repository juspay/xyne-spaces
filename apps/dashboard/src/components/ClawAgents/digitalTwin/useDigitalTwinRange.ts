import { useMemo, useState } from 'react';
import { useClawDigitalTwinEstimate } from '@/hooks/useClawDigitalTwin';
import type { DigitalTwinEstimate } from '@/services/claw/digitalTwinTypes';

export type DigitalTwinRange = { from: string; to: string } | null;

export interface RangePreset {
  /** Compact label for a segmented control. */
  short: string;
  /** Full label for a stacked list. */
  label: string;
  sublabel: string;
  months: number | null;
}

const PRESETS_ENABLE: RangePreset[] = [
  {
    short: 'Skip',
    label: 'Skip backfill',
    sublabel: 'Start learning from today only',
    months: null,
  },
  { short: '3 mo', label: 'Last 3 months', sublabel: 'Light — recent context', months: 3 },
  { short: '6 mo', label: 'Last 6 months', sublabel: 'Recommended — solid coverage', months: 6 },
  { short: '12 mo', label: 'Last 12 months', sublabel: 'Deep — full year of history', months: 12 },
];

const PRESETS_BACKFILL: RangePreset[] = [
  { short: '3 mo', label: 'Last 3 months', sublabel: 'Recent context only', months: 3 },
  { short: '6 mo', label: 'Last 6 months', sublabel: 'Solid coverage', months: 6 },
  { short: '12 mo', label: 'Last 12 months', sublabel: 'Full year of history', months: 12 },
  { short: '24 mo', label: 'Last 24 months', sublabel: 'Maximum depth', months: 24 },
];

export const QUICK_DAYS = [7, 14, 30, 60, 90];

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};
const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

export interface UseDigitalTwinRangeResult {
  presets: RangePreset[];
  selection: 'preset' | 'custom';
  presetIdx: number;
  selectPreset: (index: number) => void;
  selectCustom: () => void;
  activePreset: RangePreset | null;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  customDays: number;
  applyQuickDays: (n: number) => void;
  range: DigitalTwinRange;
  estimate: DigitalTwinEstimate | undefined;
  estimateLoading: boolean;
}

/**
 * Shared range state + live scope/cost estimate for the enable/backfill flows.
 * Presentation lives in the callers (inline panel vs. dialog).
 */
export function useDigitalTwinRange(
  mode: 'enable' | 'backfill',
  active: boolean,
): UseDigitalTwinRangeResult {
  const presets = mode === 'enable' ? PRESETS_ENABLE : PRESETS_BACKFILL;
  const [selection, setSelection] = useState<'preset' | 'custom'>('preset');
  const [presetIdx, setPresetIdx] = useState(mode === 'enable' ? 2 : 1);
  const [customFrom, setCustomFrom] = useState(() => daysAgo(7));
  const [customTo, setCustomTo] = useState(() => isoDate(new Date()));

  const range = useMemo((): DigitalTwinRange => {
    if (selection === 'custom') {
      if (!customFrom || !customTo || customFrom > customTo) return null;
      return { from: customFrom, to: customTo };
    }
    const preset = presets[presetIdx];
    if (!preset || preset.months === null) return null;
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - preset.months);
    return { from: isoDate(from), to: isoDate(to) };
  }, [selection, presetIdx, presets, customFrom, customTo]);

  const estimateQuery = useClawDigitalTwinEstimate(
    range?.from ?? '',
    range?.to ?? '',
    active && !!range,
  );

  return {
    presets,
    selection,
    presetIdx,
    selectPreset: (index: number): void => {
      setSelection('preset');
      setPresetIdx(index);
    },
    selectCustom: () => setSelection('custom'),
    activePreset: selection === 'preset' ? (presets[presetIdx] ?? null) : null,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    customDays: daysBetween(customFrom, customTo),
    applyQuickDays: (n: number): void => {
      setCustomFrom(daysAgo(n));
      setCustomTo(isoDate(new Date()));
    },
    range,
    estimate: estimateQuery.data,
    estimateLoading: estimateQuery.isFetching,
  };
}
