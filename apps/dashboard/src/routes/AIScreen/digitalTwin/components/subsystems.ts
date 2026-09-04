import type { ComponentType, SVGProps } from 'react';
import {
  ContactsBook,
  FileDefault,
  FolderDefault,
  GitBranch,
  GraduationHat,
  PencilEdit,
  Settings02,
  UserThree,
} from '@xyne/icons';

type SubsystemIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

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

export const SUBSYSTEM_ICONS: Record<string, SubsystemIcon> = {
  style: PencilEdit as SubsystemIcon,
  expertise: GraduationHat as SubsystemIcon,
  projects: FolderDefault as SubsystemIcon,
  relationships: UserThree as SubsystemIcon,
  preferences: Settings02 as SubsystemIcon,
  decisions: GitBranch as SubsystemIcon,
  context: ContactsBook as SubsystemIcon,
  docs: FileDefault as SubsystemIcon,
};

export const subsystemLabel = (subsystem: string): string =>
  SUBSYSTEM_LABELS[subsystem] ?? subsystem;

export const SOURCE_LABELS: Record<string, string> = {
  daily: 'Daily curator',
  upload: 'Uploaded docs',
  backfill: 'Backfill',
};

export const sourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source;

export interface CategoryStyle {
  label: string;
  className: string;
}

export const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  world: {
    label: 'WORLD',
    className: 'border-status-success/60 text-status-success',
  },
  experience: {
    label: 'EXPERIENCE',
    className: 'border-primary/60 text-primary',
  },
  observation: {
    label: 'OBSERVATION',
    className: 'border-status-pending/60 text-status-pending',
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
