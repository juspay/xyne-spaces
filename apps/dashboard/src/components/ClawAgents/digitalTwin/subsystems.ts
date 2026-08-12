// Single source of truth for Digital Twin subsystem / source / category display
// metadata. The reference app duplicated these maps across four components; the
// port centralizes them here.

import {
  ChatChatting,
  Contact,
  FileText,
  FolderOpen,
  GitBranch,
  GraduationCap,
  SlidersHorizontal,
  Users,
  type DigitalTwinIcon,
} from './icons';

/** The 8 curated subsystems the backend groups memories into. */
export const SUBSYSTEM_ORDER = [
  'style',
  'expertise',
  'projects',
  'relationships',
  'preferences',
  'decisions',
  'docs',
  'context',
] as const;

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

const SUBSYSTEM_ALIASES: Record<string, string> = {
  communication: 'style',
  people: 'relationships',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- backend category key
  'working-style': 'preferences',
  documents: 'docs',
  world: 'context',
  experience: 'context',
  observation: 'context',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- normalized backend category key
  'mental-model': 'context',
};

export const normalizeSubsystem = (subsystem: string): string => {
  const normalized = subsystem.trim().toLowerCase().replaceAll('_', '-');
  return SUBSYSTEM_ALIASES[normalized] ?? normalized;
};

export const SUBSYSTEM_ICONS: Record<string, DigitalTwinIcon> = {
  style: ChatChatting,
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
  style: '#d16dff',
  expertise: '#0ea5e9',
  projects: '#10b981',
  relationships: '#f59e0b',
  preferences: '#ec4899',
  decisions: '#6366f1',
  context: '#14b8a6',
  docs: '#94a3b8',
};

export const subsystemLabel = (subsystem: string): string =>
  SUBSYSTEM_LABELS[normalizeSubsystem(subsystem)] ?? subsystem;

export const subsystemIcon = (subsystem: string): DigitalTwinIcon | undefined =>
  SUBSYSTEM_ICONS[normalizeSubsystem(subsystem)];

export const subsystemRank = (subsystem: string): number => {
  const index = SUBSYSTEM_ORDER.indexOf(
    normalizeSubsystem(subsystem) as (typeof SUBSYSTEM_ORDER)[number],
  );
  return index === -1 ? SUBSYSTEM_ORDER.length : index;
};

const FALLBACK_PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
export const subsystemColor = (subsystem: string, index = 0): string =>
  SUBSYSTEM_COLORS[normalizeSubsystem(subsystem)] ??
  FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] ??
  '#6366f1';

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
    label: 'World',
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  experience: {
    label: 'Experience',
    className: 'border-primary/25 bg-primary/10 text-foreground',
  },
  observation: {
    label: 'Observation',
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- backend category key
  mental_model: {
    label: 'Mental model',
    className: 'border-border bg-muted text-muted-foreground',
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
