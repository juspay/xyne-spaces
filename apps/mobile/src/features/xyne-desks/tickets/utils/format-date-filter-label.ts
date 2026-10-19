export type TicketsDateRange = {
  /** Inclusive start (ms). */
  start?: number;
  /** Inclusive end (ms). */
  end?: number;
};

export type TicketsDatePreset = 'today' | 'week' | 'month';

/** Local calendar day → UTC midnight (matches dashboard DateRangeSubmenu start). */
export function dateStringToStartMs(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

/** Local calendar day → UTC end of day (matches dashboard DateRangeSubmenu end). */
export function dateStringToEndMs(value: string): number {
  return new Date(`${value}T23:59:59.999Z`).getTime();
}

export function msToDateInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatShortFilterDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Gmail-style date chip label:
 * - none → "Date"
 * - preset match → "Today" / "Last 7 days" / "Last 30 days"
 * - custom → "Jan 1 – Jan 7" or single day
 */
export function formatDateFilterLabel(range: TicketsDateRange | null | undefined): string {
  if (!range?.start && !range?.end) return 'Date';

  const preset = matchDatePreset(range);
  if (preset === 'today') return 'Today';
  if (preset === 'week') return 'Last 7 days';
  if (preset === 'month') return 'Last 30 days';

  if (range.start != null && range.end != null) {
    const startLabel = formatShortFilterDate(range.start);
    const endLabel = formatShortFilterDate(range.end);
    if (msToDateInputValue(range.start) === msToDateInputValue(range.end)) {
      return startLabel;
    }
    return `${startLabel} – ${endLabel}`;
  }

  if (range.start != null) return `From ${formatShortFilterDate(range.start)}`;
  if (range.end != null) return `Until ${formatShortFilterDate(range.end)}`;
  return 'Date';
}

/** Dashboard DateRangeSubmenu presets (local midnight). */
export function getDatePresetRange(preset: TicketsDatePreset): TicketsDateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = today.getTime() + 24 * 60 * 60 * 1000 - 1;

  switch (preset) {
    case 'today':
      return { start: today.getTime(), end };
    case 'week': {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);
      return { start: weekStart.getTime(), end };
    }
    case 'month': {
      const monthStart = new Date(today);
      monthStart.setDate(today.getDate() - 30);
      return { start: monthStart.getTime(), end };
    }
  }
}

export function matchDatePreset(range: TicketsDateRange): TicketsDatePreset | null {
  if (range.start == null || range.end == null) return null;
  const presets: TicketsDatePreset[] = ['today', 'week', 'month'];
  for (const preset of presets) {
    const expected = getDatePresetRange(preset);
    if (
      expected.start != null &&
      expected.end != null &&
      Math.abs(expected.start - range.start) < 1000 &&
      Math.abs(expected.end - range.end) < 1000
    ) {
      return preset;
    }
  }
  return null;
}

export function isDateRangeActive(range: TicketsDateRange | null | undefined): boolean {
  return range?.start != null || range?.end != null;
}
