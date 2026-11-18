import type { ArtifactAppsAnalyticsDay } from '@/services/claw/artifactAppsService';

/** One plotted series of a daily chart: which field, its name, and the CSS colour of its marks. */
export type Series = { key: keyof ArtifactAppsAnalyticsDay; label: string; color: string };

/** Every chart has a table twin; this is which one a card is showing. */
export type View = 'chart' | 'table';
