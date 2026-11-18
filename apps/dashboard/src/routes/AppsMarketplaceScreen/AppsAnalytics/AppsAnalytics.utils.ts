import type { ArtifactAppsAnalytics } from '@/services/claw/artifactAppsService';

const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const FULL = new Intl.NumberFormat();

/** Stat-tile values: in full below 10,000, compact above (12.9K). */
export function formatCount(n: number): string {
  return n < 10_000 ? FULL.format(n) : COMPACT.format(n);
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** One status-bar part: every app is in exactly one. */
export interface CompositionPart {
  key: keyof ArtifactAppsAnalytics['composition'];
  label: string;
  /** CSS variable holding the fill. */
  color: string;
  /** Ink for a count printed inside the fill. */
  ink: string;
  count: number;
}

/** Fixed order and colour per part, so a part keeps its colour when others are zero. */
export function compositionParts(c: ArtifactAppsAnalytics['composition']): CompositionPart[] {
  return [
    {
      key: 'published',
      label: 'Published',
      color: 'var(--viz-series-1)',
      ink: '#ffffff',
      count: c.published,
    },
    {
      key: 'private',
      label: 'Private',
      color: 'var(--viz-series-2)',
      ink: '#ffffff',
      count: c.private,
    },
    {
      key: 'empty',
      label: 'Never built',
      color: 'var(--viz-series-3)',
      ink: '#ffffff',
      count: c.empty,
    },
    {
      key: 'archived',
      label: 'Archived',
      color: 'var(--viz-series-4)',
      ink: 'var(--viz-on-series-4)',
      count: c.archived,
    },
  ];
}

/** Axis ticks every few days so labels never collide, whatever the range. */
export function tickInterval(days: number): number {
  if (days <= 7) return 0;
  if (days <= 30) return 4;
  return 13;
}
