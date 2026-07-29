// Single source of truth for Digital Twin subsystem / source / category display
// metadata. The reference app duplicated these maps across four components; the
// port centralizes them here.

import {
  Contact,
  FileText,
  FolderOpen,
  GitBranch,
  GraduationCap,
  Pencil,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** The 8 curated subsystems the backend groups memories into. */
export const SUBSYSTEM_LABELS: Record<string, string> = {
  style: 'Communication style',
  expertise: 'Expertise',
  projects: 'Projects',
  relationships: 'Relationships',
  preferences: 'Preferences',
  decisions: 'Decisions',
  context: 'Context',
  docs: 'Documents',
};

export const SUBSYSTEM_ICONS: Record<string, LucideIcon> = {
  style: Pencil,
  expertise: GraduationCap,
  projects: FolderOpen,
  relationships: Users,
  preferences: SlidersHorizontal,
  decisions: GitBranch,
  context: Contact,
  docs: FileText,
};

/** Chart fills (data-viz accents — literal hex is fine per the port convention). */
export const SUBSYSTEM_COLORS: Record<string, string> = {
  style: '#6366f1',
  expertise: '#0ea5e9',
  projects: '#10b981',
  relationships: '#f59e0b',
  preferences: '#ec4899',
  decisions: '#8b5cf6',
  context: '#14b8a6',
  docs: '#94a3b8',
};

export const subsystemLabel = (subsystem: string): string =>
  SUBSYSTEM_LABELS[subsystem] ?? subsystem;

const FALLBACK_PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
export const subsystemColor = (subsystem: string, index = 0): string =>
  SUBSYSTEM_COLORS[subsystem] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] ?? '#6366f1';

/** Intake sources shown in the metrics "by source" breakdown. */
export const SOURCE_LABELS: Record<string, string> = {
  daily: 'Daily curator',
  upload: 'Uploaded docs',
  backfill: 'Backfill',
};

export const sourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source;

// ── Memory categories ──────────────────────────────────────────────────────────

export interface CategoryStyle {
  label: string;
  className: string;
}

/** Semantic-token classes for the four Hindsight memory categories. */
export const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  world: {
    label: 'WORLD',
    className: 'border-emerald-500/60 text-emerald-600 dark:text-emerald-400',
  },
  experience: {
    label: 'EXPERIENCE',
    className: 'border-primary/60 text-primary',
  },
  observation: {
    label: 'OBSERVATION',
    className: 'border-amber-500/60 text-amber-600 dark:text-amber-400',
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- backend category key
  mental_model: {
    label: 'MENTAL MODEL',
    className: 'border-border text-muted-foreground',
  },
};

export const CATEGORY_LEGEND: Array<{ key: keyof typeof CATEGORY_STYLES; description: string }> = [
  { key: 'world', description: 'Durable, objective fact about you or your work.' },
  {
    key: 'experience',
    description: "Something observed during the agent's own runs — what it tried, what worked.",
  },
  {
    key: 'observation',
    description: 'Secondary extraction pass — often a near-duplicate rephrasing of a WORLD fact.',
  },
  {
    key: 'mental_model',
    description: 'Captured judgment call or framing the agent should respect.',
  },
];
